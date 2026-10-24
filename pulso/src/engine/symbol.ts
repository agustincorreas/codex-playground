// Estado intradía de un símbolo: precio, máximos, volumen, VWAP, velas de 1 minuto e indicadores.
import { Ema, Macd } from './indicators';
import type { Bar, NewsItem, ReferenceData, TradePlan } from './types';

const MIN = 60_000;
const SEC10 = 10_000;
/** Velas de 10 s que se guardan (~2 horas). */
const MAX_SEC_BARS = 720;

export interface FlagSetup extends TradePlan {
  poleHigh: number;
  poleLow: number;
  armedAt: number;
  pullbackBars: number;
}

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
  bars: Bar[] = [];
  /** Velas de 10 segundos de las últimas ~2 horas. */
  secBars: Bar[] = [];

  ema9 = new Ema(9);
  ema20 = new Ema(20);
  macd = new Macd();
  private closedBarT = 0;

  halted = false;
  haltTs = 0;
  haltReason = '';
  luld?: { up: number; down: number };

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

  get gapPct(): number {
    const base = this.open || this.dayOpen;
    return this.prevClose > 0 && base > 0 ? ((base - this.prevClose) / this.prevClose) * 100 : 0;
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

  /** Suma un print a la vela del minuto correspondiente. */
  addToBar(ts: number, o: number, h: number, l: number, c: number, v: number, pv: number, n: number): void {
    const t = Math.floor(ts / MIN) * MIN;
    const cur = this.bars[this.bars.length - 1];
    if (cur && cur.t === t) {
      if (h > cur.h) cur.h = h;
      if (l < cur.l) cur.l = l;
      cur.c = c;
      cur.v += v;
      cur.pv += pv;
      cur.n += n;
      return;
    }
    if (cur && cur.t > t) {
      // Print atrasado: buscar su vela hacia atrás (sin reordenar el día completo).
      for (let i = this.bars.length - 2; i >= Math.max(0, this.bars.length - 6); i--) {
        const b = this.bars[i];
        if (b.t === t) {
          if (h > b.h) b.h = h;
          if (l < b.l) b.l = l;
          b.v += v;
          b.pv += pv;
          b.n += n;
          return;
        }
      }
      return;
    }
    this.closeBarsBefore(t);
    this.bars.push({ t, o, h, l, c, v, pv, n });
  }

  /** Suma un print a la vela de 10 segundos correspondiente. */
  addToSecBar(ts: number, o: number, h: number, l: number, c: number, v: number, pv: number, n: number): void {
    const t = Math.floor(ts / SEC10) * SEC10;
    const cur = this.secBars[this.secBars.length - 1];
    if (cur && cur.t === t) {
      if (h > cur.h) cur.h = h;
      if (l < cur.l) cur.l = l;
      cur.c = c;
      cur.v += v;
      cur.pv += pv;
      cur.n += n;
      return;
    }
    if (cur && cur.t > t) return;
    this.secBars.push({ t, o, h, l, c, v, pv, n });
    if (this.secBars.length > MAX_SEC_BARS + 120) this.secBars.splice(0, this.secBars.length - MAX_SEC_BARS);
  }

  /** Volumen típico por minuto: promedio de las últimas 5 velas cerradas (o la actual si no hay). */
  volumePerMinute(): number {
    const n = this.bars.length;
    if (!n) return 0;
    if (n === 1) return this.bars[0].v;
    let v = 0;
    let k = 0;
    for (let i = n - 2; i >= 0 && k < 5; i--, k++) v += this.bars[i].v;
    return v / k;
  }

  /**
   * Reemplaza (o inserta) la vela oficial de un minuto y corrige volumen/VWAP del día
   * por la diferencia con lo que ya se había acumulado print a print.
   */
  setMinuteBar(bar: Bar): { dv: number } {
    const idx = this.findBar(bar.t);
    if (idx >= 0) {
      const old = this.bars[idx];
      const dv = bar.v - old.v;
      this.volume += dv;
      this.pv += bar.pv - old.pv;
      this.bars[idx] = { ...bar };
      return { dv };
    }
    this.volume += bar.v;
    this.pv += bar.pv;
    let pos = this.bars.length;
    while (pos > 0 && this.bars[pos - 1].t > bar.t) pos--;
    if (pos === this.bars.length) this.closeBarsBefore(bar.t);
    this.bars.splice(pos, 0, { ...bar });
    return { dv: bar.v };
  }

  private findBar(t: number): number {
    for (let i = this.bars.length - 1; i >= Math.max(0, this.bars.length - 10); i--) {
      if (this.bars[i].t === t) return i;
      if (this.bars[i].t < t) return -1;
    }
    return -1;
  }

  /** Cierra en los indicadores todas las velas anteriores a `t`. Devuelve cuántas cerró. */
  closeBarsBefore(t: number): number {
    let closed = 0;
    for (const b of this.bars) {
      if (b.t <= this.closedBarT) continue;
      if (b.t >= t) break;
      this.ema9.push(b.c);
      this.ema20.push(b.c);
      this.macd.push(b.c);
      this.closedBarT = b.t;
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

  volumeSince(now: number, minutes: number): number {
    const from = now - minutes * MIN;
    let v = 0;
    for (let i = this.bars.length - 1; i >= 0; i--) {
      const b = this.bars[i];
      if (b.t + MIN <= from) break;
      v += b.v;
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
