// Indicadores incrementales del gráfico: extienden el cálculo con las velas nuevas y dan exactamente
// los mismos números que las series completas; si cambian velas viejas, recalculan todo.
import { describe, expect, it } from 'vitest';
import { emaSeries, macdSeries } from '../src/engine/indicators';
import { IncrementalIndicators } from '../src/client/lib/incremental';

/** Paseo al azar reproducible (sin Math.random: el test siempre ve los mismos cierres). */
function walk(n: number, seed = 7): number[] {
  let x = seed;
  const out: number[] = [];
  let p = 5;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    p = Math.max(0.5, p + ((x / 2147483648) - 0.5) * 0.3);
    out.push(Math.round(p * 100) / 100);
  }
  return out;
}

function full(closes: number[]) {
  const m = macdSeries(closes);
  return { e9: emaSeries(closes, 9), e20: emaSeries(closes, 20), e200: emaSeries(closes, 200), macd: m.macd, signal: m.signal, hist: m.hist };
}

describe('indicadores incrementales', () => {
  it('vela a vela da lo mismo que las series completas (incluida la vela en vivo que cambia)', () => {
    const closes = walk(320);
    const inc = new IncrementalIndicators();
    for (let n = 1; n <= closes.length; n++) {
      const part = closes.slice(0, n);
      const from = inc.update('ABC|60', part);
      expect(from).toBe(Math.max(0, n - 2));
      expect(inc.series).toEqual(full(part));
      // La última vela se mueve con cada tick antes de cerrar: también tiene que coincidir.
      const live = part.slice();
      live[n - 1] = live[n - 1] + 0.07;
      expect(inc.update('ABC|60', live)).toBe(n - 1);
      expect(inc.series).toEqual(full(live));
    }
  });

  it('varias velas nuevas de golpe también extienden el cálculo', () => {
    const closes = walk(260, 3);
    const inc = new IncrementalIndicators();
    inc.update('XYZ|300', closes.slice(0, 100));
    const from = inc.update('XYZ|300', closes.slice(0, 180));
    expect(from).toBe(99);
    expect(inc.series).toEqual(full(closes.slice(0, 180)));
    expect(inc.update('XYZ|300', closes)).toBe(179);
    expect(inc.series).toEqual(full(closes));
  });

  it('recalcula todo si cambian velas viejas, si hay menos velas o si es otra acción o temporalidad', () => {
    const closes = walk(150, 11);
    const inc = new IncrementalIndicators();
    inc.update('ABC|60', closes);
    const filled = closes.slice();
    filled[40] += 0.5;
    expect(inc.update('ABC|60', filled)).toBe(0);
    expect(inc.series).toEqual(full(filled));
    expect(inc.update('ABC|60', filled.slice(0, 120))).toBe(0);
    expect(inc.series).toEqual(full(filled.slice(0, 120)));
    expect(inc.update('ABC|300', filled.slice(0, 120))).toBe(0);
    expect(inc.series).toEqual(full(filled.slice(0, 120)));
    // Historia que llega por delante (velas nuevas al principio): también se recalcula.
    const withPast = [...walk(50, 5), ...filled.slice(0, 120)];
    expect(inc.update('ABC|300', withPast)).toBe(0);
    expect(inc.series).toEqual(full(withPast));
    expect(inc.series.e9).toHaveLength(170);
  });

  it('sin velas deja las series vacías', () => {
    const inc = new IncrementalIndicators();
    expect(inc.update('ABC|60', [])).toBe(0);
    expect(inc.series.e9).toEqual([]);
    expect(inc.series.hist).toEqual([]);
  });
});
