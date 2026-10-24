// Float y short interest: CSV propio > Massive (gratis, incluso en el plan Basic) > FMP > SEC.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { getJson, RateLimiter, readCache, redact, writeCache, type Log } from './util';

export interface FloatRow {
  float?: number;
  sharesOutstanding?: number;
  shortInterest?: number;
  source: string;
}

/** CSV opcional: SYMBOL,float[,acciones_en_circulacion] (una fila por símbolo, encabezado opcional). */
export async function loadFloatCsv(path: string): Promise<Map<string, FloatRow>> {
  const out = new Map<string, FloatRow>();
  if (!existsSync(path)) return out;
  const text = await readFile(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const [sym, f, so] = line.split(/[,;\t]/).map((x) => x.trim());
    if (!sym || !/^[A-Za-z.\-]+$/.test(sym)) continue;
    const float = Number(f);
    if (!(float > 0)) continue;
    out.set(sym.toUpperCase(), { float, sharesOutstanding: Number(so) > 0 ? Number(so) : undefined, source: 'CSV' });
  }
  return out;
}

interface MassivePage<T> {
  results?: T[];
  next_url?: string;
}

/** Recorre una consulta paginada de Massive (next_url no incluye la clave: hay que volver a agregarla). */
export async function massivePaged<T>(url: string, key: string, limiter: RateLimiter, maxPages = 50): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = url;
  for (let i = 0; next && i < maxPages; i++) {
    const withKey: string = next.includes('apiKey=') ? next : `${next}${next.includes('?') ? '&' : '?'}apiKey=${key}`;
    const page: MassivePage<T> = await getJson<MassivePage<T>>(withKey, { limiter });
    out.push(...(page.results ?? []));
    next = page.next_url;
  }
  return out;
}

export async function massiveFloat(restUrl: string, key: string, limiter: RateLimiter, dayKey: string, log: Log): Promise<Map<string, number>> {
  const cacheName = `massive-float-${dayKey}.json`;
  let rows = await readCache<Array<[string, number]>>(cacheName);
  if (!rows) {
    try {
      const res = await massivePaged<{ ticker: string; free_float: number }>(`${restUrl}/stocks/vX/float?limit=5000`, key, limiter);
      rows = res.filter((r) => r.free_float > 0).map((r) => [r.ticker, r.free_float]);
      await writeCache(cacheName, rows);
    } catch (e) {
      log('warn', `Float de Massive: ${redact((e as Error).message)}`);
      return new Map();
    }
  }
  return new Map(rows);
}

export async function massiveShortInterest(restUrl: string, key: string, limiter: RateLimiter, dayKey: string, log: Log): Promise<Map<string, number>> {
  const cacheName = `massive-short-${dayKey}.json`;
  let rows = await readCache<Array<[string, number]>>(cacheName);
  if (!rows) {
    try {
      const latest = await getJson<MassivePage<{ settlement_date: string }>>(
        `${restUrl}/stocks/v1/short-interest?limit=1&sort=settlement_date.desc&apiKey=${key}`,
        { limiter },
      );
      const date = latest.results?.[0]?.settlement_date;
      if (!date) return new Map();
      const res = await massivePaged<{ ticker: string; short_interest: number }>(
        `${restUrl}/stocks/v1/short-interest?settlement_date=${date}&limit=50000`,
        key,
        limiter,
      );
      rows = res.filter((r) => r.short_interest > 0).map((r) => [r.ticker, r.short_interest]);
      await writeCache(cacheName, rows);
    } catch (e) {
      log('warn', `Short interest de Massive: ${redact((e as Error).message)}`);
      return new Map();
    }
  }
  return new Map(rows);
}

/** FMP (Starter en adelante): float de todas las acciones, de a 5000 por página. */
export async function fmpFloat(key: string, dayKey: string, log: Log): Promise<Map<string, { float: number; outstanding?: number }>> {
  const cacheName = `fmp-float-${dayKey}.json`;
  let rows = await readCache<Array<[string, number, number]>>(cacheName);
  if (!rows) {
    rows = [];
    try {
      for (let page = 0; page < 20; page++) {
        const res = await getJson<Array<{ symbol: string; floatShares?: number; outstandingShares?: number }>>(
          `https://financialmodelingprep.com/stable/shares-float-all?page=${page}&limit=5000&apikey=${key}`,
        );
        if (!Array.isArray(res) || !res.length) break;
        for (const r of res) if (r.floatShares && r.floatShares > 0) rows.push([r.symbol, r.floatShares, r.outstandingShares ?? 0]);
        if (res.length < 5000) break;
      }
      await writeCache(cacheName, rows);
    } catch (e) {
      log('warn', `Float de FMP: ${redact((e as Error).message)}`);
      return new Map();
    }
  }
  return new Map(rows.map(([s, f, o]) => [s, { float: f, outstanding: o || undefined }]));
}
