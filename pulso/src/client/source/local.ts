// Modo simulador: el mercado simulado y el motor corren en el navegador, sin servidor ni claves.
// Cada sesión de práctica tiene su semilla: con la misma semilla el mercado es idéntico, así que al
// recargar la página se reconstruye y se avanza rápido hasta donde estabas.
import { Engine } from '../../engine/engine';
import { formatEtTime, sessionAt } from '../../engine/time';
import type { Alert, NewsItem, Quote, ScanRow, Session, Settings, TapePrint } from '../../engine/types';
import { MarketSim } from '../../sim/simulator';
import { MarketBooks, type DepthBook } from '../../trading/depth';
import type { DataSource, SourceHandlers } from './types';

export interface SimConfig {
  seed: number;
  /** Un instante del día a simular (se usa el último día hábil). */
  dayTs: number;
  /** Hora ET (minutos) a la que arranca la simulación en vivo. */
  startMinutes: number;
  /** Hora de mercado a la que hay que avanzar para reanudar una sesión. */
  resumeAt?: number;
}

const SEC = 1000;

export class LocalSource implements DataSource {
  readonly kind = 'local' as const;
  private readonly engine = new Engine({ allSecBars: true });
  private readonly sim: MarketSim;
  private timer?: ReturnType<typeof setInterval>;
  private h?: SourceHandlers;
  private speed = 1;
  private selected: string | null = null;
  private pendingAlerts: Alert[] = [];
  private pendingNews: NewsItem[] = [];
  private realLast = 0;
  private lastView = 0;
  private stopped = false;
  private readonly books: MarketBooks;
  ready = false;
  readonly depthIsReal = true;

  constructor(
    settings: Settings,
    watch: string[],
    private readonly cfg: SimConfig,
  ) {
    this.engine.setSettings(settings);
    this.engine.setWatchlist(watch);
    this.sim = new MarketSim((ev) => this.engine.ingest(ev), { seed: cfg.seed, dayTs: cfg.dayTs, startMinutes: cfg.startMinutes });
    this.engine.setReference(this.sim.refs);
    this.books = new MarketBooks(cfg.seed);
  }

  start(h: SourceHandlers): void {
    this.h = h;
    h.onStatus(this.status('Generando el pre-market simulado…'));
    // Dejar que la interfaz pinte el estado de carga antes del precalentamiento.
    setTimeout(() => {
      if (this.stopped) return;
      this.engine.warmup = true;
      this.sim.warmup();
      this.engine.tick(this.sim.now);
      void this.fastForward().then(() => {
        if (this.stopped) return;
        this.ready = true;
        this.engine.warmup = false;
        this.engine.onAlert((a) => this.pendingAlerts.push(a));
        this.engine.onNews((n) => this.pendingNews.push(n));
        h.onAlerts(this.engine.alerts.slice(), true);
        h.onNews(this.engine.news.slice(), true);
        h.onView(this.engine.view());
        if (this.selected) h.onDetail(this.engine.detail(this.selected));
        h.onStatus(this.status('Acciones ficticias generadas por el simulador'));
        this.realLast = performance.now();
        this.timer = setInterval(() => this.loop(), 100);
      });
    }, 30);
  }

  /** Reanudar: avanzar el mercado hasta la hora guardada, en tramos para no congelar la página. */
  private async fastForward(): Promise<void> {
    const target = this.cfg.resumeAt ?? 0;
    if (this.sim.now >= target) return;
    // Al avanzar rápido no hacen falta las cotizaciones intermedias: al final se publican las actuales.
    this.sim.quiet = true;
    while (!this.stopped && this.sim.now < target) {
      const chunkEnd = Math.min(target, this.sim.now + 5 * 60 * SEC);
      this.sim.advance(chunkEnd - this.sim.now);
      this.engine.tick(this.sim.now);
      this.h?.onStatus(this.status(`Reanudando tu sesión: ${formatEtTime(this.sim.now, false)} ET…`));
      await new Promise((r) => setTimeout(r, 0));
    }
    this.sim.quiet = false;
    this.sim.flushQuotes();
  }

  private status(message: string) {
    return { mode: 'demo' as const, provider: 'Simulador', connected: true, realtime: false, message, speed: this.speed };
  }

  private loop(): void {
    const h = this.h;
    if (!h) return;
    const t = performance.now();
    // Si la pestaña estuvo dormida, no simular de golpe todo el tiempo perdido.
    const dt = Math.min(1000, t - this.realLast);
    this.realLast = t;
    this.sim.advance(dt * this.speed);
    this.engine.tick(this.sim.now);
    h.onTick?.(this.sim.now);
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
    if (this.timer) this.h?.onDetail(sym ? this.engine.detail(sym) : null);
  }

  setSettings(s: Settings): void {
    this.engine.setSettings(s);
  }

  setWatchlist(syms: string[]): void {
    this.engine.setWatchlist(syms);
  }

  setTracked(syms: string[]): void {
    this.engine.setTracked(syms);
  }

  setSpeed(x: number): void {
    this.speed = x;
    this.h?.onStatus(this.status('Acciones ficticias generadas por el simulador'));
  }

  async search(prefix: string): Promise<string[]> {
    return this.engine.search(prefix);
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
