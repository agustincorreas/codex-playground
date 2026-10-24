// Indicadores: EMA y MACD incrementales (motor) y en lote (gráfico).
import type { Bar } from './types';

export class Ema {
  private readonly k: number;
  value: number | undefined;

  constructor(readonly period: number) {
    this.k = 2 / (period + 1);
  }

  /** Incorpora el cierre de una vela terminada. */
  push(x: number): number {
    this.value = this.value === undefined ? x : x * this.k + this.value * (1 - this.k);
    return this.value;
  }

  /** Valor "en vivo" si la vela actual cerrara en `x`, sin modificar el estado. */
  peek(x: number): number {
    return this.value === undefined ? x : x * this.k + this.value * (1 - this.k);
  }
}

export class Macd {
  private fast = new Ema(12);
  private slow = new Ema(26);
  private signal = new Ema(9);

  push(close: number): void {
    const m = this.fast.push(close) - this.slow.push(close);
    this.signal.push(m);
  }

  peek(close: number): { macd: number; signal: number; hist: number } {
    const m = this.fast.peek(close) - this.slow.peek(close);
    const s = this.signal.peek(m);
    return { macd: m, signal: s, hist: m - s };
  }
}

export function emaSeries(values: number[], period: number): number[] {
  const ema = new Ema(period);
  return values.map((v) => ema.push(v));
}

export function macdSeries(closes: number[]): { macd: number[]; signal: number[]; hist: number[] } {
  const fast = emaSeries(closes, 12);
  const slow = emaSeries(closes, 26);
  const macd = closes.map((_, i) => fast[i] - slow[i]);
  const signal = emaSeries(macd, 9);
  return { macd, signal, hist: macd.map((m, i) => m - signal[i]) };
}

/** VWAP acumulado vela a vela (desde la primera vela del día). */
export function vwapSeries(bars: Bar[]): number[] {
  let pv = 0;
  let v = 0;
  return bars.map((b) => {
    pv += b.pv;
    v += b.v;
    return v > 0 ? pv / v : b.c;
  });
}

/** Agrupa velas de 1 minuto en velas de `minutes` minutos. */
export function aggregateBars(bars: Bar[], minutes: number): Bar[] {
  if (minutes <= 1) return bars;
  const span = minutes * 60_000;
  const out: Bar[] = [];
  for (const b of bars) {
    const t = Math.floor(b.t / span) * span;
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
      last.v += b.v;
      last.pv += b.pv;
      last.n += b.n;
    } else {
      out.push({ ...b, t });
    }
  }
  return out;
}
