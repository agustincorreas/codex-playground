// Estado intradía de un símbolo: precio, máximos, volumen, VWAP, velas de 1 minuto e indicadores.
import { Ema, Macd } from './indicators';
import type { Bar, NewsItem, ReferenceData, TapePrint, TradePlan } from './types';

const MIN = 60_000;
const SEC10 = 10_000;
/** Velas de 10 s que se guardan (~2 horas). */
export const MAX_SEC_BARS = 720;

/** Posición de la primera vela con `t >= t0` (búsqueda binaria; `bars.length` si no hay). */
export function lowerBound(bars: Bar[], t0: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t < t0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface FlagSetup extends TradePlan {
  poleHigh: number;
  poleLow: number;
  armedAt: number;
  pullbackBars: number;
}

/** Prints que se guardan por acción para la cinta y para ejecutar órdenes límite en cola. */
export const TAPE_MAX = 400;

export class SymbolState {
  ref: ReferenceData;
  prevClose = 0;
  last = 0;
  lastTs = 0;
  /** Precio del print anterior (para detectar cruces). */
  prevPrice = 0;
  dir: 1 | -1 | 0 = 0;
  /** Primer print del día (cualquier sesión). */
  dayOpen = 0;
  /** Apertura de la rueda regular (primer print desde 9:30). */
  open = 0;
  hod = 0;
  hodTs = 0;
  lod = Infinity;
  pmHigh = 0;
  volume = 0;
  pv = 0;
  ticks = 0;
  /**
   * Fuente parcial (por ejemplo, solo la bolsa IEX): cuánto representa el mercado completo respecto de
   * lo que llega por el feed en vivo (1 = el feed ya es el mercado completo). Se calibra con los datos
   * consolidados demorados y sirve para estimar el volumen de los últimos minutos.
   */
  volumeScale = 1;
  /** Muestras de calibración recibidas (la primera reemplaza el valor inicial; las demás se promedian). */
  scaleSamples = 0;
  /** Volumen acumulado del día que llegó por el feed en vivo (diagnóstico). */
  feedVolume = 0;
  /** Hasta qué hora hay datos consolidados del mercado completo (0 = el feed ya es completo). */
  consolidatedTs = 0;
  bars: Bar[] = [];
  /** Velas de 10 segundos de las últimas ~2 horas. */
  secBars: Bar[] = [];
  /**
   * Cambia cada vez que se modifica o inserta una vela que no es la última (print atrasado, vela
   * consolidada, relleno): un detalle parcial "desde la última vela" no alcanza y hay que mandar el día entero.
   */
  barsRev = 0;

  ema9 = new Ema(9);
  ema20 = new Ema(20);
  macd = new Macd();
  private closedBarT = 0;
  /** Índice de la última vela cerrada en los indicadores (−1 = ninguna): `closeBarsBefore` sigue desde ahí. */
  private closedIdx = -1;

  halted = false;
  haltTs = 0;
  haltReason = '';
  luld?: { up: number; down: number };

  /** NBBO publicado por el proveedor o el simulador (0 = sin cotización real). */
  bid = 0;
  ask = 0;
  bidSize = 0;
  askSize = 0;
  quoteTs = 0;
  /** Cinta: los últimos prints con el lado en que se hicieron. */
  tape: TapePrint[] = [];

  news: NewsItem[] = [];
  lastNewsTs = 0;

  // Memoria de alertas (cooldowns y niveles ya avisados).
  memo = new Map<string, number>();
  lastHodAlertPrice = 0;
  squeezeLevel = 0;
  rotationLevel = 0;
  upticks = 0;
  vwapSide: 1 | -1 | 0 = 0;
  vwapSideSince = 0;
  belowPrevCloseSince = 0;
  flag?: FlagSetup;
  inGappers = false;
  /** Cumple el prefiltro de precio/volumen (se recalcula en cada vista). */
  eligible = false;

  /** Agrega un print a la cinta (se guardan los últimos TAPE_MAX). */
  addPrint(p: TapePrint): void {
    this.tape.push(p);
    if (this.tape.length > TAPE_MAX + 100) this.tape.splice(0, this.tape.length - TAPE_MAX);
  }

  constructor(readonly sym: string, ref?: ReferenceData) {
    this.ref = ref ?? { sym };
    if (ref?.prevClose) this.prevClose = ref.prevClose;
  }

  get vwap(): number {
    return this.volume > 0 ? this.pv / this.volume : this.last;
  }

  get changePct(): number {
    return this.prevClose > 0 && this.last > 0 ? ((this.last - this.prevClose) / this.prevClose) * 100 : 0;
  }

  /** Gap del día: apertura vs. cierre anterior. Antes de la apertura, lo que sube en el pre-market. */
  get gapPct(): number {
    if (!this.open) return this.changePct;
    return this.prevClose > 0 ? ((this.open - this.prevClose) / this.prevClose) * 100 : 0;
  }

  /** Actualiza precio/máximos con un print. Devuelve true si marcó nuevo máximo del día. */
  updatePrice(price: number, ts: number, regular: boolean, premarket: boolean): boolean {
    if (!(price > 0)) return false;
    this.prevPrice = this.last || price;
    if (price > this.last) this.dir = 1;
    else if (price < this.last) this.dir = -1;
    this.last = price;
    this.lastTs = Math.max(this.lastTs, ts);
    if (!this.dayOpen) this.dayOpen = price;
    if (regular && !this.open) this.open = price;
    if (premarket && price > this.pmHigh) this.pmHigh = price;
    if (price < this.lod) this.lod = price;
    if (price > this.hod) {
      const isNew = this.hod > 0;
      this.hod = price;
      this.hodTs = ts;
      return isNew;
    }
    return false;
  }

  /**
   * Suma un print a la vela del minuto correspondiente. Un print atrasado va a su vela (en cualquier
   * lugar del día) o abre una nueva en su posición. Devuelve true si una vela lo aceptó.
   */
  addToBar(ts: number, o: number, h: number, l: number, c: number, v: number, pv: number, n: number): boolean {
    const t = Math.floor(ts / MIN) * MIN;
    let inserted = false;
    addToSeries(this.bars, t, o, h, l, c, v, pv, n, (pos) => {
      inserted = true;
      if (pos === this.bars.length) this.closeBarsBefore(t);
      else this.inserted(pos);
    });
    if (!inserted && this.bars[this.bars.length - 1].t !== t) this.barsRev++;
    return true;
  }

  /** Suma un print a la vela de 10 segundos correspondiente (igual que `addToBar`). */
  addToSecBar(ts: number, o: number, h: number, l: number, c: number, v: number, pv: number, n: number): boolean {
    const t = Math.floor(ts / SEC10) * SEC10;
    const last = this.secBars[this.secBars.length - 1];
    if (last && last.t > t) this.barsRev++;
    addToSeries(this.secBars, t, o, h, l, c, v, pv, n, () => undefined);
    if (this.secBars.length > MAX_SEC_BARS + 120) this.secBars.splice(0, this.secBars.length - MAX_SEC_BARS);
    return true;
  }

  /** Velas de 10 s anteriores a las propias (historia que se consigue después, p. ej. de las operaciones). */
  prependSecBars(bars: Bar[]): void {
    const firstOwn = this.secBars.length ? this.secBars[0].t : Infinity;
    const older = bars.filter((b) => b.t < firstOwn).map((b) => ({ ...b }));
    if (!older.length) return;
    this.secBars = [...older, ...this.secBars];
    if (this.secBars.length > MAX_SEC_BARS) this.secBars.splice(0, this.secBars.length - MAX_SEC_BARS);
    this.barsRev++;
  }

  /** Velas de 10 s en cualquier posición (relleno de un hueco tras una caída): reemplazan las del mismo instante. */
  mergeSecBars(bars: Bar[]): void {
    const map = new Map(this.secBars.map((b) => [b.t, b]));
    for (const b of bars) map.set(b.t, { ...b });
    this.secBars = [...map.values()].sort((a, b) => a.t - b.t);
    if (this.secBars.length > MAX_SEC_BARS) this.secBars.splice(0, this.secBars.length - MAX_SEC_BARS);
    this.barsRev++;
  }

  /**
   * Volumen típico por minuto: el de las últimas 5 velas cerradas repartido en los minutos reales que
   * abarcan (una acción fina no tiene una vela por minuto: 5 velas pueden ser media hora).
   */
  volumePerMinute(): number {
    const n = this.bars.length;
    if (!n) return 0;
    if (n === 1) return this.bars[0].v;
    let v = 0;
    let k = 0;
    let first = 0;
    for (let i = n - 2; i >= 0 && k < 5; i--, k++) {
      v += this.bars[i].v;
      first = this.bars[i].t;
    }
    const minutes = Math.max(1, Math.round((this.bars[n - 2].t - first) / MIN) + 1);
    return v / minutes;
  }

  /**
   * Reemplaza (o inserta) la vela oficial de un minuto y corrige volumen/VWAP del día
   * por la diferencia con lo que ya se había acumulado print a print.
   */
  setMinuteBar(bar: Bar): { dv: number } {
    return { dv: this.upsertMinuteBar(bar) };
  }

  /**
   * Reemplaza (o inserta en su lugar) una vela de 1 minuto buscándola en todo el día: para las velas
   * consolidadas que llegan con demora, que pueden estar muchos minutos atrás. Devuelve la diferencia
   * de volumen respecto de la vela que había.
   */
  upsertMinuteBar(bar: Bar): number {
    const pos = lowerBound(this.bars, bar.t);
    const cur = this.bars[pos];
    if (cur && cur.t === bar.t) {
      const dv = bar.v - cur.v;
      this.volume += dv;
      this.pv += bar.pv - cur.pv;
      this.bars[pos] = { ...bar };
      if (pos < this.bars.length - 1) this.barsRev++;
      return dv;
    }
    this.volume += bar.v;
    this.pv += bar.pv;
    if (pos === this.bars.length) this.closeBarsBefore(bar.t);
    else this.inserted(pos);
    this.bars.splice(pos, 0, { ...bar });
    return bar.v;
  }

  /** Índice de la vela de 1 minuto que empieza en `t` (−1 si no hay). */
  findBarAt(t: number): number {
    const pos = lowerBound(this.bars, t);
    return pos < this.bars.length && this.bars[pos].t === t ? pos : -1;
  }

  /** Se insertó una vela en `pos` (no al final): corre el índice de la última cerrada y marca la revisión. */
  inserted(pos: number): void {
    if (pos <= this.closedIdx) this.closedIdx++;
    this.barsRev++;
  }

  /** Cierra en los indicadores todas las velas anteriores a `t`. Devuelve cuántas cerró. */
  closeBarsBefore(t: number): number {
    let closed = 0;
    for (let i = this.closedIdx + 1; i < this.bars.length; i++) {
      const b = this.bars[i];
      if (b.t <= this.closedBarT) continue;
      if (b.t >= t) break;
      this.ema9.push(b.c);
      this.ema20.push(b.c);
      this.macd.push(b.c);
      this.closedBarT = b.t;
      this.closedIdx = i;
      closed++;
    }
    return closed;
  }

  get lastClosedBarT(): number {
    return this.closedBarT;
  }

  /** Recalcula EMAs y MACD desde la primera vela (después de un backfill). */
  resetIndicators(): void {
    this.ema9 = new Ema(9);
    this.ema20 = new Ema(20);
    this.macd = new Macd();
    this.closedBarT = 0;
    this.closedIdx = -1;
    if (this.bars.length) this.closeBarsBefore(this.bars[this.bars.length - 1].t);
  }

  /** Precio aproximado hace `minutes` minutos (cierre de la vela vigente en ese momento). */
  priceAgo(now: number, minutes: number): number {
    const ref = now - minutes * MIN;
    for (let i = this.bars.length - 1; i >= 0; i--) {
      if (this.bars[i].t <= ref) return this.bars[i].c;
    }
    return this.bars.length ? this.bars[0].o : this.last;
  }

  /** Mínimo de las velas que empiezan dentro de los últimos `minutes` minutos (incluye la actual). */
  lowSince(now: number, minutes: number): number {
    const from = Math.floor((now - minutes * MIN) / MIN) * MIN;
    let low = this.last || Infinity;
    for (let i = this.bars.length - 1; i >= 0; i--) {
      const b = this.bars[i];
      if (b.t < from) break;
      if (b.l < low) low = b.l;
    }
    return low;
  }

  highSince(now: number, minutes: number): number {
    const from = Math.floor((now - minutes * MIN) / MIN) * MIN;
    let high = this.last;
    for (let i = this.bars.length - 1; i >= 0; i--) {
      const b = this.bars[i];
      if (b.t < from) break;
      if (b.h > high) high = b.h;
    }
    return high;
  }

  addFeedVolume(_ts: number, size: number): void {
    this.feedVolume += size;
  }

  /** Volumen de las velas posteriores al minuto que contiene a `ts`. */
  volumeAfter(ts: number): { v: number; pv: number } {
    const t = Math.floor(ts / MIN) * MIN;
    let v = 0;
    let pv = 0;
    for (let i = this.bars.length - 1; i >= 0; i--) {
      const b = this.bars[i];
      if (b.t <= t) break;
      v += b.v;
      pv += b.pv;
    }
    return { v, pv };
  }

  /** Volumen de las velas que empezaron en los últimos `minutes` minutos (la actual incluida). */
  volumeSince(now: number, minutes: number): number {
    const from = now - minutes * MIN;
    let v = 0;
    for (let i = this.bars.length - 1; i >= 0; i--) {
      const b = this.bars[i];
      if (b.t < from) break;
      v += b.v;
    }
    return v;
  }

  /**
   * Volumen de los últimos minutos estimado para el mercado completo: las velas ya consolidadas van tal
   * cual y las que solo tienen lo del feed parcial se escalan con la calibración.
   */
  volumeSinceEstimated(now: number, minutes: number): number {
    if (!this.consolidatedTs || this.volumeScale <= 1) return this.volumeSince(now, minutes);
    const from = now - minutes * MIN;
    const consolidated = Math.floor(this.consolidatedTs / MIN) * MIN;
    let v = 0;
    for (let i = this.bars.length - 1; i >= 0; i--) {
      const b = this.bars[i];
      if (b.t < from) break;
      v += b.t > consolidated ? b.v * this.volumeScale : b.v;
    }
    return v;
  }

  addNews(item: NewsItem): boolean {
    if (this.news.some((n) => n.id === item.id)) return false;
    this.news.push(item);
    this.news.sort((a, b) => b.ts - a.ts);
    if (this.news.length > 30) this.news.length = 30;
    if (item.ts > this.lastNewsTs) this.lastNewsTs = item.ts;
    return true;
  }

  cooldownOk(key: string, now: number, ms: number): boolean {
    const last = this.memo.get(key);
    return last === undefined || now - last >= ms;
  }

  mark(key: string, now: number): void {
    this.memo.set(key, now);
  }
}

/**
 * Suma un print a la vela de `series` que empieza en `t`: la última si es la actual; si está atrasado,
 * la busca en toda la serie (búsqueda binaria) o abre una en su posición. `onInsert(pos)` avisa antes
 * de insertar una vela nueva (`pos === series.length` si va al final).
 */
function addToSeries(series: Bar[], t: number, o: number, h: number, l: number, c: number, v: number, pv: number, n: number, onInsert: (pos: number) => void): void {
  const cur = series[series.length - 1];
  if (cur && cur.t === t) {
    if (h > cur.h) cur.h = h;
    if (l < cur.l) cur.l = l;
    cur.c = c;
    cur.v += v;
    cur.pv += pv;
    cur.n += n;
    return;
  }
  const pos = !cur || cur.t < t ? series.length : lowerBound(series, t);
  const b = series[pos];
  if (b && b.t === t) {
    // Print atrasado: entra a su vela sin tocar el cierre (el último print de ese minuto ya pasó).
    if (h > b.h) b.h = h;
    if (l < b.l) b.l = l;
    b.v += v;
    b.pv += pv;
    b.n += n;
    return;
  }
  onInsert(pos);
  series.splice(pos, 0, { t, o, h, l, c, v, pv, n });
}
