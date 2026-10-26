// Interfaz común de los proveedores de datos y el proveedor demo (simulador en el servidor).
import WebSocket from 'ws';
import type { HistoryTf } from '../src/engine/history';
import { synthHistory } from '../src/sim/history';
import type { Engine } from '../src/engine/engine';
import type { Bar, ProviderStatus } from '../src/engine/types';
import { MarketSim } from '../src/sim/simulator';
import type { Log } from './util';

export interface ProviderContext {
  /** Motor vigente (cambia en el reinicio diario de las 4:00 ET). */
  engine(): Engine;
  log: Log;
  setStatus(s: Partial<ProviderStatus>): void;
  /** Símbolos dentro del rango de precio del universo (los demás eventos se ignoran). */
  universe: Set<string>;
  /** Rango de precio (cierre anterior) para entrar al universo. */
  universeMin: number;
  universeMax: number;
}

export interface Provider {
  readonly label: string;
  readonly realtime: boolean;
  /** Etiqueta del encabezado cuando "en vivo" o "demorado" no alcanzan para describirlo. */
  readonly badge?: string;
  start(ctx: ProviderContext): Promise<void>;
  stop(): void;
  /** Hora de mercado (en el demo, la del reloj simulado). */
  now(): number;
  /** Símbolos "calientes" (escáneres, watchlist, seleccionado) que merecen datos tick a tick. */
  setHot(syms: string[]): void;
  /** Velas de 1 minuto del día para un símbolo (cuando el motor no las tiene completas). */
  backfill(sym: string): Promise<Bar[] | null>;
  /**
   * Velas de 10 s armadas con las operaciones históricas (gráficos de 10 s y 30 s). `onBars` recibe lo
   * acumulado a medida que llega (del presente hacia atrás), así el gráfico se completa sin esperar.
   */
  backfillSec?(sym: string, onBars?: (bars: Bar[]) => void): Promise<Bar[] | null>;
  /** Historia para el gráfico: velas de 1 min de los últimos días, de 1 hora de los últimos meses o diarias. */
  history?(sym: string, tf: HistoryTf): Promise<Bar[] | null>;
}

export class DemoProvider implements Provider {
  readonly label = 'Simulador';
  readonly realtime = false;
  private sim?: MarketSim;
  private timer?: ReturnType<typeof setInterval>;
  private ctx?: ProviderContext;

  async start(ctx: ProviderContext): Promise<void> {
    this.ctx = ctx;
    const engine = ctx.engine();
    const sim = new MarketSim((ev) => ctx.engine().ingest(ev));
    this.sim = sim;
    for (const r of sim.refs) ctx.universe.add(r.sym);
    engine.setReference(sim.refs);
    engine.warmup = true;
    sim.warmup();
    engine.warmup = false;
    ctx.setStatus({ connected: true, message: 'Modo demo en el servidor: acciones ficticias generadas por el simulador.' });
    let last = Date.now();
    this.timer = setInterval(() => {
      const t = Date.now();
      sim.advance(Math.min(1000, t - last));
      last = t;
    }, 100);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  now(): number {
    return this.sim?.now ?? Date.now();
  }

  setHot(): void {}

  async backfill(): Promise<Bar[] | null> {
    return null;
  }

  /** Historia inventada, determinista por símbolo, que termina en el cierre anterior. */
  async history(sym: string, tf: HistoryTf): Promise<Bar[] | null> {
    const ref = this.ctx?.engine().get(sym)?.ref;
    if (!ref) return null;
    return synthHistory(sym, ref.prevClose, ref.avgVolume, tf, this.now());
  }
}

/** WebSocket con reconexión exponencial. `onOpen` se llama en cada conexión nueva. */
export class ReconnectingSocket {
  private ws?: WebSocket;
  private closed = false;
  private retry = 0;
  private stableTimer?: ReturnType<typeof setTimeout>;
  private watchTimer?: ReturnType<typeof setInterval>;
  /** Último mensaje o pong recibido (la conexión está viva). */
  private lastAlive = 0;
  /** Último mensaje de datos. */
  private lastMessage = 0;

  constructor(
    private readonly url: string,
    private readonly label: string,
    private readonly log: Log,
    private readonly handlers: {
      onOpen?: (ws: WebSocket) => void;
      onMessage: (data: unknown, ws: WebSocket) => void;
      onClose?: () => void;
      /**
       * Vigilancia de datos: si en este lapso no llega ningún mensaje mientras `expectData()` dice que
       * tendrían que llegar (horario de mercado), se reconecta. Aparte, siempre se hace ping cada 15 s
       * y una conexión que no contesta en 45 s se da por muerta (pasa al dormir la computadora).
       */
      idleMs?: number;
      expectData?: () => boolean;
      /** Cada cuánto se vigila (15 s; las pruebas lo acortan). */
      watchEveryMs?: number;
    },
    private readonly options: WebSocket.ClientOptions = {},
  ) {}

  connect(): void {
    if (this.closed) return;
    const ws = new WebSocket(this.url, { perMessageDeflate: true, ...this.options });
    this.ws = ws;
    ws.on('open', () => {
      this.log('info', `${this.label}: conectado.`);
      // Si la conexión dura un minuto, se considera estable y se reinicia la espera entre intentos.
      this.stableTimer = setTimeout(() => (this.retry = 0), 60_000);
      this.lastAlive = this.lastMessage = Date.now();
      this.watchTimer = setInterval(() => this.watch(ws), this.handlers.watchEveryMs ?? 15_000);
      this.handlers.onOpen?.(ws);
    });
    ws.on('pong', () => {
      this.lastAlive = Date.now();
    });
    ws.on('message', (raw) => {
      this.lastAlive = this.lastMessage = Date.now();
      let data: unknown;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this.handlers.onMessage(data, ws);
    });
    ws.on('error', (e) => this.log('warn', `${this.label}: ${e.message}`));
    ws.on('close', (code) => {
      if (this.stableTimer) clearTimeout(this.stableTimer);
      if (this.watchTimer) clearInterval(this.watchTimer);
      this.watchTimer = undefined;
      this.handlers.onClose?.();
      if (this.closed) return;
      const wait = Math.min(60_000, 1000 * 2 ** this.retry++);
      this.log('warn', `${this.label}: conexión cerrada (${code}). Reintento en ${Math.round(wait / 1000)} s.`);
      setTimeout(() => this.connect(), wait);
    });
  }

  /** Cada 15 s: una conexión muda o que no contesta el ping se corta (y se reconecta sola). */
  private watch(ws: WebSocket): void {
    if (ws !== this.ws || ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    const idle = this.handlers.idleMs ?? 0;
    const dead = now - this.lastAlive > (this.handlers.watchEveryMs ?? 15_000) * 3;
    const mute = idle > 0 && now - this.lastMessage > idle && (this.handlers.expectData?.() ?? true);
    if (dead || mute) {
      this.log('warn', `${this.label}: ${dead ? 'no contesta' : 'sin datos'} hace ${Math.round((now - (dead ? this.lastAlive : this.lastMessage)) / 1000)} s. Reconecto.`);
      ws.terminate();
      return;
    }
    try {
      ws.ping();
    } catch {
      // Se cierra sola si falla.
    }
  }

  send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Cierra la conexión actual y vuelve a conectar con espera (sin cortar la reconexión). */
  reconnect(): void {
    if (this.closed) return;
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) this.ws.close();
    else this.connect();
  }

  /** Corta la reconexión (por ejemplo, ante una clave inválida). */
  close(): void {
    this.closed = true;
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.ws?.close();
  }
}
