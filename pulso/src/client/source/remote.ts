// Modo en vivo: la interfaz se conecta por WebSocket al servidor de Pulso (que habla con el proveedor).
import { sessionAt } from '../../engine/time';
import type { HistoryTf } from '../../engine/history';
import type { Bar, Quote, ScanRow, Session, Settings, SymbolDetail, TapePrint } from '../../engine/types';
import { MarketBooks, type DepthBook } from '../../trading/depth';
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
  /** Último mensaje del servidor (manda una vista por segundo: si se calla, la conexión murió). */
  private lastMessage = 0;
  private watchTimer?: ReturnType<typeof setInterval>;
  /** Reintento de conexión pendiente: se cancela en `stop()` para no reconectar una fuente ya cerrada. */
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly onVisible = () => {
    if (document.visibilityState === 'visible') this.checkAlive(true);
  };
  /** Última fila conocida de cada símbolo (de las vistas y de la ficha) para cotizar órdenes. */
  private rows = new Map<string, ScanRow>();
  private detail: SymbolDetail | null = null;
  private focused: string | null = null;
  private focusedDetail: SymbolDetail | null = null;
  /** Con datos reales no hay Level 2 en este escáner: el libro se estima solo para ejecutar las órdenes. */
  private readonly books = new MarketBooks(1);
  ready = false;
  readonly depthIsReal = false;

  constructor(
    private settings: Settings,
    private watch: string[],
    /** Identifica esta página ante el servidor (cuenta de práctica guardada ahí). */
    private readonly clientId?: string,
  ) {}

  start(h: SourceHandlers): void {
    this.h = h;
    this.connect();
    this.watchTimer = setInterval(() => this.checkAlive(false), 5000);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  /** Si el servidor no habla hace 15 s (o al volver a la pestaña), se corta y se vuelve a conectar. */
  private checkAlive(force: boolean): void {
    const ws = this.ws;
    if (!ws || this.closed || ws.readyState !== WebSocket.OPEN) return;
    const quiet = Date.now() - this.lastMessage;
    if (quiet < (force ? 5000 : 15_000)) return;
    console.warn(`Pulso: sin noticias del servidor hace ${Math.round(quiet / 1000)} s; reconecto.`);
    ws.onclose = null;
    ws.onmessage = null;
    try {
      ws.close();
    } catch {
      // Ya estaba muerta.
    }
    this.h?.onStatus({ mode: 'live', provider: 'Servidor', connected: false, realtime: false, message: 'Sin conexión con el servidor de Pulso. Reintentando…' });
    this.connect();
  }

  private connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.lastMessage = Date.now();
      if (this.clientId) this.send({ t: 'client', id: this.clientId });
      this.send({ t: 'settings', settings: this.settings });
      this.send({ t: 'watchlist', syms: this.watch });
      this.send({ t: 'tracked', syms: this.tracked });
      if (this.selected) this.send({ t: 'select', sym: this.selected });
      if (this.focused) this.send({ t: 'focus', sym: this.focused });
    };
    ws.onmessage = (m) => {
      this.lastMessage = Date.now();
      const h = this.h;
      if (!h) return;
      let msg;
      try {
        msg = JSON.parse(String(m.data));
      } catch {
        console.warn('Pulso: mensaje del servidor ilegible, se ignora.');
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      switch (msg.t) {
        case 'hello':
          h.onStatus(msg.status);
          h.onAlerts(msg.alerts ?? [], true);
          h.onNews(msg.news ?? [], true);
          if (msg.serverTime) this.clockOffset = msg.serverTime - Date.now();
          break;
        case 'view':
          this.ready = true;
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
          if (msg.focus) {
            if (msg.detail?.sym === this.focused) {
              this.focusedDetail = msg.detail;
              if (msg.detail) this.rows.set(msg.detail.sym, msg.detail.row);
            }
            break;
          }
          if (msg.detail?.sym === this.selected || msg.detail === null) {
            this.detail = msg.detail;
            if (msg.detail) this.rows.set(msg.detail.sym, msg.detail.row);
            h.onDetail(msg.detail);
          }
          break;
        case 'status':
          h.onStatus(msg.status);
          break;
        case 'account':
          h.onAccount?.(msg.rev as number);
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
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        if (!this.closed) this.connect();
      }, wait);
    };
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  stop(): void {
    this.closed = true;
    if (this.watchTimer) clearInterval(this.watchTimer);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    document.removeEventListener('visibilitychange', this.onVisible);
    const ws = this.ws;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      ws.close();
    }
  }

  select(sym: string | null): void {
    this.selected = sym;
    this.send({ t: 'select', sym });
  }

  focus(sym: string | null): void {
    if (sym !== this.focused) this.focusedDetail = null;
    this.focused = sym;
    this.send({ t: 'focus', sym });
  }

  /** La ficha de la acción que mira la IA; si es la misma que la seleccionada, la de la selección. */
  focusDetail(): SymbolDetail | null {
    if (!this.focused) return null;
    if (this.detail?.sym === this.focused) return this.detail;
    return this.focusedDetail;
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
    const d = this.detail?.sym === sym ? this.detail.quote : null;
    if (d) return d;
    return { sym, last: r.price, bid: r.bid, ask: r.ask, bidSize: 0, askSize: 0, real: false, ts: r.lastTs, halted: r.halted, volPerMin: r.vol5m / 5 };
  }

  row(sym: string): ScanRow | null {
    return this.rows.get(sym) ?? null;
  }

  reviewBars(sym: string, from: number, to: number): number[][] | undefined {
    if (this.detail?.sym !== sym) return undefined;
    return this.detail.bars.filter((b) => b.t >= from && b.t <= to).slice(-60).map((b) => [b.t, b.o, b.h, b.l, b.c, Math.round(b.v)]);
  }

  private histCache = new Map<string, { at: number; bars: Promise<Bar[]> }>();

  /** Historia del servidor, con caché corta (la diaria media hora; el resto, cinco minutos). */
  history(sym: string, tf: HistoryTf): Promise<Bar[]> {
    const key = `${sym}:${tf}`;
    const hit = this.histCache.get(key);
    if (hit && Date.now() - hit.at < (tf === 'day' ? 30 : 5) * 60_000) return hit.bars;
    const bars = fetch(`/api/history?sym=${encodeURIComponent(sym)}&tf=${tf}`)
      .then(async (r) => (r.ok ? ((await r.json()) as Bar[]) : []))
      .catch(() => [] as Bar[]);
    this.histCache.set(key, { at: Date.now(), bars });
    return bars;
  }

  async search(prefix: string): Promise<string[]> {
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(prefix)}`);
      if (!r.ok) return [];
      const list: unknown = await r.json();
      return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  now(): number {
    return Date.now() + this.clockOffset;
  }

  book(sym: string): DepthBook | null {
    return this.books.get(sym, this.quote(sym), this.now());
  }

  printsSince(sym: string, seq: number): TapePrint[] {
    const tape = this.detail?.sym === sym ? this.detail.tape : undefined;
    return tape ? tape.filter((p) => p.seq > seq) : [];
  }

  lastSeq(): number {
    const tape = this.detail?.tape;
    return tape?.length ? tape[tape.length - 1].seq : 0;
  }

  session(now: number): Session {
    return sessionAt(now);
  }
}

/** ¿La página la sirve el servidor de Pulso? Si no (demo estático), se usa el simulador local. */
/** ¿Hay servidor de Pulso? Con `?demo` en la URL se ignora (salvo `force`: para saber dónde guardar la cuenta). */
export async function detectServer(force = false): Promise<{ mode: string; provider: string } | null> {
  if (import.meta.env.MODE === 'demo') return null;
  if (!force && new URLSearchParams(location.search).has('demo')) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch('/api/health', { signal: ctrl.signal });
    clearTimeout(timer);
    // Un hosting estático contesta 404 (o una página HTML): no es un error, es que no hay servidor.
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    const body: unknown = await r.json();
    return body && typeof body === 'object' && (body as { app?: unknown }).app === 'pulso' ? (body as { mode: string; provider: string }) : null;
  } catch {
    return null;
  }
}
