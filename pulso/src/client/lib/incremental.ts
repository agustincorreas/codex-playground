// EMA 9, 20 y 200 y MACD (12, 26, 9) del gráfico, calculados de a poco: cuando llegan velas nuevas al
// final se extiende el cálculo anterior en vez de recorrer las ~5.000 velas de nuevo. La última vela
// está "en vivo" (su cierre cambia con cada tick), así que nunca se consolida: se calcula con `peek`.
// Da exactamente los mismos números que `emaSeries` y `macdSeries` sobre la serie completa.
import { Ema } from '../../engine/indicators';

export interface IndicatorSeries {
  e9: number[];
  e20: number[];
  e200: number[];
  macd: number[];
  signal: number[];
  hist: number[];
}

function fresh() {
  return { e9: new Ema(9), e20: new Ema(20), e200: new Ema(200), fast: new Ema(12), slow: new Ema(26), sig: new Ema(9) };
}

export class IncrementalIndicators {
  /** Símbolo y temporalidad del cálculo guardado. */
  key = '';
  /** Cierres con los que se calculó la última vez. */
  closes: number[] = [];
  readonly series: IndicatorSeries = { e9: [], e20: [], e200: [], macd: [], signal: [], hist: [] };
  /** Estado de las medias con los cierres consolidados (todos menos el último). */
  private emas = fresh();

  /**
   * Actualiza las series para estos cierres. Devuelve el índice desde el que cambiaron los valores:
   * `0` cuando hubo que recalcular todo (otra acción o temporalidad, velas viejas distintas por un
   * relleno de historia, menos velas que antes) o el índice de la vela que estaba en vivo cuando
   * solo se agregaron velas al final.
   */
  update(key: string, closes: number[]): number {
    const prev = this.closes;
    const n = closes.length;
    let from = 0;
    if (key === this.key && prev.length > 0 && n >= prev.length && samePrefix(prev, closes, prev.length - 1)) {
      from = prev.length - 1;
    } else {
      this.key = key;
      this.emas = fresh();
      for (const s of Object.values(this.series)) s.length = 0;
    }
    const s = this.series;
    const e = this.emas;
    for (const arr of Object.values(s)) arr.length = n;
    // Velas consolidadas: se incorporan al estado.
    for (let i = from; i < n - 1; i++) {
      const c = closes[i];
      s.e9[i] = e.e9.push(c);
      s.e20[i] = e.e20.push(c);
      s.e200[i] = e.e200.push(c);
      const m = e.fast.push(c) - e.slow.push(c);
      const sig = e.sig.push(m);
      s.macd[i] = m;
      s.signal[i] = sig;
      s.hist[i] = m - sig;
    }
    // La vela en vivo: el valor que tendrían si cerrara ahora, sin tocar el estado.
    if (n > 0) {
      const i = n - 1;
      const c = closes[i];
      s.e9[i] = e.e9.peek(c);
      s.e20[i] = e.e20.peek(c);
      s.e200[i] = e.e200.peek(c);
      const m = e.fast.peek(c) - e.slow.peek(c);
      const sig = e.sig.peek(m);
      s.macd[i] = m;
      s.signal[i] = sig;
      s.hist[i] = m - sig;
    }
    this.closes = closes.slice();
    return from;
  }
}

function samePrefix(a: number[], b: number[], len: number): boolean {
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) return false;
  return true;
}
