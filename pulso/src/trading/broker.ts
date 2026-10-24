// Bróker de práctica: ejecuta órdenes contra la cotización simulada (o real) con spread, deslizamiento,
// halts y comisiones; lleva las posiciones, el efectivo y arma un trade por cada ida y vuelta.
// Solo compras (long), como el método de momentum en small caps.
import { priceTick } from '../engine/metrics';
import type { Quote } from '../engine/types';
import type { ActiveSession, EntryContext, ExitReason, Fill, Order, OrderRole, OrderSide, OrderType, Position, Trade, TradingSettings } from './types';

export interface OrderRequest {
  sym: string;
  side: OrderSide;
  type: OrderType;
  shares: number;
  /** Límite (órdenes límite) o activación (órdenes stop). */
  price?: number;
  /** Stop y objetivo que se colocan como OCO cuando la compra se ejecuta. */
  stop?: number;
  target?: number;
  setup?: string;
  ctx?: EntryContext;
  role?: OrderRole;
}

export interface BrokerResult {
  ok: boolean;
  message: string;
  fills: Fill[];
}

export interface BrokerEvents {
  onFill?(fill: Fill, trade?: Trade): void;
  /** Avisos que no vienen de una acción del usuario (una orden cancelada al ejecutarse, por ejemplo). */
  onNotice?(message: string): void;
  onChange?(): void;
  /** Velas de 1 minuto para guardar con el trade y poder revisarlo después. */
  captureBars?(sym: string, from: number, to: number): number[][] | undefined;
}

/** Último precio por símbolo para valuar posiciones. */
export type Marks = (sym: string) => number | undefined;

const MIN = 60_000;
const round4 = (p: number) => Math.round(p * 10000) / 10000;
const money = (v: number) => Math.round(v * 100) / 100;
const fail = (message: string): BrokerResult => ({ ok: false, message, fills: [] });

export function fmtMoney(v: number): string {
  const sign = v < 0 ? '−' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPx(p: number): string {
  return p >= 1 ? p.toFixed(2) : p.toFixed(4);
}

function reasonFromRole(role: OrderRole): ExitReason {
  if (role === 'stop' || role === 'target' || role === 'eod') return role;
  return 'manual';
}

export class Broker {
  constructor(
    public session: ActiveSession,
    public settings: TradingSettings,
    private readonly events: BrokerEvents = {},
  ) {}

  // ------------------------------------------------------------------ consultas

  position(sym: string): Position | undefined {
    return this.session.positions.find((p) => p.sym === sym);
  }

  orders(sym?: string): Order[] {
    return sym ? this.session.orders.filter((o) => o.sym === sym) : this.session.orders;
  }

  /** Símbolos que el bróker necesita cotizar (posiciones y órdenes pendientes). */
  symbols(): string[] {
    const set = new Set<string>();
    for (const p of this.session.positions) set.add(p.sym);
    for (const o of this.session.orders) set.add(o.sym);
    return [...set];
  }

  fee(shares: number): number {
    const s = this.settings;
    if (!(s.commissionPerShare > 0)) return 0;
    return money(Math.max(s.minCommission, shares * s.commissionPerShare));
  }

  /** Precio a mercado: la punta contraria más un deslizamiento según el tamaño contra la liquidez. */
  execPrice(side: OrderSide, q: Quote, shares: number): number {
    const base = side === 'buy' ? q.ask : q.bid;
    if (!this.settings.slippage) return base;
    // Comprar el 100% del volumen de un minuto mueve el precio ~1,5%; el 10% casi no lo mueve.
    const ratio = shares / Math.max(1000, q.volPerMin);
    const pct = Math.min(0.05, 0.015 * ratio);
    const tick = priceTick(base);
    const slip = Math.round((base * pct) / tick) * tick;
    return side === 'buy' ? round4(base + slip) : Math.max(tick, round4(base - slip));
  }

  equity(marks: Marks): number {
    let v = this.session.cash;
    for (const p of this.session.positions) v += p.shares * (marks(p.sym) ?? p.avgCost);
    return money(v);
  }

  dayPnl(marks: Marks): number {
    return money(this.equity(marks) - this.session.startCash);
  }

  /** Efectivo comprometido por compras pendientes (límite o stop). */
  private reserved(exceptId?: string): number {
    let r = 0;
    for (const o of this.session.orders) if (o.side === 'buy' && o.id !== exceptId) r += o.shares * (o.price ?? 0);
    return r;
  }

  buyingPower(marks: Marks, exceptId?: string): number {
    const m = this.settings.margin;
    if (m <= 1) return Math.max(0, money(this.session.cash - this.reserved(exceptId)));
    let mv = 0;
    for (const p of this.session.positions) mv += p.shares * (marks(p.sym) ?? p.avgCost);
    return Math.max(0, money(this.equity(marks) * m - mv - this.reserved(exceptId)));
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

  place(req: OrderRequest, q: Quote | null, now: number, marks: Marks): BrokerResult {
    const shares = Math.floor(req.shares);
    if (!(shares > 0)) return fail('La cantidad de acciones tiene que ser mayor a cero.');
    if (!q) return fail(`No hay cotización de ${req.sym}.`);
    if (req.type !== 'market' && !(req.price && req.price > 0)) return fail('Falta el precio de la orden.');
    if (req.type === 'market' && q.halted) return fail(`${req.sym} está en halt: no se puede operar hasta que reanude.`);

    if (req.side === 'buy') {
      if (this.lockedByLoss(marks)) {
        return fail(`Llegaste a tu pérdida máxima del día (${fmtMoney(this.settings.maxDailyLoss)}). Cortá por hoy y revisá tus trades.`);
      }
      const est = req.type === 'market' ? this.execPrice('buy', q, shares) : req.price!;
      const cost = est * shares + this.fee(shares);
      const bp = this.buyingPower(marks);
      if (cost > bp + 1e-6) {
        const max = Math.floor((bp - this.fee(shares)) / est);
        return fail(`Poder de compra insuficiente: necesitás ${fmtMoney(cost)} y tenés ${fmtMoney(bp)} (alcanza para ${Math.max(0, max)} acciones).`);
      }
      if (req.stop !== undefined && req.stop >= est) return fail('El stop tiene que quedar debajo del precio de entrada.');
      if (req.target !== undefined && req.target <= est) return fail('El objetivo tiene que quedar arriba del precio de entrada.');
    } else {
      const pos = this.position(req.sym);
      if (!pos) return fail(`No tenés acciones de ${req.sym} (en este simulador solo se opera comprado).`);
      if (shares > pos.shares) return fail(`Tenés ${pos.shares} acciones de ${req.sym}.`);
    }

    const order: Order = {
      id: this.nextId('o'),
      sym: req.sym,
      side: req.side,
      type: req.type,
      shares,
      price: req.type === 'market' ? undefined : round4(req.price!),
      role: req.role ?? (req.side === 'buy' ? 'entry' : 'exit'),
      createdAt: now,
      bracket: req.side === 'buy' && (req.stop || req.target) ? { stop: req.stop, target: req.target } : undefined,
      setup: req.setup,
      ctx: req.ctx,
    };

    if (req.type === 'market') {
      const fill = this.execute(order, q, now);
      return { ok: true, message: this.describe(fill), fills: [fill] };
    }
    this.session.orders.push(order);
    const fills = this.onQuote(q, now);
    const own = fills.find((f) => f.orderId === order.id);
    this.changed();
    if (own) return { ok: true, message: this.describe(own), fills };
    const what = req.type === 'limit' ? 'límite' : 'stop';
    return { ok: true, message: `Orden ${what} de ${req.side === 'buy' ? 'compra' : 'venta'}: ${shares} ${req.sym} a $${fmtPx(order.price!)}.`, fills };
  }

  cancel(id: string): void {
    const o = this.session.orders.find((x) => x.id === id);
    if (!o) return;
    this.session.orders = this.session.orders.filter((x) => x.id !== id);
    const p = this.position(o.sym);
    if (p && o.role === 'stop') p.stop = undefined;
    if (p && o.role === 'target') p.target = undefined;
    this.changed();
  }

  cancelAll(sym?: string): void {
    for (const o of [...this.session.orders]) if (!sym || o.sym === sym) this.cancel(o.id);
  }

  /** Coloca (o reemplaza) el stop y el objetivo de una posición como órdenes OCO. */
  setBracket(sym: string, b: { stop?: number; target?: number }, now: number, q?: Quote | null): BrokerResult {
    const p = this.position(sym);
    if (!p) return fail(`No tenés posición en ${sym}.`);
    if (q && b.stop !== undefined && b.stop >= q.bid) return fail('El stop tiene que quedar debajo del precio actual.');
    if (q && b.target !== undefined && b.target <= q.ask) return fail('El objetivo tiene que quedar arriba del precio actual.');
    this.session.orders = this.session.orders.filter((o) => !(o.sym === sym && (o.role === 'stop' || o.role === 'target')));
    const oco = this.nextId('oco');
    if (b.stop) {
      this.session.orders.push({ id: this.nextId('o'), sym, side: 'sell', type: 'stop', shares: p.shares, price: round4(b.stop), role: 'stop', oco, createdAt: now });
    }
    if (b.target) {
      this.session.orders.push({ id: this.nextId('o'), sym, side: 'sell', type: 'limit', shares: p.shares, price: round4(b.target), role: 'target', oco, createdAt: now });
    }
    p.stop = b.stop ? round4(b.stop) : undefined;
    p.target = b.target ? round4(b.target) : undefined;
    if (p.initialStop === undefined && b.stop) p.initialStop = round4(b.stop);
    this.changed();
    return { ok: true, message: `${sym}: stop ${p.stop ? '$' + fmtPx(p.stop) : '—'} · objetivo ${p.target ? '$' + fmtPx(p.target) : '—'}.`, fills: [] };
  }

  /** Revisa las órdenes pendientes de un símbolo contra la cotización nueva. */
  onQuote(q: Quote, now: number, marks?: Marks): Fill[] {
    const p = this.position(q.sym);
    if (p) {
      if (q.last > p.high) p.high = q.last;
      if (q.last < p.low) p.low = q.last;
    }
    if (q.halted) return [];
    const fills: Fill[] = [];
    for (const o of [...this.session.orders]) {
      if (o.sym !== q.sym || !this.session.orders.includes(o)) continue;
      let px: number | null = null;
      const limit = o.price!;
      if (o.side === 'buy' && o.type === 'limit' && q.ask <= limit) px = Math.min(limit, this.execPrice('buy', q, o.shares));
      else if (o.side === 'buy' && o.type === 'stop' && q.ask >= limit) px = Math.max(limit, this.execPrice('buy', q, o.shares));
      else if (o.side === 'sell' && o.type === 'limit' && q.bid >= limit) px = Math.max(limit, this.execPrice('sell', q, o.shares));
      else if (o.side === 'sell' && o.type === 'stop' && q.bid <= limit) px = this.execPrice('sell', q, o.shares);
      if (px === null) continue;
      if (o.side === 'buy') {
        const cost = px * o.shares + this.fee(o.shares);
        const bp = this.buyingPower(marks ?? ((s) => (s === q.sym ? q.last : undefined)), o.id);
        if (cost > bp + 1e-6) {
          this.session.orders = this.session.orders.filter((x) => x.id !== o.id);
          this.events.onNotice?.(`Orden de compra de ${o.sym} cancelada: el poder de compra no alcanzaba al ejecutarse.`);
          this.changed();
          continue;
        }
      }
      fills.push(this.execute(o, q, now, px));
    }
    return fills;
  }

  /** Cierra todo a mercado (fin del día). Las órdenes pendientes se cancelan. */
  flatten(quote: (sym: string) => Quote | null, now: number, reason: OrderRole = 'eod'): Trade[] {
    this.session.orders = [];
    const trades: Trade[] = [];
    for (const p of [...this.session.positions]) {
      const q = quote(p.sym) ?? { sym: p.sym, last: p.avgCost, bid: p.avgCost, ask: p.avgCost, ts: now, halted: false, volPerMin: 0 };
      const order: Order = { id: this.nextId('o'), sym: p.sym, side: 'sell', type: 'market', shares: p.shares, role: reason, createdAt: now };
      // En halt no hay mercado: se cierra al último precio conocido.
      const fill = this.execute(order, q, now, q.halted ? q.bid : undefined);
      const t = this.session.trades[this.session.trades.length - 1];
      if (t && t.closedAt === fill.ts && t.sym === p.sym) trades.push(t);
    }
    this.changed();
    return trades;
  }

  // ------------------------------------------------------------------ ejecución

  private execute(o: Order, q: Quote, now: number, priceOverride?: number): Fill {
    const price = round4(priceOverride ?? this.execPrice(o.side, q, o.shares));
    const fill: Fill = { id: this.nextId('f'), orderId: o.id, sym: o.sym, side: o.side, shares: o.shares, price, fee: this.fee(o.shares), ts: now, role: o.role };
    this.session.fills.push(fill);
    if (this.session.fills.length > 3000) this.session.fills.splice(0, this.session.fills.length - 3000);
    this.session.orders = this.session.orders.filter((x) => x.id !== o.id && (!o.oco || x.oco !== o.oco));
    let trade: Trade | undefined;
    if (o.side === 'buy') this.applyBuy(o, fill);
    else trade = this.applySell(o, fill);
    this.events.onFill?.(fill, trade);
    this.changed();
    return fill;
  }

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
        high: f.price,
        low: f.price,
        setup: o.setup,
        ctx: o.ctx,
        fills: 0,
      };
      this.session.positions.push(p);
    }
    p.avgCost = round4((p.avgCost * p.shares + f.price * f.shares) / (p.shares + f.shares));
    p.shares += f.shares;
    p.boughtShares += f.shares;
    p.boughtCost = money(p.boughtCost + f.price * f.shares);
    p.fees = money(p.fees + f.fee);
    p.fills++;
    if (o.setup && !p.setup) p.setup = o.setup;
    this.session.cash = money(this.session.cash - f.price * f.shares - f.fee);
    const stop = o.bracket?.stop ?? p.stop;
    const target = o.bracket?.target ?? p.target;
    if (stop || target) this.setBracket(o.sym, { stop, target }, f.ts);
  }

  private applySell(o: Order, f: Fill): Trade | undefined {
    const p = this.position(o.sym);
    if (!p) return undefined;
    p.shares -= f.shares;
    p.soldShares += f.shares;
    p.soldValue = money(p.soldValue + f.price * f.shares);
    p.fees = money(p.fees + f.fee);
    p.fills++;
    this.session.cash = money(this.session.cash + f.price * f.shares - f.fee);
    if (p.shares <= 0) return this.closeTrade(p, f, reasonFromRole(o.role));
    // Venta parcial: el stop y el objetivo quedan por las acciones que siguen abiertas.
    for (const x of this.session.orders) if (x.sym === o.sym && x.side === 'sell' && x.shares > p.shares) x.shares = p.shares;
    return undefined;
  }

  private closeTrade(p: Position, f: Fill, reason: ExitReason): Trade {
    this.session.positions = this.session.positions.filter((x) => x !== p);
    this.session.orders = this.session.orders.filter((x) => !(x.sym === p.sym && x.side === 'sell'));
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

  describe(f: Fill): string {
    const verb = f.side === 'buy' ? 'Compraste' : 'Vendiste';
    const t = f.side === 'sell' ? this.session.trades.find((x) => x.closedAt === f.ts && x.sym === f.sym) : undefined;
    const pnl = t ? ` · trade ${t.net >= 0 ? '+' : ''}${fmtMoney(t.net)}` : '';
    const role = f.role === 'stop' ? 'Stop ejecutado: ' : f.role === 'target' ? 'Objetivo alcanzado: ' : '';
    return `${role}${verb} ${f.shares} ${f.sym} a $${fmtPx(f.price)}${pnl}.`;
  }

  /** Etiquetas editables desde el diario (setup y nota) de un trade cerrado o de una posición. */
  tag(sym: string, setup: string | undefined): void {
    const p = this.position(sym);
    if (p) {
      p.setup = setup;
      this.changed();
    }
  }
}
