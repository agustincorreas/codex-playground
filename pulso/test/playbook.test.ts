// El libro de jugadas del IA Trader: elegir la "obvia", detectar entradas limpias y manejar la posición.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/engine/types';
import { etWallToTs } from '../src/engine/time';
import type { Bar, Quote, ScanRow, SymbolDetail } from '../src/engine/types';
import { findEntry, inEntryWindow, manage, newMemory, rankCandidates, sizeFor, DEFAULT_RULES } from '../src/trading/playbook';
import { parseDecision } from '../src/trading/advisor';
import type { Position } from '../src/trading/types';

const at = (h: number, m: number) => etWallToTs(2026, 10, 26, h * 60 + m);

function row(p: Partial<ScanRow> & { sym: string }): ScanRow {
  const price = p.price ?? 5;
  return {
    price,
    prevClose: 3,
    changePct: 60,
    gapPct: 40,
    volume: 5_000_000,
    rvol: 20,
    rvol5m: 10,
    float: 3e6,
    chg1m: 1,
    chg5m: 3,
    chg15m: 8,
    vol5m: 300_000,
    hod: price * 1.01,
    lod: 3.2,
    pctFromHod: -1,
    vwap: price * 0.95,
    hasNews: true,
    halted: false,
    score: 5,
    pillars: { price: true, change: true, rvol: true, news: true, float: true, score: 5 },
    bid: price - 0.01,
    ask: price,
    ticks: 50,
    lastTs: at(9, 45),
    dir: 1,
    ...p,
  } as ScanRow;
}

function bar(t: number, o: number, h: number, l: number, c: number, v: number): Bar {
  return { t, o, h, l, c, v, pv: ((o + h + l + c) / 4) * v, n: 10 };
}

function detail(bars: Bar[], r: ScanRow, extra: Partial<SymbolDetail> = {}): SymbolDetail {
  return {
    sym: r.sym,
    ref: { sym: r.sym, name: 'Runner Inc', prevClose: r.prevClose, float: r.float },
    row: r,
    bars,
    secBars: [],
    tape: [],
    quote: null,
    open: 3.4,
    pmHigh: 4.2,
    lod: r.lod,
    ema9: r.price * 0.97,
    ema20: r.price * 0.94,
    macd: { macd: 0.02, signal: 0.01, hist: 0.01 },
    news: [],
    setup: { aboveVwap: true, aboveEma9: true, aboveEma20: true, macdBullish: true, nextLevel: Math.ceil(r.price) },
    ...extra,
  };
}

const quote = (last: number, spread = 0.01): Quote => ({ sym: 'X', last, bid: last - spread, ask: last, bidSize: 1000, askSize: 1000, real: true, ts: 0, halted: false, volPerMin: 50_000 });

describe('libro de jugadas', () => {
  it('elige la "obvia": 5 pilares, RVOL grande, float chico, noticia y cerca del máximo', () => {
    const rows = [
      row({ sym: 'MEH', pillars: { price: true, change: true, rvol: false, news: false, float: true, score: 3 }, rvol: 2, hasNews: false }),
      row({ sym: 'OBVI' }),
      row({ sym: 'FAR', pctFromHod: -12 }),
      row({ sym: 'HALT', halted: true }),
      row({ sym: 'DEAD', pctFromHod: -30 }),
      row({ sym: 'BIG', price: 45 }),
    ];
    const c = rankCandidates(rows, DEFAULT_SETTINGS);
    expect(c.map((x) => x.sym)).toEqual(['OBVI', 'FAR', 'MEH']);
    expect(c[0].score).toBeGreaterThan(80);
    expect(c[0].reasons).toContain('con noticia');
    expect(c[2].warnings).toContain('sin noticia');
  });

  it('entra en un micro pullback con stop debajo del descanso y objetivo 2:1, y no entra sin ruptura', () => {
    const t0 = at(9, 40);
    const bars = [
      bar(t0, 4.0, 4.1, 3.95, 4.05, 80_000),
      bar(t0 + 60_000, 4.05, 4.3, 4.0, 4.28, 120_000),
      bar(t0 + 120_000, 4.28, 4.5, 4.25, 4.48, 150_000),
      bar(t0 + 180_000, 4.48, 4.52, 4.35, 4.4, 60_000), // descanso 1
      bar(t0 + 240_000, 4.4, 4.44, 4.36, 4.42, 40_000), // descanso 2
      bar(t0 + 300_000, 4.42, 4.47, 4.41, 4.46, 30_000), // la vela actual supera el máximo de la anterior (4.44)
    ];
    const r = row({ sym: 'RUNR', price: 4.46, hod: 4.52, pctFromHod: -1.3, vwap: 4.2 });
    const plan = findEntry(detail(bars, r, { ema9: 4.3 }), quote(4.46), t0 + 330_000);
    expect(plan?.kind).toBe('microPullback');
    expect(plan!.entry).toBe(4.46);
    expect(plan!.stop).toBe(4.35);
    expect(plan!.target).toBeCloseTo(4.68, 2);
    // Sin ruptura de la vela anterior no hay entrada; tampoco con el precio debajo del VWAP.
    const flat = [...bars.slice(0, 5), bar(t0 + 300_000, 4.42, 4.43, 4.4, 4.41, 30_000)];
    expect(findEntry(detail(flat, row({ sym: 'RUNR', price: 4.41, hod: 4.52, pctFromHod: -2 })), quote(4.41), t0 + 330_000)).toBeNull();
    const below = detail(bars, r, { setup: { aboveVwap: false, aboveEma9: true, aboveEma20: true, macdBullish: true, nextLevel: 5 } });
    expect(findEntry(below, quote(4.46), t0 + 330_000)).toBeNull();
  });

  it('toma el bull flag del motor y descarta stops lejanos o spreads anchos', () => {
    const t0 = at(10, 0);
    const bars = [bar(t0, 5, 5.2, 5, 5.15, 50_000), bar(t0 + 60_000, 5.15, 5.3, 5.1, 5.25, 50_000), bar(t0 + 120_000, 5.25, 5.31, 5.2, 5.3, 40_000)];
    const r = row({ sym: 'FLAG', price: 5.3, hod: 5.31, pctFromHod: -0.2 });
    const d = detail(bars, r, { setup: { aboveVwap: true, aboveEma9: true, aboveEma20: true, macdBullish: true, nextLevel: 6, flag: { entry: 5.3, stop: 5.12, target: 5.66, poleHigh: 5.3, armedAt: t0 } } });
    expect(findEntry(d, quote(5.3), t0 + 150_000)?.kind).toBe('bullFlag');
    const farStop = detail(bars, r, { setup: { ...d.setup, flag: { entry: 5.3, stop: 4.5, target: 6.9, poleHigh: 5.3, armedAt: t0 } } });
    expect(findEntry(farStop, quote(5.3), t0 + 150_000)).toBeNull();
    expect(findEntry(d, quote(5.3, 0.15), t0 + 150_000)).toBeNull();
  });

  it('el tamaño sale del riesgo, sin pasar del poder de compra ni de la liquidez', () => {
    expect(sizeFor(20, 4.46, 4.35, 10_000, 50_000)).toBe(180);
    expect(sizeFor(200, 4.46, 4.35, 10_000, 50_000)).toBe(1800);
    expect(sizeFor(200, 4.46, 4.35, 1_000, 50_000)).toBe(210);
    expect(sizeFor(200, 4.46, 4.35, 10_000, 5_000)).toBe(500);
    expect(sizeFor(20, 4.46, 4.46, 10_000, 50_000)).toBe(0);
  });

  it('maneja la posición: stop, mitad en 2R, stop a la entrada, EMA 9 y tiempo', () => {
    const t0 = at(10, 0);
    const pos: Position = { sym: 'RUNR', shares: 200, avgCost: 4.46, openedAt: t0, boughtShares: 200, boughtCost: 892, soldShares: 0, soldValue: 0, fees: 0, realized: 0, initialStop: 4.35, planStop: 4.35, planTarget: 4.68, high: 4.5, low: 4.44, fills: 1 } as Position;
    const base = [bar(t0, 4.4, 4.5, 4.38, 4.46, 50_000), bar(t0 + 60_000, 4.46, 4.55, 4.44, 4.5, 50_000), bar(t0 + 120_000, 4.5, 4.52, 4.47, 4.5, 20_000)];
    const r = row({ sym: 'RUNR', price: 4.5, vwap: 4.3 });
    const mem = newMemory(t0, 4.46);
    expect(manage(pos, detail(base, r, { ema9: 4.4 }), quote(4.5), t0 + 130_000, mem).action).toBe('hold');
    expect(manage(pos, detail(base, r, { ema9: 4.4 }), quote(4.34), t0 + 130_000, mem).action).toBe('sellAll');
    // Objetivo: mitad; después el stop sube a la entrada.
    expect(manage(pos, detail(base, r, { ema9: 4.4 }), quote(4.7), t0 + 130_000, mem).action).toBe('sellHalf');
    mem.halfTaken = true;
    expect(manage(pos, detail(base, r, { ema9: 4.4 }), quote(4.7), t0 + 130_000, mem).action).toBe('stopToBreakeven');
    mem.breakeven = true;
    // Una vela cerrada debajo de la EMA 9 saca el resto.
    const weak = [...base, bar(t0 + 180_000, 4.6, 4.62, 4.3, 4.35, 60_000), bar(t0 + 240_000, 4.35, 4.4, 4.33, 4.38, 10_000)];
    expect(manage(pos, detail(weak, r, { ema9: 4.45 }), quote(4.5), t0 + 250_000, mem).action).toBe('sellAll');
    // Sin avanzar en 6 minutos, afuera.
    const fresh = newMemory(t0, 4.46);
    fresh.lastBarT = base[1].t;
    expect(manage(pos, detail(base, r, { ema9: 4.4 }), quote(4.47), t0 + 7 * 60_000, fresh).action).toBe('sellAll');
    expect(manage(pos, detail(base, r, { ema9: 4.4 }), quote(4.47), t0 + 7 * 60_000, fresh).reason).toMatch(/minutos/);
  });

  it('ventana horaria y lectura del JSON de Claude', () => {
    expect(inEntryWindow(at(8, 0), DEFAULT_RULES)).toBe(true);
    expect(inEntryWindow(at(13, 0), DEFAULT_RULES)).toBe(false);
    expect(parseDecision('Claro, acá va:\n{"decision":"enter","confidence":72,"reason":"Flag limpio.","stop":4.33}')).toMatchObject({ decision: 'enter', confidence: 72, stop: 4.33 });
    expect(parseDecision('{"sym": "runr", "reason": "la obvia"}')).toMatchObject({ decision: 'pick', sym: 'RUNR' });
    expect(parseDecision('no hay json')).toBeNull();
  });
});
