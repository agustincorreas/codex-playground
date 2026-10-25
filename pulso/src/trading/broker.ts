// Bróker de práctica, lo más parecido posible a operar de verdad:
// - Las órdenes tardan en llegar al mercado (latencia) y se ejecutan contra el libro (Level 2): una
//   compra grande paga varios niveles y una venta en una acción fina puede deslizar bastante.
// - Las órdenes límite esperan su turno en la cola de su precio y se ejecutan con los prints de la
//   cinta, a veces en partes. Los stops se disparan con el último precio y salen a mercado.
// - Reglas de la sesión: fuera de la rueda regular solo órdenes límite (DAY+), en halt no se ejecuta
//   nada. Comisiones y tasas regulatorias (SEC y FINRA) en las ventas.
// - Cuenta cash con liquidación T+1, o cuenta margen con la regla PDT por debajo de US$ 25.000.
// Lleva las posiciones y el efectivo y arma un trade por cada ida y vuelta. Solo compras (long).
import type { Quote, TapePrint } from '../engine/types';
import { roundPx, tickOf, type DepthBook, type Part } from './depth';
import type { ActiveSession, EntryContext, ExitReason, Fill, Order, OrderRole, OrderSide, OrderStatus, OrderType, Position, Tif, Trade, TradingSettings } from './types';

/** Lo que el bróker necesita del mercado. */
export interface MarketAccess {
  quote(sym: string): Quote | null;
  /** Libro con profundidad sincronizado al NBBO (null si no hay cotización). */
  book(sym: string): DepthBook | null;
  /** Prints de la cinta posteriores a `seq`. */
  printsSince(sym: string, seq: number): TapePrint[];
  lastSeq(): number;
  session(now: number): 'pre' | 'regular' | 'post' | 'closed';
}

export interface OrderRequest {
  sym: string;
  side: OrderSide;
  type: OrderType;
  shares: number;
  /** Precio límite. */
  price?: number;
  /** Precio de disparo (órdenes stop). */
  stopPrice?: number;
  tif?: Tif;
  route?: string;
  /** Stop y objetivo que se colocan como OCO cuando la compra se ejecuta. */
  stop?: number;
  target?: number;
  /** Stop y objetivo del plan: quedan anotados en la posición (riesgo y R) sin mandar órdenes. */
  planStop?: number;
  planTarget?: number;
  setup?: string;
  ctx?: EntryContext;
  role?: OrderRole;
}

export interface BrokerResult {
  ok: boolean;
  message: string;
  fills: Fill[];
  order?: Order;
}

export interface BrokerEvents {
  onFill?(fill: Fill, trade?: Trade): void;
  /**
   * Una orden quedó esperando en el mercado ('open') o se canceló sin que el usuario la cancelara
   * ('canceled': venció, sin liquidez, sin poder de compra...). Las cancelaciones que son consecuencia
   * de otra cosa (OCO, posición cerrada, reemplazo, cierre del día) no se avisan.
   */
  onOrder?(kind: 'open' | 'canceled', order: Order): void;
  /** Avisos que no vienen de una acción del usuario (una orden cancelada al ejecutarse, por ejemplo). */
  onNotice?(message: string): void;
  onChange?(): void;
  /** Velas de 1 minuto para guardar con el trade y poder revisarlo después. */
  captureBars?(sym: string, from: number, to: number): number[][] | undefined;
}

/** Último precio por símbolo para valuar posiciones. */
export type Marks = (sym: string) => number | undefined;

/** Reglas de la cuenta que dependen de días anteriores. */
export interface AccountRules {
  /** Day trades de los últimos 4 días de práctica (con los de hoy completan la ventana de 5). */
  priorDayTrades: number;
}

const MIN = 60_000;
const EPS = 1e-9;
/** Tasa de la SEC (Sección 31) desde abril de 2026: US$ 20,60 por millón vendido. */
export const SEC_FEE_RATE = 20.6 / 1_000_000;
/** FINRA TAF 2026: US$ 0,000195 por acción vendida, con un máximo de US$ 9,79 por operación. */
export const TAF_RATE = 0.000195;
export const TAF_MAX = 9.79;
const HISTORY_MAX = 400;

const round4 = (p: number) => Math.round(p * 10000) / 10000;
const money = (v: number) => Math.round(v * 100) / 100;
const ceilCent = (v: number) => Math.ceil(v * 100 - 1e-9) / 100;
const fail = (message: string): BrokerResult => ({ ok: false, message, fills: [] });

export function fmtMoney(v: number): string {
  const sign = v < 0 ? '−' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtPx(p: number): string {
  return p >= 1 ? p.toFixed(2) : p.toFixed(4);
}

function reasonFromRole(role: OrderRole): ExitReason {
  if (role === 'stop' || role === 'target' || role === 'eod') return role;
  return 'manual';
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  sent: 'Enviada',
  open: 'Abierta',
  partial: 'Parcial',
  filled: 'Ejecutada',
  canceled: 'Cancelada',
  rejected: 'Rechazada',
};

export function describeOrder(o: Pick<Order, 'side' | 'type' | 'shares' | 'sym' | 'price' | 'stopPrice' | 'tif'>): string {
  const side = o.side === 'buy' ? 'Compra' : 'Venta';
  const kind = o.type === 'market' ? 'a mercado' : o.type === 'limit' ? `límite $${fmtPx(o.price ?? 0)}` : `stop $${fmtPx(o.stopPrice ?? 0)}`;
  return `${side} ${o.shares} ${o.sym} ${kind} (${o.tif})`;
}

export class Broker {
  constructor(
    public session: ActiveSession,
    public settings: TradingSettings,
    private readonly events: BrokerEvents = {},
    private readonly rules: () => AccountRules = () => ({ priorDayTrades: 0 }),
  ) {
    // Los números de la cinta valen para esta carga de la página: al reanudar, las órdenes vivas
    // vuelven a mirarla desde el momento actual.
    for (const o of session.orders) o.tapeSeq = undefined;
  }

  /** Último print de la cinta que vio el bróker (para que las órdenes nuevas miren desde ahí). */
  private seqNow?: () => number;

  /** El mercado se rearmó con otro motor: las órdenes en cola empiezan a medir la cinta de nuevo. */
  rebase(): void {
    for (const o of this.session.orders) o.tapeSeq = undefined;
    this.seqNow = undefined;
  }

  // ------------------------------------------------------------------ consultas

  position(sym: string): Position | undefined {
    return this.session.positions.find((p) => p.sym === sym);
  }

  /** Órdenes vivas (enviadas, abiertas o parciales). */
  orders(sym?: string): Order[] {
    return sym ? this.session.orders.filter((o) => o.sym === sym) : this.session.orders;
  }

  /** Símbolos que el bróker necesita seguir (posiciones y órdenes vivas). */
  symbols(): string[] {
    const set = new Set<string>();
    for (const p of this.session.positions) set.add(p.sym);
    for (const o of this.session.orders) set.add(o.sym);
    return [...set];
  }

  /** Comisión y tasas de una ejecución. La comisión mínima se reparte entre las ejecuciones de la orden. */
  fee(o: Pick<Order, 'side' | 'shares'>, shares: number, value: number): number {
    const s = this.settings;
    let fee = 0;
    if (s.commissionPerShare > 0 || s.minCommission > 0) fee += Math.max(shares * s.commissionPerShare, (s.minCommission * shares) / Math.max(1, o.shares));
    if (s.regFees && o.side === 'sell') fee += ceilCent(value * SEC_FEE_RATE) + Math.min(TAF_MAX, ceilCent(shares * TAF_RATE));
    return money(fee);
  }

  positionValue(marks: Marks): number {
    let v = 0;
    for (const p of this.session.positions) v += p.shares * (marks(p.sym) ?? p.avgCost);
    return money(v);
  }

  equity(marks: Marks): number {
    return money(this.session.cash + this.positionValue(marks));
  }

  dayPnl(marks: Marks): number {
    return money(this.equity(marks) - this.session.startCash);
  }

  /** Efectivo comprometido por compras pendientes. */
  reserved(exceptId?: string): number {
    let r = 0;
    for (const o of this.session.orders) {
      if (o.side !== 'buy' || o.id === exceptId) continue;
      const px = o.price ?? o.stopPrice ?? 0;
      r += (o.shares - o.filled) * px;
    }
    return money(r);
  }

  /** Apalancamiento efectivo: 4x intradía solo con US$ 25.000 o más; si no, 2x (Reg T). */
  leverage(marks: Marks): number {
    if (this.settings.account === 'cash') return 1;
    const max = this.equity(marks) >= 25_000 ? 4 : 2;
    return Math.max(1, Math.min(max, this.settings.leverage));
  }

  /** Efectivo de ventas de hoy que todavía no se puede usar (cuenta cash, T+1). */
  unsettled(): number {
    return this.settings.account === 'cash' && this.settings.settlement ? this.session.unsettled : 0;
  }

  buyingPower(marks: Marks, exceptId?: string): number {
    if (this.settings.account === 'cash') return Math.max(0, money(this.session.cash - this.unsettled() - this.reserved(exceptId)));
    return Math.max(0, money(this.equity(marks) * this.leverage(marks) - this.positionValue(marks) - this.reserved(exceptId)));
  }

  /** Poder de compra usado por posiciones y por órdenes de compra pendientes. */
  buyingPowerUsed(marks: Marks): number {
    return money(this.positionValue(marks) + this.reserved());
  }

  marginBorrowed(): number {
    return Math.max(0, money(-this.session.cash));
  }

  /** Day trades en la ventana de 5 días (los de hoy son los trades cerrados de la sesión). */
  dayTradeCount(): number {
    return this.rules().priorDayTrades + this.session.trades.length;
  }

  /** ¿Aplica la regla PDT a esta cuenta ahora? */
  pdtApplies(marks: Marks): boolean {
    return this.settings.account === 'margin' && this.settings.pdt && this.equity(marks) < 25_000;
  }

  lockedByLoss(marks: Marks): boolean {
    const max = this.settings.maxDailyLoss;
    return max > 0 && this.dayPnl(marks) <= -max;
  }

  // ------------------------------------------------------------------ órdenes

  private nextId(prefix: string): string {
    return `${prefix}${++this.session.seq}`;
  }

  private changed(): void {
    this.events.onChange?.();
  }

  /** Manda una orden: se valida ya y llega al mercado después de la latencia. */
  place(req: OrderRequest, now: number, m: MarketAccess, marks: Marks): BrokerResult {
    this.seqNow = () => m.lastSeq();
    const shares = Math.floor(req.shares);
    if (!(shares > 0)) return fail('La cantidad de acciones tiene que ser mayor a cero.');
    const q = m.quote(req.sym);
    if (!q) return fail(`No hay cotización de ${req.sym}.`);
    const sess = m.session(now);
    const tif = req.tif ?? this.settings.defaultTif;
    if (sess === 'closed') return fail('El mercado está cerrado.');
    if (req.type === 'market' && sess !== 'regular') return fail('Fuera de la rueda regular solo se aceptan órdenes límite, como en un bróker real. Usá Límite o un atajo (Ask + 0,05).');
    if (req.type === 'market' && q.halted) return fail(`${req.sym} está en halt: las órdenes a mercado no se aceptan hasta que reanude.`);
    if (req.type === 'limit' && !(req.price && req.price > 0)) return fail('Falta el precio límite.');
    if (req.type === 'stop' && !(req.stopPrice && req.stopPrice > 0)) return fail('Falta el precio de disparo del stop.');
    const ref = q.last || q.ask;
    const px = req.type === 'limit' ? req.price! : req.type === 'stop' ? req.stopPrice! : ref;
    if (px > ref * 1.5 || px < ref * 0.5) return fail(`El precio $${fmtPx(px)} está muy lejos del último ($${fmtPx(ref)}): revisalo.`);

    if (req.side === 'buy') {
      if (this.lockedByLoss(marks)) {
        return fail(`Llegaste a tu pérdida máxima del día (${fmtMoney(this.settings.maxDailyLoss)}). Cortá por hoy y revisá tus trades.`);
      }
      if (!this.position(req.sym) && this.pdtApplies(marks) && this.dayTradeCount() >= 3) {
        return fail('Regla PDT: ya hiciste 3 day trades en los últimos 5 días. Con menos de US$ 25.000 en una cuenta margen no podés hacer otro; pasate a cuenta cash o esperá a que se libere la ventana.');
      }
      const est = req.type === 'limit' ? req.price! : req.type === 'stop' ? req.stopPrice! * 1.01 : q.ask * 1.01;
      const cost = est * shares + this.fee({ side: 'buy', shares }, shares, est * shares);
      const bp = this.buyingPower(marks);
      if (cost > bp + 1e-6) {
        const max = Math.max(0, Math.floor(bp / est));
        const pending = this.unsettled() > 0 ? ` (${fmtMoney(this.unsettled())} de ventas de hoy se liberan mañana: liquidación T+1 de la cuenta cash)` : '';
        return fail(`Poder de compra insuficiente: necesitás ${fmtMoney(cost)} y tenés ${fmtMoney(bp)}${pending}. Te alcanza para ${max} acciones.`);
      }
      const entry = req.type === 'limit' ? Math.min(req.price!, q.ask) : req.type === 'stop' ? req.stopPrice! : q.ask;
      if (req.stop !== undefined && req.stop >= Math.min(q.bid, entry) - EPS) return fail(`El stop ($${fmtPx(req.stop)}) tiene que quedar debajo del bid y de tu entrada.`);
      if (req.target !== undefined && req.target <= entry + EPS) return fail('El objetivo tiene que quedar arriba de tu entrada.');
    } else {
      const pos = this.position(req.sym);
      if (!pos) return fail(`No tenés acciones de ${req.sym} (en este simulador solo se opera comprado).`);
      if (shares > pos.shares) return fail(`Tenés ${pos.shares} acciones de ${req.sym}.`);
      if (req.type === 'stop' && req.stopPrice! >= Math.min(q.bid, q.last) - EPS) return fail('El stop de venta tiene que quedar debajo del bid.');
    }

    const latency = this.settings.latencyMs * (0.7 + 0.9 * Math.random());
    const order: Order = {
      id: this.nextId('o'),
      sym: req.sym,
      side: req.side,
      type: req.type,
      shares,
      price: req.type === 'limit' ? roundPx(req.price!) : undefined,
      stopPrice: req.type === 'stop' ? roundPx(req.stopPrice!) : undefined,
      tif,
      route: req.route ?? 'SMRT',
      role: req.role ?? (req.side === 'buy' ? 'entry' : 'exit'),
      status: 'sent',
      createdAt: now,
      activeAt: now + latency,
      updatedAt: now,
      filled: 0,
      avgPrice: 0,
      bracket: req.side === 'buy' && (req.stop || req.target) ? { stop: req.stop, target: req.target } : undefined,
      plan: req.side === 'buy' && (req.planStop || req.planTarget) ? { stop: req.planStop, target: req.planTarget } : undefined,
      setup: req.setup,
      ctx: req.ctx,
    };
    this.session.orders.push(order);
    this.changed();
    return { ok: true, message: `Enviada: ${describeOrder(order)}.`, fills: [], order };
  }

  /** Saca una orden de las vivas. `silent`: una cancelación que es consecuencia de otra acción. */
  private finish(o: Order, status: OrderStatus, now: number, note?: string, silent = false): void {
    this.session.orders = this.session.orders.filter((x) => x.id !== o.id);
    o.status = status;
    o.updatedAt = now;
    if (note) o.note = note;
    this.session.history.push(o);
    if (this.session.history.length > HISTORY_MAX) this.session.history.splice(0, this.session.history.length - HISTORY_MAX);
    if (status === 'canceled' && !silent) this.events.onOrder?.('canceled', o);
  }

  /** Una orden del día, viva o terminada. */
  order(id: string): Order | undefined {
    return this.session.orders.find((o) => o.id === id) ?? this.session.history.find((o) => o.id === id);
  }

  cancel(id: string, now: number): void {
    const o = this.session.orders.find((x) => x.id === id);
    if (!o) return;
    this.finish(o, 'canceled', now, 'Cancelada por vos', true);
    const p = this.position(o.sym);
    if (p && o.role === 'stop') p.stop = undefined;
    if (p && o.role === 'target') p.target = undefined;
    this.changed();
  }

  cancelAll(sym: string | undefined, now: number): void {
    for (const o of [...this.session.orders]) if (!sym || o.sym === sym) this.cancel(o.id, now);
  }

  /** Coloca (o reemplaza) el stop y el objetivo de una posición como órdenes OCO. */
  setBracket(sym: string, b: { stop?: number; target?: number }, now: number, q?: Quote | null): BrokerResult {
    const p = this.position(sym);
    if (!p) return fail(`No tenés posición en ${sym}.`);
    if (q && b.stop !== undefined && b.stop >= Math.min(q.bid, q.last) - EPS) return fail('El stop tiene que quedar debajo del bid.');
    if (q && b.target !== undefined && b.target <= q.ask + EPS) return fail('El objetivo tiene que quedar arriba del ask.');
    for (const o of [...this.session.orders]) if (o.sym === sym && (o.role === 'stop' || o.role === 'target')) this.finish(o, 'canceled', now, 'Reemplazada', true);
    const oco = this.nextId('oco');
    const base = { sym, side: 'sell' as const, shares: p.shares, tif: 'DAY+' as const, route: 'SMRT', oco, status: 'open' as const, createdAt: now, activeAt: now, updatedAt: now, filled: 0, avgPrice: 0, tapeSeq: this.seqNow?.() };
    if (b.stop) this.session.orders.push({ ...base, id: this.nextId('o'), type: 'stop', stopPrice: roundPx(b.stop), role: 'stop' });
    if (b.target) this.session.orders.push({ ...base, id: this.nextId('o'), type: 'limit', price: roundPx(b.target), role: 'target' });
    p.stop = b.stop ? roundPx(b.stop) : undefined;
    p.target = b.target ? roundPx(b.target) : undefined;
    if (p.initialStop === undefined && b.stop) p.initialStop = roundPx(b.stop);
    this.changed();
    return { ok: true, message: `${sym}: stop ${p.stop ? '$' + fmtPx(p.stop) : '—'} · objetivo ${p.target ? '$' + fmtPx(p.target) : '—'}.`, fills: [] };
  }

  // ------------------------------------------------------------------ mercado

  /** Hace trabajar las órdenes vivas con el mercado de este momento. Se llama en cada tick. */
  process(now: number, m: MarketAccess, marks: Marks): Fill[] {
    this.seqNow = () => m.lastSeq();
    const fills: Fill[] = [];
    const sess = m.session(now);
    for (const p of this.session.positions) {
      const last = marks(p.sym);
      if (last === undefined) continue;
      if (last > p.high) p.high = last;
      if (last < p.low) p.low = last;
    }
    for (const o of [...this.session.orders]) {
      if (!this.session.orders.includes(o)) continue;
      if (o.tif === 'DAY' && (sess === 'post' || sess === 'closed')) {
        this.finish(o, 'canceled', now, 'Venció al cierre de la rueda (DAY)');
        this.changed();
        continue;
      }
      if (now < o.activeAt) continue;
      const q = m.quote(o.sym);
      if (!q) continue;
      const working = !q.halted && sess !== 'closed' && (sess === 'regular' || o.tif === 'DAY+');
      const arrived = o.status === 'sent';
      if (arrived) {
        o.status = 'open';
        o.updatedAt = now;
        o.tapeSeq = m.lastSeq();
        if (o.type === 'limit') o.queueAhead = m.book(o.sym)?.sizeAt(o.side === 'buy' ? 'bid' : 'ask', o.price!) ?? 0;
        this.changed();
      }
      if (!working) {
        o.note = q.halted ? 'Espera la reanudación del halt' : 'Espera la rueda regular (TIF DAY)';
      } else {
        o.note = undefined;
        fills.push(...this.work(o, q, now, m, marks, sess));
      }
      // Llegó y no se ejecutó nada: queda esperando en el libro (o el disparo, si es stop).
      if (arrived && o.filled === 0 && this.session.orders.includes(o)) this.events.onOrder?.('open', o);
    }
    return fills;
  }

  private work(o: Order, q: Quote, now: number, m: MarketAccess, marks: Marks, sess: string): Fill[] {
    const out: Fill[] = [];
    // Una orden que nunca miró la cinta (stop/objetivo puestos sobre la posición, o una sesión
    // recién reanudada) empieza a mirarla desde ahora: los prints anteriores no la afectan.
    if (o.tapeSeq === undefined) o.tapeSeq = m.lastSeq();
    const prints = m.printsSince(o.sym, o.tapeSeq);
    if (prints.length) o.tapeSeq = prints[prints.length - 1].seq;
    if (o.type === 'market') return this.sweep(o, undefined, now, m, marks, q);
    if (o.type === 'stop') {
      if (!o.triggered) {
        const stop = o.stopPrice!;
        const hit = prints.length
          ? prints.some((p) => (o.side === 'sell' ? p.price <= stop + EPS : p.price >= stop - EPS))
          : o.side === 'sell'
            ? q.last <= stop + EPS
            : q.last >= stop - EPS;
        if (!hit) return out;
        o.triggered = true;
        o.updatedAt = now;
      }
      // Disparado: a mercado en la rueda; afuera, como límite 3 % peor (no hay órdenes a mercado).
      const limit = sess === 'regular' ? undefined : roundPx(o.side === 'sell' ? o.stopPrice! * 0.97 : o.stopPrice! * 1.03);
      return this.sweep(o, limit, now, m, marks, q);
    }
    // Límite: si del otro lado ya están a mi precio (o mejor), se toma el libro hasta mi límite.
    const limit = o.price!;
    if (o.side === 'buy' ? q.ask <= limit + EPS : q.bid >= limit - EPS) out.push(...this.sweep(o, limit, now, m, marks, q));
    // Si no, espera su turno: los prints a mi precio consumen la cola de adelante; uno que pasa más
    // allá de mi precio significa que yo era la mejor punta y me tocaba a mí.
    for (const p of prints) {
      if (o.filled >= o.shares || !this.session.orders.includes(o)) break;
      const through = o.side === 'buy' ? p.price < limit - EPS : p.price > limit + EPS;
      const atMine = Math.abs(p.price - limit) < EPS && (o.side === 'buy' ? p.side !== 'ask' && p.side !== 'above' : p.side !== 'bid' && p.side !== 'below');
      let qty = 0;
      if (through) qty = Math.min(o.shares - o.filled, p.size);
      else if (atMine) {
        const ahead = o.queueAhead ?? 0;
        if (ahead >= p.size) {
          o.queueAhead = ahead - p.size;
          continue;
        }
        qty = Math.min(o.shares - o.filled, p.size - ahead);
        o.queueAhead = 0;
      }
      if (qty > 0) {
        const f = this.fillParts(o, [{ price: limit, size: qty }], now, marks);
        if (f) out.push(f);
      }
    }
    // Las cancelaciones de los que estaban adelante también te acercan al frente de la cola.
    if (o.queueAhead && this.session.orders.includes(o)) {
      const visible = m.book(o.sym)?.sizeAt(o.side === 'buy' ? 'bid' : 'ask', limit);
      if (visible !== undefined && visible < o.queueAhead) o.queueAhead = visible;
    }
    return out;
  }

  /** Ejecuta una orden agresiva recorriendo el libro (hasta el límite, si tiene). */
  private sweep(o: Order, limit: number | undefined, now: number, m: MarketAccess, marks: Marks, q: Quote): Fill[] {
    let want = o.shares - o.filled;
    if (o.side === 'sell') {
      want = Math.min(want, this.position(o.sym)?.shares ?? 0);
      if (want <= 0) {
        this.finish(o, 'canceled', now, 'Ya no hay posición');
        this.changed();
        return [];
      }
    }
    const book = m.book(o.sym);
    let parts: Part[];
    if (book) parts = book.walk(o.side, want, limit, o.side === 'buy' ? q.ask : q.bid);
    else {
      const px = o.side === 'buy' ? q.ask : q.bid;
      parts = limit !== undefined && (o.side === 'buy' ? px > limit + EPS : px < limit - EPS) ? [] : [{ price: px, size: want }];
    }
    if (!parts.length) return [];
    if (o.side === 'buy') {
      // El poder de compra se revisa al ejecutar: si el precio se fue, se compra lo que alcance.
      const bp = this.buyingPower(marks, o.id);
      let spend = 0;
      const ok: Part[] = [];
      for (const p of parts) {
        const fits = Math.min(p.size, Math.floor((bp - spend) / p.price));
        if (fits <= 0) break;
        ok.push({ price: p.price, size: fits });
        spend += fits * p.price;
        if (fits < p.size) break;
      }
      if (!ok.length) {
        this.finish(o, 'canceled', now, 'Poder de compra insuficiente al ejecutarse');
        this.changed();
        return [];
      }
      parts = ok;
    }
    book?.take(o.side, parts, now);
    const f = this.fillParts(o, parts, now, marks);
    if (f && o.type === 'market' && o.filled < o.shares && this.session.orders.includes(o)) {
      // A mercado lo que no se pudo comprar (sin poder de compra) se cancela.
      this.finish(o, 'canceled', now, `Ejecutada en parte: ${o.filled} de ${o.shares}`);
    }
    return f ? [f] : [];
  }

  /** Registra una ejecución (una o varias porciones a distintos precios) de una orden. */
  private fillParts(o: Order, parts: Part[], now: number, _marks: Marks): Fill | undefined {
    let shares = parts.reduce((s, p) => s + p.size, 0);
    let value = parts.reduce((s, p) => s + p.size * p.price, 0);
    if (o.side === 'sell') {
      const held = this.position(o.sym)?.shares ?? 0;
      if (shares > held) {
        value = (value / shares) * held;
        shares = held;
      }
    }
    if (shares <= 0) return undefined;
    const price = round4(value / shares);
    const fill: Fill = { id: this.nextId('f'), orderId: o.id, sym: o.sym, side: o.side, shares, price, value: money(value), fee: this.fee(o, shares, value), ts: now, role: o.role };
    this.session.fills.push(fill);
    if (this.session.fills.length > 3000) this.session.fills.splice(0, this.session.fills.length - 3000);
    o.avgPrice = round4((o.avgPrice * o.filled + value) / (o.filled + shares));
    o.filled += shares;
    o.updatedAt = now;
    if (o.filled >= o.shares) this.finish(o, 'filled', now);
    else o.status = 'partial';
    let trade: Trade | undefined;
    if (o.side === 'buy') this.applyBuy(o, fill);
    else trade = this.applySell(o, fill, now);
    if (o.status === 'filled' && o.oco) {
      for (const x of [...this.session.orders]) if (x.oco === o.oco) this.finish(x, 'canceled', now, 'OCO: se ejecutó la otra orden', true);
    }
    this.events.onFill?.(fill, trade);
    this.changed();
    return fill;
  }

  /** Cierra todo (fin del día): cancela las órdenes y vende las posiciones contra el libro. */
  flatten(now: number, m: MarketAccess, marks: Marks, reason: OrderRole = 'eod'): Trade[] {
    for (const o of [...this.session.orders]) this.finish(o, 'canceled', now, 'Cierre del día', true);
    const trades: Trade[] = [];
    for (const p of [...this.session.positions]) {
      const q = m.quote(p.sym);
      const order: Order = {
        id: this.nextId('o'),
        sym: p.sym,
        side: 'sell',
        type: 'market',
        shares: p.shares,
        tif: 'DAY+',
        route: 'SMRT',
        role: reason,
        status: 'open',
        createdAt: now,
        activeAt: now,
        updatedAt: now,
        filled: 0,
        avgPrice: 0,
      };
      this.session.orders.push(order);
      const before = this.session.trades.length;
      if (q && !q.halted) this.sweep(order, undefined, now, m, marks, q);
      else {
        // En halt no hay mercado: se cierra al último precio conocido.
        this.fillParts(order, [{ price: marks(p.sym) ?? p.avgCost, size: p.shares }], now, marks);
      }
      if (this.session.orders.includes(order)) this.finish(order, 'canceled', now, 'Sin liquidez', true);
      if (this.session.trades.length > before) trades.push(this.session.trades[this.session.trades.length - 1]);
    }
    this.changed();
    return trades;
  }

  // ------------------------------------------------------------------ cuenta

  private applyBuy(o: Order, f: Fill): void {
    let p = this.position(o.sym);
    if (!p) {
      p = {
        sym: o.sym,
        shares: 0,
        avgCost: 0,
        openedAt: f.ts,
        boughtShares: 0,
        boughtCost: 0,
        soldShares: 0,
        soldValue: 0,
        fees: 0,
        realized: 0,
        high: f.price,
        low: f.price,
        setup: o.setup,
        ctx: o.ctx,
        fills: 0,
      };
      this.session.positions.push(p);
    }
    const value = f.value ?? f.price * f.shares;
    p.avgCost = round4((p.avgCost * p.shares + value) / (p.shares + f.shares));
    p.shares += f.shares;
    p.boughtShares += f.shares;
    p.boughtCost = money(p.boughtCost + value);
    p.fees = money(p.fees + f.fee);
    p.realized = money(p.realized - f.fee);
    p.fills++;
    if (o.setup && !p.setup) p.setup = o.setup;
    this.session.cash = money(this.session.cash - value - f.fee);
    if (o.plan) {
      if (o.plan.stop && o.plan.stop < p.avgCost) p.planStop = roundPx(o.plan.stop);
      if (o.plan.target && o.plan.target > p.avgCost) p.planTarget = roundPx(o.plan.target);
      if (p.initialStop === undefined && p.planStop !== undefined) p.initialStop = p.planStop;
    }
    const stop = o.bracket?.stop ?? p.stop;
    const target = o.bracket?.target ?? p.target;
    if (stop || target) this.setBracket(o.sym, { stop, target }, f.ts);
  }

  private applySell(o: Order, f: Fill, now: number): Trade | undefined {
    const p = this.position(o.sym);
    if (!p) return undefined;
    const value = f.value ?? f.price * f.shares;
    const proceeds = money(value - f.fee);
    p.realized = money(p.realized + value - p.avgCost * f.shares - f.fee);
    p.shares -= f.shares;
    p.soldShares += f.shares;
    p.soldValue = money(p.soldValue + value);
    p.fees = money(p.fees + f.fee);
    p.fills++;
    this.session.cash = money(this.session.cash + proceeds);
    if (this.settings.account === 'cash') this.session.unsettled = money(this.session.unsettled + proceeds);
    if (p.shares <= 0) return this.closeTrade(p, f, reasonFromRole(o.role), now);
    // Venta parcial: el stop y el objetivo quedan por las acciones que siguen abiertas.
    for (const x of this.session.orders) if (x.sym === o.sym && x.side === 'sell' && x.id !== o.id && x.shares - x.filled > p.shares) x.shares = x.filled + p.shares;
    return undefined;
  }

  private closeTrade(p: Position, f: Fill, reason: ExitReason, now: number): Trade {
    this.session.positions = this.session.positions.filter((x) => x !== p);
    for (const x of [...this.session.orders]) if (x.sym === p.sym && x.side === 'sell' && x.id !== f.orderId) this.finish(x, 'canceled', now, 'Posición cerrada', true);
    const avgEntry = p.boughtCost / p.boughtShares;
    const avgExit = p.soldValue / p.soldShares;
    const gross = money(p.soldValue - p.boughtCost);
    const net = money(gross - p.fees);
    const risk = p.initialStop !== undefined && avgEntry > p.initialStop ? money((avgEntry - p.initialStop) * p.boughtShares) : undefined;
    const marks = this.session.fills
      .filter((x) => x.sym === p.sym && x.ts >= p.openedAt && x.ts <= f.ts)
      .map((x) => [x.ts, x.side === 'buy' ? 'B' : 'S', x.price, x.shares] as [number, 'B' | 'S', number, number]);
    const trade: Trade = {
      id: `${this.session.id}-${this.nextId('t')}`,
      sessionId: this.session.id,
      sym: p.sym,
      openedAt: p.openedAt,
      closedAt: f.ts,
      shares: p.boughtShares,
      avgEntry: round4(avgEntry),
      avgExit: round4(avgExit),
      gross,
      fees: money(p.fees),
      net,
      returnPct: Math.round((net / p.boughtCost) * 10000) / 100,
      r: risk ? Math.round((net / risk) * 100) / 100 : undefined,
      risk,
      mfePct: Math.round(((p.high - avgEntry) / avgEntry) * 10000) / 100,
      maePct: Math.round(((p.low - avgEntry) / avgEntry) * 10000) / 100,
      exitReason: reason,
      setup: p.setup,
      ctx: p.ctx,
      fills: p.fills,
      marks,
      bars: this.events.captureBars?.(p.sym, p.openedAt - 20 * MIN, f.ts),
    };
    this.session.trades.push(trade);
    return trade;
  }

  describe(f: Fill, trade?: Trade): string {
    const verb = f.side === 'buy' ? 'Compraste' : 'Vendiste';
    const order = this.session.orders.find((o) => o.id === f.orderId) ?? this.session.history.find((o) => o.id === f.orderId);
    const partial = order && order.filled < order.shares && order.status !== 'filled' ? ` (parcial: ${order.filled} de ${order.shares})` : '';
    const pnl = trade ? ` · trade ${trade.net >= 0 ? '+' : ''}${fmtMoney(trade.net)}` : '';
    const role = f.role === 'stop' ? 'Stop ejecutado: ' : f.role === 'target' ? 'Objetivo alcanzado: ' : f.role === 'eod' ? 'Cierre del día: ' : '';
    return `${role}${verb} ${f.shares} ${f.sym} a $${fmtPx(f.price)}${partial}${pnl}.`;
  }
}

export { tickOf };
