// Utilidades del servidor: logs, HTTP con reintentos, limitador de ritmo y caché en disco.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE_DIR = join(ROOT, '.cache');

export type Level = 'info' | 'warn' | 'error';

export interface Log {
  (level: Level, msg: string): void;
}

const recent: Array<{ ts: number; level: Level; msg: string }> = [];

export const log: Log = (level, msg) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${level === 'info' ? '' : level.toUpperCase() + ' '}${msg}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  recent.push({ ts: Date.now(), level, msg });
  if (recent.length > 100) recent.shift();
};

export function recentLogs(): Array<{ ts: number; level: Level; msg: string }> {
  return recent.slice();
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly url: string,
  ) {
    super(`HTTP ${status} en ${redact(url)}: ${body.slice(0, 240)}`);
  }
}

/** Oculta claves que viajan en la URL (apiKey=..., apikey=...) antes de loguear. */
export function redact(url: string): string {
  return url.replace(/(api_?key=)[^&]+/gi, '$1***');
}

export interface GetOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  limiter?: RateLimiter;
}

/** GET que devuelve JSON. Reintenta 429/5xx/errores de red; verifica que la respuesta sea JSON. */
export async function getJson<T>(url: string, opts: GetOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    if (opts.limiter) await opts.limiter.take();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
    try {
      const res = await fetch(url, { headers: { 'Accept-Encoding': 'gzip, deflate', ...opts.headers }, signal: ctrl.signal });
      const text = await res.text();
      if (!res.ok) throw new HttpError(res.status, text, url);
      const body = text.replace(/^﻿/, '').trimStart();
      if (!body.startsWith('{') && !body.startsWith('[')) throw new HttpError(res.status, `respuesta que no es JSON: ${body.slice(0, 120)}`, url);
      return JSON.parse(body) as T;
    } catch (e) {
      const retryable = !(e instanceof HttpError) || e.status === 429 || e.status >= 500;
      if (attempt >= retries || !retryable) throw e;
      await sleep((e instanceof HttpError && e.status === 429 ? 5_000 : 700) * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function getText(url: string, opts: GetOptions = {}): Promise<string> {
  if (opts.limiter) await opts.limiter.take();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await fetch(url, { headers: opts.headers, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, text, url);
    return text.replace(/^﻿/, '');
  } finally {
    clearTimeout(timer);
  }
}

/** Limita la cantidad de pedidos por ventana de tiempo (por ejemplo, 5 por minuto o 8 por segundo). */
export class RateLimiter {
  private stamps: number[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  take(): Promise<void> {
    const next = this.chain.then(async () => {
      for (;;) {
        const now = Date.now();
        this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
        if (this.stamps.length < this.max) {
          this.stamps.push(now);
          return;
        }
        await sleep(this.windowMs - (now - this.stamps[0]) + 5);
      }
    });
    this.chain = next.catch(() => undefined);
    return next;
  }
}

export async function readCache<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(join(CACHE_DIR, name), 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function writeCache(name: string, data: unknown): Promise<void> {
  try {
    const path = join(CACHE_DIR, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(data));
  } catch (e) {
    log('warn', `No se pudo escribir la caché ${name}: ${(e as Error).message}`);
  }
}

/** Convierte timestamps de proveedores (s, ms, µs o ns) a milisegundos. */
export function toMs(t: number | string): number {
  if (typeof t === 'string') return Date.parse(t);
  if (t > 1e17) return Math.floor(t / 1e6);
  if (t > 1e14) return Math.floor(t / 1e3);
  if (t > 1e11) return t;
  return t * 1000;
}
