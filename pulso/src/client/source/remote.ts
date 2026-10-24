// Modo en vivo: la interfaz se conecta por WebSocket al servidor de Pulso (que habla con el proveedor).
import type { Settings } from '../../engine/types';
import type { DataSource, SourceHandlers } from './types';

export class RemoteSource implements DataSource {
  readonly kind = 'remote' as const;
  private ws?: WebSocket;
  private h?: SourceHandlers;
  private selected: string | null = null;
  private retry = 0;
  private closed = false;
  private clockOffset = 0;

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
          h.onView(msg.view);
          break;
        case 'alerts':
          h.onAlerts(msg.alerts, false);
          break;
        case 'news':
          h.onNews(msg.items, false);
          break;
        case 'detail':
          if (msg.detail?.sym === this.selected || msg.detail === null) h.onDetail(msg.detail);
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

  setSpeed(): void {}

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
