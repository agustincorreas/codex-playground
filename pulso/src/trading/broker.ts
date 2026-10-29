// Bróker de práctica, lo más parecido posible a operar de verdad:
// - Las órdenes tardan en llegar al mercado (latencia) y se ejecutan contra el libro (Level 2): una
//   compra grande paga varios niveles y una venta en una acción fina puede deslizar bastante.
// - Las órdenes límite esperan su turno en la cola de su precio y se ejecutan con los prints de la
//   cinta, a veces en partes. Los stops se disparan con el último precio y salen a mercado.
// - Reglas de la sesión: fuera de la rueda regular solo órdenes límite (DAY+), en halt no se ejecuta
//   nada. Comisiones y tasas regulatorias (SEC y FINRA) en las ventas.
// - Cuenta cash con liquidación T+1, o cuenta margen con la regla PDT por debajo de US$ 25.000.
// - Ventas en corto como en un bróker de small caps: solo en cuenta margen y en la rueda regular, con
//   locate (ETB sin costo, HTB con costo por acción, o sin acciones para prestar ese día), el 150 % de la
//   venta bloqueado como poder de compra, y cobertura al cierre del día.
// Lleva las posiciones y el efectivo y arma un trade por cada ida y vuelta (largo o corto).
import type { Quote, TapePrint } from '../engine/types';
import { roundPx, tickOf, type DepthBook, type Part } from './depth';
import { describeLocate, type Locate } from './locate';
import type { ActiveSession, EntryContext, ExitReason, Fill, Order, OrderRole, OrderSide, OrderStatus, OrderType, Position, PositionSide, Tif, Trade, TradingSettings } from './types';

/** Lo que el bróker necesita del mercado. */
export interface MarketAccess {
  quote(sym: string): Quote | null;
  /** Libro con profundidad sincronizado al NBBO (null si no hay cotización). */
  book(sym: string): DepthBook | null;
  /** Prints de la cinta posteriores a `seq`. */
  printsSince(sym: string, seq: number): TapePrint[];
  lastSeq(): number;
  session(now: number): 'pre' | 'regular' | 'post' | 'closed';
  /** Prestables de hoy para vender en corto (sin el dato se asume ETB sin costo). */
  locate?(sym: string): Locate | null;
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
  /** Stop y objetivo que se colocan como OCO cuando la entrada se ejecuta. */
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
/** Poder de compra que bloquea una venta en corto: el 150 % de lo vendido (Reg T: lo vendido más el 50 %). */
export const SHORT_MARGIN = 1.5;
/** Debajo de este precio no se vende en corto (como en los brókers de small caps). */
export const SHORT_MIN_PRICE = 1;
const HISTORY_MAX = 400;
const ETB: Locate = { shortable: 'etb', borrowFee: 0 };

const round4 = (p: number) => Math.round(p * 10000) / 10000;
const money = (v: number) => Math.round(v * 100) / 100;
const ceilCent = (v: number) => Math.ceil(v * 100 - 1e-9) / 100;
const fail = (message: string): BrokerResult => ({ ok: false, message, fills: [] });
/** La mitad de una posición (una acción sola se vende entera). */
const halfOf = (shares: number) => Math.max(1, Math.ceil(shares / 2));
/** Lado de la orden que cierra (o achica) una posición. */
const exitSide = (side: PositionSide): OrderSide => (side === 'long' ? 'sell' : 'buy');

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

export function describeOrder(o: Pick<Order, 'side' | 'type' | 'shares' | 'sym' | 'price' | 'stopPrice' | 'tif'> & { role?: OrderRole }): string {
  const side = o.side === 'buy' ? (o.role && o.role !== 'entry' ? 'Cobertura' : 'Compra') : o.role === 'entry' ? 'Venta en corto' : 'Venta';
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
    // Posiciones guardadas antes de que existieran los cortos: son largas.
    for (const p of session.positions) p.side ??= 'long';
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

  /**
   * ¿Una orden de ese lado abre (o agranda) una posición, en vez de cerrarla? Una compra sin posición o
   * sobre un largo entra; sobre un corto, cubre. Una venta sin posición o sobre un corto entra en corto;
   * sobre un largo, vende.
   */
  opens(sym: string, side: OrderSide): boolean {
    const p = this.position(sym);
    if (!p) return true;
    return side === 'buy' ? p.side === 'long' : p.side === 'short';
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

  /**
   * Comisión y tasas de una ejecución (y el locate de un corto HTB). La comisión mínima se reparte
   * entre las ejecuciones de la orden.
   */
  fee(o: Pick<Order, 'side' | 'shares'> & { borrowFee?: number }, shares: number, value: number): number {
    const s = this.settings;
    let fee = 0;
    if (s.commissionPerShare > 0 || s.minCommission > 0) fee += Math.max(shares * s.commissionPerShare, (s.minCommission * shares) / Math.max(1, o.shares));
    if (s.regFees && o.side === 'sell') fee += ceilCent(value * SEC_FEE_RATE) + Math.min(TAF_MAX, ceilCent(shares * TAF_RATE));
    if (o.borrowFee) fee += shares * o.borrowFee;
    return money(fee);
  }

  /** Valor de mercado de una posición (positivo en un largo, negativo en un corto: es lo que se debe). */
  private marketValue(p: Position, marks: Marks): number {
    const v = p.shares * (marks(p.sym) ?? p.avgCost);
    return p.side === 'short' ? -v : v;
  }

  /** Valor de mercado de las posiciones con signo: los cortos restan (equity = efectivo + esto). */
  positionValue(marks: Marks): number {
    let v = 0;
    for (const p of this.session.positions) v += this.marketValue(p, marks);
    return money(v);
  }

  /** Valor de mercado de los largos. */
  longValue(marks: Marks): number {
    let v = 0;
    for (const p of this.session.positions) if (p.side === 'long') v += this.marketValue(p, marks);
    return money(v);
  }

  /** Lo que costaría cubrir los cortos ahora (positivo). */
  shortValue(marks: Marks): number {
    let v = 0;
    for (const p of this.session.positions) if (p.side === 'short') v -= this.marketValue(p, marks);
    return money(v);
  }

  equity(marks: Marks): number {
    return money(this.session.cash + this.positionValue(marks));
  }

  dayPnl(marks: Marks): number {
    return money(this.equity(marks) - this.session.startCash);
  }

  /** Poder de compra comprometido por entradas pendientes: compras y, al 150 %, ventas en corto. */
  reserved(exceptId?: string): number {
    let r = 0;
    for (const o of this.session.orders) {
      if (o.role !== 'entry' || o.id === exceptId) continue;
      const px = o.price ?? o.stopPrice ?? 0;
      r += (o.shares - o.filled) * px * (o.side === 'sell' ? SHORT_MARGIN : 1);
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

  /** Poder de compra que ocupan las posiciones: los largos a su valor y los cortos al 150 % del suyo. */
  private positionsUsed(marks: Marks): number {
    return money(this.longValue(marks) + SHORT_MARGIN * this.shortValue(marks));
  }

  buyingPower(marks: Marks, exceptId?: string): number {
    if (this.settings.account === 'cash') return Math.max(0, money(this.session.cash - this.unsettled() - this.reserved(exceptId)));
    return Math.max(0, money(this.equity(marks) * this.leverage(marks) - this.positionsUsed(marks) - this.reserved(exceptId)));
  }

  /** Poder de compra usado por posiciones (largos al valor, cortos al 150 %) y por entradas pendientes. */
  buyingPowerUsed(marks: Marks): number {
    return money(this.positionsUsed(marks) + this.reserved());
  }

  /**
   * Plata prestada por el bróker: lo que falta de efectivo después de apartar lo que costaría cubrir
   * los cortos (lo vendido en corto no es plata disponible).
   */
  marginBorrowed(marks: Marks = () => undefined): number {
    return Math.max(0, money(this.shortValue(marks) - this.session.cash));
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

  /** Prestables de hoy para un símbolo (ETB si el mercado no lo informa). */
  locate(sym: string, m: MarketAccess): Locate {
    return m.locate?.(sym) ?? ETB;
  }

  /**
   * Por qué no se puede abrir (o agrandar) un corto en esa acción ahora, o null si se puede: tipo de
   * cuenta, pérdida máxima, regla PDT, rueda, halt, precio y locate. El poder de compra se revisa aparte.
   */
  shortBlock(sym: string, now: number, m: MarketAccess, marks: Marks): string | null {
    if (!this.settings.allowShort) return 'Las ventas en corto están desactivadas (se activan en Preferencias de práctica).';
    if (this.settings.account === 'cash') return 'En una cuenta cash no se vende en corto: pasate a cuenta margen en los ajustes de la cuenta.';
    if (this.lockedByLoss(marks)) return `Llegaste a tu pérdida máxima del día (${fmtMoney(this.settings.maxDailyLoss)}). Cortá por hoy y revisá tus trades.`;
    if (!this.position(sym) && this.pdtApplies(marks) && this.dayTradeCount() >= 3) {
      return 'Regla PDT: ya hiciste 3 day trades en los últimos 5 días. Con menos de US$ 25.000 en una cuenta margen no podés hacer otro.';
    }
    const sess = m.session(now);
    if (sess !== 'regular') return 'Los cortos solo se abren en la rueda regular (9:30 a 16:00), como en los brókers de small caps.';
    const q = m.quote(sym);
    if (!q) return `No hay cotización de ${sym}.`;
    if (q.halted) return `${sym} está en halt: no se abren cortos hasta que reanude.`;
    if ((q.last || q.bid) < SHORT_MIN_PRICE) return `No se vende en corto debajo de US$ ${SHORT_MIN_PRICE}: ${sym} cotiza a $${fmtPx(q.last || q.bid)}.`;
    if (this.locate(sym, m).shortable === 'none') return `No hay acciones para pedir prestadas de ${sym} hoy.`;
    return null;
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

    const pos = this.position(req.sym);
    const opens = this.opens(req.sym, req.side);
    let borrowFee: number | undefined;
    if (req.side === 'buy' && opens) {
      if (this.lockedByLoss(marks)) {
        return fail(`Llegaste a tu pérdida máxima del día (${fmtMoney(this.settings.maxDailyLoss)}). Cortá por hoy y revisá tus trades.`);
      }
      if (!pos && this.pdtApplies(marks) && this.dayTradeCount() >= 3) {
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
      // Una compra stop se dispara arriba del mercado: su stop de pérdida puede quedar entre el bid y la entrada.
      const floor = req.type === 'stop' ? entry : Math.min(q.bid, entry);
      if (req.stop !== undefined && req.stop >= floor - EPS) {
        return fail(req.type === 'stop' ? `El stop ($${fmtPx(req.stop)}) tiene que quedar debajo de tu entrada.` : `El stop ($${fmtPx(req.stop)}) tiene que quedar debajo del bid y de tu entrada.`);
      }
      if (req.target !== undefined && req.target <= entry + EPS) return fail('El objetivo tiene que quedar arriba de tu entrada.');
    } else if (req.side === 'buy') {
      // Cobertura de un corto: nunca se pasa de corto a largo en una sola orden.
      if (shares > pos!.shares) return fail(`Estás corto ${pos!.shares} acciones de ${req.sym}: para pasarte a largo cubrí primero y después comprá.`);
      if (req.type === 'stop' && req.stopPrice! <= Math.max(q.ask, q.last) + EPS) return fail('El stop de compra (que cubre el corto) tiene que quedar arriba del ask.');
    } else if (opens) {
      // Venta en corto (nueva o agrandando la que hay).
      const block = this.shortBlock(req.sym, now, m, marks);
      if (block) return fail(block);
      const locate = this.locate(req.sym, m);
      if (locate.shortable === 'htb') borrowFee = locate.borrowFee;
      // El stop de una venta en corto se dispara debajo del mercado; su entrada estimada es ese precio.
      const est = req.type === 'limit' ? Math.max(req.price!, q.bid) : req.type === 'stop' ? req.stopPrice! : q.bid;
      const need = SHORT_MARGIN * est * shares + this.fee({ side: 'sell', shares, borrowFee }, shares, est * shares);
      const bp = this.buyingPower(marks);
      if (need > bp + 1e-6) {
        const max = Math.max(0, Math.floor(bp / (SHORT_MARGIN * est + (borrowFee ?? 0))));
        return fail(`Poder de compra insuficiente para el corto: se bloquea el 150 % de la venta (${fmtMoney(need)}) y tenés ${fmtMoney(bp)}. Te alcanza para ${max} acciones.`);
      }
      const entry = est;
      // Una venta stop se dispara debajo del mercado: su stop de pérdida puede quedar entre la entrada y el ask.
      const ceil = req.type === 'stop' ? entry : Math.max(q.ask, entry);
      if (req.stop !== undefined && req.stop <= ceil + EPS) {
        return fail(req.type === 'stop' ? `El stop ($${fmtPx(req.stop)}) de un corto tiene que quedar arriba de tu entrada.` : `El stop ($${fmtPx(req.stop)}) de un corto tiene que quedar arriba del ask y de tu entrada.`);
      }
      if (req.target !== undefined && req.target >= entry - EPS) return fail('El objetivo de un corto tiene que quedar debajo de tu entrada.');
    } else {
      // Venta de un largo: nunca se pasa de largo a corto en una sola orden.
      if (shares > pos!.shares) return fail(`Tenés ${pos!.shares} acciones de ${req.sym}: para pasarte a corto vendé primero y después abrí el corto.`);
      if (req.type === 'stop' && req.stopPrice! >= Math.min(q.bid, q.last) - EPS) return fail('El stop de venta tiene que quedar debajo del bid.');
    }
    // Un stop del ticket que cierra la posición (venta sobre un largo, compra sobre un corto) es el stop
    // de la posición: así lo ven las estadísticas, el gráfico y el IA Trader (y si la cubre entera y no
    // había otro, queda anotado en ella).
    let role = req.role;
    if (!role && !opens && req.type === 'stop') {
      role = 'stop';
      if (shares >= pos!.shares && !this.session.orders.some((o) => o.sym === req.sym && o.role === 'stop')) {
        pos!.stop = roundPx(req.stopPrice!);
        if (pos!.initialStop === undefined) pos!.initialStop = pos!.stop;
      }
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
      role: role ?? (opens ? 'entry' : 'exit'),
      status: 'sent',
      createdAt: now,
      activeAt: now + latency,
      updatedAt: now,
      filled: 0,
      avgPrice: 0,
      bracket: opens && (req.stop || req.target) ? { stop: req.stop, target: req.target } : undefined,
      plan: opens && (req.planStop || req.planTarget) ? { stop: req.planStop, target: req.planTarget } : undefined,
      borrowFee,
      setup: req.setup,
      ctx: req.ctx,
    };
    this.session.orders.push(order);
    this.changed();
    const locateNote = borrowFee ? ` Locate ${describeLocate({ shortable: 'htb', borrowFee })}.` : '';
    return { ok: true, message: `Enviada: ${describeOrder(order)}.${locateNote}`, fills: [], order };
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

  /**
   * Coloca (o reemplaza) el stop y el objetivo de una posición como órdenes OCO. En un largo, el stop
   * vende debajo del bid y el objetivo arriba del ask; en un corto, al revés: el stop compra arriba del
   * ask y el objetivo compra debajo del bid.
   */
  setBracket(sym: string, b: { stop?: number; target?: number }, now: number, q?: Quote | null): BrokerResult {
    const p = this.position(sym);
    if (!p) return fail(`No tenés posición en ${sym}.`);
    const short = p.side === 'short';
    if (q && b.stop !== undefined) {
      if (!short && b.stop >= Math.min(q.bid, q.last) - EPS) return fail('El stop tiene que quedar debajo del bid.');
      if (short && b.stop <= Math.max(q.ask, q.last) + EPS) return fail('El stop de un corto tiene que quedar arriba del ask.');
    }
    if (q && b.target !== undefined) {
      if (!short && b.target <= q.ask + EPS) return fail('El objetivo tiene que quedar arriba del ask.');
      if (short && b.target >= q.bid - EPS) return fail('El objetivo de un corto tiene que quedar debajo del bid.');
    }
    for (const o of [...this.session.orders]) if (o.sym === sym && (o.role === 'stop' || o.role === 'target')) this.finish(o, 'canceled', now, 'Reemplazada', true);
    const oco = this.nextId('oco');
    const base = { sym, side: exitSide(p.side), shares: p.shares, tif: 'DAY+' as const, route: 'SMRT', oco, status: 'open' as const, createdAt: now, activeAt: now, updatedAt: now, filled: 0, avgPrice: 0, tapeSeq: this.seqNow?.() };
    if (b.stop) this.session.orders.push({ ...base, id: this.nextId('o'), type: 'stop', stopPrice: roundPx(b.stop), role: 'stop' });
    // Como Ross: en el objetivo se sale de la mitad; el resto corre con el stop (que después se mueve a la entrada).
    if (b.target) this.session.orders.push({ ...base, id: this.nextId('o'), shares: halfOf(p.shares), type: 'limit', price: roundPx(b.target), role: 'target' });
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
      // Una venta en corto que quedó esperando solo se ejecuta en la rueda regular.
      const shortEntry = o.side === 'sell' && o.role === 'entry';
      const working = !q.halted && sess !== 'closed' && (sess === 'regular' || (o.tif === 'DAY+' && !shortEntry));
      const arrived = o.status === 'sent';
      if (arrived) {
        o.status = 'open';
        o.updatedAt = now;
        o.tapeSeq = m.lastSeq();
        if (o.type === 'limit') o.queueAhead = m.book(o.sym)?.sizeAt(o.side === 'buy' ? 'bid' : 'ask', o.price!) ?? 0;
        this.changed();
      }
      if (!working) {
        o.note = q.halted ? 'Espera la reanudación del halt' : shortEntry && sess !== 'regular' ? 'Los cortos solo se abren en la rueda regular' : 'Espera la rueda regular (TIF DAY)';
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

  /** Acciones de la posición que una orden de salida puede cerrar (0 si la posición ya no está o es del otro lado). */
  private closable(o: Order): number {
    const p = this.position(o.sym);
    if (!p || p.side !== (o.side === 'sell' ? 'long' : 'short')) return 0;
    return p.shares;
  }

  /** Ejecuta una orden agresiva recorriendo el libro (hasta el límite, si tiene). */
  private sweep(o: Order, limit: number | undefined, now: number, m: MarketAccess, marks: Marks, q: Quote): Fill[] {
    let want = o.shares - o.filled;
    const entry = o.role === 'entry';
    if (!entry) {
      want = Math.min(want, this.closable(o));
      if (want <= 0) {
        this.finish(o, 'canceled', now, 'Ya no hay posición');
        this.changed();
        return [];
      }
    } else if (!this.opens(o.sym, o.side)) {
      // Una entrada que llega cuando ya hay posición del otro lado no la cierra a escondidas.
      this.finish(o, 'canceled', now, 'Hay una posición del otro lado');
      this.changed();
      return [];
    }
    const book = m.book(o.sym);
    let parts: Part[];
    if (book) parts = book.walk(o.side, want, limit, o.side === 'buy' ? q.ask : q.bid);
    else {
      const px = o.side === 'buy' ? q.ask : q.bid;
      parts = limit !== undefined && (o.side === 'buy' ? px > limit + EPS : px < limit - EPS) ? [] : [{ price: px, size: want }];
    }
    if (!parts.length) return [];
    if (entry) {
      // El poder de compra se revisa al ejecutar: si el precio se fue, se toma lo que alcance.
      const bp = this.buyingPower(marks, o.id);
      const margin = o.side === 'sell' ? SHORT_MARGIN : 1;
      let spend = 0;
      const ok: Part[] = [];
      for (const p of parts) {
        // Cada acción cuesta su precio (el 150 % en un corto) más la comisión que le toca: así el efectivo no queda negativo.
        const unit = margin * p.price + this.fee(o, 1, p.price);
        const fits = Math.min(p.size, Math.floor((bp - spend) / unit));
        if (fits <= 0) break;
        ok.push({ price: p.price, size: fits });
        spend += fits * unit;
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
    if (o.role !== 'entry') {
      const held = this.closable(o);
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
    const p = this.position(o.sym);
    if (o.side === 'buy') {
      if (p?.side === 'short') trade = this.applyExit(o, fill, now);
      else this.applyEntry(o, fill, 'long');
    } else if (p?.side === 'long') trade = this.applyExit(o, fill, now);
    else this.applyEntry(o, fill, 'short');
    // OCO: al ejecutarse una del grupo se cancelan las demás, salvo que todavía quede posición (el objetivo
    // sale de la mitad: el stop sigue cuidando el resto).
    if (o.status === 'filled' && o.oco && !(this.position(o.sym)?.shares ?? 0)) {
      for (const x of [...this.session.orders]) if (x.oco === o.oco) this.finish(x, 'canceled', now, 'OCO: se ejecutó la otra orden', true);
    }
    this.events.onFill?.(fill, trade);
    this.changed();
    return fill;
  }

  /** Cierra todo (fin del día): cancela las órdenes, vende los largos y cubre los cortos contra el libro. */
  flatten(now: number, m: MarketAccess, marks: Marks, reason: OrderRole = 'eod'): Trade[] {
    for (const o of [...this.session.orders]) this.finish(o, 'canceled', now, 'Cierre del día', true);
    const trades: Trade[] = [];
    for (const p of [...this.session.positions]) {
      const q = m.quote(p.sym);
      const order: Order = {
        id: this.nextId('o'),
        sym: p.sym,
        side: exitSide(p.side),
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
      if (q && !q.halted && m.book(p.sym)) this.sweep(order, undefined, now, m, marks, q);
      // En halt, sin libro o sin liquidez suficiente, lo que queda se cierra al último precio conocido:
      // una posición nunca se archiva viva ni se cierra a $0.
      const left = this.position(p.sym)?.shares ?? 0;
      if (left > 0 && this.session.orders.includes(order)) {
        const px = marks(p.sym) || q?.last || (p.side === 'long' ? q?.bid : q?.ask) || p.avgCost;
        this.fillParts(order, [{ price: px, size: left }], now, marks);
      }
      if (this.session.orders.includes(order)) this.finish(order, 'canceled', now, 'Sin liquidez', true);
      if (this.session.trades.length > before) trades.push(this.session.trades[this.session.trades.length - 1]);
    }
    this.changed();
    return trades;
  }

  // ------------------------------------------------------------------ cuenta

  /** Una compra que abre o agranda un largo, o una venta que abre o agranda un corto. */
  private applyEntry(o: Order, f: Fill, side: PositionSide): void {
    let p = this.position(o.sym);
    if (!p) {
      p = {
        sym: o.sym,
        side,
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
    if (side === 'long') {
      p.boughtShares += f.shares;
      p.boughtCost = money(p.boughtCost + value);
      this.session.cash = money(this.session.cash - value - f.fee);
    } else {
      p.soldShares += f.shares;
      p.soldValue = money(p.soldValue + value);
      // Lo vendido entra al efectivo (y queda bloqueado por el requisito del corto); el locate y las tasas se descuentan.
      this.session.cash = money(this.session.cash + value - f.fee);
    }
    p.fees = money(p.fees + f.fee);
    p.realized = money(p.realized - f.fee);
    p.fills++;
    if (o.setup && !p.setup) p.setup = o.setup;
    if (o.plan) {
      // El plan solo vale del lado correcto: stop debajo de la entrada en un largo (arriba en un corto) y objetivo al revés.
      const { stop, target } = o.plan;
      if (stop && (side === 'long' ? stop < p.avgCost : stop > p.avgCost)) p.planStop = roundPx(stop);
      if (target && (side === 'long' ? target > p.avgCost : target < p.avgCost)) p.planTarget = roundPx(target);
      if (p.initialStop === undefined && p.planStop !== undefined) p.initialStop = p.planStop;
    }
    const stop = o.bracket?.stop ?? p.stop;
    const target = o.bracket?.target ?? p.target;
    if (stop || target) this.setBracket(o.sym, { stop, target }, f.ts);
  }

  /** Una venta sobre un largo o una compra que cubre un corto (parcial o total). */
  private applyExit(o: Order, f: Fill, now: number): Trade | undefined {
    const p = this.position(o.sym);
    if (!p) return undefined;
    const value = f.value ?? f.price * f.shares;
    if (p.side === 'long') {
      const proceeds = money(value - f.fee);
      p.realized = money(p.realized + value - p.avgCost * f.shares - f.fee);
      p.soldShares += f.shares;
      p.soldValue = money(p.soldValue + value);
      this.session.cash = money(this.session.cash + proceeds);
      if (this.settings.account === 'cash') this.session.unsettled = money(this.session.unsettled + proceeds);
    } else {
      // Cubrir: se paga lo comprado; la ganancia es lo que bajó desde la venta promedio.
      p.realized = money(p.realized + p.avgCost * f.shares - value - f.fee);
      p.boughtShares += f.shares;
      p.boughtCost = money(p.boughtCost + value);
      this.session.cash = money(this.session.cash - value - f.fee);
    }
    p.shares -= f.shares;
    p.fees = money(p.fees + f.fee);
    p.fills++;
    if (p.shares <= 0) return this.closeTrade(p, f, reasonFromRole(o.role), now);
    // Salida parcial: el stop y el objetivo quedan por las acciones que siguen abiertas.
    for (const x of this.session.orders) if (x.sym === o.sym && x.side === o.side && x.role !== 'entry' && x.id !== o.id && x.shares - x.filled > p.shares) x.shares = x.filled + p.shares;
    // Se tomó la mitad en el objetivo: el resto corre sin objetivo (con el stop, que conviene mover a la entrada).
    if (o.role === 'target' && o.status === 'filled') p.target = undefined;
    return undefined;
  }

  private closeTrade(p: Position, f: Fill, reason: ExitReason, now: number): Trade {
    this.session.positions = this.session.positions.filter((x) => x !== p);
    for (const x of [...this.session.orders]) if (x.sym === p.sym && x.role !== 'entry' && x.id !== f.orderId) this.finish(x, 'canceled', now, 'Posición cerrada', true);
    const short = p.side === 'short';
    // En un largo se entra comprando y se sale vendiendo; en un corto, al revés.
    const entryShares = short ? p.soldShares : p.boughtShares;
    const entryValue = short ? p.soldValue : p.boughtCost;
    const exitValue = short ? p.boughtCost : p.soldValue;
    const exitShares = short ? p.boughtShares : p.soldShares;
    const avgEntry = entryValue / entryShares;
    const avgExit = exitValue / exitShares;
    const gross = money(p.soldValue - p.boughtCost);
    const net = money(gross - p.fees);
    const riskPerShare = p.initialStop === undefined ? 0 : short ? p.initialStop - avgEntry : avgEntry - p.initialStop;
    const risk = riskPerShare > 0 ? money(riskPerShare * entryShares) : undefined;
    const marks = this.session.fills
      .filter((x) => x.sym === p.sym && x.ts >= p.openedAt && x.ts <= f.ts)
      .map((x) => [x.ts, x.side === 'buy' ? 'B' : 'S', x.price, x.shares] as [number, 'B' | 'S', number, number]);
    // A favor de un corto es cuanto bajó desde la entrada; en contra, cuanto subió.
    const best = short ? avgEntry - p.low : p.high - avgEntry;
    const worst = short ? avgEntry - p.high : p.low - avgEntry;
    const trade: Trade = {
      id: `${this.session.id}-${this.nextId('t')}`,
      sessionId: this.session.id,
      sym: p.sym,
      side: p.side,
      openedAt: p.openedAt,
      closedAt: f.ts,
      shares: entryShares,
      avgEntry: round4(avgEntry),
      avgExit: round4(avgExit),
      gross,
      fees: money(p.fees),
      net,
      returnPct: Math.round((net / entryValue) * 10000) / 100,
      r: risk ? Math.round((net / risk) * 100) / 100 : undefined,
      risk,
      mfePct: Math.round((best / avgEntry) * 10000) / 100,
      maePct: Math.round((worst / avgEntry) * 10000) / 100,
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
    const verb = f.side === 'buy' ? (f.role === 'entry' ? 'Compraste' : 'Cubriste') : f.role === 'entry' ? 'Vendiste en corto' : 'Vendiste';
    const order = this.session.orders.find((o) => o.id === f.orderId) ?? this.session.history.find((o) => o.id === f.orderId);
    const partial = order && order.filled < order.shares && order.status !== 'filled' ? ` (parcial: ${order.filled} de ${order.shares})` : '';
    const pnl = trade ? ` · trade ${trade.net >= 0 ? '+' : ''}${fmtMoney(trade.net)}` : '';
    const role = f.role === 'stop' ? 'Stop ejecutado: ' : f.role === 'target' ? 'Objetivo alcanzado: ' : f.role === 'eod' ? 'Cierre del día: ' : '';
    return `${role}${verb} ${f.shares} ${f.sym} a $${fmtPx(f.price)}${partial}${pnl}.`;
  }
}

export { tickOf };
