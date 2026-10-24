// Controlador de la cuenta de práctica: sesiones (días simulados), bróker, guardado y avisos.
import { useEffect, useState } from 'react';
import { etParts, REG_CLOSE, sessionDate } from '../engine/time';
import { lastTradingDay } from '../sim/simulator';
import { Broker, fmtMoney, type BrokerResult, type Marks, type OrderRequest } from '../trading/broker';
import type { TrainingStore } from '../trading/store';
import { DEFAULT_TRADING, type ActiveSession, type EntryContext, type Fill, type SessionRecord, type Trade, type TrainingState, type TradingSettings } from '../trading/types';
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

const money = (v: number) => Math.round(v * 100) / 100;

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
    const base: TrainingState = { version: 1, settings: DEFAULT_TRADING, balance: DEFAULT_TRADING.startingBalance, updatedAt: Date.now() };
    const st = loaded.state ?? base;
    this.state = { ...base, ...st, settings: { ...DEFAULT_TRADING, ...st.settings } };
    this.sessions = [...loaded.sessions].sort((a, b) => b.endedAt - a.endedAt);
    const wanted = mode === 'local' ? 'sim' : 'live';
    const a = this.state.active;
    const today = sessionDate(Date.now()).dateKey;
    if (a && (a.mode !== wanted || (a.mode === 'live' && a.dayKey !== today))) {
      // Una sesión de otro modo o de otro día no se puede seguir: se archiva tal como quedó y las
      // posiciones abiertas vuelven al efectivo a su costo (no hay precio de ese mercado).
      this.archive(a, a.simNow ?? a.marketStart);
      this.state.balance = money(a.cash + a.positions.reduce((v, p) => v + p.shares * p.avgCost, 0));
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
    return {
      id: newSessionId(),
      mode: live ? 'live' : 'sim',
      seed: live ? undefined : Math.floor(Math.random() * 2 ** 31),
      dayTs: live ? undefined : dayTs,
      startMinutes: live ? undefined : startMinutes,
      dayKey,
      startedAt: Date.now(),
      marketStart: 0,
      startCash: this.state.balance,
      cash: this.state.balance,
      positions: [],
      orders: [],
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
    const a = this.state.active;
    if (!a) return;
    this.broker = new Broker(a, this.state.settings, {
      onFill: (fill, trade) => {
        for (const cb of this.fillListeners) cb({ fill, trade });
      },
      onNotice: (text) => this.notify(text, 'error'),
      onChange: () => this.schedulePersist(),
      captureBars: (sym, from, to) => this.source?.reviewBars(sym, from, to),
    });
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

  /** Cada avance del mercado: ejecutar órdenes pendientes y, en el simulador, cerrar al final de la rueda. */
  onTick(now: number): void {
    const b = this.broker;
    if (!b || !this.source) return;
    if (this.state.active && !this.state.active.marketStart) this.state.active.marketStart = now;
    for (const sym of b.symbols()) {
      const q = this.source.quote(sym);
      if (q) b.onQuote(q, now, this.marks);
    }
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
    return { price: r.price, changePct: r.changePct, rvol: r.rvol, float: r.float, score: r.score, minutes: etParts(this.source.now()).minutes };
  }

  place(req: OrderRequest): BrokerResult {
    const b = this.broker;
    if (!b || !this.source) return { ok: false, message: 'Todavía no hay un día de práctica activo.', fills: [] };
    this.touched = true;
    const ctx = req.side === 'buy' ? (req.ctx ?? this.context(req.sym)) : undefined;
    const res = b.place({ ...req, ctx }, this.source.quote(req.sym), this.source.now(), this.marks);
    this.notify(res.message, res.ok ? 'ok' : 'error');
    this.persistSoon();
    this.emit();
    return res;
  }

  setBracket(sym: string, stop?: number, target?: number): BrokerResult {
    const b = this.broker;
    if (!b || !this.source) return { ok: false, message: 'Sin sesión activa.', fills: [] };
    this.touched = true;
    const res = b.setBracket(sym, { stop, target }, this.source.now(), this.source.quote(sym));
    this.notify(res.message, res.ok ? 'ok' : 'error');
    this.emit();
    return res;
  }

  /** Vender una fracción de la posición a mercado (1 = todo). */
  sell(sym: string, fraction: number): BrokerResult {
    const p = this.broker?.position(sym);
    if (!p) return { ok: false, message: `No tenés posición en ${sym}.`, fills: [] };
    const shares = fraction >= 1 ? p.shares : Math.max(1, Math.floor(p.shares * fraction));
    return this.place({ sym, side: 'sell', type: 'market', shares });
  }

  cancel(id: string): void {
    this.touched = true;
    this.broker?.cancel(id);
    this.emit();
  }

  cancelAll(sym?: string): void {
    this.touched = true;
    this.broker?.cancelAll(sym);
    this.emit();
  }

  /** Terminar el día: cerrar todo a mercado, guardar el día en el historial y llevar el saldo. */
  endDay(): SessionRecord | null {
    const a = this.state.active;
    if (!a) return null;
    const now = this.source?.now() ?? Date.now();
    if (this.broker && this.source) this.broker.flatten((s) => this.source!.quote(s), now);
    const rec = this.archive(a, now);
    this.state.balance = a.cash;
    this.state.active = undefined;
    this.broker = null;
    this.lastEnded = rec;
    this.touched = true;
    this.syncTracked();
    this.persistNow();
    this.emit();
    return rec;
  }

  private archive(a: ActiveSession, marketEnd: number): SessionRecord {
    const rec: SessionRecord = {
      id: a.id,
      mode: a.mode,
      seed: a.seed,
      dayKey: a.dayKey,
      startedAt: a.startedAt,
      endedAt: Date.now(),
      marketStart: a.marketStart,
      marketEnd,
      startCash: a.startCash,
      endCash: a.cash,
      trades: a.trades,
    };
    if (rec.trades.length) {
      this.sessions = [rec, ...this.sessions.filter((s) => s.id !== rec.id)];
      void this.store.saveSession(rec).catch(() => this.notify('No se pudo guardar el día en el historial.', 'error'));
    }
    return rec;
  }

  /** Empezar otro día simulado (o una sesión nueva en vivo). */
  newDay(startMinutes?: number): void {
    if (this.state.active && (this.state.active.positions.length || this.state.active.trades.length)) this.endDay();
    if (startMinutes) this.state.settings = { ...this.state.settings, startMinutes };
    this.state.active = this.createSession(startMinutes);
    this.broker = null;
    this.touched = false;
    this.lastEnded = null;
    // En vivo la fuente sigue siendo la misma: se conecta el bróker de la sesión nueva.
    if (this.mode === 'remote' && this.source) this.attach(this.source);
    this.emit();
  }

  resetAccount(clearHistory: boolean): void {
    this.state.active = undefined;
    this.broker = null;
    this.state.balance = this.state.settings.startingBalance;
    if (clearHistory) {
      this.sessions = [];
      void this.store.clear();
    }
    this.state.active = this.createSession();
    this.touched = true;
    this.lastEnded = null;
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
    const rec = this.sessions.find((s) => s.trades.some((x) => x.id === id));
    if (!rec) return;
    rec.trades = rec.trades.map((x) => (x.id === id ? { ...x, ...patch } : x));
    this.sessions = [...this.sessions];
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
    if (a && this.source && a.mode === 'sim') a.simNow = this.source.now();
    this.state.updatedAt = Date.now();
    void this.store.saveState(this.state);
  }

  // ------------------------------------------------------------------ números de la cuenta

  summary() {
    const b = this.broker;
    const a = this.state.active;
    if (!b || !a) return { cash: this.state.balance, equity: this.state.balance, dayPnl: 0, buyingPower: this.state.balance, open: 0, trades: 0 };
    return {
      cash: a.cash,
      equity: b.equity(this.marks),
      dayPnl: b.dayPnl(this.marks),
      buyingPower: b.buyingPower(this.marks),
      open: a.positions.length,
      trades: a.trades.length,
    };
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
