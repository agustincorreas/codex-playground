// Controlador de la cuenta de práctica: días de práctica, bróker, reglas de la cuenta (T+1 y PDT),
// atajos de teclado, guardado y avisos.
import { useEffect, useState } from 'react';
import type { Session } from '../engine/types';
import { etDateTimeToTs, etParts, etWallToTs, nextSessionChange, POST_CLOSE, REG_CLOSE, regularCloseMinutes, sessionAt, sessionDate } from '../engine/time';
import { dayHeat, lastTradingDay, seedForDay } from '../sim/simulator';
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

/** Cómo arrancar un día nuevo. */
export interface NewDayOptions {
  clock: 'practice' | 'ny';
  /** Práctica: fecha (AAAA-MM-DD; si no es día hábil, el hábil anterior) y hora de inicio (minutos ET). */
  date?: string;
  startMinutes?: number;
  /** Repetir un día: la misma semilla, el mismo mercado. */
  seed?: number;
}

/** Respaldo de la cuenta de práctica (para llevarla a otro navegador o guardarla). */
export interface AccountBackup {
  app: 'pulso';
  kind: 'cuenta-de-practica';
  version: 1;
  exportedAt: number;
  state: TrainingState;
  sessions: SessionRecord[];
}

const money = (v: number) => Math.round(v * 100) / 100;
/** Días de la ventana de la regla PDT (el de hoy incluido). */
const PDT_WINDOW = 5;

function newSessionId(): string {
  return `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Fin del día simulado: el cierre del after-hours (17:00 en los días de cierre anticipado). */
export function postEndMinutes(dayKey: string): number {
  return regularCloseMinutes(dayKey) === REG_CLOSE ? POST_CLOSE : 17 * 60;
}

/**
 * El mercado de Nueva York ahora mismo (para el modo "Mercado ahora"). En el último minuto del
 * after-hours ya no se arranca un día: el próximo abre con el pre-market siguiente.
 */
export function nyMarket(now = Date.now()): { open: boolean; session: Session; dateKey: string; nextOpen: number } {
  const p = etParts(now);
  const session = sessionAt(now);
  const end = postEndMinutes(p.dateKey);
  const open = session !== 'closed' && p.minutes < end - 1;
  const nextOpen = open ? now : nextSessionChange(session === 'closed' ? now : etWallToTs(p.y, p.mo, p.d, end) + 1000).at;
  return { open, session, dateKey: p.dateKey, nextOpen };
}

/** Un día de "Mercado ahora" que ya terminó (es de otra fecha o ya cerró el after-hours). */
function nyDayOver(a: ActiveSession, now = Date.now()): boolean {
  const p = etParts(now);
  return p.dateKey !== a.dayKey || p.minutes >= postEndMinutes(a.dayKey);
}

function normalizeState(st: TrainingState | null): TrainingState {
  const base: TrainingState = { version: 1, settings: DEFAULT_TRADING, balance: DEFAULT_TRADING.startingBalance, dayIndex: 0, dayTrades: [], updatedAt: Date.now() };
  const s = st ?? base;
  return {
    ...base,
    ...s,
    dayIndex: s.dayIndex ?? 0,
    dayTrades: s.dayTrades ?? [],
    settings: { ...DEFAULT_TRADING, ...s.settings, hotkeys: s.settings?.hotkeys?.length ? s.settings.hotkeys : DEFAULT_TRADING.hotkeys },
  };
}

/** Revisa un archivo de respaldo: devuelve el respaldo o un mensaje de por qué no sirve. */
export function parseBackup(raw: unknown): AccountBackup | string {
  if (!raw || typeof raw !== 'object') return 'El archivo no es un respaldo de Pulso.';
  const b = raw as Partial<AccountBackup>;
  if (b.app !== 'pulso' || b.kind !== 'cuenta-de-practica') return 'El archivo no es un respaldo de la cuenta de práctica de Pulso.';
  if (typeof b.version !== 'number' || b.version > 1) return 'El respaldo es de una versión más nueva de Pulso: actualizá la página y probá de nuevo.';
  const st = b.state;
  if (!st || typeof st !== 'object' || typeof st.balance !== 'number' || !Number.isFinite(st.balance) || !st.settings || typeof st.settings !== 'object') {
    return 'Al respaldo le falta la cuenta (saldo y ajustes).';
  }
  if (!Array.isArray(b.sessions)) return 'Al respaldo le falta el historial de días.';
  const sessions = b.sessions.filter((x): x is SessionRecord => !!x && typeof x === 'object' && typeof x.id === 'string' && typeof x.dayKey === 'string' && Array.isArray(x.trades));
  const state = { ...st };
  const a = state.active;
  if (a && (typeof a !== 'object' || !Array.isArray(a.positions) || !Array.isArray(a.orders) || !Array.isArray(a.trades) || !Array.isArray(a.fills) || typeof a.cash !== 'number')) delete state.active;
  return { app: 'pulso', kind: 'cuenta-de-practica', version: 1, exportedAt: Number(b.exportedAt) || Date.now(), state, sessions };
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
  /** Ejecuciones mientras el mercado se ponía al día (se avisan juntas al terminar). */
  private away: { fills: number; trades: Trade[] } | null = null;
  /** Cambia al importar una cuenta: la página rearma el mercado aunque el día sea el mismo. */
  private reloads = 0;

  constructor(
    private readonly store: TrainingStore,
    loaded: { state: TrainingState | null; sessions: SessionRecord[] },
    readonly mode: 'local' | 'remote',
  ) {
    this.state = normalizeState(loaded.state);
    this.sessions = [...loaded.sessions].sort((a, b) => b.endedAt - a.endedAt);
    this.settle();
    store.onFallback = () => {
      this.notify('No se pudo guardar en tu cuenta de Claude: por ahora se guarda en este navegador.', 'error');
      this.emit();
    };
  }

  /**
   * Revisa el día guardado al cargar: uno de otro modo, de otra fecha o de otra versión del simulador
   * no se puede seguir y se archiva tal como quedó (las posiciones vuelven al efectivo a su costo). Un
   * día de "Mercado ahora" que ya terminó sin nada abierto se archiva; con órdenes o posiciones se
   * deja, así el mercado se pone al día hasta el cierre y las cierra ahí.
   */
  private settle(): void {
    const wanted = this.mode === 'local' ? 'sim' : 'live';
    const a = this.state.active;
    const today = sessionDate(Date.now()).dateKey;
    const stale =
      a &&
      (a.mode !== wanted ||
        (a.mode === 'live' && a.dayKey !== today) ||
        (a.mode === 'sim' && a.simVersion !== SIM_VERSION) ||
        !a.history ||
        (a.clock === 'ny' && nyDayOver(a) && !a.positions.length && !a.orders.length));
    if (a && stale) {
      const back = money(a.cash + a.positions.reduce((v, p) => v + p.shares * p.avgCost, 0));
      this.archive(a, a.simNow ?? a.marketStart, back);
      this.state.balance = back;
      this.state.active = undefined;
    }
    if (a && this.state.active) this.touched = true;
    if (!this.state.active) this.ensureFresh();
  }

  /** Sin día activo: arranca uno (en "Mercado ahora", solo si Nueva York está abierto). */
  private ensureFresh(): void {
    if (this.mode === 'local' && this.state.settings.clock === 'ny' && !nyMarket().open) return;
    this.state.active = this.createSession({ clock: this.state.settings.clock });
  }

  /**
   * "Mercado ahora" sin día activo y con Nueva York abierto: arranca el día de hoy. Devuelve si arrancó
   * (la página lo llama cada tanto mientras muestra el mercado cerrado).
   */
  ensureSession(): boolean {
    if (this.state.active || this.mode !== 'local' || this.state.settings.clock !== 'ny' || !nyMarket().open) return false;
    this.startFresh({ clock: 'ny' });
    this.emit();
    return true;
  }

  /** "Mercado ahora" con Nueva York cerrado y sin día activo: cuándo abre el pre-market. */
  get nyClosedUntil(): number | null {
    if (this.mode !== 'local' || this.state.active || this.state.settings.clock !== 'ny') return null;
    const m = nyMarket();
    return m.open ? null : m.nextOpen;
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

  /** Identifica el mercado que tiene que mostrar la página: cambia con cada día nuevo. */
  get simKey(): string | null {
    const a = this.state.active;
    return a && a.mode === 'sim' ? `${a.id}:${this.reloads}` : null;
  }

  /** Configuración del simulador para la sesión actual (semilla, día y punto de reanudación). */
  get simConfig(): SimConfig | undefined {
    const a = this.state.active;
    if (!a || a.mode !== 'sim' || a.seed === undefined) return undefined;
    const base = { sessionId: a.id, seed: a.seed, dayTs: a.dayTs ?? Date.now(), startMinutes: a.startMinutes ?? this.state.settings.startMinutes };
    if (a.clock === 'ny') {
      // Solo las órdenes en espera necesitan repasar lo que pasó; las posiciones toman el precio de ahora.
      return { ...base, realtime: true, catchUpFrom: this.touched && a.orders.length > 0 ? a.simNow : undefined };
    }
    return { ...base, resumeAt: this.touched ? a.simNow : undefined };
  }

  private createSession(opts: NewDayOptions): ActiveSession {
    const live = this.mode === 'remote';
    const now = Date.now();
    let dayTs = now;
    let dayKey: string;
    let seed: number | undefined;
    let startMinutes: number | undefined;
    let clock: 'ny' | undefined;
    if (live) dayKey = sessionDate(now).dateKey;
    else if (opts.clock === 'ny') {
      // El mercado de hoy es el mismo para todos (la semilla sale de la fecha), como uno de verdad.
      const p = etParts(now);
      dayKey = p.dateKey;
      seed = seedForDay(dayKey);
      startMinutes = Math.floor(p.minutes);
      clock = 'ny';
    } else {
      if (opts.date) dayTs = etDateTimeToTs(opts.date, '12:00');
      const d = lastTradingDay(dayTs);
      dayKey = `${d.y}-${String(d.mo).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
      seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
      startMinutes = opts.startMinutes ?? this.state.settings.startMinutes;
    }
    this.state.dayIndex += 1;
    return {
      id: newSessionId(),
      mode: live ? 'live' : 'sim',
      seed,
      simVersion: live ? undefined : SIM_VERSION,
      dayTs: live ? undefined : dayTs,
      startMinutes,
      clock,
      heat: seed === undefined ? undefined : dayHeat(seed),
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
          if (this.away) {
            this.away.fills++;
            if (trade) this.away.trades.push(trade);
            return;
          }
          const o = this.broker?.order(fill.orderId);
          const done = !o || o.filled >= o.shares;
          if (trade) this.sound(trade.net >= 0 ? 'win' : 'loss');
          else this.sound(!done ? 'partial' : fill.side === 'buy' ? 'buy' : 'sell');
          for (const cb of this.fillListeners) cb({ fill, trade });
        },
        onOrder: (kind, o) => {
          if (this.away) return;
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

  /** Cada avance del mercado: trabajar las órdenes y, en el simulador, cerrar al final del after-hours. */
  onTick(now: number): void {
    const b = this.broker;
    const src = this.source;
    if (!b || !src?.ready) return;
    if (this.state.active && !this.state.active.marketStart) this.state.active.marketStart = now;
    b.process(now, src, this.marks);
    this.checkDayEnd(now);
    this.syncTracked();
  }

  /**
   * Mientras el mercado se pone al día (al volver a "Mercado ahora" con órdenes o posiciones): las
   * órdenes se trabajan con lo que pasó, en silencio, y al final se avisa qué se ejecutó.
   */
  catchUp(now: number): void {
    const b = this.broker;
    const src = this.source;
    if (!b || !src || !this.state.active) return;
    if (!this.away) this.away = { fills: 0, trades: [] };
    b.process(now, src, this.marks);
    this.checkDayEnd(now);
  }

  /** El mercado se rearmó con otro motor: las órdenes en cola vuelven a medir la cinta desde ahora. */
  rebase(): void {
    this.broker?.rebase();
    this.flushAway();
  }

  private flushAway(): void {
    const away = this.away;
    this.away = null;
    if (!away?.fills) return;
    const net = money(away.trades.reduce((x, t) => x + t.net, 0));
    const closed = away.trades.length ? ` y cerraste ${away.trades.length} trade${away.trades.length > 1 ? 's' : ''} (${fmtMoney(net)})` : '';
    const fills = away.fills === 1 ? 'una ejecución' : `${away.fills} ejecuciones`;
    this.notify(`Mientras no estabas hubo ${fills} de tus órdenes${closed}. Mirá el detalle en la actividad del día.`, net < 0 ? 'error' : 'info');
    this.emit();
  }

  /** Al final del after-hours se cierra todo y el día va al diario ("Mercado ahora" siempre termina ahí). */
  private checkDayEnd(now: number): void {
    const a = this.state.active;
    if (this.mode !== 'local' || !a || etParts(now).minutes < postEndMinutes(a.dayKey) - 1) return;
    const open = a.positions.length > 0;
    const hadActivity = a.trades.length > 0 || open;
    if (!hadActivity && a.clock !== 'ny') return;
    this.endDay();
    const ny = a.clock === 'ny' ? ' de Nueva York' : '';
    const what = open ? ': se cerraron las posiciones y se guardó el día en el diario' : hadActivity ? ': se guardó el día en el diario' : '';
    this.notify(`Terminó el after-hours${ny}${what}.`, 'info');
    if (a.clock === 'ny') this.ensureSession();
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

  /**
   * Vender una fracción de la posición (o `qty` acciones, sin pasarse de la posición) con una orden
   * límite agresiva (Bid − 0,05), como un atajo.
   */
  sell(sym: string, fraction: number, ref: 'bid' | 'ask' = 'bid', offset = -0.05, qty?: number): BrokerResult {
    const p = this.broker?.position(sym);
    if (!p) return this.reject({ ok: false, message: `No tenés posición en ${sym}.`, fills: [] });
    const q = this.source?.quote(sym);
    if (!q) return this.place({ sym, side: 'sell', type: 'market', shares: p.shares });
    const shares = qty !== undefined ? Math.min(p.shares, Math.max(1, Math.floor(qty))) : fraction >= 1 ? p.shares : Math.max(1, Math.floor(p.shares * fraction));
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
    this.flushAway();
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
      simVersion: a.simVersion,
      startMinutes: a.startMinutes,
      clock: a.clock,
      heat: a.heat,
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
  private startFresh(opts: NewDayOptions = { clock: this.state.settings.clock }): void {
    this.state.active = this.createSession(opts);
    this.broker = null;
    this.lastEnded = null;
    if (this.mode === 'remote' && this.source) this.attach(this.source);
    else this.source = null;
    // Empezar un día es una acción: se guarda, así al recargar sigue este mismo mercado.
    this.touched = true;
    this.persistNow();
  }

  /**
   * Empezar otro día: "Mercado ahora" (la hora de Nueva York) o un día simulado con la fecha y la hora
   * que elijas (o una sesión nueva en vivo). Lo elegido queda para los días siguientes.
   */
  newDay(opts: NewDayOptions = { clock: this.state.settings.clock }): void {
    if (this.state.active && (this.state.active.positions.length || this.state.active.trades.length)) this.endDay();
    const patch: Partial<TradingSettings> = { clock: opts.clock };
    if (opts.clock === 'practice' && opts.startMinutes !== undefined && opts.seed === undefined) patch.startMinutes = Math.round(opts.startMinutes);
    this.state.settings = { ...this.state.settings, ...patch };
    if (this.broker) this.broker.settings = this.state.settings;
    if (this.mode === 'local' && opts.clock === 'ny' && !nyMarket().open) {
      // Nueva York está cerrado: queda elegido y el día arranca solo cuando abra el pre-market.
      this.state.active = undefined;
      this.broker = null;
      this.lastEnded = null;
      this.source = null;
      this.touched = true;
      this.persistNow();
      this.emit();
      return;
    }
    this.startFresh(opts);
    this.emit();
  }

  /** Repetir un día: el mismo mercado (misma semilla y fecha) desde la misma hora, como día de práctica. */
  replayDay(day: { seed?: number; dayKey: string; startMinutes?: number }): void {
    if (day.seed === undefined) return;
    this.newDay({ clock: 'practice', date: day.dayKey, startMinutes: day.startMinutes ?? this.state.settings.startMinutes, seed: day.seed });
  }

  /** ¿Ese día se puede repetir igual? (con la versión actual del simulador). */
  canReplay(day: { seed?: number; simVersion?: number; mode: 'sim' | 'live' }): boolean {
    return this.mode === 'local' && day.mode === 'sim' && day.seed !== undefined && day.simVersion === SIM_VERSION;
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
    this.ensureFresh();
    this.broker = null;
    this.lastEnded = null;
    if (this.mode === 'remote' && this.source) this.attach(this.source);
    else this.source = null;
    this.touched = true;
    this.persistNow();
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

  // ------------------------------------------------------------------ respaldo

  /** Todo lo de la cuenta (saldo, ajustes, día en curso e historial) para guardarlo en un archivo. */
  exportBackup(): AccountBackup {
    this.persistNow();
    return { app: 'pulso', kind: 'cuenta-de-practica', version: 1, exportedAt: Date.now(), state: structuredClone(this.state), sessions: structuredClone(this.sessions) };
  }

  /**
   * Reemplaza la cuenta por la de un respaldo (la de este navegador o de tu cuenta de Claude se borra).
   * El día en curso del respaldo sigue donde estaba si se puede; si no, se archiva como al cargar.
   */
  async importBackup(raw: unknown): Promise<BrokerResult> {
    const b = parseBackup(raw);
    if (typeof b === 'string') return this.reject({ ok: false, message: b, fills: [] });
    this.state = normalizeState(b.state);
    this.sessions = [...b.sessions].sort((x, y) => y.endedAt - x.endedAt);
    this.broker = null;
    this.source = null;
    this.lastEnded = null;
    this.touched = false;
    this.reloads++;
    this.settle();
    this.touched = true;
    this.state.updatedAt = Date.now();
    try {
      await this.store.clear();
      await this.store.saveState(this.state);
      for (const rec of this.sessions) await this.store.saveSession(rec);
    } catch {
      this.notify('No se pudo guardar todo el respaldo: revisá el historial.', 'error');
    }
    const days = this.sessions.length;
    const message = `Cuenta importada: ${fmtMoney(this.state.balance)} y ${days} día${days === 1 ? '' : 's'} en el diario.`;
    this.notify(message, 'ok');
    this.emit();
    return { ok: true, message, fills: [] };
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
