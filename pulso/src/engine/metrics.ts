// Métricas derivadas por símbolo: volumen relativo, cambios por ventana y los 5 pilares.
import type { SymbolState } from './symbol';
import type { Pillars, ScanRow, Settings } from './types';

export interface MetricCtx {
  now: number;
  settings: Settings;
  /** Fracción esperada del volumen diario a esta hora (ver time.expectedVolumeFraction). */
  volFrac: number;
}

const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : 0);

/** Volumen relativo ajustado por horario: volumen de hoy vs lo normal a esta hora. */
export function rvolOf(st: SymbolState, volFrac: number): number {
  const avg = st.ref.avgVolume;
  return avg && avg > 0 ? st.volume / (avg * volFrac) : 0;
}

/** Volumen de los últimos 5 minutos vs 5 minutos promedio de una rueda normal (390 min). */
export function rvol5mOf(st: SymbolState, now: number): number {
  const avg = st.ref.avgVolume;
  if (!avg || avg <= 0) return 0;
  return st.volumeSince(now, 5) / ((avg / 390) * 5);
}

export function hasRecentNews(st: SymbolState, now: number, settings: Settings): boolean {
  return st.lastNewsTs > 0 && now - st.lastNewsTs <= settings.newsWindowHours * 3_600_000;
}

/** Float conocido, o acciones en circulación como estimación (cota superior). */
export function floatOf(st: SymbolState): { value?: number; estimate: boolean } {
  if (st.ref.float && st.ref.float > 0) return { value: st.ref.float, estimate: false };
  if (st.ref.sharesOutstanding && st.ref.sharesOutstanding > 0) {
    return { value: st.ref.sharesOutstanding, estimate: true };
  }
  return { estimate: false };
}

export function pillarsOf(st: SymbolState, ctx: MetricCtx, rvol = rvolOf(st, ctx.volFrac)): Pillars {
  const s = ctx.settings;
  const fl = floatOf(st);
  const price = st.last >= s.priceMin && st.last <= s.priceMax;
  const change = st.changePct >= s.minChangePct;
  const rv = rvol >= s.minRvol;
  const news = hasRecentNews(st, ctx.now, s);
  // Si solo conocemos las acciones en circulación y ya cumplen, el float (menor) también cumple.
  const float = fl.value === undefined ? null : fl.value <= s.maxFloat;
  const score = Number(price) + Number(change) + Number(rv) + Number(news) + Number(float === true);
  return { price, change, rvol: rv, news, float, score };
}

export function buildRow(st: SymbolState, ctx: MetricCtx): ScanRow {
  const { now } = ctx;
  const price = st.last;
  const rvol = rvolOf(st, ctx.volFrac);
  const fl = floatOf(st);
  const pillars = pillarsOf(st, ctx, rvol);
  return {
    sym: st.sym,
    name: st.ref.name,
    price,
    prevClose: st.prevClose,
    changePct: st.changePct,
    gapPct: st.gapPct,
    volume: st.volume,
    rvol,
    rvol5m: rvol5mOf(st, now),
    float: fl.value,
    floatEst: fl.estimate || undefined,
    rotation: fl.value ? st.volume / fl.value : undefined,
    chg1m: pct(price, st.priceAgo(now, 1)),
    chg5m: pct(price, st.priceAgo(now, 5)),
    chg15m: pct(price, st.priceAgo(now, 15)),
    vol5m: st.volumeSince(now, 5),
    hod: st.hod,
    lod: Number.isFinite(st.lod) ? st.lod : price,
    pctFromHod: pct(price, st.hod),
    vwap: st.vwap,
    hasNews: pillars.news,
    halted: st.halted,
    score: pillars.score,
    pillars,
    ticks: st.ticks,
    flags: st.ref.flags,
    lastTs: st.lastTs,
    dir: st.dir,
  };
}

export function priceTick(price: number): number {
  return price >= 1 ? 0.01 : 0.0001;
}

/** Próximo medio dólar / dólar entero por encima del precio (niveles psicológicos). */
export function levelStep(price: number): number {
  if (price < 1) return 0.1;
  if (price < 3) return 0.5;
  return 1;
}

export function nextLevel(price: number): number {
  const step = levelStep(price);
  return Math.round((Math.floor(price / step + 1e-9) + 1) * step * 10000) / 10000;
}
