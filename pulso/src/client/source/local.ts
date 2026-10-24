// Modo demo: el simulador y el motor corren en el navegador, sin servidor ni claves.
import { Engine } from '../../engine/engine';
import type { Alert, NewsItem, Settings } from '../../engine/types';
import { MarketSim } from '../../sim/simulator';
import type { DataSource, SourceHandlers } from './types';

export class LocalSource implements DataSource {
  readonly kind = 'local' as const;
  private readonly engine = new Engine();
  private readonly sim: MarketSim;
  private timer?: ReturnType<typeof setInterval>;
  private h?: SourceHandlers;
  private speed = 1;
  private selected: string | null = null;
  private pendingAlerts: Alert[] = [];
  private pendingNews: NewsItem[] = [];
  private realLast = 0;
  private lastView = 0;

  constructor(settings: Settings, watch: string[]) {
    this.engine.setSettings(settings);
    this.engine.setWatchlist(watch);
    // Semilla por día: al recargar se repiten las mismas acciones ficticias (y la watchlist sigue valiendo).
    const day = new Date().toISOString().slice(0, 10);
    let seed = 0;
    for (const ch of day) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    this.sim = new MarketSim((ev) => this.engine.ingest(ev), { seed });
    this.engine.setReference(this.sim.refs);
  }

  start(h: SourceHandlers): void {
    this.h = h;
    h.onStatus(this.status('Generando el pre-market simulado…'));
    // Dejar que la interfaz pinte el estado de carga antes del precalentamiento.
    setTimeout(() => {
      this.engine.warmup = true;
      this.sim.warmup();
      this.engine.warmup = false;
      this.engine.tick(this.sim.now);
      this.engine.onAlert((a) => this.pendingAlerts.push(a));
      this.engine.onNews((n) => this.pendingNews.push(n));
      h.onAlerts(this.engine.alerts.slice(), true);
      h.onNews(this.engine.news.slice(), true);
      h.onView(this.engine.view());
      h.onStatus(this.status('Acciones ficticias generadas por el simulador'));
      this.realLast = performance.now();
      this.timer = setInterval(() => this.loop(), 100);
    }, 30);
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
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  select(sym: string | null): void {
    this.selected = sym;
    this.h?.onDetail(sym ? this.engine.detail(sym) : null);
  }

  setSettings(s: Settings): void {
    this.engine.setSettings(s);
  }

  setWatchlist(syms: string[]): void {
    this.engine.setWatchlist(syms);
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
}
