// Interfaz común de los proveedores de datos y el proveedor demo (simulador en el servidor).
import WebSocket from 'ws';
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
  start(ctx: ProviderContext): Promise<void>;
  stop(): void;
  /** Hora de mercado (en el demo, la del reloj simulado). */
  now(): number;
  /** Símbolos "calientes" (escáneres, watchlist, seleccionado) que merecen datos tick a tick. */
  setHot(syms: string[]): void;
  /** Velas de 1 minuto del día para un símbolo (cuando el motor no las tiene completas). */
  backfill(sym: string): Promise<Bar[] | null>;
}

export class DemoProvider implements Provider {
  readonly label = 'Simulador';
  readonly realtime = false;
  private sim?: MarketSim;
  private timer?: ReturnType<typeof setInterval>;

  async start(ctx: ProviderContext): Promise<void> {
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
}

/** WebSocket con reconexión exponencial. `onOpen` se llama en cada conexión nueva. */
export class ReconnectingSocket {
  private ws?: WebSocket;
  private closed = false;
  private retry = 0;
  private stableTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly url: string,
    private readonly label: string,
    private readonly log: Log,
    private readonly handlers: {
      onOpen?: (ws: WebSocket) => void;
      onMessage: (data: unknown, ws: WebSocket) => void;
      onClose?: () => void;
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
      this.handlers.onOpen?.(ws);
    });
    ws.on('message', (raw) => {
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
      this.handlers.onClose?.();
      if (this.closed) return;
      const wait = Math.min(60_000, 1000 * 2 ** this.retry++);
      this.log('warn', `${this.label}: conexión cerrada (${code}). Reintento en ${Math.round(wait / 1000)} s.`);
      setTimeout(() => this.connect(), wait);
    });
  }

  send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Corta la reconexión (por ejemplo, ante una clave inválida). */
  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}
