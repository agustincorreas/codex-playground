// Modo en vivo: la interfaz se conecta por WebSocket al servidor de Pulso (que habla con el proveedor).
import type { Quote, ScanRow, Settings, SymbolDetail } from '../../engine/types';
import type { DataSource, SourceHandlers } from './types';

export class RemoteSource implements DataSource {
  readonly kind = 'remote' as const;
  private ws?: WebSocket;
  private h?: SourceHandlers;
  private selected: string | null = null;
  private retry = 0;
  private closed = false;
  private clockOffset = 0;
  private tracked: string[] = [];
  /** Última fila conocida de cada símbolo (de las vistas y de la ficha) para cotizar órdenes. */
  private rows = new Map<string, ScanRow>();
  private detail: SymbolDetail | null = null;

  constructor(
    private settings: Settings,
    private watch: string[],
  ) {}

  start(h: SourceHandlers): void {
    this.h = h;
    this.connect();
  }

  private connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.send({ t: 'settings', settings: this.settings });
      this.send({ t: 'watchlist', syms: this.watch });
      this.send({ t: 'tracked', syms: this.tracked });
      if (this.selected) this.send({ t: 'select', sym: this.selected });
    };
    ws.onmessage = (m) => {
      const h = this.h;
      if (!h) return;
      const msg = JSON.parse(String(m.data));
      switch (msg.t) {
        case 'hello':
          h.onStatus(msg.status);
          h.onAlerts(msg.alerts ?? [], true);
          h.onNews(msg.news ?? [], true);
          if (msg.serverTime) this.clockOffset = msg.serverTime - Date.now();
          break;
        case 'view':
          for (const rows of Object.values(msg.view.scanners as Record<string, ScanRow[]>)) for (const r of rows) this.rows.set(r.sym, r);
          for (const r of [...(msg.view.watch as ScanRow[]), ...((msg.view.tracked as ScanRow[] | undefined) ?? [])]) this.rows.set(r.sym, r);
          h.onView(msg.view);
          h.onTick?.(this.now());
          break;
        case 'alerts':
          h.onAlerts(msg.alerts, false);
          break;
        case 'news':
          h.onNews(msg.items, false);
          break;
        case 'detail':
          if (msg.detail?.sym === this.selected || msg.detail === null) {
            this.detail = msg.detail;
            if (msg.detail) this.rows.set(msg.detail.sym, msg.detail.row);
            h.onDetail(msg.detail);
          }
          break;
        case 'status':
          h.onStatus(msg.status);
          break;
      }
    };
    ws.onclose = () => {
      if (this.closed) return;
      this.h?.onStatus({
        mode: 'live',
        provider: 'Servidor',
        connected: false,
        realtime: false,
        message: 'Sin conexión con el servidor de Pulso. Reintentando…',
      });
      const wait = Math.min(10_000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  stop(): void {
    this.closed = true;
    this.ws?.close();
  }

  select(sym: string | null): void {
    this.selected = sym;
    this.send({ t: 'select', sym });
  }

  setSettings(s: Settings): void {
    this.settings = s;
    this.send({ t: 'settings', settings: s });
  }

  setWatchlist(syms: string[]): void {
    this.watch = syms;
    this.send({ t: 'watchlist', syms });
  }

  setTracked(syms: string[]): void {
    this.tracked = syms;
    this.send({ t: 'tracked', syms });
  }

  setSpeed(): void {}

  quote(sym: string): Quote | null {
    const r = this.rows.get(sym);
    if (!r) return null;
    return { sym, last: r.price, bid: r.bid, ask: r.ask, ts: r.lastTs, halted: r.halted, volPerMin: r.vol5m / 5 };
  }

  row(sym: string): ScanRow | null {
    return this.rows.get(sym) ?? null;
  }

  reviewBars(sym: string, from: number, to: number): number[][] | undefined {
    if (this.detail?.sym !== sym) return undefined;
    return this.detail.bars.filter((b) => b.t >= from && b.t <= to).slice(-60).map((b) => [b.t, b.o, b.h, b.l, b.c, Math.round(b.v)]);
  }

  async search(prefix: string): Promise<string[]> {
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(prefix)}`);
      return r.ok ? await r.json() : [];
    } catch {
      return [];
    }
  }

  now(): number {
    return Date.now() + this.clockOffset;
  }
}

/** ¿La página la sirve el servidor de Pulso? Si no (demo estático), se usa el simulador local. */
export async function detectServer(): Promise<{ mode: string; provider: string } | null> {
  if (import.meta.env.MODE === 'demo') return null;
  if (new URLSearchParams(location.search).has('demo')) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch('/api/health', { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    const body = await r.json();
    return body?.app === 'pulso' ? body : null;
  } catch {
    return null;
  }
}
