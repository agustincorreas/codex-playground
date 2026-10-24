// Proveedor Massive (ex Polygon.io): Stocks Advanced (tiempo real, US$ 199/mes) o Starter/Developer
// (15 min de demora). Arranque por REST (cierres diarios agrupados, nombres, snapshot de todo el
// mercado, velas del día) y streaming de agregados por segundo de todas las acciones (A.*).
import type { Bar, DaySnapshot, MarketEvent, NewsItem, ReferenceData } from '../src/engine/types';
import { previousTradingDays, sessionDate, tradingDayStart, type EtDate } from '../src/engine/time';
import type { Config } from './config';
import { massivePaged } from './fundamentals';
import { ReconnectingSocket, type Provider, type ProviderContext } from './provider';
import { getJson, RateLimiter, readCache, redact, toMs, writeCache } from './util';

interface GroupedRow {
  T: string;
  c: number;
  v: number;
}

interface SnapTicker {
  ticker: string;
  updated?: number;
  day?: { o: number; h: number; l: number; c: number; v: number; vw: number };
  min?: { av?: number; c?: number; t?: number; vw?: number };
  prevDay?: { c: number };
  lastTrade?: { p: number; t: number };
}

interface MassiveNews {
  id: string;
  title: string;
  published_utc: string;
  article_url?: string;
  description?: string;
  publisher?: { name?: string };
  tickers?: string[];
  insights?: Array<{ ticker: string; sentiment: 'positive' | 'neutral' | 'negative' }>;
}

/** Traduce un evento del websocket de Massive a eventos del motor. */
export function massiveToEvents(m: Record<string, unknown>): MarketEvent[] {
  switch (m.ev) {
    case 'A':
    case 'AM':
      return [
        {
          kind: 'bar',
          span: m.ev === 'A' ? 'second' : 'minute',
          sym: m.sym as string,
          ts: toMs(m.s as number),
          o: m.o as number,
          h: m.h as number,
          l: m.l as number,
          c: m.c as number,
          v: m.v as number,
          vw: m.vw as number | undefined,
          dayVolume: m.av as number | undefined,
          dayVwap: m.a as number | undefined,
        },
      ];
    case 'LULD': {
      const sym = m.T as string;
      const ts = toMs(m.t as number);
      const out: MarketEvent[] = [{ kind: 'luld', sym, ts, up: m.h as number, down: m.l as number }];
      // Indicador 17 = pausa por volatilidad (solo acciones listadas en Nasdaq).
      if (((m.i as number[] | undefined) ?? []).includes(17)) {
        out.push({ kind: 'status', sym, ts, halted: true, reason: 'LUDP', resumeTs: ts + 5 * 60_000, source: 'massive' });
      }
      return out;
    }
  }
  return [];
}

export function newsFromMassive(n: MassiveNews): NewsItem {
  const s = n.insights?.map((i) => i.sentiment) ?? [];
  const sentiment = s.includes('negative') ? 'bearish' : s.includes('positive') ? 'bullish' : s.length ? 'neutral' : undefined;
  return {
    id: `mas-${n.id}`,
    ts: Date.parse(n.published_utc),
    headline: n.title,
    summary: n.description,
    source: n.publisher?.name,
    url: n.article_url,
    symbols: n.tickers ?? [],
    sentiment,
  };
}

export function snapshotToDay(t: SnapTicker, sessionStart: number): DaySnapshot | null {
  const lastTs = t.lastTrade?.t ? toMs(t.lastTrade.t) : t.updated ? toMs(t.updated) : 0;
  if (lastTs < sessionStart) return null;
  const last = t.lastTrade?.p || t.min?.c || t.day?.c;
  if (!last) return null;
  const regular = !!t.day && t.day.v > 0;
  return {
    sym: t.ticker,
    ts: lastTs,
    last,
    open: regular ? t.day!.o : undefined,
    high: regular ? Math.max(t.day!.h, last) : last,
    low: regular ? Math.min(t.day!.l, last) : last,
    // Antes de la apertura `day` está en cero: el volumen de pre-market es min.av.
    volume: Math.max(t.min?.av ?? 0, t.day?.v ?? 0),
    vwap: regular ? t.day!.vw : t.min?.vw,
    prevClose: t.prevDay?.c || undefined,
  };
}

export class MassiveProvider implements Provider {
  readonly label: string;
  readonly realtime: boolean;
  private socket?: ReconnectingSocket;
  private ctx?: ProviderContext;
  private session: EtDate = sessionDate(Date.now());
  private readonly limiter: RateLimiter;
  private newsTimer?: ReturnType<typeof setInterval>;
  private newsSince = 0;

  constructor(private readonly cfg: Config['massive']) {
    this.realtime = cfg.plan === 'advanced';
    this.label = this.realtime ? 'Massive' : 'Massive (15 min de demora)';
    this.limiter = cfg.plan === 'basic' ? new RateLimiter(5, 61_000) : new RateLimiter(50, 1000);
  }

  private url(path: string): string {
    return `${this.cfg.restUrl}${path}${path.includes('?') ? '&' : '?'}apiKey=${this.cfg.key}`;
  }

  now(): number {
    return Date.now();
  }

  async start(ctx: ProviderContext): Promise<void> {
    this.ctx = ctx;
    const { log } = ctx;
    this.session = sessionDate(Date.now());
    const engine = ctx.engine();

    ctx.setStatus({ connected: false, message: 'Massive: cierres y volumen promedio de las últimas 30 ruedas…' });
    const days = previousTradingDays(this.session, 30);
    const closes = new Map<string, number>();
    const vols = new Map<string, { v: number; n: number }>();
    for (const [i, d] of days.entries()) {
      const rows = await this.grouped(d.dateKey);
      for (const [sym, c, v] of rows) {
        if (i === 0) closes.set(sym, c);
        const acc = vols.get(sym) ?? { v: 0, n: 0 };
        acc.v += v;
        acc.n++;
        vols.set(sym, acc);
      }
    }

    ctx.setStatus({ message: 'Massive: nombres de las empresas…' });
    const names = await this.tickerNames();

    let snaps: SnapTicker[] = [];
    try {
      ctx.setStatus({ message: 'Massive: snapshot de todo el mercado…' });
      const res = await getJson<{ tickers?: SnapTicker[] }>(this.url('/v2/snapshot/locale/us/markets/stocks/tickers?include_otc=false'), {
        limiter: this.limiter,
      });
      snaps = res.tickers ?? [];
    } catch (e) {
      log('warn', `Massive snapshot: ${redact((e as Error).message)}`);
    }
    const sessionStart = tradingDayStart(Date.parse(`${this.session.dateKey}T16:00:00Z`));
    const daySnaps: DaySnapshot[] = [];
    for (const t of snaps) {
      if (t.prevDay?.c) closes.set(t.ticker, t.prevDay.c);
      const d = snapshotToDay(t, sessionStart);
      if (d) daySnaps.push(d);
    }

    const refs: ReferenceData[] = [];
    for (const [sym, prevClose] of closes) {
      if (prevClose < ctx.universeMin || prevClose > ctx.universeMax) continue;
      const n = names.get(sym);
      if (n && n.type && !['CS', 'ADRC', 'OS'].includes(n.type)) continue;
      ctx.universe.add(sym);
      const acc = vols.get(sym);
      refs.push({ sym, name: n?.name, exchange: n?.exchange, prevClose, avgVolume: acc && acc.n >= 5 ? Math.round(acc.v / acc.n) : undefined });
    }
    engine.setReference(refs);
    engine.applySnapshot(daySnaps.filter((d) => ctx.universe.has(d.sym)));
    log('info', `Massive: universo de ${ctx.universe.size} acciones; ${daySnaps.length} con operaciones hoy.`);

    const candidates = daySnaps
      .filter((d) => ctx.universe.has(d.sym) && d.prevClose && (d.last - d.prevClose) / d.prevClose >= 0.03)
      .sort((a, b) => b.last / (b.prevClose ?? 1) - a.last / (a.prevClose ?? 1))
      .slice(0, 150);
    ctx.setStatus({ message: `Massive: velas del día de ${candidates.length} acciones en movimiento…` });
    await Promise.all(
      Array.from({ length: 6 }, async (_, w) => {
        for (let i = w; i < candidates.length; i += 6) {
          const bars = await this.backfill(candidates[i].sym).catch(() => null);
          if (bars) ctx.engine().setBars(candidates[i].sym, bars);
        }
      }),
    );

    await this.pollNews(true);
    this.newsTimer = setInterval(() => void this.pollNews(false), 3 * 60_000);

    if (this.cfg.plan === 'basic') {
      ctx.setStatus({ connected: false, message: 'El plan Basic de Massive no incluye streaming: solo se usa para float y short interest.' });
      return;
    }
    this.connect();
  }

  private async grouped(dateKey: string): Promise<Array<[string, number, number]>> {
    const cacheName = `massive-grouped-${dateKey}.json`;
    const cached = await readCache<Array<[string, number, number]>>(cacheName);
    if (cached) return cached;
    try {
      const res = await getJson<{ results?: GroupedRow[] }>(this.url(`/v2/aggs/grouped/locale/us/market/stocks/${dateKey}?adjusted=true`), {
        limiter: this.limiter,
      });
      const rows: Array<[string, number, number]> = (res.results ?? []).map((r) => [r.T, r.c, r.v]);
      if (rows.length) await writeCache(cacheName, rows);
      return rows;
    } catch (e) {
      this.ctx?.log('warn', `Massive grouped ${dateKey}: ${redact((e as Error).message)}`);
      return [];
    }
  }

  private async tickerNames(): Promise<Map<string, { name: string; type?: string; exchange?: string }>> {
    const cacheName = `massive-tickers-${this.session.dateKey}.json`;
    let rows = await readCache<Array<[string, string, string, string]>>(cacheName);
    if (!rows) {
      try {
        const res = await massivePaged<{ ticker: string; name: string; type?: string; primary_exchange?: string }>(
          `${this.cfg.restUrl}/v3/reference/tickers?market=stocks&active=true&limit=1000`,
          this.cfg.key!,
          this.limiter,
          30,
        );
        const mic: Record<string, string> = { XNAS: 'NASDAQ', XNYS: 'NYSE', XASE: 'NYSE American', ARCX: 'NYSE Arca', BATS: 'Cboe BZX' };
        rows = res.map((r) => [r.ticker, r.name, r.type ?? '', mic[r.primary_exchange ?? ''] ?? r.primary_exchange ?? '']);
        await writeCache(cacheName, rows);
      } catch (e) {
        this.ctx?.log('warn', `Massive nombres: ${redact((e as Error).message)}`);
        rows = [];
      }
    }
    return new Map(rows.map(([t, name, type, exchange]) => [t, { name, type: type || undefined, exchange: exchange || undefined }]));
  }

  private async pollNews(first: boolean): Promise<void> {
    const ctx = this.ctx!;
    try {
      const since = first ? Date.now() - 24 * 3_600_000 : this.newsSince;
      const res = await getJson<{ results?: MassiveNews[] }>(
        this.url(`/v2/reference/news?order=desc&sort=published_utc&limit=${first ? 1000 : 200}&published_utc.gte=${new Date(since).toISOString()}`),
        { limiter: this.limiter },
      );
      const items = (res.results ?? []).map(newsFromMassive).sort((a, b) => a.ts - b.ts);
      const engine = ctx.engine();
      engine.warmup = first;
      for (const item of items) engine.ingest({ kind: 'news', item });
      engine.warmup = false;
      if (items.length) this.newsSince = Math.max(this.newsSince, items[items.length - 1].ts);
      if (first) ctx.log('info', `Massive: ${items.length} noticias de las últimas 24 h.`);
    } catch (e) {
      ctx.log('warn', `Massive noticias: ${redact((e as Error).message)}`);
    }
  }

  private connect(): void {
    const ctx = this.ctx!;
    const channels = this.realtime ? 'A.*,LULD.*' : 'A.*';
    this.socket = new ReconnectingSocket(this.cfg.socketUrl, 'Massive websocket', ctx.log, {
      onMessage: (data) => {
        const engine = ctx.engine();
        for (const m of (Array.isArray(data) ? data : [data]) as Array<Record<string, unknown>>) {
          if (m.ev === 'status') {
            const st = m.status as string;
            if (st === 'connected') this.socket!.send({ action: 'auth', params: this.cfg.key });
            else if (st === 'auth_success') {
              this.socket!.send({ action: 'subscribe', params: channels });
              ctx.setStatus({ connected: true, message: `Conectado a ${this.label}.` });
            } else if (st === 'auth_failed') {
              ctx.log('error', 'Massive: la clave fue rechazada. Revisá MASSIVE_API_KEY.');
              ctx.setStatus({ connected: false, message: 'Massive rechazó la clave (MASSIVE_API_KEY).' });
              this.socket!.close();
            } else if (st === 'max_connections') {
              ctx.log('error', 'Massive: ya hay otra conexión abierta con esta clave.');
              ctx.setStatus({ connected: false, message: 'Massive: hay otra conexión abierta con la misma clave.' });
            } else if (st === 'error') {
              ctx.log('warn', `Massive: ${m.message}`);
            }
            continue;
          }
          for (const ev of massiveToEvents(m)) {
            if (ev.kind !== 'news' && ctx.universe.has(ev.sym)) engine.ingest(ev);
          }
        }
      },
      onClose: () => ctx.setStatus({ connected: false, message: `${this.label}: reconectando…` }),
    });
    this.socket.connect();
  }

  setHot(): void {
    // Con A.* ya llegan todas las acciones segundo a segundo.
  }

  async backfill(sym: string): Promise<Bar[] | null> {
    const from = tradingDayStart(Date.parse(`${this.session.dateKey}T16:00:00Z`));
    const res = await getJson<{ results?: Array<{ t: number; o: number; h: number; l: number; c: number; v: number; vw?: number; n?: number }> }>(
      this.url(`/v2/aggs/ticker/${encodeURIComponent(sym)}/range/1/minute/${from}/${Date.now()}?adjusted=true&sort=asc&limit=50000`),
      { limiter: this.limiter },
    );
    return (res.results ?? []).map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, pv: (b.vw ?? b.c) * b.v, n: b.n ?? 1 }));
  }

  stop(): void {
    this.socket?.close();
    if (this.newsTimer) clearInterval(this.newsTimer);
  }
}
