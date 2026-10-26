// Proveedor Alpaca: plan Algo Trader Plus (feed SIP, US$ 99/mes) o plan gratis (feed IEX). Con
// `feed: 'auto'` se prueba una consulta SIP reciente al arrancar: si el plan la permite, SIP; si no, IEX.
// Arranque por REST (activos, snapshots, volumen promedio, velas del día) y luego streaming:
// velas de 1 minuto de todo el mercado + prints de los símbolos calientes + halts + LULD + noticias.
//
// Plan gratis en capas: IEX en tiempo real (precio al segundo, ~2–3 % del volumen) más el mercado
// completo con 15 minutos de demora (snapshots `delayed_sip` de todo el universo cada un minuto y
// velas consolidadas de los símbolos calientes). El escáner ve el volumen real con un rato de atraso y
// los precios en vivo; el motor estima los últimos minutos escalando lo que vio IEX.
import type { HistoryTf } from '../src/engine/history';
import type { Bar, DaySnapshot, DelayedSnapshot, MarketEvent, NewsItem, ReferenceData } from '../src/engine/types';
import { etParts, previousTradingDays, sessionDate, tradingDayStart, type EtDate } from '../src/engine/time';
import type { Config } from './config';
import { ReconnectingSocket, type Provider, type ProviderContext } from './provider';
import { chunk, getJson, HttpError, RateLimiter, readCache, writeCache } from './util';

interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n?: number;
  vw?: number;
}

interface AlpacaSnapshot {
  latestTrade?: { t: string; p: number; s: number };
  minuteBar?: AlpacaBar;
  dailyBar?: AlpacaBar;
  prevDailyBar?: AlpacaBar;
}

interface AlpacaAsset {
  symbol: string;
  name: string;
  exchange: string;
  tradable: boolean;
  status: string;
}

interface AlpacaNews {
  id: number;
  headline: string;
  summary?: string;
  source?: string;
  url?: string | null;
  created_at: string;
  symbols: string[];
}

const EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX', 'ARCA', 'BATS', 'NYSEARCA']);

// Condiciones de prints que no actualizan el último precio ni los máximos (precio promedio, odd lots,
// fuera de secuencia, etc.). Siguen sumando volumen.
const NO_PRICE_CONDITIONS = new Set(['B', 'C', 'G', 'H', 'I', 'M', 'N', 'P', 'Q', 'R', 'U', 'V', 'W', 'Z', '4', '7', '9']);

// Motivos de halt de la cinta CTA (NYSE/AMEX/Arca) llevados a los códigos de Nasdaq que usa el motor.
const CTA_REASON: Record<string, string> = {
  M: 'LUDP',
  P: 'T1',
  D: 'T2',
  A: 'T12',
  C: 'H11',
  X: 'O1',
  N: 'M1',
  F: 'T8',
  V: 'T8',
  '1': 'MWC1',
  '2': 'MWC2',
  '3': 'MWC3',
};

export function barFromAlpaca(b: AlpacaBar): Bar {
  const t = Date.parse(b.t);
  return { t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, pv: (b.vw ?? (b.h + b.l + b.c) / 3) * b.v, n: b.n ?? 1 };
}

/** Traduce un mensaje del stream de Alpaca (un elemento del array) a eventos del motor. */
export function alpacaToEvent(m: Record<string, unknown>): MarketEvent | null {
  switch (m.T) {
    case 't': {
      const conds = (m.c as string[] | undefined) ?? [];
      return {
        kind: 'trade',
        sym: m.S as string,
        ts: Date.parse(m.t as string),
        price: m.p as number,
        size: m.s as number,
        updatesPrice: !conds.some((c) => NO_PRICE_CONDITIONS.has(c)),
      };
    }
    case 'q':
      // Tamaños en lotes de 100 acciones.
      return {
        kind: 'quote',
        sym: m.S as string,
        ts: Date.parse(m.t as string),
        bid: m.bp as number,
        ask: m.ap as number,
        bidSize: ((m.bs as number) ?? 0) * 100,
        askSize: ((m.as as number) ?? 0) * 100,
      };
    case 'b':
    case 'u': {
      const b = m as unknown as AlpacaBar & { S: string };
      return { kind: 'bar', span: 'minute', sym: b.S, ts: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, vw: b.vw, n: b.n };
    }
    case 's': {
      const sc = String(m.sc ?? '');
      const halted = sc === 'H' || sc === 'P' || sc === '2';
      const resumed = sc === 'T' || sc === '3';
      if (!halted && !resumed) return null;
      const rc = String(m.rc ?? '').trim();
      const cta = /^\d$/.test(sc);
      const reason = cta ? (CTA_REASON[rc] ?? rc) : sc === 'P' && !rc ? 'LUDP' : rc;
      return {
        kind: 'status',
        sym: m.S as string,
        ts: Date.parse(m.t as string),
        halted,
        reason,
        reasonText: undefined,
        source: 'alpaca',
      };
    }
    case 'l':
      return { kind: 'luld', sym: m.S as string, ts: Date.parse(m.t as string), up: m.u as number, down: m.d as number };
    case 'n': {
      const n = m as unknown as AlpacaNews;
      return { kind: 'news', item: newsFromAlpaca(n) };
    }
  }
  return null;
}

export function newsFromAlpaca(n: AlpacaNews): NewsItem {
  return {
    id: `alp-${n.id}`,
    ts: Date.parse(n.created_at),
    headline: n.headline,
    summary: n.summary || undefined,
    source: n.source === 'benzinga' ? 'Benzinga' : n.source,
    url: n.url ?? undefined,
    symbols: n.symbols ?? [],
  };
}

/**
 * Cierre anterior y estado del día desde un snapshot. Antes de la apertura el `dailyBar` todavía es
 * el del día anterior (los prints de pre-market no forman la vela diaria).
 */
export function fromSnapshot(sym: string, s: AlpacaSnapshot, session: EtDate): { prevClose?: number; day?: DaySnapshot } {
  const dailyDate = s.dailyBar ? etParts(Date.parse(s.dailyBar.t)).dateKey : '';
  const isToday = dailyDate === session.dateKey;
  const prevClose = isToday ? s.prevDailyBar?.c : s.dailyBar?.c;
  const start = tradingDayStart(Date.parse(`${session.dateKey}T16:00:00Z`));
  const lt = s.latestTrade;
  const ltTs = lt ? Date.parse(lt.t) : 0;
  if (!lt || ltTs < start) return { prevClose };
  const db = isToday ? s.dailyBar : undefined;
  return {
    prevClose,
    day: {
      sym,
      ts: ltTs,
      last: lt.p,
      open: db?.o,
      high: Math.max(db?.h ?? 0, lt.p),
      low: Math.min(db?.l ?? Infinity, lt.p),
      volume: db?.v ?? 0,
      vwap: db?.vw,
      prevClose,
    },
  };
}

/** Snapshot demorado del mercado completo → estado consolidado para el motor. */
export function delayedFromSnapshot(sym: string, s: AlpacaSnapshot, session: EtDate): DelayedSnapshot | null {
  const lt = s.latestTrade;
  if (!lt) return null;
  const ts = Date.parse(lt.t);
  const start = tradingDayStart(Date.parse(`${session.dateKey}T16:00:00Z`));
  if (!(ts >= start)) return null;
  const db = s.dailyBar && etParts(Date.parse(s.dailyBar.t)).dateKey === session.dateKey ? s.dailyBar : undefined;
  const mb = s.minuteBar && Date.parse(s.minuteBar.t) >= start ? barFromAlpaca(s.minuteBar) : undefined;
  return { sym, ts, last: lt.p, high: Math.max(db?.h ?? 0, lt.p), low: Math.min(db?.l ?? Infinity, lt.p), volume: db?.v ?? 0, vwap: db?.vw, open: db?.o, minute: mb };
}

export class AlpacaProvider implements Provider {
  label = '';
  realtime = false;
  /** Plan gratis: IEX en vivo más el mercado completo demorado (ver el encabezado del archivo). */
  layered = false;
  /** Feed en uso (con `auto`, el que se detectó al arrancar). */
  feed: 'sip' | 'iex' | 'delayed_sip' = 'iex';
  private readonly hotLimitFixed: boolean;
  private stream?: ReconnectingSocket;
  private news?: ReconnectingSocket;
  private hot = new Set<string>();
  private wantedHot = new Set<string>();
  private limiter = new RateLimiter(180, 60_000);
  private ctx?: ProviderContext;
  private session: EtDate = sessionDate(Date.now());
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private polling = false;
  private refreshing = false;
  /** Símbolos calientes que todavía no tienen velas consolidadas (se piden enseguida). */
  private pendingBars = new Set<string>();
  private pendingTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly cfg: Config['alpaca']) {
    this.hotLimitFixed = cfg.hotLimit > 0;
    this.applyFeed(cfg.feed === 'auto' ? 'iex' : cfg.feed);
  }

  private applyFeed(feed: 'sip' | 'iex' | 'delayed_sip'): void {
    this.feed = feed;
    this.layered = feed === 'iex';
    this.label = feed === 'sip' ? 'Alpaca SIP' : this.layered ? 'Alpaca gratis' : 'Alpaca (demorado)';
    this.realtime = feed === 'sip' || this.layered;
    // Algo Trader Plus permite 10.000 consultas por minuto; el plan gratis, 200.
    this.limiter = feed === 'sip' ? new RateLimiter(150, 1000) : new RateLimiter(180, 60_000);
    if (!this.hotLimitFixed) this.cfg.hotLimit = feed === 'iex' ? 25 : 400;
  }

  private get streamUrl(): string {
    return this.cfg.streamUrl ?? `wss://stream.data.alpaca.markets/v2/${this.feed}`;
  }

  /** ¿El plan permite el SIP en tiempo real? (El gratis responde 403 a cualquier consulta SIP reciente.) */
  private async hasSip(): Promise<boolean> {
    // `get` insiste tres veces ante el 403; con un "sí" alcanza (el plan gratis nunca responde 200).
    const start = new Date(Date.now() - 10 * 60_000).toISOString();
    try {
      await this.get(`${this.cfg.dataUrl}/v2/stocks/bars?symbols=SPY&timeframe=1Min&start=${start}&limit=1&feed=sip`);
      return true;
    } catch (e) {
      if (e instanceof HttpError && e.status === 403) return false;
      throw e;
    }
  }

  private liveMessage(): string {
    return this.layered ? 'Alpaca gratis: precio en vivo (IEX); volumen, máximos y escáneres del mercado completo con 15 min de demora.' : `Conectado a ${this.label}.`;
  }

  /** Etiqueta del encabezado: en capas, aclara qué es en vivo y qué viene con demora. */
  get badge(): string | undefined {
    return this.layered ? 'EN VIVO (IEX) · MERCADO COMPLETO −15 MIN' : undefined;
  }

  private get headers() {
    return { 'APCA-API-KEY-ID': this.cfg.keyId!, 'APCA-API-SECRET-KEY': this.cfg.secret! };
  }

  /**
   * GET con reintento cuando Alpaca contesta 403 "subscription does not permit": recién contratado el
   * plan, durante unos minutos algunos de sus servidores lo tienen y otros no.
   */
  private async get(url: string): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await getJson<unknown>(url, { headers: this.headers, limiter: this.limiter });
      } catch (e) {
        if (attempt >= 2 || !(e instanceof HttpError && e.status === 403 && /subscription/i.test(e.body))) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  now(): number {
    return Date.now();
  }

  async start(ctx: ProviderContext): Promise<void> {
    this.ctx = ctx;
    const { log } = ctx;
    this.session = sessionDate(Date.now());
    if (this.cfg.feed === 'auto') {
      ctx.setStatus({ connected: false, message: 'Alpaca: detectando el plan de datos…' });
      const sip = await this.hasSip();
      this.applyFeed(sip ? 'sip' : 'iex');
      ctx.setStatus({ provider: this.label, realtime: this.realtime, badge: this.badge });
      log('info', sip ? 'Alpaca: la cuenta tiene Algo Trader Plus: todo el mercado en tiempo real (SIP).' : 'Alpaca: plan gratis: IEX en vivo más el mercado completo con 15 min de demora.');
    }
    ctx.setStatus({ connected: false, message: 'Alpaca: descargando la lista de acciones…' });

    const assets = await this.assets();
    const listed = assets.filter((a) => a.tradable && a.status === 'active' && EXCHANGES.has(a.exchange));
    const names = new Map(listed.map((a) => [a.symbol, a]));
    log('info', `Alpaca: ${listed.length} acciones listadas.`);

    ctx.setStatus({ message: `Alpaca: snapshots de ${listed.length} acciones…` });
    const snaps = await this.snapshots(listed.map((a) => a.symbol));
    const engine = ctx.engine();
    if (this.layered) engine.feedScale = 35;
    const refs: ReferenceData[] = [];
    const days: DaySnapshot[] = [];
    const { universeMin, universeMax } = ctx;
    for (const [sym, snap] of snaps) {
      const { prevClose, day } = fromSnapshot(sym, snap, this.session);
      if (!prevClose || prevClose < universeMin || prevClose > universeMax) continue;
      ctx.universe.add(sym);
      const a = names.get(sym);
      refs.push({ sym, name: a?.name, exchange: a?.exchange, prevClose });
      if (day) days.push(day);
    }
    log('info', `Alpaca: universo de ${ctx.universe.size} acciones entre $${universeMin} y $${universeMax}.`);

    // El volumen promedio (30 días de 10.000 acciones) es lo que más tarda la primera vez: se carga en
    // segundo plano, así el mercado se ve enseguida y el RVOL aparece cuando termina.
    engine.setReference(refs);
    engine.applySnapshot(days);
    void this.avgVolumes([...ctx.universe], (done, total) => {
      if (this.ctx?.engine() === engine) ctx.setStatus({ message: `Alpaca: volumen promedio de ${total} acciones… ${Math.round((done / total) * 100)} %` });
    })
      .then((avg) => {
        if (this.ctx?.engine() !== engine) return;
        for (const [sym, v] of avg) engine.updateReference(sym, { avgVolume: v });
        log('info', `Alpaca: volumen promedio de ${avg.size} acciones.`);
        if (this.stream) ctx.setStatus({ message: this.liveMessage() });
      })
      .catch((e) => log('warn', `Alpaca volumen promedio: ${(e as Error).message}`));
    if (this.layered) {
      // El estado inicial viene del mercado completo con demora: queda marcado como consolidado.
      const delayed: DelayedSnapshot[] = [];
      for (const [sym, snap] of snaps) {
        if (!ctx.universe.has(sym)) continue;
        const d = delayedFromSnapshot(sym, snap, this.session);
        if (d) delayed.push(d);
      }
      engine.applyDelayed(delayed);
    }

    // Velas del día para las que ya se mueven (sus máximos de pre-market y el gráfico).
    const candidates = days
      .filter((d) => d.prevClose && (d.last - d.prevClose) / d.prevClose >= 0.03)
      .sort((a, b) => b.last / (b.prevClose ?? 1) - a.last / (a.prevClose ?? 1))
      .slice(0, 250)
      .map((d) => d.sym);
    ctx.setStatus({ message: `Alpaca: velas del día de ${candidates.length} acciones en movimiento…` });
    const bars = await this.dayBars(candidates);
    for (const [sym, list] of bars) engine.setBars(sym, list);
    this.wantedHot = new Set(candidates.slice(0, this.cfg.hotLimit));

    try {
      const recent = await this.recentNews();
      engine.warmup = true;
      for (const n of recent) engine.ingest({ kind: 'news', item: n });
      engine.warmup = false;
      log('info', `Alpaca: ${recent.length} noticias de las últimas 24 h.`);
    } catch (e) {
      log('warn', `Alpaca noticias: ${(e as Error).message}`);
    }

    this.connectStream();
    this.connectNews();
    if (this.layered) {
      this.timers.push(setInterval(() => void this.pollDelayed(), this.cfg.delayedPollMs));
      this.timers.push(setInterval(() => void this.refreshHot([...this.hot]), this.cfg.hotRefreshMs));
    }
  }

  /** Plan gratis: el estado del día de todo el universo según el mercado completo (15 min atrás). */
  private async pollDelayed(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || this.polling) return;
    this.polling = true;
    try {
      const snaps = await this.snapshots([...ctx.universe]);
      const delayed: DelayedSnapshot[] = [];
      for (const [sym, snap] of snaps) {
        const d = delayedFromSnapshot(sym, snap, this.session);
        if (d) delayed.push(d);
      }
      ctx.engine().applyDelayed(delayed);
    } catch (e) {
      ctx.log('warn', `Alpaca mercado completo (demorado): ${(e as Error).message}`);
    } finally {
      this.polling = false;
    }
  }

  /** Plan gratis: velas consolidadas (hasta hace 16 min) de los símbolos calientes, sobre las de IEX. */
  private async refreshHot(syms: string[]): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || this.refreshing || !syms.length) return;
    this.refreshing = true;
    try {
      const bars = await this.dayBars(syms.slice(0, 60));
      const engine = ctx.engine();
      for (const [sym, list] of bars) engine.mergeBars(sym, list);
    } finally {
      this.refreshing = false;
    }
  }

  /** Las claves de paper funcionan con paper-api y las de la cuenta real con api: se prueban ambas. */
  private async assets(): Promise<AlpacaAsset[]> {
    const other = this.cfg.tradingUrl.includes('paper-api') ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets';
    try {
      return (await this.get(`${this.cfg.tradingUrl}/v2/assets?status=active&asset_class=us_equity`)) as AlpacaAsset[];
    } catch (e) {
      if (!(e instanceof HttpError && (e.status === 401 || e.status === 403))) throw e;
      const res = (await this.get(`${other}/v2/assets?status=active&asset_class=us_equity`)) as AlpacaAsset[];
      this.ctx?.log('info', `Alpaca: las claves corresponden a ${other}.`);
      return res;
    }
  }

  private async snapshots(symbols: string[]): Promise<Map<string, AlpacaSnapshot>> {
    const out = new Map<string, AlpacaSnapshot>();
    // Con el plan gratis, el estado del día se pide al mercado completo demorado (no a IEX sola).
    const feed = this.feed === 'sip' ? 'sip' : 'delayed_sip';
    for (const group of chunk(symbols, 400)) {
      let list = group;
      // Un símbolo inválido hace fallar todo el lote: se quita y se reintenta.
      for (let attempt = 0; attempt < 8 && list.length; attempt++) {
        try {
          const res = (await this.get(`${this.cfg.dataUrl}/v2/stocks/snapshots?symbols=${encodeURIComponent(list.join(','))}&feed=${feed}`)) as Record<string, AlpacaSnapshot>;
          for (const [sym, snap] of Object.entries(res)) if (snap) out.set(sym, snap);
          break;
        } catch (e) {
          const bad = e instanceof HttpError ? e.body.match(/invalid symbol: ([A-Z0-9.\-/]+)/i)?.[1] : undefined;
          if (!bad) throw e;
          list = list.filter((s) => s !== bad);
        }
      }
    }
    return out;
  }

  private async avgVolumes(symbols: string[], progress?: (done: number, total: number) => void): Promise<Map<string, number>> {
    const cacheName = `alpaca-avgvol-${this.session.dateKey}.json`;
    const cached = await readCache<Array<[string, number]>>(cacheName);
    if (cached) return new Map(cached);
    const days = previousTradingDays(this.session, 30);
    if (!days.length) return new Map();
    const start = days[days.length - 1].dateKey;
    const end = days[0].dateKey;
    const sums = new Map<string, { v: number; n: number }>();
    let done = 0;
    for (const group of chunk(symbols, 200)) {
      done += group.length;
      if (done % 1000 < 200) progress?.(done, symbols.length);
      let token: string | undefined;
      do {
        const url =
          `${this.cfg.dataUrl}/v2/stocks/bars?symbols=${encodeURIComponent(group.join(','))}&timeframe=1Day&start=${start}&end=${end}` +
          `&limit=10000&adjustment=split&feed=sip${token ? `&page_token=${encodeURIComponent(token)}` : ''}`;
        const res = (await this.get(url)) as { bars: Record<string, AlpacaBar[]>; next_page_token?: string | null };
        for (const [sym, list] of Object.entries(res.bars ?? {})) {
          const acc = sums.get(sym) ?? { v: 0, n: 0 };
          for (const b of list) {
            acc.v += b.v;
            acc.n++;
          }
          sums.set(sym, acc);
        }
        token = res.next_page_token ?? undefined;
      } while (token);
    }
    const out = new Map<string, number>();
    for (const [sym, { v, n }] of sums) if (n >= 5) out.set(sym, Math.round(v / n));
    await writeCache(cacheName, [...out]);
    return out;
  }

  /** Velas de 1 minuto desde las 4:00 ET. Con el plan gratis se piden al SIP hasta hace 16 minutos. */
  private async dayBars(symbols: string[]): Promise<Map<string, Bar[]>> {
    const out = new Map<string, Bar[]>();
    if (!symbols.length) return out;
    const start = new Date(tradingDayStart(Date.parse(`${this.session.dateKey}T16:00:00Z`))).toISOString();
    const paid = this.feed === 'sip';
    const end = paid ? '' : `&end=${new Date(Date.now() - 16 * 60_000).toISOString()}`;
    for (const group of chunk(symbols, 50)) {
      let token: string | undefined;
      try {
        do {
          const url =
            `${this.cfg.dataUrl}/v2/stocks/bars?symbols=${encodeURIComponent(group.join(','))}&timeframe=1Min&start=${start}${end}` +
            `&limit=10000&feed=sip${token ? `&page_token=${encodeURIComponent(token)}` : ''}`;
          const res = (await this.get(url)) as { bars: Record<string, AlpacaBar[]>; next_page_token?: string | null };
          for (const [sym, list] of Object.entries(res.bars ?? {})) {
            const arr = out.get(sym) ?? [];
            arr.push(...list.map(barFromAlpaca));
            out.set(sym, arr);
          }
          token = res.next_page_token ?? undefined;
        } while (token);
      } catch (e) {
        this.ctx?.log('warn', `Alpaca velas del día: ${(e as Error).message}`);
      }
    }
    return out;
  }

  private async recentNews(): Promise<NewsItem[]> {
    const out: NewsItem[] = [];
    const start = new Date(Date.now() - 24 * 3_600_000).toISOString();
    let token: string | undefined;
    for (let page = 0; page < 12; page++) {
      const res = (await this.get(
        `${this.cfg.dataUrl}/v1beta1/news?start=${start}&limit=50&sort=desc${token ? `&page_token=${encodeURIComponent(token)}` : ''}`,
      )) as { news: AlpacaNews[]; next_page_token?: string | null };
      out.push(...(res.news ?? []).map(newsFromAlpaca));
      token = res.next_page_token ?? undefined;
      if (!token) break;
    }
    return out;
  }

  private connectStream(): void {
    const ctx = this.ctx!;
    const { log } = ctx;
    this.stream = new ReconnectingSocket(this.streamUrl, `Alpaca stream (${this.feed})`, log, {
      onMessage: (data) => {
        const arr = Array.isArray(data) ? data : [data];
        const engine = ctx.engine();
        for (const m of arr as Array<Record<string, unknown>>) {
          if (m.T === 'success' && m.msg === 'connected') {
            this.stream!.send({ action: 'auth', key: this.cfg.keyId, secret: this.cfg.secret });
          } else if (m.T === 'success' && m.msg === 'authenticated') {
            this.hot.clear();
            this.stream!.send({ action: 'subscribe', bars: ['*'], updatedBars: ['*'], statuses: ['*'], lulds: ['*'] });
            this.syncHot();
            ctx.setStatus({ connected: true, message: this.liveMessage() });
          } else if (m.T === 'error') {
            this.onStreamError(m.code as number, m.msg as string);
          } else if (m.T === 'subscription') {
            const trades = (m.trades as string[] | undefined)?.length ?? 0;
            log('info', `Alpaca: suscripción activa (prints de ${trades} símbolos, velas de todo el mercado).`);
          } else {
            const ev = alpacaToEvent(m);
            if (ev && (ev.kind === 'news' || ctx.universe.has(ev.sym))) engine.ingest(ev);
          }
        }
      },
      onClose: () => ctx.setStatus({ connected: false, message: `${this.label}: reconectando…` }),
    });
    this.stream.connect();
  }

  private onStreamError(code: number, msg: string): void {
    const { log, setStatus } = this.ctx!;
    const hints: Record<number, string> = {
      402: 'Clave o secreto de Alpaca incorrectos. Revisá ALPACA_KEY_ID y ALPACA_SECRET_KEY.',
      406: 'Ya hay otra conexión abierta con esta clave (Alpaca permite una sola). Cerrá la otra app o servidor.',
      409: 'Tu plan de Alpaca no incluye este feed. Dejá ALPACA_FEED=auto (o iex con la cuenta gratis); para SIP contratá Algo Trader Plus.',
      405: 'Superaste el límite de símbolos del plan gratis (30). Bajá ALPACA_HOT_SYMBOLS.',
    };
    const hint = hints[code] ?? msg;
    log('error', `Alpaca stream: error ${code} (${msg}). ${hint}`);
    setStatus({ connected: false, message: hint });
    // Con 402 (clave mala) no tiene sentido insistir. Con 409 sí: recién contratado el plan, algunos
    // servidores de Alpaca todavía no lo ven; la reconexión con espera cae en otro.
    if (code === 402) this.stream?.close();
    if (code === 409) this.stream?.reconnect();
    if (code === 405) {
      this.cfg.hotLimit = Math.max(5, Math.floor(this.cfg.hotLimit / 2));
      this.syncHot();
    }
  }

  private connectNews(): void {
    const ctx = this.ctx!;
    this.news = new ReconnectingSocket(this.cfg.newsStreamUrl, 'Alpaca noticias', ctx.log, {
      onMessage: (data) => {
        for (const m of (Array.isArray(data) ? data : [data]) as Array<Record<string, unknown>>) {
          if (m.T === 'success' && m.msg === 'connected') this.news!.send({ action: 'auth', key: this.cfg.keyId, secret: this.cfg.secret });
          else if (m.T === 'success' && m.msg === 'authenticated') this.news!.send({ action: 'subscribe', news: ['*'] });
          else if (m.T === 'error') ctx.log('warn', `Alpaca noticias: error ${m.code} (${m.msg}).`);
          else if (m.T === 'n') {
            const ev = alpacaToEvent(m);
            if (ev) ctx.engine().ingest(ev);
          }
        }
      },
    });
    this.news.connect();
  }

  setHot(syms: string[]): void {
    this.wantedHot = new Set(syms.slice(0, this.cfg.hotLimit));
    this.syncHot();
  }

  /** Plan gratis: un símbolo nuevo entre los calientes recibe sus velas consolidadas enseguida. */
  private queueBars(syms: string[]): void {
    if (!this.layered) return;
    for (const s of syms) this.pendingBars.add(s);
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => {
      const list = [...this.pendingBars];
      this.pendingBars.clear();
      void this.refreshHot(list);
    }, 1500);
  }

  private syncHot(): void {
    if (!this.stream) return;
    const add = [...this.wantedHot].filter((s) => !this.hot.has(s) && this.ctx?.universe.has(s));
    const remove = [...this.hot].filter((s) => !this.wantedHot.has(s));
    // Con SIP también la cotización (NBBO) de los calientes; con IEX no (su libro no es el del mercado).
    const quotes = this.feed === 'sip';
    if (remove.length) this.stream.send(quotes ? { action: 'unsubscribe', trades: remove, quotes: remove } : { action: 'unsubscribe', trades: remove });
    if (add.length) this.stream.send(quotes ? { action: 'subscribe', trades: add, quotes: add } : { action: 'subscribe', trades: add });
    for (const s of remove) this.hot.delete(s);
    for (const s of add) this.hot.add(s);
    if (add.length) this.queueBars(add);
  }

  async backfill(sym: string): Promise<Bar[] | null> {
    const res = await this.dayBars([sym]);
    return res.get(sym) ?? null;
  }

  /**
   * Historia para el gráfico: 1 min de los últimos 5 días hábiles, 1 hora de los últimos 100 días o
   * diaria desde 2016 (ajustada por splits). Con el plan gratis, hasta hace 16 minutos.
   */
  async history(sym: string, tf: HistoryTf): Promise<Bar[] | null> {
    const now = Date.now();
    const paid = this.feed === 'sip';
    const end = paid ? '' : `&end=${new Date(now - 16 * 60_000).toISOString()}`;
    const fiveDays = previousTradingDays(this.session, 5);
    const start =
      tf === 'minute'
        ? tradingDayStart(Date.parse(`${fiveDays[fiveDays.length - 1].dateKey}T16:00:00Z`))
        : tf === 'hour'
          ? now - 100 * 24 * 3_600_000
          : Date.UTC(2016, 0, 1);
    const timeframe = tf === 'minute' ? '1Min' : tf === 'hour' ? '1Hour' : '1Day';
    const out: Bar[] = [];
    let token: string | undefined;
    for (let page = 0; page < 12; page++) {
      const url =
        `${this.cfg.dataUrl}/v2/stocks/bars?symbols=${encodeURIComponent(sym)}&timeframe=${timeframe}&start=${new Date(start).toISOString()}${end}` +
        `&limit=10000&adjustment=split&feed=sip${token ? `&page_token=${encodeURIComponent(token)}` : ''}`;
      const res = (await this.get(url)) as { bars: Record<string, AlpacaBar[]>; next_page_token?: string | null };
      out.push(...(res.bars?.[sym] ?? []).map(barFromAlpaca));
      token = res.next_page_token ?? undefined;
      if (!token) break;
    }
    return out;
  }

  /**
   * Velas de 10 s a partir de las operaciones consolidadas, del presente hacia atrás: con SIP, todo el
   * día desde las 4:00 ET (hasta 60 páginas de 10.000 operaciones); con el plan gratis, las últimas dos
   * horas hasta hace 16 minutos (lo último lo completan los prints en vivo). Cada página que llega se
   * entrega a `onBars` sin la vela más vieja, que puede seguir en la página siguiente.
   */
  async backfillSec(sym: string, onBars?: (bars: Bar[]) => void): Promise<Bar[] | null> {
    const paid = this.feed === 'sip';
    const end = paid ? Date.now() : Date.now() - 16 * 60_000;
    const start = paid ? tradingDayStart(Date.parse(`${this.session.dateKey}T16:00:00Z`)) : end - 2 * 3_600_000;
    const bars = new Map<number, Bar>();
    const sorted = () => [...bars.values()].sort((a, b) => a.t - b.t);
    let token: string | undefined;
    for (let page = 0; page < (paid ? 60 : 8); page++) {
      const url =
        `${this.cfg.dataUrl}/v2/stocks/${encodeURIComponent(sym)}/trades?start=${new Date(start).toISOString()}&end=${new Date(end).toISOString()}` +
        `&limit=10000&feed=sip&sort=desc${token ? `&page_token=${encodeURIComponent(token)}` : ''}`;
      const res = (await this.get(url)) as { trades: Array<{ t: string; p: number; s: number; c?: string[] }>; next_page_token?: string | null };
      // Vienen del presente hacia atrás: dentro de la vela se procesan en orden de tiempo.
      for (const tr of (res.trades ?? []).slice().reverse()) {
        const ts = Date.parse(tr.t);
        const t = Math.floor(ts / 10_000) * 10_000;
        const price = (tr.c ?? []).some((c) => NO_PRICE_CONDITIONS.has(c)) ? undefined : tr.p;
        const b = bars.get(t) as (Bar & { firstTs?: number; lastTs?: number }) | undefined;
        if (!b) {
          bars.set(t, { t, o: price ?? tr.p, h: price ?? tr.p, l: price ?? tr.p, c: price ?? tr.p, v: tr.s, pv: tr.p * tr.s, n: 1, firstTs: ts, lastTs: ts } as Bar);
          continue;
        }
        if (price !== undefined) {
          if (price > b.h) b.h = price;
          if (price < b.l) b.l = price;
          // La vela del borde entre páginas recibe trades más viejos después: apertura y cierre van por tiempo.
          if (ts >= (b.lastTs ?? 0)) {
            b.c = price;
            b.lastTs = ts;
          }
          if (ts < (b.firstTs ?? Infinity)) {
            b.o = price;
            b.firstTs = ts;
          }
        }
        b.v += tr.s;
        b.pv += tr.p * tr.s;
        b.n++;
      }
      token = res.next_page_token ?? undefined;
      if (!token) break;
      if (onBars && bars.size > 1) onBars(sorted().slice(1));
    }
    return bars.size ? sorted() : null;
  }

  stop(): void {
    this.stream?.close();
    this.news?.close();
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
  }
}
