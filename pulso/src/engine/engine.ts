// Motor del escáner: recibe eventos de mercado (prints, agregados, halts, noticias), mantiene el
// estado de cada acción y produce las listas de los escáneres, las alertas y la ficha de un símbolo.
// No depende del navegador ni de Node: corre igual en el modo demo (navegador) y en el servidor.
import { isEligible, onBarClosed, onPrice, fmtPrice, type AlertSink } from './alerts';
import { buildRow, nextLevel, pillarsOf, recentRangePct, rvolOf, syntheticQuote, type MetricCtx } from './metrics';
import { SymbolState } from './symbol';
import { etParts, expectedVolumeFraction, REG_OPEN, sessionAt } from './time';
import {
  DEFAULT_SETTINGS,
  type Alert,
  type AlertType,
  type Bar,
  type DaySnapshot,
  type DelayedSnapshot,
  type HaltRow,
  type MarketEvent,
  type NewsItem,
  type Quote,
  type ReferenceData,
  type ScannerId,
  type ScanRow,
  type Session,
  type Settings,
  type SymbolDetail,
  type TapePrint,
  type TapeSide,
  type Tone,
  type TradePlan,
  type ViewModel,
} from './types';

const MIN = 60_000;
const SCANNER_ROWS = 25;

export const HALT_REASONS: Record<string, string> = {
  LUDP: 'Pausa por volatilidad (LULD)',
  LUDS: 'Pausa por volatilidad (straddle)',
  M: 'Pausa por volatilidad',
  T1: 'Noticia pendiente',
  T2: 'Noticia publicada',
  T3: 'Noticia y reanudación',
  T5: 'Pausa por movimiento de precio',
  T6: 'Actividad inusual de mercado',
  T7: 'Halt por oferta/demanda',
  T8: 'Halt relacionado a ETF',
  T12: 'Información adicional solicitada',
  H4: 'Incumplimiento de requisitos',
  H9: 'Atraso en presentaciones',
  H10: 'Suspensión de la SEC',
  H11: 'Preocupación regulatoria',
  O1: 'Halt operativo',
  IPO1: 'IPO todavía sin operar',
  MWC1: 'Circuit breaker nivel 1',
  MWC2: 'Circuit breaker nivel 2',
  MWC3: 'Circuit breaker nivel 3',
  D: 'Baja del listado',
};

export function isVolatilityHalt(reason: string): boolean {
  return reason === 'LUDP' || reason === 'LUDS' || reason === 'M' || reason === 'T5';
}

export interface EngineOptions {
  settings?: Partial<Settings>;
  maxAlerts?: number;
  /** Filtro de universo: si devuelve false, los eventos del símbolo se ignoran. */
  accept?: (sym: string, price: number) => boolean;
  /** Armar velas de 10 s para todas las acciones (simulador) o solo para las elegibles (servidor). */
  allSecBars?: boolean;
}

export class Engine implements AlertSink {
  settings: Settings;
  readonly symbols = new Map<string, SymbolState>();
  readonly halts = new Map<string, HaltRow>();
  readonly watch = new Set<string>();
  /** Símbolos con posición u órdenes abiertas en el bróker de práctica. */
  readonly tracked = new Set<string>();
  alerts: Alert[] = [];
  news: NewsItem[] = [];
  now = 0;
  session: Session = 'closed';
  /** Mientras es true, las alertas se marcan como históricas (no suenan). */
  warmup = false;

  private readonly maxAlerts: number;
  private readonly accept?: (sym: string, price: number) => boolean;
  private readonly allSecBars: boolean;
  private printSeq = 0;
  private alertListeners = new Set<(a: Alert) => void>();
  private newsListeners = new Set<(n: NewsItem) => void>();
  private seq = 0;
  private minuteKey = -1;
  volFrac = 0.01;
  private pendingResume = new Set<string>();
  private evCount = 0;
  private evWindowStart = 0;
  private evRate = 0;

  constructor(opts: EngineOptions = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...opts.settings };
    this.maxAlerts = opts.maxAlerts ?? 600;
    this.accept = opts.accept;
    this.allSecBars = opts.allSecBars ?? false;
  }

  // ---------------------------------------------------------------- suscripciones

  onAlert(cb: (a: Alert) => void): () => void {
    this.alertListeners.add(cb);
    return () => this.alertListeners.delete(cb);
  }

  onNews(cb: (n: NewsItem) => void): () => void {
    this.newsListeners.add(cb);
    return () => this.newsListeners.delete(cb);
  }

  isWatched(sym: string): boolean {
    return this.watch.has(sym) || this.tracked.has(sym);
  }

  setWatchlist(syms: string[]): void {
    this.watch.clear();
    for (const s of syms) this.watch.add(s.toUpperCase());
  }

  setTracked(syms: string[]): void {
    this.tracked.clear();
    for (const s of syms) this.tracked.add(s.toUpperCase());
  }

  setSettings(partial: Partial<Settings>): void {
    this.settings = { ...this.settings, ...partial };
  }

  // ---------------------------------------------------------------- datos de referencia

  get(sym: string): SymbolState | undefined {
    return this.symbols.get(sym);
  }

  private ensure(sym: string, price = 0): SymbolState | undefined {
    let st = this.symbols.get(sym);
    if (!st) {
      if (this.accept && !this.accept(sym, price)) return undefined;
      st = new SymbolState(sym);
      this.symbols.set(sym, st);
    }
    return st;
  }

  setReference(list: ReferenceData[]): void {
    for (const ref of list) {
      const st = this.symbols.get(ref.sym);
      if (st) {
        st.ref = { ...st.ref, ...ref };
        if (ref.prevClose) st.prevClose = ref.prevClose;
      } else {
        this.symbols.set(ref.sym, new SymbolState(ref.sym, ref));
      }
    }
  }

  updateReference(sym: string, partial: Partial<ReferenceData>): void {
    const st = this.symbols.get(sym);
    if (!st) return;
    st.ref = { ...st.ref, ...partial, sym };
    if (partial.prevClose) st.prevClose = partial.prevClose;
  }

  /** Estado del día al arrancar con la rueda ya empezada. */
  applySnapshot(list: DaySnapshot[]): void {
    for (const snap of list) {
      const st = this.ensure(snap.sym, snap.last);
      if (!st) continue;
      if (snap.prevClose) st.prevClose = snap.prevClose;
      st.last = snap.last;
      st.prevPrice = snap.last;
      st.lastTs = snap.ts;
      st.hod = Math.max(st.hod, snap.high);
      st.lod = Math.min(st.lod, snap.low);
      st.volume = snap.volume;
      st.pv = (snap.vwap ?? snap.last) * snap.volume;
      if (snap.open) {
        st.open = snap.open;
        st.dayOpen = st.dayOpen || snap.open;
      }
      this.now = Math.max(this.now, snap.ts);
    }
  }

  /**
   * Datos consolidados demorados sobre un feed parcial en vivo: el volumen del día pasa a ser el del
   * mercado completo hasta esa hora más lo que el feed vio después; los máximos y mínimos se completan
   * en silencio (sin alertas: ya pasaron) y las acciones sin prints en el feed toman el último precio
   * demorado. La vela consolidada de cada minuto, comparada con la del feed de ese mismo minuto, calibra
   * cuánto representa el mercado respecto del feed (el volumen del día no sirve para eso: el feed puede
   * haber arrancado a mitad del día).
   */
  /**
   * Feed parcial: cuánto representa el mercado completo respecto del feed mientras una acción no tenga
   * su propia calibración (IEX ve ~2–3 % del volumen: unas 35 veces menos).
   */
  feedScale = 1;

  applyDelayed(list: DelayedSnapshot[]): void {
    for (const d of list) {
      const st = this.ensure(d.sym, d.last);
      if (!st || !(d.ts > 0)) continue;
      if (d.ts <= st.consolidatedTs) continue;
      st.consolidatedTs = d.ts;
      if (!st.scaleSamples && st.volumeScale === 1) st.volumeScale = this.feedScale;
      // La vela consolidada del minuto reemplaza a la del feed; la relación entre las dos calibra la escala.
      if (d.minute && d.minute.v > 0) {
        const own = st.bars.find((b) => b.t === d.minute!.t);
        if (own && own.v > 0) {
          const sample = Math.min(500, Math.max(1, d.minute.v / own.v));
          st.volumeScale = st.scaleSamples ? st.volumeScale * 0.7 + sample * 0.3 : sample;
          st.scaleSamples++;
        }
        st.upsertMinuteBar(d.minute);
        if (d.minute.h > st.hod) st.hod = d.minute.h;
        if (d.minute.l < st.lod) st.lod = d.minute.l;
      }
      const after = st.volumeAfter(d.ts);
      const volume = d.volume + after.v;
      if (volume > st.volume) {
        st.pv = (d.vwap ?? d.last) * d.volume + after.pv;
        st.volume = volume;
      }
      if (d.high > st.hod) {
        st.hod = d.high;
        st.hodTs = d.ts;
      }
      if (d.low > 0 && d.low < st.lod) st.lod = d.low;
      if (d.open && !st.dayOpen) st.dayOpen = d.open;
      if (d.ts > st.lastTs && d.last > 0) {
        st.prevPrice = st.last || d.last;
        st.last = d.last;
        st.lastTs = d.ts;
      }
    }
  }

  /**
   * Reemplaza velas de 1 minuto por las consolidadas (demoradas) y completa las anteriores. Después,
   * el volumen del día se recalcula desde las velas (consolidadas hasta donde llegan y del feed en
   * vivo de ahí en más).
   */
  mergeBars(sym: string, bars: Bar[]): void {
    const st = this.symbols.get(sym);
    if (!st || !bars.length) return;
    this.setBars(sym, bars);
    for (const b of bars) {
      if (!st.bars.length || b.t < st.bars[0].t) continue;
      st.upsertMinuteBar(b);
    }
    // Consolidado hasta el último milisegundo de la última vela recibida.
    const covered = bars[bars.length - 1].t + 60_000 - 1;
    if (covered > st.consolidatedTs) st.consolidatedTs = covered;
    let v = 0;
    let pv = 0;
    for (const b of st.bars) {
      v += b.v;
      pv += b.pv;
    }
    if (v > 0) {
      st.volume = v;
      st.pv = pv;
    }
    for (const b of bars) if (b.h > st.hod) st.hod = b.h;
    st.resetIndicators();
  }

  /** Velas de 10 s hacia atrás (armadas con las operaciones históricas) para los gráficos de 10 s y 30 s. */
  setSecBars(sym: string, bars: Bar[]): void {
    const st = this.symbols.get(sym);
    if (!st || !bars.length) return;
    st.prependSecBars(bars);
  }

  /** Velas de 10 s que rellenan un hueco (tras una caída de la conexión). */
  mergeSecBars(sym: string, bars: Bar[]): void {
    const st = this.symbols.get(sym);
    if (!st || !bars.length) return;
    st.mergeSecBars(bars);
  }

  /** Completa las velas del día (backfill) sin alterar volumen/máximos ya cargados por snapshot. */
  setBars(sym: string, bars: Bar[]): void {
    const st = this.symbols.get(sym);
    if (!st || !bars.length) return;
    const firstOwn = st.bars.length ? st.bars[0].t : Infinity;
    const older = bars.filter((b) => b.t < firstOwn).map((b) => ({ ...b }));
    if (!older.length) return;
    st.bars = [...older, ...st.bars];
    const day = etParts(older[0].t);
    for (const b of older) {
      const m = etParts(b.t).minutes;
      if (m < REG_OPEN && etParts(b.t).dateKey === day.dateKey && b.h > st.pmHigh) st.pmHigh = b.h;
      if (b.h > st.hod) st.hod = b.h;
      if (b.l < st.lod) st.lod = b.l;
    }
    if (!st.dayOpen) st.dayOpen = older[0].o;
    if (st.volume === 0) {
      for (const b of st.bars) {
        st.volume += b.v;
        st.pv += b.pv;
      }
      st.last = st.last || st.bars[st.bars.length - 1].c;
    }
    st.resetIndicators();
  }

  // ---------------------------------------------------------------- eventos

  private clock(ts: number): void {
    if (ts > this.now) this.now = ts;
    const key = Math.floor(this.now / MIN);
    if (key !== this.minuteKey) {
      this.minuteKey = key;
      this.session = sessionAt(this.now);
      this.volFrac = expectedVolumeFraction(etParts(this.now).minutes);
    }
  }

  /** Avanza el reloj aunque no haya eventos (reloj de pared o de la simulación). */
  tick(now: number): void {
    this.clock(now);
    // Reanudaciones sin print posterior: avisar igual después de 30 s.
    for (const sym of this.pendingResume) {
      const st = this.symbols.get(sym);
      const row = this.halts.get(sym);
      if (!st || !row?.resumedAt) {
        this.pendingResume.delete(sym);
        continue;
      }
      if (this.now - row.resumedAt >= 30_000) this.emitResume(st, row);
    }
  }

  ingest(ev: MarketEvent): void {
    this.evCount++;
    switch (ev.kind) {
      case 'trade':
        return this.onTrade(ev.sym, ev.ts, ev.price, ev.size, ev.updatesPrice !== false);
      case 'bar':
        return this.onAggregate(ev);
      case 'status':
        return this.onStatus(ev);
      case 'luld': {
        const st = this.symbols.get(ev.sym);
        if (st) st.luld = { up: ev.up, down: ev.down };
        return;
      }
      case 'news':
        return this.onNewsItem(ev.item);
      case 'quote': {
        const st = this.symbols.get(ev.sym);
        if (!st) return;
        st.bid = ev.bid;
        st.ask = ev.ask;
        st.bidSize = ev.bidSize;
        st.askSize = ev.askSize;
        st.quoteTs = ev.ts;
        return;
      }
    }
  }

  /** ¿Hay NBBO del mercado (y no uno viejo)? */
  private hasQuote(st: SymbolState): boolean {
    return st.bid > 0 && st.ask > st.bid && !st.halted && this.now - st.quoteTs < 10 * MIN;
  }

  /** Lado del print respecto de las puntas; sin NBBO, por la regla del tick (sube = compra). */
  private sideOf(st: SymbolState, price: number): TapeSide {
    if (this.hasQuote(st)) {
      if (price > st.ask) return 'above';
      if (price === st.ask) return 'ask';
      if (price < st.bid) return 'below';
      if (price === st.bid) return 'bid';
      return 'mid';
    }
    const prev = st.tape[st.tape.length - 1];
    if (!prev || price === prev.price) return prev?.side === 'bid' || prev?.side === 'below' ? 'bid' : 'ask';
    return price > prev.price ? 'ask' : 'bid';
  }

  private onTrade(sym: string, ts: number, price: number, size: number, updatesPrice: boolean): void {
    const st = this.ensure(sym, price);
    if (!st || !(price > 0)) return;
    this.clock(ts);
    if (st.halted && ts > st.haltTs + 15_000) this.markResumed(st, ts, 'inferido');
    st.volume += size;
    st.pv += price * size;
    st.ticks++;
    st.addFeedVolume(ts, size);
    const barsBefore = st.bars.length;
    st.addToBar(ts, price, price, price, price, size, price * size, 1);
    if (this.allSecBars || st.eligible || this.isWatched(sym)) {
      st.addToSecBar(ts, price, price, price, price, size, price * size, 1);
      st.addPrint({ seq: ++this.printSeq, ts, price, size, side: this.sideOf(st, price) });
    }
    if (st.bars.length > barsBefore && barsBefore > 0) onBarClosed(st, this);
    if (!updatesPrice) return;
    this.afterPrice(st, price, ts);
  }

  private onAggregate(ev: Extract<MarketEvent, { kind: 'bar' }>): void {
    const st = this.ensure(ev.sym, ev.c);
    if (!st || !(ev.c > 0)) return;
    const end = ev.span === 'minute' ? ev.ts + MIN - 1 : ev.ts + 999;
    this.clock(end);
    if (st.halted && ev.ts > st.haltTs + 15_000) this.markResumed(st, ev.ts, 'inferido');
    const pv = (ev.vw ?? (ev.o + ev.h + ev.l + ev.c) / 4) * ev.v;
    const barsBefore = st.bars.length;
    if (ev.span === 'minute') {
      const { dv } = st.setMinuteBar({ t: Math.floor(ev.ts / MIN) * MIN, o: ev.o, h: ev.h, l: ev.l, c: ev.c, v: ev.v, pv, n: ev.n ?? 1 });
      if (dv > 0) st.addFeedVolume(ev.ts, dv);
      st.ticks += ev.n ?? 1;
      if (st.bars.length > barsBefore && barsBefore > 0) onBarClosed(st, this);
      // La vela oficial puede llegar después de prints más nuevos: no retroceder el último precio.
      const newest = st.bars[st.bars.length - 1];
      if (newest.t === Math.floor(ev.ts / MIN) * MIN) {
        if (ev.h > st.hod) this.afterPrice(st, ev.h, end);
        if (ev.l < st.lod) st.lod = ev.l;
        this.afterPrice(st, ev.c, end);
      } else {
        if (ev.h > st.hod) st.hod = ev.h;
        if (ev.l < st.lod) st.lod = ev.l;
      }
      return;
    }
    // Agregado de 1 segundo: se acumula en la vela del minuto.
    st.addToBar(ev.ts, ev.o, ev.h, ev.l, ev.c, ev.v, pv, ev.n ?? 1);
    if (this.allSecBars || st.eligible) st.addToSecBar(ev.ts, ev.o, ev.h, ev.l, ev.c, ev.v, pv, ev.n ?? 1);
    if (st.bars.length > barsBefore && barsBefore > 0) onBarClosed(st, this);
    if (ev.dayVolume && ev.dayVolume >= st.volume) {
      st.volume = ev.dayVolume;
      st.pv = (ev.dayVwap ?? st.vwap) * ev.dayVolume;
    } else {
      st.volume += ev.v;
      st.pv += pv;
    }
    st.addFeedVolume(ev.ts, ev.v);
    st.ticks += ev.n ?? 1;
    if (ev.h > st.hod && ev.h > ev.c) this.afterPrice(st, ev.h, end);
    this.afterPrice(st, ev.c, end);
  }

  private afterPrice(st: SymbolState, price: number, ts: number): void {
    const prev = st.last || price;
    const m = etParts(ts).minutes;
    const regular = this.session === 'regular';
    const pre = m < REG_OPEN;
    const newHod = st.updatePrice(price, ts, regular, pre);
    if (this.pendingResume.has(st.sym)) {
      const row = this.halts.get(st.sym);
      if (row) this.emitResume(st, row);
    }
    const row = this.halts.get(st.sym);
    if (row) {
      row.price = price;
      row.changePct = st.changePct;
    }
    onPrice(st, this, newHod, prev, price);
  }

  private onStatus(ev: Extract<MarketEvent, { kind: 'status' }>): void {
    const st = this.ensure(ev.sym);
    if (!st) return;
    this.clock(ev.ts);
    const prev = this.halts.get(ev.sym);
    const reasonText = ev.reasonText || HALT_REASONS[ev.reason] || ev.reason || 'Halt';
    if (ev.halted) {
      if (st.halted && prev?.halted) {
        prev.reason = ev.reason || prev.reason;
        prev.reasonText = reasonText;
        if (ev.resumeTs) prev.resumeTs = ev.resumeTs;
        return;
      }
      // Un evento de halt viejo (por ejemplo, repetido por el RSS) no reabre uno ya reanudado.
      if (prev && !prev.halted && prev.ts >= ev.ts) return;
      st.halted = true;
      st.haltTs = ev.ts;
      st.haltReason = ev.reason;
      st.flag = undefined;
      st.bid = st.ask = st.bidSize = st.askSize = 0;
      const row: HaltRow = {
        sym: ev.sym,
        ts: ev.ts,
        halted: true,
        reason: ev.reason,
        reasonText,
        resumeTs: ev.resumeTs ?? (isVolatilityHalt(ev.reason) ? ev.ts + 5 * MIN : undefined),
        price: st.last,
        haltPrice: st.last,
        changePct: st.changePct,
        count: (prev?.count ?? 0) + 1,
      };
      this.halts.set(ev.sym, row);
      let dir = '';
      if (isVolatilityHalt(ev.reason) && st.last > 0) {
        if (st.luld && st.last >= st.luld.up * 0.995) dir = ' al alza';
        else if (st.luld && st.last <= st.luld.down * 1.005) dir = ' a la baja';
        else if (st.last >= st.hod * 0.97) dir = ' al alza';
        else if (st.last <= st.lod * 1.03) dir = ' a la baja';
      }
      this.emit(st, 'halt', `Halt${dir}: ${reasonText}`, dir === ' a la baja' ? 'down' : 'warn', undefined, Math.min(ev.ts, this.now));
    } else {
      if (prev && ev.resumeTs) prev.resumeTs = ev.resumeTs;
      if (st.halted) this.markResumed(st, ev.ts, ev.source ?? '');
    }
  }

  private markResumed(st: SymbolState, ts: number, _source: string): void {
    st.halted = false;
    const row = this.halts.get(st.sym);
    if (row) {
      row.halted = false;
      row.resumedAt = ts;
      this.pendingResume.add(st.sym);
    }
  }

  private emitResume(st: SymbolState, row: HaltRow): void {
    this.pendingResume.delete(st.sym);
    const ref = row.haltPrice;
    const diff = ref > 0 && st.last > 0 ? ((st.last - ref) / ref) * 100 : 0;
    const tone: Tone = diff > 0.5 ? 'up' : diff < -0.5 ? 'down' : 'info';
    const vs = ref > 0 ? ` (${diff >= 0 ? '+' : ''}${diff.toFixed(1)}% vs. precio del halt)` : '';
    this.emit(st, 'resume', `Reanuda en $${fmtPrice(st.last)}${vs}`, tone, undefined, Math.min(row.resumedAt ?? this.now, this.now));
  }

  private onNewsItem(item: NewsItem): void {
    if (this.news.some((n) => n.id === item.id)) return;
    this.news.push(item);
    this.news.sort((a, b) => b.ts - a.ts);
    if (this.news.length > 300) this.news.length = 300;
    for (const cb of this.newsListeners) cb(item);
    for (const sym of item.symbols) {
      const st = this.symbols.get(sym);
      if (!st || !st.addNews(item)) continue;
      const fresh = this.now - item.ts < 30 * MIN;
      const relevant =
        this.watch.has(sym) ||
        isEligible(st, this.settings, false) ||
        (st.changePct >= 5 && st.last >= this.settings.priceMin * 0.5);
      if (fresh && relevant) {
        const tone: Tone = item.sentiment === 'bearish' ? 'down' : item.sentiment === 'bullish' ? 'up' : 'info';
        this.emit(st, 'news', `Noticia: ${item.headline}`, tone);
      }
    }
  }

  // ---------------------------------------------------------------- alertas

  emit(st: SymbolState, type: AlertType, text: string, tone: Tone, plan?: TradePlan, ts = this.now): void {
    const ctx = this.metricCtx();
    const rvol = rvolOf(st, ctx.volFrac);
    const alert: Alert = {
      id: `${ts}-${++this.seq}`,
      ts,
      sym: st.sym,
      type,
      text,
      price: st.last,
      changePct: st.changePct,
      volume: st.volume,
      rvol,
      float: st.ref.float ?? st.ref.sharesOutstanding,
      score: pillarsOf(st, ctx, rvol).score,
      tone,
      warmup: this.warmup || undefined,
      plan,
    };
    this.alerts.push(alert);
    if (this.alerts.length > this.maxAlerts) this.alerts.splice(0, this.alerts.length - this.maxAlerts);
    for (const cb of this.alertListeners) cb(alert);
  }

  // ---------------------------------------------------------------- vistas

  private metricCtx(): MetricCtx {
    return { now: this.now, settings: this.settings, volFrac: this.volFrac, extended: this.session !== 'regular' };
  }

  view(): ViewModel {
    const ctx = this.metricCtx();
    const s = this.settings;
    const rows: ScanRow[] = [];
    const watchRows: ScanRow[] = [];
    const trackedRows: ScanRow[] = [];
    let active = 0;
    for (const st of this.symbols.values()) {
      if (!(st.last > 0)) continue;
      if (st.volume > 0) active++;
      const watched = this.watch.has(st.sym);
      const tracked = this.tracked.has(st.sym);
      st.eligible = isEligible(st, s, watched || tracked);
      const inRange = st.last >= s.priceMin && st.last <= s.priceMax;
      if (!watched && !tracked && (!inRange || st.volume < s.minVolume)) continue;
      const row = buildRow(st, ctx);
      if (watched) watchRows.push(row);
      if (tracked) trackedRows.push(row);
      if (inRange && st.volume >= s.minVolume) rows.push(row);
    }

    const top = (list: ScanRow[], key: (r: ScanRow) => number) =>
      list.sort((a, b) => key(b) - key(a)).slice(0, SCANNER_ROWS);

    const gappers = top(
      rows.filter((r) => r.changePct >= s.gapperMinPct),
      (r) => r.changePct,
    );
    for (const r of gappers) {
      const st = this.symbols.get(r.sym)!;
      if (!st.inGappers && r.changePct >= s.minChangePct && r.score >= 3) {
        st.inGappers = true;
        this.emit(st, 'gapper', `Entra a gappers: +${r.changePct.toFixed(1)}%`, 'info');
      }
    }

    const scanners: Record<ScannerId, ScanRow[]> = {
      gappers,
      pillars: rows
        .filter((r) => r.score >= s.pillarsMinScore)
        .sort((a, b) => b.score - a.score || b.changePct - a.changePct)
        .slice(0, SCANNER_ROWS),
      running: top(
        rows.filter((r) => r.chg5m >= s.runMinPct5m),
        (r) => r.chg5m,
      ),
      lowFloat: top(
        rows.filter((r) => r.float !== undefined && r.float <= s.maxFloatSoft && r.changePct >= s.gapperMinPct),
        (r) => r.changePct,
      ),
      rvol: top(
        rows.filter((r) => r.rvol >= 2),
        (r) => r.rvol,
      ),
      fades: rows
        .filter((r) => r.prevClose > 0 && r.hod >= r.prevClose * 1.2 && r.pctFromHod <= -15)
        .sort((a, b) => a.pctFromHod - b.pctFromHod)
        .slice(0, SCANNER_ROWS),
    };

    const halts = [...this.halts.values()]
      .sort((a, b) => Number(b.halted) - Number(a.halted) || b.ts - a.ts)
      .slice(0, 40)
      .map((h) => ({ ...h }));

    return {
      ts: this.now,
      session: this.session,
      scanners,
      watch: watchRows.sort((a, b) => b.changePct - a.changePct),
      tracked: trackedRows,
      hodBoard: gappers.slice(0, 10),
      halts,
      stats: { tracked: this.symbols.size, active, eventsPerSec: this.eventsPerSec() },
    };
  }

  private eventsPerSec(): number {
    const elapsed = this.now - this.evWindowStart;
    if (elapsed >= 5000 || this.evWindowStart === 0) {
      if (this.evWindowStart !== 0 && elapsed > 0) this.evRate = (this.evCount * 1000) / elapsed;
      this.evCount = 0;
      this.evWindowStart = this.now;
    }
    return Math.round(this.evRate);
  }

  detail(sym: string): SymbolDetail | null {
    const st = this.symbols.get(sym);
    if (!st || !(st.last > 0)) return null;
    const ctx = this.metricCtx();
    const row = buildRow(st, ctx);
    const ema9 = st.ema9.peek(st.last);
    const ema20 = st.ema20.peek(st.last);
    const macd = st.macd.peek(st.last);
    return {
      sym,
      ref: st.ref,
      row,
      bars: st.bars.slice(),
      secBars: st.secBars.slice(),
      tape: st.tape.slice(-150),
      quote: this.quote(sym),
      open: st.open || st.dayOpen,
      pmHigh: st.pmHigh,
      lod: Number.isFinite(st.lod) ? st.lod : st.last,
      ema9,
      ema20,
      macd,
      news: st.news.slice(0, 15),
      halt: this.halts.get(sym),
      luld: st.luld,
      setup: {
        aboveVwap: st.last >= st.vwap,
        aboveEma9: st.last >= ema9,
        aboveEma20: st.last >= ema20,
        macdBullish: macd.macd >= macd.signal,
        flag: st.flag
          ? {
              entry: st.flag.entry,
              stop: st.flag.stop,
              target: st.flag.target,
              poleHigh: st.flag.poleHigh,
              armedAt: st.flag.armedAt,
            }
          : undefined,
        nextLevel: nextLevel(st.last),
      },
    };
  }

  /** Fila de escáner de un símbolo (aunque no esté en ninguna lista). */
  row(sym: string): ScanRow | null {
    const st = this.symbols.get(sym);
    return st && st.last > 0 ? buildRow(st, this.metricCtx()) : null;
  }

  /** Cotización actual (con spread estimado) para ejecutar órdenes de práctica. */
  quote(sym: string): Quote | null {
    const st = this.symbols.get(sym);
    if (!st || !(st.last > 0)) return null;
    const volPerMin = st.volumePerMinute();
    if (this.hasQuote(st)) {
      return { sym, last: st.last, bid: st.bid, ask: st.ask, bidSize: st.bidSize, askSize: st.askSize, real: true, ts: Math.max(st.lastTs, st.quoteTs), halted: false, volPerMin };
    }
    const { bid, ask } = syntheticQuote(st.last, recentRangePct(st), this.session !== 'regular');
    return { sym, last: st.last, bid, ask, bidSize: 0, askSize: 0, real: false, ts: st.lastTs, halted: st.halted, volPerMin };
  }

  /** Prints de la cinta posteriores a `seq` (para ejecutar órdenes límite en su turno). */
  printsSince(sym: string, seq: number): TapePrint[] {
    const tape = this.symbols.get(sym)?.tape;
    if (!tape?.length || tape[tape.length - 1].seq <= seq) return [];
    let i = tape.length - 1;
    while (i > 0 && tape[i - 1].seq > seq) i--;
    return tape.slice(i);
  }

  /** Último número de print (para empezar a seguir la cinta desde ahora). */
  get lastPrintSeq(): number {
    return this.printSeq;
  }

  /** Busca símbolos por prefijo (buscador de la interfaz). */
  search(prefix: string, limit = 8): string[] {
    const p = prefix.toUpperCase();
    if (!p) return [];
    const out: string[] = [];
    for (const sym of this.symbols.keys()) {
      if (sym.startsWith(p)) out.push(sym);
      if (out.length >= limit * 4) break;
    }
    return out.sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, limit);
  }
}
