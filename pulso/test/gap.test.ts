// Pulso: Gap: las reglas puras (qué gap se arma, cuándo se dispara, cuántas acciones, cuándo se cubre) y el
// IA Trader en modo Gap con un mercado falso: vende en corto al romper el mínimo de la primera vela, cubre en
// el objetivo, y a la hora de quedar plano cubre lo que quedó.
import { describe, expect, it, vi } from 'vitest';
import { etDateTimeToTs } from '../src/engine/time';
import { openingCandle } from '../src/engine/metrics';
import { DEFAULT_SETTINGS, type Bar, type Quote, type ScanRow, type SymbolDetail, type TapePrint, type ViewModel } from '../src/engine/types';
import { DepthBook } from '../src/trading/depth';
import { atrOf, DEFAULT_GAP_RULES, GAP_PROFILES, gapExit, gapProfileOf, gapSetup, gapShares, gapTriggered } from '../src/trading/gap';
import type { Position } from '../src/trading/types';
import type { TrainingStore } from '../src/trading/store';
import type { DataSource, SourceHandlers } from '../src/client/source/types';
import { TrainingController } from '../src/client/training';

vi.mock('../src/client/lib/ai', () => ({ aiAvailable: () => Promise.resolve(null) }));
import { AiTrader } from '../src/client/aitrader';

const MIN = 60_000;
const DAY = '2026-10-23';
const at = (hhmm: string) => etDateTimeToTs(DAY, hhmm);
const store: TrainingStore = { kind: 'navegador', load: async () => ({ state: null, sessions: [] }), saveState: async () => {}, saveSession: async () => {}, clear: async () => {} };

class StaticBook extends DepthBook {
  sync(): void {}
}
const lvl = (price: number, ...sizes: number[]) => ({ price, rows: sizes.map((size, i) => ({ venue: ['NSDQ', 'ARCA'][i] ?? 'EDGX', size })) });

/** Un gap de 8 % cuya primera vela de 5 min cerró en rojo: abrió 10,50, máximo 10,80, mínimo 10,20, cierre 10,30. */
function gapRow(p: Partial<ScanRow> = {}): ScanRow {
  return {
    sym: 'GAP',
    price: 10.3,
    prevClose: 9.72,
    changePct: 6,
    gapPct: 8,
    volume: 3_000_000,
    rvol: 12,
    rvol5m: 8,
    float: 60_000_000,
    chg1m: -0.3,
    chg5m: -1.5,
    chg15m: -1.5,
    vol5m: 400_000,
    hod: 10.8,
    lod: 10.2,
    pctFromHod: -4.6,
    vwap: 10.45,
    hasNews: true,
    halted: false,
    score: 60,
    pillars: { price: true, change: true, rvol: true, news: true, float: false, score: 4 },
    bid: 10.29,
    ask: 10.3,
    ticks: 2000,
    lastTs: at('09:40'),
    dir: -1,
    avgVolume: 1_000_000,
    open5: { o: 10.5, h: 10.8, l: 10.2, c: 10.3, v: 2_000_000 },
    ...p,
  };
}

const stats = { atr: 0.8, avgOpen5: 30_000, source: 'servidor' as const };
const m = (h: number, mi: number) => h * 60 + mi;

describe('Pulso: Gap, reglas', () => {
  it('arma el gap con volumen cuya primera vela cerró en rojo: venta en el mínimo, stop en el máximo, objetivo en R', () => {
    const s = gapSetup(gapRow(), stats, m(9, 40), DEFAULT_GAP_RULES);
    expect(s.status).toBe('armado');
    expect(s).toMatchObject({ trigger: 10.2, stop: 10.8, target: 9.6, risk: 0.6 });
    expect(s.rvol).toBeCloseTo(66.7, 0);
    const r15 = gapSetup(gapRow(), stats, m(9, 40), GAP_PROFILES.rinde);
    expect(r15.target).toBeCloseTo(9.3, 2);
  });

  it('descarta el gap chico, el que no tiene volumen, el de primera vela verde y el riesgo fuera de rango; espera la primera vela', () => {
    expect(gapSetup(gapRow({ gapPct: 3 }), stats, m(9, 40), DEFAULT_GAP_RULES)).toMatchObject({ status: 'descartado', why: expect.stringMatching(/gap de 3\.0 %/) });
    expect(gapSetup(gapRow({ open5: { o: 10.5, h: 10.8, l: 10.2, c: 10.3, v: 100_000 } }), stats, m(9, 40), DEFAULT_GAP_RULES)).toMatchObject({ status: 'descartado', why: expect.stringMatching(/volumen de apertura 3\.3×/) });
    expect(gapSetup(gapRow({ open5: { o: 10.2, h: 10.8, l: 10.1, c: 10.6, v: 2_000_000 } }), stats, m(9, 40), DEFAULT_GAP_RULES)).toMatchObject({ status: 'descartado', why: expect.stringMatching(/no cerró en rojo/) });
    expect(gapSetup(gapRow(), { ...stats, atr: 0.3 }, m(9, 40), DEFAULT_GAP_RULES)).toMatchObject({ status: 'descartado', why: expect.stringMatching(/más de 1 ATR/) });
    expect(gapSetup(gapRow({ open5: undefined }), stats, m(9, 33), DEFAULT_GAP_RULES)).toMatchObject({ status: 'esperando' });
    expect(gapSetup(gapRow(), null, m(9, 40), DEFAULT_GAP_RULES)).toMatchObject({ status: 'esperando', why: expect.stringMatching(/estadísticas/) });
    expect(gapSetup(gapRow(), stats, m(15, 40), DEFAULT_GAP_RULES)).toMatchObject({ status: 'vencido' });
    expect(gapSetup(gapRow({ price: 4.5, prevClose: 4.1 }), stats, m(9, 40), DEFAULT_GAP_RULES)).toMatchObject({ status: 'descartado', why: expect.stringMatching(/precio/) });
  });

  it('se dispara al primer precio por debajo del mínimo de la primera vela, con tamaño por riesgo', () => {
    const s = gapSetup(gapRow(), stats, m(9, 40), DEFAULT_GAP_RULES);
    expect(gapTriggered(s, 10.25, 10.24)).toBe(false);
    expect(gapTriggered(s, 10.19, 10.18)).toBe(true);
    // Bid muy por encima del nivel (quedó un hueco): no se vende a cualquier precio.
    expect(gapTriggered(s, 10.19, 10.4)).toBe(false);
    expect(gapShares(50, 10.2, 10.8, 100_000)).toBe(83);
    expect(gapShares(50, 10.2, 10.8, 500)).toBe(49);
    expect(gapShares(50, 10.2, 10.2, 100_000)).toBe(0);
  });

  it('cubre en el stop, en el objetivo o a la hora de quedar plano', () => {
    const pos = { sym: 'GAP', side: 'short', shares: 80, avgCost: 10.19, openedAt: 0, boughtShares: 0, boughtCost: 0, soldShares: 80, soldValue: 815.2, fees: 0, realized: 0, initialStop: 10.8, stop: 10.8, target: 9.6, high: 10.3, low: 10.1 } as Position;
    expect(gapExit(pos, 10.5, m(10, 0), DEFAULT_GAP_RULES).action).toBe('hold');
    expect(gapExit(pos, 10.81, m(10, 0), DEFAULT_GAP_RULES)).toMatchObject({ action: 'cover', role: 'stop' });
    expect(gapExit(pos, 9.59, m(10, 0), DEFAULT_GAP_RULES)).toMatchObject({ action: 'cover', role: 'target' });
    expect(gapExit(pos, 10.5, m(15, 55), DEFAULT_GAP_RULES)).toMatchObject({ action: 'cover', role: 'eod' });
  });

  it('ATR, perfiles y la primera vela de 5 min armada con las de 1 min', () => {
    const daily = Array.from({ length: 20 }, (_, i) => ({ h: 11 + (i % 3) * 0.1, l: 10, c: 10.5 }));
    expect(atrOf(daily)).toBeCloseTo(1.1, 1);
    expect(atrOf(daily.slice(0, 3))).toBe(0);
    expect(gapProfileOf(DEFAULT_GAP_RULES)).toBe('seguro');
    expect(gapProfileOf({ ...DEFAULT_GAP_RULES, targetR: 1.5 })).toBe('rinde');
    expect(gapProfileOf({ ...DEFAULT_GAP_RULES, minRvol: 3 })).toBe('personalizado');
    const bar = (t: number, o: number, h: number, l: number, c: number, v: number): Bar => ({ t, o, h, l, c, v, pv: 0, n: 1 });
    const bars = [bar(at('09:29'), 10.4, 10.45, 10.35, 10.42, 50_000), bar(at('09:30'), 10.5, 10.7, 10.4, 10.6, 900_000), bar(at('09:32'), 10.6, 10.8, 10.3, 10.35, 700_000), bar(at('09:34'), 10.35, 10.4, 10.2, 10.3, 400_000), bar(at('09:35'), 10.3, 10.32, 10.1, 10.15, 300_000)];
    expect(openingCandle(bars, at('09:34'))).toBeNull();
    expect(openingCandle(bars, at('09:36'))).toEqual({ o: 10.5, h: 10.8, l: 10.2, c: 10.3, v: 2_000_000 });
  });
});

/** Fuente falsa: un gap armado, libro fijo y cotización que el test mueve. */
function fakeSource(start: number) {
  const r = gapRow();
  const quote: Quote = { sym: 'GAP', last: 10.3, bid: 10.29, ask: 10.3, bidSize: 500, askSize: 500, real: true, ts: start, halted: false, volPerMin: 100_000 };
  const book = new StaticBook(1);
  const setBook = () => {
    book.bids = [lvl(quote.bid, 2000, 2000), lvl(quote.bid - 0.01, 5000)];
    book.asks = [lvl(quote.ask, 2000, 2000), lvl(quote.ask + 0.01, 5000)];
  };
  setBook();
  const detail: SymbolDetail = { sym: 'GAP', ref: { sym: 'GAP', name: 'Gap Inc', avgVolume: 1_000_000 }, row: r, bars: [], secBars: [], tape: [], quote, open: 10.5, pmHigh: 10.9, lod: 10.2, ema9: 10.4, ema20: 10.45, macd: { macd: 0, signal: 0, hist: 0 }, news: [], setup: { aboveVwap: false, aboveEma9: false, aboveEma20: false, macdBullish: false, flag: undefined, nextLevel: 10.5 } };
  const tape: TapePrint[] = [];
  let seq = 0;
  let now = start;
  const daily: Bar[] = Array.from({ length: 20 }, (_, i) => ({ t: start - (20 - i) * 86_400_000, o: 9.7, h: 10.1, l: 9.3, c: 9.72, v: 1_000_000, pv: 0, n: 1 }));
  const src: DataSource & { tick(ms: number): number; move(last: number): void } = {
    kind: 'local',
    ready: true,
    depthIsReal: true,
    start: (_h: SourceHandlers) => {},
    stop: () => {},
    select: () => {},
    setSettings: () => {},
    setWatchlist: () => {},
    setTracked: () => {},
    setSpeed: () => {},
    search: async () => [],
    now: () => now,
    quote: (s) => (s === 'GAP' ? quote : null),
    row: (s) => (s === 'GAP' ? r : null),
    reviewBars: () => undefined,
    book: (s) => (s === 'GAP' ? book : null),
    printsSince: (_s, after) => tape.filter((p) => p.seq > after),
    lastSeq: () => seq,
    session: () => 'regular',
    history: async () => daily,
    focus: () => {},
    focusDetail: () => detail,
    tick(ms: number) {
      now += ms;
      return now;
    },
    move(last: number) {
      quote.last = last;
      quote.bid = Math.round((last - 0.01) * 100) / 100;
      quote.ask = last;
      r.price = last;
      setBook();
      tape.push({ seq: ++seq, ts: now, price: last, size: 500, side: 'mid' });
    },
  };
  return { src, quote, row: r };
}

function view(rows: ScanRow[]): ViewModel {
  return { ts: 0, session: 'regular', scanners: { gappers: rows, pillars: [], running: [], lowFloat: [], rvol: [], fades: [] }, watch: [], tracked: [], hodBoard: [], halts: [], stats: { tracked: 0, active: 0, eventsPerSec: 0 } };
}

async function arm(startAt = '09:40') {
  const c = new TrainingController(store, { state: null, sessions: [] }, 'local');
  c.updateSettings({ autoBracket: true, latencyMs: 100, account: 'margin' });
  c.setBalance(20_000);
  const f = fakeSource(at(startAt));
  c.attach(f.src);
  const t = new AiTrader(c, () => {}, { instructions: false });
  await Promise.resolve();
  t.attach(f.src);
  t.setView(view([f.row]), DEFAULT_SETTINGS);
  t.update({ mode: 'auto', consult: false, follow: false, strategy: 'gap', gapProfile: 'seguro' });
  const tick = (ms = 1000) => {
    const now = f.src.tick(ms);
    c.onTick(now);
    t.step(now);
    return now;
  };
  const flush = async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  };
  return { c, t, f, tick, flush, log: () => t.state.log.map((l) => l.text) };
}

describe('Pulso: Gap, el IA Trader', () => {
  it('ve el gap armado, vende en corto al romper el mínimo de la primera vela y cubre en el objetivo', async () => {
    const { c, t, f, tick, flush, log } = await arm();
    tick();
    await flush();
    tick();
    expect(t.state.gap[0]).toMatchObject({ sym: 'GAP', status: 'armado', trigger: 10.2, stop: 10.8, target: 9.6 });
    expect(t.state.phase).toBe('watching');
    expect(t.state.plan).toMatchObject({ sym: 'GAP', entry: 10.2, stop: 10.8, target: 9.6 });
    expect(c.broker!.orders('GAP')).toHaveLength(0);
    // Rompe el mínimo: venta en corto límite al bid, por el tamaño según el riesgo (0,5 % de 20.000 = $100 / 0,60).
    f.src.move(10.19);
    tick();
    const sell = c.broker!.orders('GAP').find((o) => o.side === 'sell');
    expect(sell).toMatchObject({ type: 'limit', shares: 160 });
    tick();
    const pos = c.broker!.position('GAP');
    expect(pos?.side).toBe('short');
    expect(pos?.shares).toBe(160);
    expect(pos?.stop).toBe(10.8);
    expect(pos?.target).toBe(9.6);
    expect(t.state.phase).toBe('inPosition');
    expect(log().some((x) => /Vende en corto 160 GAP/.test(x))).toBe(true);
    // Llega al objetivo: la orden OCO del bróker cubre (contra los prints que van pasando); la IA lo anota como cerrado con ganancia.
    for (let i = 0; i < 12 && c.broker!.position('GAP'); i++) {
      f.src.move(9.58);
      tick();
    }
    expect(c.broker!.position('GAP')).toBeUndefined();
    expect(c.active!.trades).toHaveLength(1);
    expect(c.active!.trades[0].net).toBeGreaterThan(0);
    tick();
    expect(log().some((x) => /GAP cerrado: \+\$/.test(x))).toBe(true);
    // La misma acción no se vuelve a operar hoy.
    f.src.move(10.1);
    tick();
    tick();
    expect(c.broker!.position('GAP')).toBeUndefined();
    expect(t.state.waiting).toMatch(/Ningún gap de hoy cumple|armado/);
  });

  it('a la hora de quedar plano cubre lo que quedó abierto', async () => {
    const { c, t, f, tick, flush, log } = await arm('15:20');
    tick();
    await flush();
    f.src.move(10.19);
    tick();
    tick();
    expect(c.broker!.position('GAP')?.side).toBe('short');
    // Ni stop ni objetivo hasta las 15:55: ahí se cancela lo que había y se cubre al ask.
    f.src.move(10.3);
    tick(36 * MIN);
    tick();
    expect(log().some((x) => /cubre el corto/.test(x))).toBe(true);
    for (let i = 0; i < 12 && c.broker!.position('GAP'); i++) {
      f.src.move(10.3);
      tick();
    }
    expect(c.broker!.position('GAP')).toBeUndefined();
    expect(c.active!.trades[0].net).toBeLessThan(0);
    expect(t.state.pausedReason).toMatch(/plano/);
  });
});
