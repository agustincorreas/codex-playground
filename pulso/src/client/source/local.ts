// Modo simulador: el mercado simulado y el motor corren en el navegador, sin servidor ni claves.
// Cada sesión de práctica tiene su semilla y el camino de cada acción depende solo de la semilla y del
// día, así que el mercado se puede rearmar a cualquier hora y es el mismo: al recargar la página se
// arma directo en la hora donde estabas. En el modo "Mercado ahora" el reloj es el de Nueva York: al
// volver se arma en la hora actual y, si dejaste órdenes o posiciones, antes se repasa lo que pasó
// mientras no estabas para que se ejecuten como en el mercado.
import { Engine } from '../../engine/engine';
import type { HistoryTf } from '../../engine/history';
import { synthHistory } from '../../sim/history';
import { formatEtTime, sessionAt } from '../../engine/time';
import type { Bar, Alert, NewsItem, Quote, ScanRow, Session, Settings, TapePrint } from '../../engine/types';
import { MarketSim, type DayHeat } from '../../sim/simulator';
import { MarketBooks, type DepthBook } from '../../trading/depth';
import type { DataSource, SourceHandlers } from './types';

export interface SimConfig {
  /** Sesión de práctica: la fuente se rearma con cada sesión nueva. */
  sessionId: string;
  seed: number;
  /** Un instante del día a simular (se usa el último día hábil). */
  dayTs: number;
  /** Hora ET (minutos) a la que arranca la simulación en vivo. */
  startMinutes: number;
  /** Hora de mercado en la que se rearma el mercado para reanudar una sesión. */
  resumeAt?: number;
  /** Modo "Mercado ahora": el reloj es el de Nueva York (sin velocidad ni pausa). */
  realtime?: boolean;
  /**
   * Con órdenes o posiciones abiertas al irse: desde esta hora se repasa el mercado hasta ahora, así
   * las órdenes se ejecutan (o los stops saltan) como habría pasado.
   */
  catchUpFrom?: number;
}

/** Datos del día simulado para mostrar (clima y si viene de un fin de semana o feriado). */
export interface DayInfo {
  dateKey: string;
  heat: DayHeat;
  afterBreak: boolean;
  postTs: number;
}

const SEC = 1000;
/** En "Mercado ahora", un salto más grande que esto (pestaña dormida) rearma el mercado. */
const MAX_LIVE_GAP = 90 * SEC;
/** Tramo máximo entre dos repasos de las órdenes (la cinta guarda los últimos prints). */
const ORDER_STEP = 5 * SEC;

export class LocalSource implements DataSource {
  readonly kind = 'local' as const;
  private engine!: Engine;
  private sim!: MarketSim;
  private timer?: ReturnType<typeof setInterval>;
  private h?: SourceHandlers;
  private speed = 1;
  private selected: string | null = null;
  private pendingAlerts: Alert[] = [];
  private pendingNews: NewsItem[] = [];
  private realLast = 0;
  private lastView = 0;
  private stopped = false;
  private syncing = false;
  /** Último rearmado por un salto del reloj (para no rearmar en cadena). */
  private lastSync = -Infinity;
  private settings: Settings;
  private watch: string[];
  private tracked: string[] = [];
  private readonly books: MarketBooks;
  ready = false;
  readonly depthIsReal = true;

  constructor(
    settings: Settings,
    watch: string[],
    private readonly cfg: SimConfig,
  ) {
    this.settings = settings;
    this.watch = watch;
    this.books = new MarketBooks(cfg.seed);
    this.build(cfg.startMinutes);
  }

  get realtime(): boolean {
    return !!this.cfg.realtime;
  }

  get day(): DayInfo {
    return { dateKey: this.sim.dateKey, heat: this.sim.heat, afterBreak: this.sim.afterBreak, postTs: this.sim.postTs };
  }

  /**
   * Arma el mercado (motor nuevo) con la cinta empezando en `at`. Sin `at`, solo el universo, sin
   * generar el día (para conocer el día y los datos de referencia antes de arrancar).
   */
  private build(startMinutes: number, at?: number, only?: Set<string>): void {
    this.engine = new Engine({ allSecBars: true });
    this.engine.setSettings(this.settings);
    this.engine.setWatchlist(this.watch);
    this.engine.setTracked(this.tracked);
    this.sim = new MarketSim((ev) => this.engine.ingest(ev), { seed: this.cfg.seed, dayTs: this.cfg.dayTs, startMinutes, startTs: at });
    this.engine.setReference(this.sim.refs);
    if (at === undefined && !only) return;
    this.sim.only = only ?? null;
    this.engine.warmup = true;
    this.sim.warmup();
    this.engine.tick(this.sim.now);
  }

  start(h: SourceHandlers): void {
    this.h = h;
    h.onStatus(this.status(this.realtime ? 'Armando el mercado a la hora de Nueva York…' : 'Generando el mercado simulado…'));
    // Dejar que la interfaz pinte el estado de carga antes de generar el día.
    setTimeout(() => void this.boot(), 30);
  }

  private async boot(): Promise<void> {
    if (this.stopped) return;
    const cfg = this.cfg;
    if (cfg.realtime) {
      if (cfg.catchUpFrom !== undefined && this.tracked.length && cfg.catchUpFrom < Math.min(Date.now(), this.sim.postTs) - 2 * SEC) {
        // Primero el mercado donde lo dejaste, con tus acciones, y después lo que pasó hasta ahora.
        this.build(cfg.startMinutes, cfg.catchUpFrom, new Set(this.tracked));
        await this.catchUp();
        if (this.stopped) return;
        this.build(cfg.startMinutes, this.liveTarget());
        this.h?.onRebuild?.();
      } else this.build(cfg.startMinutes, this.liveTarget());
    } else this.build(cfg.startMinutes, cfg.resumeAt ?? this.sim.startTs);
    this.goLive();
  }

  /** Hora a la que tiene que estar el mercado en "Mercado ahora" (la de Nueva York, hasta el fin del after-hours). */
  private liveTarget(): number {
    return Math.min(Date.now(), this.sim.postTs);
  }

  private goLive(): void {
    const h = this.h;
    if (!h || this.stopped) return;
    this.ready = true;
    this.engine.warmup = false;
    this.pendingAlerts = [];
    this.pendingNews = [];
    this.engine.onAlert((a) => this.pendingAlerts.push(a));
    this.engine.onNews((n) => this.pendingNews.push(n));
    h.onAlerts(this.engine.alerts.slice(), true);
    h.onNews(this.engine.news.slice(), true);
    h.onView(this.engine.view());
    if (this.selected) h.onDetail(this.engine.detail(this.selected));
    h.onStatus(this.status(this.liveMessage()));
    this.realLast = performance.now();
    if (!this.timer) this.timer = setInterval(() => this.loop(), 100);
  }

  /**
   * Repasa el mercado desde donde quedó hasta ahora publicando solo las acciones con órdenes o
   * posición (el resto sigue su camino sin publicar nada, así es rápido) y trabajando las órdenes.
   */
  private async catchUp(): Promise<void> {
    this.ready = false;
    this.sim.only = new Set(this.tracked);
    let lastYield = performance.now();
    while (!this.stopped && this.sim.now < this.liveTarget()) {
      this.sim.advance(Math.min(ORDER_STEP, this.liveTarget() - this.sim.now));
      this.engine.tick(this.sim.now);
      this.h?.onCatchUp?.(this.sim.now);
      if (performance.now() - lastYield > 60) {
        this.h?.onStatus(this.status(`Poniéndose al día con tus órdenes: ${formatEtTime(this.sim.now, false)} ET…`));
        await new Promise((r) => setTimeout(r, 0));
        lastYield = performance.now();
      }
    }
  }

  /** La pestaña estuvo dormida en "Mercado ahora": rearmar el mercado en la hora actual. */
  private async resync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    this.lastSync = performance.now();
    this.ready = false;
    this.h?.onStatus(this.status('Poniéndose al día con el mercado de Nueva York…'));
    await new Promise((r) => setTimeout(r, 0));
    if (this.tracked.length) await this.catchUp();
    if (!this.stopped) {
      this.build(this.cfg.startMinutes, this.liveTarget());
      this.h?.onRebuild?.();
      this.goLive();
    }
    this.syncing = false;
  }

  private status(message: string) {
    return { mode: 'demo' as const, provider: this.realtime ? 'Simulador · hora de NY' : 'Simulador', connected: true, realtime: this.realtime, message, speed: this.realtime ? 1 : this.speed };
  }

  private liveMessage(): string {
    if (this.sim.now >= this.sim.postTs) return 'Terminó el after-hours: empezá otro día para seguir practicando';
    return this.realtime ? 'Acciones ficticias al ritmo del reloj de Nueva York' : 'Acciones ficticias generadas por el simulador';
  }

  private loop(): void {
    const h = this.h;
    if (!h || !this.ready) return;
    const t = performance.now();
    const before = this.sim.now;
    if (this.realtime) {
      const target = this.liveTarget();
      if (target - this.sim.now > MAX_LIVE_GAP && t - this.lastSync > 10_000) {
        void this.resync();
        return;
      }
      // Si el navegador demoró el reloj, se avanza en tramos para no saltear la cinta de tus órdenes.
      while (this.sim.now < target) {
        this.sim.advance(Math.min(ORDER_STEP, target - this.sim.now));
        this.engine.tick(this.sim.now);
        if (this.sim.now < target) h.onTick?.(this.sim.now);
      }
    } else if (this.sim.now < this.sim.postTs) {
      // Si la pestaña estuvo dormida, no simular de golpe todo el tiempo perdido.
      const dt = Math.min(1000, t - this.realLast);
      this.sim.advance(Math.min(dt * this.speed, this.sim.postTs - this.sim.now));
    }
    this.realLast = t;
    this.engine.tick(this.sim.now);
    h.onTick?.(this.sim.now);
    if (before < this.sim.postTs && this.sim.now >= this.sim.postTs) h.onStatus(this.status(this.liveMessage()));
    if (this.pendingAlerts.length) {
      h.onAlerts(this.pendingAlerts, false);
      this.pendingAlerts = [];
    }
    if (this.pendingNews.length) {
      h.onNews(this.pendingNews, false);
      this.pendingNews = [];
    }
    if (t - this.lastView >= 500) {
      this.lastView = t;
      h.onView(this.engine.view());
      if (this.selected) h.onDetail(this.engine.detail(this.selected));
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  select(sym: string | null): void {
    this.selected = sym;
    if (this.timer && this.ready) this.h?.onDetail(sym ? this.engine.detail(sym) : null);
  }

  setSettings(s: Settings): void {
    this.settings = s;
    this.engine.setSettings(s);
  }

  setWatchlist(syms: string[]): void {
    this.watch = syms;
    this.engine.setWatchlist(syms);
  }

  setTracked(syms: string[]): void {
    this.tracked = syms;
    this.engine.setTracked(syms);
  }

  setSpeed(x: number): void {
    if (this.realtime) return;
    this.speed = x;
    this.h?.onStatus(this.status(this.liveMessage()));
  }

  async search(prefix: string): Promise<string[]> {
    return this.engine.search(prefix);
  }

  /** Historia inventada, determinista por símbolo, que termina en el cierre anterior. */
  async history(sym: string, tf: HistoryTf): Promise<Bar[]> {
    const ref = this.engine.get(sym)?.ref;
    return ref ? synthHistory(sym, ref.prevClose, ref.avgVolume, tf, this.sim.now) : [];
  }

  now(): number {
    return this.sim.now;
  }

  quote(sym: string): Quote | null {
    return this.engine.quote(sym);
  }

  /** Velas de 1 minuto compactas [t, o, h, l, c, v] para revisar un trade después. */
  reviewBars(sym: string, from: number, to: number): number[][] | undefined {
    const st = this.engine.get(sym);
    if (!st) return undefined;
    const r = (p: number) => Math.round(p * 10000) / 10000;
    return st.bars
      .filter((b) => b.t >= from && b.t <= to)
      .slice(-60)
      .map((b) => [b.t, r(b.o), r(b.h), r(b.l), r(b.c), Math.round(b.v)]);
  }

  row(sym: string): ScanRow | null {
    return this.engine.row(sym);
  }

  book(sym: string): DepthBook | null {
    return this.books.get(sym, this.engine.quote(sym), this.sim.now);
  }

  printsSince(sym: string, seq: number): TapePrint[] {
    return this.engine.printsSince(sym, seq);
  }

  lastSeq(): number {
    return this.engine.lastPrintSeq;
  }

  session(now: number): Session {
    return sessionAt(now);
  }
}
