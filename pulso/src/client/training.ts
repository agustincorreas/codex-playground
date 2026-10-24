// Controlador de la cuenta de práctica: días de práctica, bróker, reglas de la cuenta (T+1 y PDT),
// atajos de teclado, guardado y avisos.
import { useEffect, useState } from 'react';
import { etParts, REG_CLOSE, sessionDate } from '../engine/time';
import { lastTradingDay } from '../sim/simulator';
import { Broker, describeOrder, fmtMoney, fmtPx, type BrokerResult, type Marks, type OrderRequest } from '../trading/broker';
import { roundPx, tickOf } from '../trading/depth';
import type { TrainingStore } from '../trading/store';
import {
  DEFAULT_TRADING,
  SIM_VERSION,
  type ActiveSession,
  type EntryContext,
  type Fill,
  type Hotkey,
  type Order,
  type SessionRecord,
  type Tif,
  type Trade,
  type TrainingState,
  type TradingSettings,
} from '../trading/types';
import type { SimConfig } from './source/local';
import type { DataSource } from './source/types';

export interface Notice {
  id: number;
  text: string;
  tone: 'ok' | 'error' | 'info';
}

export interface FillEvent {
  fill: Fill;
  trade?: Trade;
}

/** Sonidos de las órdenes (como en TradingView): ejecutada, parcial, en espera, cancelada o rechazada. */
export type OrderSound = 'buy' | 'sell' | 'win' | 'loss' | 'partial' | 'placed' | 'canceled' | 'rejected';

/** Lo que el ticket tiene cargado cuando se usa un atajo (acciones, stop, objetivo, setup, ruta y TIF). */
export interface TicketState {
  shares: number;
  stop?: number;
  target?: number;
  setup?: string;
  route?: string;
  tif?: Tif;
}

const money = (v: number) => Math.round(v * 100) / 100;
/** Días de la ventana de la regla PDT (el de hoy incluido). */
const PDT_WINDOW = 5;

function newSessionId(): string {
  return `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export class TrainingController {
  state: TrainingState;
  sessions: SessionRecord[];
  broker: Broker | null = null;
  notices: Notice[] = [];
  /** Sesión recién terminada (para mostrar el resumen). */
  lastEnded: SessionRecord | null = null;
  private source: DataSource | null = null;
  private listeners = new Set<() => void>();
  private fillListeners = new Set<(e: FillEvent) => void>();
  private soundListeners = new Set<(s: OrderSound) => void>();
  private saveTimer?: ReturnType<typeof setTimeout>;
  private noticeSeq = 0;
  /** Hubo una acción del usuario en esta sesión: recién ahí se guarda (no en la carga). */
  private touched = false;
  private trackedKey = '';

  constructor(
    private readonly store: TrainingStore,
    loaded: { state: TrainingState | null; sessions: SessionRecord[] },
    readonly mode: 'local' | 'remote',
  ) {
    const base: TrainingState = { version: 1, settings: DEFAULT_TRADING, balance: DEFAULT_TRADING.startingBalance, dayIndex: 0, dayTrades: [], updatedAt: Date.now() };
    const st = loaded.state ?? base;
    this.state = {
      ...base,
      ...st,
      dayIndex: st.dayIndex ?? 0,
      dayTrades: st.dayTrades ?? [],
      settings: { ...DEFAULT_TRADING, ...st.settings, hotkeys: st.settings?.hotkeys?.length ? st.settings.hotkeys : DEFAULT_TRADING.hotkeys },
    };
    this.sessions = [...loaded.sessions].sort((a, b) => b.endedAt - a.endedAt);
    const wanted = mode === 'local' ? 'sim' : 'live';
    const a = this.state.active;
    const today = sessionDate(Date.now()).dateKey;
    const stale = a && (a.mode !== wanted || (a.mode === 'live' && a.dayKey !== today) || (a.mode === 'sim' && a.simVersion !== SIM_VERSION) || !a.history);
    if (a && stale) {
      // Un día de otro modo, de otra fecha o de otra versión del simulador no se puede seguir: se
      // archiva tal como quedó y las posiciones abiertas vuelven al efectivo a su costo.
      const back = money(a.cash + a.positions.reduce((v, p) => v + p.shares * p.avgCost, 0));
      this.archive(a, a.simNow ?? a.marketStart, back);
      this.state.balance = back;
      this.state.active = undefined;
    }
    if (a && this.state.active) this.touched = true;
    if (!this.state.active) this.state.active = this.createSession();
    store.onFallback = () => {
      this.notify('No se pudo guardar en tu cuenta de Claude: por ahora se guarda en este navegador.', 'error');
      this.emit();
    };
  }

  get storeKind() {
    return this.store.kind;
  }

  get active(): ActiveSession | undefined {
    return this.state.active;
  }

  /** ¿Se puede operar? (hay día activo y el mercado terminó de cargarse o de reanudarse). */
  get ready(): boolean {
    return !!this.broker && !!this.source?.ready;
  }

  get depthIsReal(): boolean {
    return this.source?.depthIsReal ?? false;
  }

  /** Configuración del simulador para la sesión actual (semilla, día y punto de reanudación). */
  get simConfig(): SimConfig | undefined {
    const a = this.state.active;
    if (!a || a.mode !== 'sim' || a.seed === undefined) return undefined;
    return { seed: a.seed, dayTs: a.dayTs ?? Date.now(), startMinutes: a.startMinutes ?? this.state.settings.startMinutes, resumeAt: this.touched ? a.simNow : undefined };
  }

  private createSession(startMinutes = this.state.settings.startMinutes): ActiveSession {
    const live = this.mode === 'remote';
    const dayTs = Date.now();
    const d = live ? sessionDate(dayTs) : lastTradingDay(dayTs);
    const dayKey = `${d.y}-${String(d.mo).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    this.state.dayIndex += 1;
    return {
      id: newSessionId(),
      mode: live ? 'live' : 'sim',
      seed: live ? undefined : Math.floor(Math.random() * 2 ** 31),
      simVersion: live ? undefined : SIM_VERSION,
      dayTs: live ? undefined : dayTs,
      startMinutes: live ? undefined : startMinutes,
      dayKey,
      dayIndex: this.state.dayIndex,
      startedAt: Date.now(),
      marketStart: 0,
      startCash: this.state.balance,
      cash: this.state.balance,
      // T+1: lo vendido el día anterior ya se liquidó.
      unsettled: 0,
      positions: [],
      orders: [],
      history: [],
      fills: [],
      trades: [],
      seq: 0,
    };
  }

  // ------------------------------------------------------------------ suscripción (React)

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onFill(cb: (e: FillEvent) => void): () => void {
    this.fillListeners.add(cb);
    return () => this.fillListeners.delete(cb);
  }

  onSound(cb: (s: OrderSound) => void): () => void {
    this.soundListeners.add(cb);
    return () => this.soundListeners.delete(cb);
  }

  private sound(s: OrderSound): void {
    if (!this.state.settings.orderSounds) return;
    for (const cb of this.soundListeners) cb(s);
  }

  /** Aviso de error con el sonido de orden rechazada. */
  private reject(res: BrokerResult): BrokerResult {
    this.notify(res.message, 'error');
    this.sound('rejected');
    return res;
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  notify(text: string, tone: Notice['tone']): void {
    const n = { id: ++this.noticeSeq, text, tone };
    this.notices = [...this.notices.slice(-3), n];
    this.emit();
    setTimeout(() => {
      this.notices = this.notices.filter((x) => x.id !== n.id);
      this.emit();
    }, tone === 'error' ? 6000 : 4000);
  }

  // ------------------------------------------------------------------ conexión con la fuente de datos

  attach(source: DataSource): void {
    this.source = source;
    // Una fuente nueva todavía no sabe qué símbolos seguir.
    this.trackedKey = '';
    const a = this.state.active;
    if (!a) return;
    this.broker = new Broker(
      a,
      this.state.settings,
      {
        onFill: (fill, trade) => {
          const o = this.broker?.order(fill.orderId);
          const done = !o || o.filled >= o.shares;
          if (trade) this.sound(trade.net >= 0 ? 'win' : 'loss');
          else this.sound(!done ? 'partial' : fill.side === 'buy' ? 'buy' : 'sell');
          for (const cb of this.fillListeners) cb({ fill, trade });
        },
        onOrder: (kind, o) => {
          if (kind === 'open') {
            this.notify(`Orden en espera: ${describeOrder(o)}.`, 'info');
            this.sound('placed');
          } else {
            this.notify(`Orden cancelada: ${describeOrder(o)}${o.note ? ` · ${o.note}` : ''}.`, 'info');
            this.sound('canceled');
          }
        },
        onNotice: (text) => this.notify(text, 'error'),
        onChange: () => this.schedulePersist(),
        captureBars: (sym, from, to) => this.source?.reviewBars(sym, from, to),
      },
      () => ({ priorDayTrades: this.priorDayTrades() }),
    );
    this.syncTracked();
    this.emit();
  }

  detach(source: DataSource): void {
    if (this.source === source) {
      this.persistNow();
      this.source = null;
    }
  }

  readonly marks: Marks = (sym) => this.source?.quote(sym)?.last;

  /** Day trades de los días anteriores dentro de la ventana de la regla PDT. */
  private priorDayTrades(): number {
    const today = this.state.active?.dayIndex ?? this.state.dayIndex;
    return this.state.dayTrades.filter((d) => d > today - PDT_WINDOW && d < today).length;
  }

  /** Cada avance del mercado: trabajar las órdenes y, en el simulador, cerrar al final de la rueda. */
  onTick(now: number): void {
    const b = this.broker;
    const src = this.source;
    if (!b || !src?.ready) return;
    if (this.state.active && !this.state.active.marketStart) this.state.active.marketStart = now;
    b.process(now, src, this.marks);
    if (this.mode === 'local' && this.state.active && etParts(now).minutes >= REG_CLOSE - 1) {
      const hadActivity = this.state.active.trades.length > 0 || this.state.active.positions.length > 0;
      if (hadActivity) {
        this.endDay();
        this.notify('Cierre de la rueda: se cerraron las posiciones y se guardó el día en el diario.', 'info');
      }
    }
    this.syncTracked();
  }

  private syncTracked(): void {
    const syms = this.broker?.symbols() ?? [];
    const key = syms.join(',');
    if (key !== this.trackedKey) {
      this.trackedKey = key;
      this.source?.setTracked(syms);
    }
  }

  // ------------------------------------------------------------------ acciones del usuario

  private context(sym: string): EntryContext | undefined {
    const r = this.source?.row(sym);
    if (!r || !this.source) return undefined;
    return {
      price: r.price,
      changePct: r.changePct,
      gapPct: r.gapPct,
      rvol: r.rvol,
      rvol5m: r.rvol5m,
      volume: r.volume,
      float: r.float,
      score: r.score,
      minutes: etParts(this.source.now()).minutes,
    };
  }

  private notReady(): BrokerResult | null {
    if (!this.broker || !this.source) return { ok: false, message: 'Todavía no hay un día de práctica activo.', fills: [] };
    if (!this.source.ready) return { ok: false, message: 'Esperá a que termine de cargar el mercado.', fills: [] };
    return null;
  }

  place(req: OrderRequest): BrokerResult {
    const blocked = this.notReady();
    if (blocked) return this.reject(blocked);
    const b = this.broker!;
    const src = this.source!;
    this.touched = true;
    const ctx = req.side === 'buy' ? (req.ctx ?? this.context(req.sym)) : undefined;
    // Sin stop y objetivo automáticos, los del ticket quedan como plan: las salidas las hacés vos.
    if (req.side === 'buy' && !this.state.settings.autoBracket && (req.stop !== undefined || req.target !== undefined)) {
      req = { ...req, planStop: req.stop, planTarget: req.target, stop: undefined, target: undefined };
    }
    const res = b.place({ ...req, ctx }, src.now(), src, this.marks);
    if (!res.ok) this.reject(res);
    this.persistSoon();
    this.emit();
    return res;
  }

  setBracket(sym: string, stop?: number, target?: number): BrokerResult {
    const blocked = this.notReady();
    if (blocked) return blocked;
    this.touched = true;
    const res = this.broker!.setBracket(sym, { stop, target }, this.source!.now(), this.source!.quote(sym));
    if (res.ok) this.notify(res.message, 'ok');
    else this.reject(res);
    this.emit();
    return res;
  }

  /** Vender una fracción de la posición con una orden límite agresiva (Bid − 0,05), como un atajo. */
  sell(sym: string, fraction: number, ref: 'bid' | 'ask' = 'bid', offset = -0.05): BrokerResult {
    const p = this.broker?.position(sym);
    if (!p) return this.reject({ ok: false, message: `No tenés posición en ${sym}.`, fills: [] });
    const q = this.source?.quote(sym);
    if (!q) return this.place({ sym, side: 'sell', type: 'market', shares: p.shares });
    const shares = fraction >= 1 ? p.shares : Math.max(1, Math.floor(p.shares * fraction));
    const base = ref === 'bid' ? q.bid : q.ask;
    const price = roundPx(Math.max(tickOf(base), base + offset));
    return this.place({ sym, side: 'sell', type: 'limit', price, shares, tif: 'DAY+' });
  }

  /** Ejecuta un atajo de teclado o botón rápido sobre una acción. */
  hotkey(h: Hotkey, sym: string, ticket: TicketState): BrokerResult | null {
    const a = h.action;
    if (a.kind === 'cancel') {
      if (this.broker?.orders(sym).length) this.cancelAll(sym);
      return null;
    }
    if (a.kind === 'breakeven') {
      const p = this.broker?.position(sym);
      if (!p) return null;
      return this.setBracket(sym, p.avgCost, p.target);
    }
    if (a.kind === 'sell') return this.sell(sym, a.fraction, a.ref === 'last' ? 'bid' : a.ref, a.offset);
    const q = this.source?.quote(sym);
    if (!q) return this.place({ sym, side: 'buy', type: 'market', shares: ticket.shares });
    const base = a.ref === 'ask' ? q.ask : a.ref === 'bid' ? q.bid : q.last;
    const price = roundPx(base + a.offset);
    let shares = typeof a.shares === 'number' ? a.shares : ticket.shares;
    if (a.shares === 'risk') {
      if (!ticket.stop || ticket.stop >= price) return this.reject({ ok: false, message: 'Para comprar por riesgo poné un stop debajo del precio en el ticket.', fills: [] });
      shares = Math.max(1, Math.floor(this.state.settings.defaultRisk / (price - ticket.stop)));
    }
    return this.place({ sym, side: 'buy', type: 'limit', price, shares, tif: ticket.tif ?? 'DAY+', route: ticket.route, stop: ticket.stop, target: ticket.target, setup: ticket.setup });
  }

  cancel(id: string): void {
    if (!this.broker || !this.source) return;
    const o = this.broker.orders().find((x) => x.id === id);
    if (!o) return;
    this.touched = true;
    this.broker.cancel(id, this.source.now());
    this.notify(`Cancelaste: ${describeOrder(o)}.`, 'info');
    this.sound('canceled');
    this.emit();
  }

  cancelAll(sym?: string): void {
    if (!this.broker || !this.source) return;
    const list = this.broker.orders().filter((o) => !sym || o.sym === sym);
    if (!list.length) return;
    this.touched = true;
    this.broker.cancelAll(sym, this.source.now());
    this.notify(list.length === 1 ? `Cancelaste: ${describeOrder(list[0])}.` : `Cancelaste ${list.length} órdenes${sym ? ` de ${sym}` : ''}.`, 'info');
    this.sound('canceled');
    this.emit();
  }

  /** Terminar el día: cerrar todo, guardar el día en el historial y llevar el saldo. */
  endDay(): SessionRecord | null {
    const a = this.state.active;
    if (!a) return null;
    const now = this.source?.now() ?? Date.now();
    if (this.broker && this.source) this.broker.flatten(now, this.source, this.marks);
    const rec = this.archive(a, now);
    this.state.balance = a.cash;
    this.state.dayTrades = [...this.state.dayTrades, ...a.trades.map(() => a.dayIndex)].filter((d) => d > a.dayIndex - 10);
    this.state.active = undefined;
    this.broker = null;
    this.lastEnded = rec;
    this.touched = true;
    this.syncTracked();
    this.persistNow();
    this.emit();
    return rec;
  }

  private archive(a: ActiveSession, marketEnd: number, endCash = a.cash): SessionRecord {
    const rec: SessionRecord = {
      id: a.id,
      mode: a.mode,
      seed: a.seed,
      dayKey: a.dayKey,
      dayIndex: a.dayIndex,
      startedAt: a.startedAt,
      endedAt: Date.now(),
      marketStart: a.marketStart,
      marketEnd,
      startCash: a.startCash,
      endCash,
      trades: a.trades,
    };
    if (rec.trades.length) {
      this.sessions = [rec, ...this.sessions.filter((s) => s.id !== rec.id)];
      void this.store.saveSession(rec).catch(() => this.notify('No se pudo guardar el día en el historial.', 'error'));
    }
    return rec;
  }

  /**
   * Arranca un día nuevo (en el simulador, otro mercado). En el simulador la página arma la fuente
   * del mercado nuevo, así que la vieja se suelta acá: su hora ya no es la de esta sesión.
   */
  private startFresh(startMinutes?: number): void {
    this.state.active = this.createSession(startMinutes);
    this.broker = null;
    this.lastEnded = null;
    if (this.mode === 'remote' && this.source) this.attach(this.source);
    else this.source = null;
    // Empezar un día es una acción: se guarda, así al recargar sigue este mismo mercado.
    this.touched = true;
    this.persistNow();
  }

  /** Empezar otro día simulado (o una sesión nueva en vivo). */
  newDay(startMinutes?: number): void {
    if (this.state.active && (this.state.active.positions.length || this.state.active.trades.length)) this.endDay();
    if (startMinutes) this.state.settings = { ...this.state.settings, startMinutes };
    this.startFresh(startMinutes);
    this.emit();
  }

  /** Plata puesta en la cuenta (saldo inicial más depósitos y retiros): base del resultado total. */
  get capital(): number {
    return this.state.capital ?? this.state.settings.startingBalance;
  }

  /**
   * Cambia el saldo de la cuenta a `target`, como un depósito o un retiro: el resultado del día, el
   * total y las estadísticas no lo cuentan como ganancia ni como pérdida. Con posiciones abiertas no
   * se puede (el saldo quedaría mezclado con acciones).
   */
  setBalance(target: number): BrokerResult {
    const fail = (message: string) => this.reject({ ok: false, message, fills: [] });
    target = money(target);
    if (!Number.isFinite(target) || target < 1) return fail('Elegí un saldo de al menos US$ 1.');
    if (target > 10_000_000) return fail('El saldo máximo es US$ 10.000.000.');
    const a = this.state.active;
    if (a?.positions.length) return fail('Cerrá tus posiciones antes de cambiar el saldo.');
    const current = a ? a.cash : this.state.balance;
    const delta = money(target - current);
    if (delta === 0) return { ok: true, message: 'El saldo ya es ese.', fills: [] };
    if (a) {
      a.cash = target;
      a.startCash = money(a.startCash + delta);
      // La plata nueva queda toda disponible (lo vendido hoy deja de esperar la liquidación).
      a.unsettled = 0;
    }
    this.state.balance = target;
    this.state.capital = money(this.capital + delta);
    this.touched = true;
    this.persistNow();
    const message = `Saldo cambiado a ${fmtMoney(target)}: ${delta > 0 ? 'depositaste' : 'retiraste'} ${fmtMoney(Math.abs(delta))}. No cuenta como ganancia ni como pérdida.`;
    this.notify(message, 'ok');
    this.emit();
    return { ok: true, message, fills: [] };
  }

  resetAccount(clearHistory: boolean): void {
    this.state.active = undefined;
    this.broker = null;
    this.state.balance = this.state.settings.startingBalance;
    this.state.capital = this.state.settings.startingBalance;
    this.state.dayTrades = [];
    if (clearHistory) {
      this.sessions = [];
      void this.store.clear();
    }
    this.startFresh();
    this.notify(`Cuenta reiniciada con ${fmtMoney(this.state.balance)}.`, 'info');
    this.emit();
  }

  updateSettings(patch: Partial<TradingSettings>): void {
    this.state.settings = { ...this.state.settings, ...patch };
    if (this.broker) this.broker.settings = this.state.settings;
    this.touched = true;
    this.persistNow();
    this.emit();
  }

  /** Etiquetar un trade (setup y nota), esté en el día actual o en el historial. */
  updateTrade(id: string, patch: { setup?: string; note?: string }): void {
    this.touched = true;
    const a = this.state.active;
    const t = a?.trades.find((x) => x.id === id);
    if (t) {
      Object.assign(t, patch);
      this.persistSoon();
      this.emit();
      return;
    }
    const idx = this.sessions.findIndex((s) => s.trades.some((x) => x.id === id));
    if (idx < 0) return;
    const rec = { ...this.sessions[idx], trades: this.sessions[idx].trades.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
    this.sessions = this.sessions.map((s, i) => (i === idx ? rec : s));
    void this.store.saveSession(rec);
    this.emit();
  }

  // ------------------------------------------------------------------ guardado

  private schedulePersist(): void {
    this.touched = true;
    this.persistSoon();
  }

  private persistSoon(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.persistNow(), 700);
  }

  /** Guarda el estado (con la hora de mercado para poder reanudar). Solo después de alguna acción del usuario. */
  persistNow(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (!this.touched) return;
    const a = this.state.active;
    // La hora se toma solo de un mercado ya listo: mientras se genera o se reanuda, su reloj está atrás.
    if (a && this.source?.ready && a.mode === 'sim') a.simNow = Math.max(a.simNow ?? 0, this.source.now());
    this.state.updatedAt = Date.now();
    void this.store.saveState(this.state);
  }

  // ------------------------------------------------------------------ números de la cuenta

  summary() {
    const b = this.broker;
    const a = this.state.active;
    const s = this.state.settings;
    if (!b || !a) {
      const bal = this.state.balance;
      return { cash: bal, equity: bal, dayPnl: 0, buyingPower: bal, bpUsed: 0, positionValue: 0, marginBorrowed: 0, unsettled: 0, leverage: 1, dayTrades: this.priorDayTrades(), pdt: false, open: 0, trades: 0, realized: 0, account: s.account };
    }
    return {
      cash: a.cash,
      equity: b.equity(this.marks),
      dayPnl: b.dayPnl(this.marks),
      buyingPower: b.buyingPower(this.marks),
      bpUsed: b.buyingPowerUsed(this.marks),
      positionValue: b.positionValue(this.marks),
      marginBorrowed: b.marginBorrowed(),
      unsettled: b.unsettled(),
      leverage: b.leverage(this.marks),
      dayTrades: b.dayTradeCount(),
      pdt: b.pdtApplies(this.marks),
      open: a.positions.length,
      trades: a.trades.length,
      realized: money(a.trades.reduce((x, t) => x + t.net, 0) + a.positions.reduce((x, p) => x + p.realized, 0)),
      account: s.account,
    };
  }

  /** Órdenes del día (vivas y terminadas), la más nueva primero. */
  orderLog(): Order[] {
    const a = this.state.active;
    if (!a) return [];
    return [...a.orders, ...a.history].sort((x, y) => y.createdAt - x.createdAt);
  }

  /** Todos los trades: los del día actual y los del historial. */
  allTrades(): Trade[] {
    return [...(this.state.active?.trades ?? []), ...this.sessions.flatMap((s) => s.trades)];
  }

  unrealized(sym: string): { pnl: number; pct: number; last: number } | null {
    const p = this.broker?.position(sym);
    const last = this.marks(sym);
    if (!p || last === undefined) return null;
    return { pnl: money((last - p.avgCost) * p.shares), pct: ((last - p.avgCost) / p.avgCost) * 100, last };
  }

  describeFill(f: Fill, trade?: Trade): string {
    return this.broker ? this.broker.describe(f, trade) : `${f.side === 'buy' ? 'Compraste' : 'Vendiste'} ${f.shares} ${f.sym} a $${fmtPx(f.price)}.`;
  }
}

/** Re-render de React cuando cambia la cuenta de práctica. */
export function useTrainingVersion(c: TrainingController | null): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!c) return;
    return c.subscribe(() => setV((x) => x + 1));
  }, [c]);
  return v;
}
