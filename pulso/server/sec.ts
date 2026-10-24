// SEC EDGAR (gratis): acciones en circulación y señales de dilución (S-1, S-3, 424B, EFFECT, 8-K 3.02).
// La SEC exige un User-Agent con nombre y email y como máximo 10 pedidos por segundo.
import { getJson, RateLimiter, readCache, writeCache, type Log } from './util';

export interface RecentFilings {
  form: string[];
  filingDate: string[];
  items?: string[];
}

interface Submissions {
  filings: { recent: RecentFilings };
}

interface Frame {
  data: Array<{ cik: number; end: string; val: number }>;
}

const DAY = 86_400_000;

/** Etiquetas de riesgo de dilución a partir de las presentaciones recientes ante la SEC. */
export function dilutionFlags(recent: RecentFilings, todayKey: string): string[] {
  const flags = new Set<string>();
  const today = Date.parse(todayKey);
  for (let i = 0; i < recent.form.length; i++) {
    const form = recent.form[i];
    const age = (today - Date.parse(recent.filingDate[i])) / DAY;
    if (!(age >= 0)) continue;
    const items = (recent.items?.[i] ?? '').split(',');
    if (/^(S-1|F-1)(\/A|MEF)?$/.test(form) && age <= 180) flags.add('S-1 reciente');
    if (/^(S-3|F-3)(ASR|MEF|\/A)?$/.test(form) && age <= 3 * 365) flags.add('Shelf S-3');
    if (/^424B[145]$/.test(form) && age <= 45) flags.add('Oferta 424B');
    if (/^424B[37]$/.test(form) && age <= 45) flags.add('Reventa 424B3');
    if (form === 'EFFECT' && age <= 45) flags.add('Registro efectivo');
    if (/^8-K(\/A)?$/.test(form) && age <= 45 && items.includes('3.02')) flags.add('Emisión (8-K 3.02)');
    if (/^8-K(\/A)?$/.test(form) && age <= 90 && items.includes('3.01')) flags.add('Aviso de deslistado');
  }
  return [...flags];
}

export class SecData {
  private readonly limiter = new RateLimiter(5, 1000);
  private cikByTicker = new Map<string, number>();
  private flagCache = new Map<string, string[]>();
  private inFlight = new Set<string>();
  ready = false;

  constructor(
    private readonly userAgent: string,
    private readonly log: Log,
  ) {}

  private get headers() {
    return { 'User-Agent': this.userAgent };
  }

  async init(dayKey: string): Promise<void> {
    const cacheName = `sec-tickers-${dayKey}.json`;
    type Row = { cik_str: number; ticker: string };
    let rows = await readCache<Record<string, Row>>(cacheName);
    if (!rows) {
      rows = await getJson<Record<string, Row>>('https://www.sec.gov/files/company_tickers.json', { headers: this.headers, limiter: this.limiter });
      await writeCache(cacheName, rows);
    }
    for (const r of Object.values(rows)) {
      const t = r.ticker.toUpperCase();
      this.cikByTicker.set(t, r.cik_str);
      this.cikByTicker.set(t.replace(/-/g, '.'), r.cik_str);
    }
    this.ready = true;
    this.log('info', `SEC: ${this.cikByTicker.size} tickers mapeados a su CIK.`);
  }

  /** Acciones en circulación (portada del último 10-Q/10-K) para todas las empresas, vía "frames". */
  async sharesOutstanding(dayKey: string): Promise<Map<string, number>> {
    const cacheName = `sec-shares-${dayKey}.json`;
    let byCik = await readCache<Record<string, { end: string; val: number }>>(cacheName);
    if (!byCik) {
      byCik = {};
      const d = new Date(dayKey);
      let y = d.getUTCFullYear();
      let q = Math.floor(d.getUTCMonth() / 3) + 1;
      for (let i = 0; i < 3; i++) {
        try {
          const frame = await getJson<Frame>(
            `https://data.sec.gov/api/xbrl/frames/dei/EntityCommonStockSharesOutstanding/shares/CY${y}Q${q}I.json`,
            { headers: this.headers, limiter: this.limiter, retries: 1 },
          );
          for (const row of frame.data) {
            const prev = byCik[row.cik];
            if (!prev || row.end > prev.end) byCik[row.cik] = { end: row.end, val: row.val };
          }
        } catch {
          // El trimestre en curso todavía puede no existir.
        }
        q--;
        if (q === 0) {
          q = 4;
          y--;
        }
      }
      await writeCache(cacheName, byCik);
    }
    const out = new Map<string, number>();
    for (const [ticker, cik] of this.cikByTicker) {
      const row = byCik[cik];
      if (row && row.val > 0) out.set(ticker, row.val);
    }
    return out;
  }

  cachedFlags(sym: string): string[] | undefined {
    return this.flagCache.get(sym);
  }

  /** Presentaciones recientes de una empresa → etiquetas de dilución (con caché del día). */
  async flags(sym: string, dayKey: string): Promise<string[] | null> {
    if (this.flagCache.has(sym)) return this.flagCache.get(sym)!;
    const cik = this.cikByTicker.get(sym);
    if (!cik || this.inFlight.has(sym)) return null;
    this.inFlight.add(sym);
    try {
      const sub = await getJson<Submissions>(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`, {
        headers: this.headers,
        limiter: this.limiter,
        retries: 1,
      });
      const flags = dilutionFlags(sub.filings.recent, dayKey);
      this.flagCache.set(sym, flags);
      return flags;
    } catch (e) {
      this.log('warn', `SEC ${sym}: ${(e as Error).message}`);
      this.flagCache.set(sym, []);
      return null;
    } finally {
      this.inFlight.delete(sym);
    }
  }
}
