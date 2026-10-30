// El IA Trader con varias acciones en el mercado falso: dos posiciones a la vez (tope del perfil,
// riesgo abierto, nunca la misma acción, no abrir otra mientras una pierde), agregar a la ganadora,
// memoria del día (frenos, perdedores, setups que se evitan), reentradas y el resumen del día de Claude.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { etDateTimeToTs } from '../src/engine/time';
import { DEFAULT_SETTINGS, type Bar, type Quote, type ScanRow, type SymbolDetail, type TapePrint, type ViewModel } from '../src/engine/types';
import { DepthBook } from '../src/trading/depth';
import type { TrainingStore } from '../src/trading/store';
import type { DataSource, SourceHandlers } from '../src/client/source/types';
import { TrainingController } from '../src/client/training';

const ai = vi.hoisted(() => ({ ask: vi.fn<(system: string, prompt: string) => Promise<string>>() }));
vi.mock('../src/client/lib/ai', () => ({ aiAvailable: () => Promise.resolve({ via: 'servidor', ask: ai.ask }) }));

import { AiTrader, avoidedSetups, newDayMemory, penalized, symDay } from '../src/client/aitrader';

const store: TrainingStore = { kind: 'navegador', load: async () => ({ state: null, sessions: [] }), saveState: async () => {}, saveSession: async () => {}, clear: async () => {} };

class StaticBook extends DepthBook {
  sync(): void {}
}
const lvl = (price: number, ...sizes: number[]) => ({ price, rows: sizes.map((size, i) => ({ venue: ['NSDQ', 'ARCA'][i] ?? 'EDGX', size })) });

const T0 = etDateTimeToTs('2026-10-23', '10:00');
const MIN = 60_000;
const r2 = (v: number) => Math.round(v * 100) / 100;

function row(sym: string, price: number, extra: Partial<ScanRow> = {}): ScanRow {
  return {
    sym,
    price,
    prevClose: price / 1.5,
    changePct: 50,
    gapPct: 20,
    volume: 5_000_000,
    rvol: 20,
    rvol5m: 10,
    float: 3_000_000,
    chg1m: 0.5,
    chg5m: 2,
    chg15m: 5,
    vol5m: 400_000,
    hod: price,
    lod: price * 0.8,
    pctFromHod: 0,
    vwap: price * 0.95,
    hasNews: true,
    halted: false,
    score: 90,
    pillars: { price: true, change: true, rvol: true, news: true, float: true, score: 5 },
    bid: price - 0.01,
    ask: price,
    ticks: 1000,
    lastTs: T0,
    dir: 1,
    ...extra,
  };
}

function flatBars(price: number): Bar[] {
  return Array.from({ length: 6 }, (_, i) => ({ t: T0 - (6 - i) * MIN, o: price - 0.05, h: price, l: price - 0.08, c: price - 0.01, v: 30_000, pv: 0, n: 100 }));
}

interface Fake {
  sym: string;
  quote: Quote;
  book: StaticBook;
  detail: SymbolDetail;
}

/** Una acción del mercado falso: bull flag armado (stop 10 ¢ abajo del precio: 11 ¢ desde el ask), máximo del día 20 ¢ arriba, libro fijo y cotización que el test mueve. */
function fakeSym(sym: string, price: number, extra: Partial<ScanRow> = {}): Fake {
  const quote: Quote = { sym, last: price, bid: price, ask: r2(price + 0.01), bidSize: 500, askSize: 200, real: true, ts: T0, halted: false, volPerMin: 100_000 };
  const book = new StaticBook(1);
  book.bids = [lvl(price, 300, 200), lvl(r2(price - 0.01), 500), lvl(r2(price - 0.03), 1000)];
  book.asks = [lvl(r2(price + 0.01), 5000), lvl(r2(price + 0.02), 5000), lvl(r2(price + 0.06), 20000)];
  const r = row(sym, price, { hod: r2(price + 0.2), pctFromHod: -4, ...extra });
  const stop = r2(price - 0.1);
  const detail: SymbolDetail = {
    sym,
    ref: { sym, name: `${sym} Inc` },
    row: r,
    bars: flatBars(price),
    secBars: [],
    tape: [],
    quote,
    open: price * 0.9,
    pmHigh: price * 0.95,
    lod: price * 0.8,
    ema9: price * 0.97,
    ema20: price * 0.94,
    macd: { macd: 1, signal: 0.5, hist: 0.5 },
    news: [],
    setup: { aboveVwap: true, aboveEma9: true, aboveEma20: true, macdBullish: true, flag: { entry: price, stop, target: r2(price + 0.22), poleHigh: price, armedAt: T0 - MIN }, nextLevel: price + 0.5 },
  };
  return { sym, quote, book, detail };
}

/** Mueve la cotización (y el bid del libro) de una acción falsa. */
function move(f: Fake, last: number): void {
  f.quote.last = last;
  f.quote.bid = r2(last - 0.01);
  f.quote.ask = r2(last + 0.01);
  f.book.bids = [lvl(f.quote.bid, 5000), lvl(r2(last - 0.03), 5000)];
  f.book.asks = [lvl(f.quote.ask, 5000), lvl(r2(last + 0.03), 5000)];
  f.detail.row.price = last;
  f.detail.row.bid = f.quote.bid;
  f.detail.row.ask = f.quote.ask;
}

function fakeSource(syms: Fake[]) {
  const by = new Map(syms.map((f) => [f.sym, f]));
  let now = T0;
  let focus: string | null = null;
  let seq = 0;
  const tape: TapePrint[] = [];
  const src: DataSource & { tick(ms: number): number; focused(): string | null } = {
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
    quote: (s) => by.get(s)?.quote ?? null,
    row: (s) => by.get(s)?.detail.row ?? null,
    reviewBars: () => undefined,
    book: (s) => by.get(s)?.book ?? null,
    printsSince: (_s, after) => tape.filter((p) => p.seq > after),
    lastSeq: () => seq,
    session: () => 'regular',
    focus: (s) => {
      focus = s;
    },
    focusDetail: () => (focus ? (by.get(focus)?.detail ?? null) : null),
    tick(ms: number) {
      now += ms;
      return now;
    },
    focused: () => focus,
  };
  return { src, print: (sym: string, price: number, size: number, side: TapePrint['side']) => tape.push({ seq: ++seq, ts: now, price, size, side }) };
}

function view(rows: ScanRow[]): ViewModel {
  return { ts: T0, session: 'regular', scanners: { gappers: rows, pillars: [], running: [], lowFloat: [], rvol: [], fades: [] }, watch: [], tracked: [], hodBoard: [], halts: [], stats: { tracked: 0, active: 0, eventsPerSec: 0 } };
}

/** Cuenta margen de US$ 30.000 (sin regla PDT) con riesgo fijo de US$ 20 por trade, dos acciones con bull flag y el IA Trader en automático. */
async function arm(opts: { consult?: boolean; autoBracket?: boolean; syms?: Fake[]; profile?: 'conservador' | 'equilibrado' | 'agresivo' } = {}) {
  const c = new TrainingController(store, { state: null, sessions: [] }, 'local');
  c.updateSettings({ autoBracket: opts.autoBracket ?? false, latencyMs: 100, account: 'margin', sizing: 'fijo', defaultRisk: 20 });
  c.setBalance(30_000);
  const syms = opts.syms ?? [fakeSym('RUN', 3.0), fakeSym('ABC', 5.0)];
  const f = fakeSource(syms);
  c.attach(f.src);
  const selected: string[] = [];
  const t = new AiTrader(c, (s) => selected.push(s));
  await Promise.resolve();
  t.attach(f.src);
  t.setView(view(syms.map((s) => s.detail.row)), DEFAULT_SETTINGS);
  t.update({ mode: 'auto', consult: opts.consult ?? false, profile: opts.profile ?? 'equilibrado' });
  const tick = (ms = 1000) => {
    const now = f.src.tick(ms);
    c.onTick(now);
    t.step(now);
    return now;
  };
  const flush = async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  };
  /** Compras de una acción, vivas o ya terminadas (en el historial del día). */
  const buys = (sym: string) => [...(c.active?.history ?? []), ...(c.broker?.orders(sym) ?? [])].filter((o) => o.sym === sym && o.side === 'buy' && o.status !== 'rejected');
  return { c, t, f, syms, tick, flush, selected, buys, log: () => t.state.log.map((l) => l.text) };
}

beforeEach(() => {
  ai.ask.mockReset();
});

describe('dos posiciones a la vez', () => {
  it('equilibrado: entra en la mejor, sigue mirando la segunda y entra también; con el tope lleno espera; nunca dos veces la misma', async () => {
    const { c, t, tick, buys } = await arm();
    expect(t.settings.rules.maxPositions).toBe(2);
    tick();
    expect(t.state.phase).toBe('entering');
    expect(buys('RUN')).toHaveLength(1);
    // Con RUN comprada mira ABC (la mejor que no tiene) y entra también.
    tick();
    expect(c.broker!.position('RUN')?.shares).toBe(180);
    expect(t.state.phase).toBe('inPosition');
    expect(buys('ABC')).toHaveLength(1);
    tick();
    expect(c.broker!.position('ABC')?.shares).toBeGreaterThan(0);
    expect(t.state.positions.map((p) => p.sym).sort()).toEqual(['ABC', 'RUN']);
    expect(t.state.positions.every((p) => Number.isFinite(p.r) && p.stop !== null)).toBe(true);
    expect(t.state.waiting).toMatch(/Ya maneja 2 posiciones/);
    // Varios segundos más: sigue manejando las dos y no compra de nuevo ninguna.
    for (let i = 0; i < 5; i++) tick();
    expect(buys('RUN')).toHaveLength(1);
    expect(buys('ABC')).toHaveLength(1);
    expect(t.state.phase).toBe('inPosition');
  });

  it('conservador maneja una sola; agresivo hasta tres (pero no repite acción)', async () => {
    const cons = await arm({ profile: 'conservador' });
    cons.tick();
    cons.tick();
    cons.tick();
    expect(cons.c.broker!.position('RUN')).toBeDefined();
    expect(cons.buys('ABC')).toHaveLength(0);
    expect(cons.t.state.waiting).toBe('');
    const agg = await arm({ profile: 'agresivo' });
    expect(agg.t.settings.rules.maxPositions).toBe(3);
    for (let i = 0; i < 4; i++) agg.tick();
    expect(agg.c.broker!.position('RUN')).toBeDefined();
    expect(agg.c.broker!.position('ABC')).toBeDefined();
    expect(agg.buys('RUN')).toHaveLength(1);
    expect(agg.buys('ABC')).toHaveLength(1);
    expect(agg.t.state.waiting).toMatch(/Sin candidatas|no llega/);
  });

  it('no abre otra mientras una va perdiendo más de 0,5R; cuando se recupera, entra', async () => {
    const run = fakeSym('RUN', 3.0);
    const abc = fakeSym('ABC', 5.0);
    // ABC recién arma su setup cuando RUN ya está comprada.
    const flag = abc.detail.setup.flag;
    abc.detail.setup.flag = undefined;
    const { c, t, tick, buys } = await arm({ syms: [run, abc] });
    tick();
    tick();
    expect(c.broker!.position('RUN')?.shares).toBe(180);
    // RUN cae a 2,93: va perdiendo 0,7R (sin tocar el stop de 2,90).
    move(run, 2.93);
    abc.detail.setup.flag = flag;
    tick();
    expect(t.state.waiting).toMatch(/RUN va perdiendo más de 0,5R/);
    tick();
    expect(buys('ABC')).toHaveLength(0);
    // Se recupera: ahora sí entra en ABC.
    move(run, 3.05);
    tick();
    expect(buys('ABC')).toHaveLength(1);
  });

  it('el riesgo abierto total respeta el tope del perfil: con 1R abierto espera, y con el stop en la entrada (cuenta 0) entra', async () => {
    const { c, t, syms, tick, buys, log } = await arm({ autoBracket: true });
    const [run] = syms;
    t.update({ rules: { ...t.settings.rules, maxOpenRiskR: 1 } });
    tick();
    tick();
    expect(c.broker!.position('RUN')?.shares).toBe(180);
    tick();
    expect(buys('ABC')).toHaveLength(0);
    expect(t.state.waiting).toMatch(/riesgo abierto está al tope/);
    expect(t.state.plan).toMatchObject({ sym: 'ABC', note: expect.stringMatching(/riesgo abierto/) });
    // RUN llega al objetivo: vende la mitad, el stop sube a la entrada y el riesgo abierto queda en 0: entra en ABC.
    move(run, 3.24);
    tick();
    tick();
    expect(c.broker!.position('RUN')?.shares).toBe(90);
    tick(31_000);
    expect(log().some((x) => /RUN: stop a la entrada/.test(x))).toBe(true);
    expect(buys('ABC')).toHaveLength(1);
  });

  it('con 2R de riesgo abierto, la segunda posición se achica para no pasarse', async () => {
    const { c, t, tick, buys, log } = await arm();
    t.update({ rules: { ...t.settings.rules, maxOpenRiskR: 1.5 } });
    tick();
    tick();
    expect(c.broker!.position('RUN')?.shares).toBe(180);
    expect(buys('ABC')).toHaveLength(1);
    // RUN tiene 180 × 0,11 = $19,8 abiertos; quedan $10,2 → 10,2 / 0,11 (5,01 − 4,90) = 92 acciones (menos de 100: sin lote).
    expect(buys('ABC')[0].shares).toBe(92);
    expect(log().some((x) => /el tamaño baja de/.test(x))).toBe(true);
  });

  it('askNow y reset() funcionan con dos posiciones', async () => {
    ai.ask.mockResolvedValue('{"decision":"hold","reason":"dejala correr"}');
    const { c, t, tick } = await arm();
    for (let i = 0; i < 3; i++) tick();
    expect(t.state.positions).toHaveLength(2);
    await t.askNow();
    expect(ai.ask).toHaveBeenCalledTimes(1);
    expect(ai.ask.mock.calls[0][1]).toMatch(/Posición: 180 acciones/);
    expect(t.state.advice?.decision).toBe('hold');
    c.newDay({ clock: 'practice' });
    expect(t.state.positions).toEqual([]);
    expect(t.state.phase).toBe('scanning');
    expect(t.state.day.trades).toBe(0);
  });
});

describe('agregar a la ganadora', () => {
  /** Velas de 1 min con subida, dos velas rojas de retroceso y la vela actual rompiendo el máximo de la anterior (stop 3,24: el mínimo del retroceso 3,27 queda más cerca que el rango de una vela, 0,10). */
  function newHighBars(t: number): Bar[] {
    const bar = (i: number, o: number, h: number, l: number, c: number, v: number): Bar => ({ t: t + i * MIN, o, h, l, c, v, pv: c * v, n: 10 });
    return [bar(0, 3.0, 3.1, 2.98, 3.09, 40_000), bar(1, 3.09, 3.22, 3.08, 3.21, 45_000), bar(2, 3.21, 3.32, 3.2, 3.3, 50_000), bar(3, 3.3, 3.4, 3.29, 3.38, 60_000), bar(4, 3.38, 3.39, 3.3, 3.32, 70_000), bar(5, 3.32, 3.33, 3.27, 3.31, 80_000), bar(6, 3.31, 3.36, 3.27, 3.33, 20_000)];
  }

  it('con la mitad tomada y el stop en la entrada, otro setup agrega una vez (sin pasar el tamaño original) y sube el stop de toda la posición', async () => {
    const run = fakeSym('RUN', 3.0);
    const { c, t, tick, buys, log } = await arm({ autoBracket: true, syms: [run] });
    tick();
    tick();
    expect(c.broker!.position('RUN')?.shares).toBe(180);
    // Objetivo: la mitad afuera y el stop a la entrada.
    move(run, 3.24);
    tick();
    tick();
    expect(c.broker!.position('RUN')?.shares).toBe(90);
    expect(log().some((x) => /stop a la entrada/.test(x))).toBe(true);
    // Aparece la primera vela de 1 min con máximo nuevo tras dos velas rojas: se agrega con el stop en 3,24.
    const now = t.state.since;
    run.detail.bars = newHighBars(now - 7 * MIN);
    run.detail.row.hod = 3.4;
    run.detail.row.pctFromHod = -2;
    move(run, 3.33);
    run.quote.ask = 3.34;
    tick();
    expect(buys('RUN')).toHaveLength(2);
    expect(buys('RUN')[1].shares).toBe(180);
    expect(log().some((x) => /RUN: agrega 180 a \$3\.3\d/.test(x))).toBe(true);
    tick();
    const pos = c.broker!.position('RUN')!;
    expect(pos.shares).toBe(270);
    const stop = c.broker!.orders('RUN').find((o) => o.role === 'stop')!;
    expect(stop.stopPrice).toBe(3.24);
    expect(stop.shares).toBe(270);
    expect(t.state.positions[0]).toMatchObject({ sym: 'RUN', shares: 270, added: true, stop: 3.24 });
    // No se agrega una segunda vez aunque el setup siga ahí.
    for (let i = 0; i < 3; i++) tick();
    expect(buys('RUN')).toHaveLength(2);
  });
});

describe('memoria del día', () => {
  it('cuenta frenos por episodio y baja 15 puntos a una acción con 2 frenos; con 2 perdedores también', () => {
    const day = newDayMemory();
    const d = symDay(day, 'XYZ');
    expect(penalized(day, 'XYZ')).toBe(false);
    d.brakes = 2;
    expect(penalized(day, 'XYZ')).toBe(true);
    const other = symDay(day, 'ABC');
    other.losers = 2;
    expect(penalized(day, 'ABC')).toBe(true);
    day.setups.microPullback = { trades: 2, wins: 0, losers: 2, netR: -2 };
    day.setups.bullFlag = { trades: 2, wins: 1, losers: 1, netR: 1 };
    expect([...avoidedSetups(day)]).toEqual(['microPullback']);
  });

  it('un spread ancho frena y se cuenta una vez por episodio; al segundo freno la acción baja en el ranking', async () => {
    const run = fakeSym('RUN', 3.0);
    const abc = fakeSym('ABC', 5.0, { rvol: 4, hasNews: false, pctFromHod: -5 });
    const { t, tick, buys } = await arm({ syms: [run, abc] });
    // RUN con el spread al 3 %: no entra, cuenta un freno.
    run.quote.ask = 3.1;
    run.quote.bid = 3.0;
    tick();
    expect(t.state.focus).toBe('RUN');
    expect(t.state.waiting).toMatch(/spread de 3\.\d % \(más de 2 %\)/);
    tick();
    tick();
    expect(t.day.syms.RUN.brakes).toBe(1);
    expect(buys('RUN')).toHaveLength(0);
    // Se cierra el spread un rato (sin setup: el banderín se desarmó) y vuelve a abrirse: segundo episodio.
    run.quote.ask = 3.01;
    run.quote.bid = 3.0;
    run.detail.setup.flag = undefined;
    tick();
    expect(t.day.syms.RUN.lastBrake).toBe('');
    run.quote.ask = 3.1;
    tick();
    expect(t.day.syms.RUN.brakes).toBe(2);
    tick(6000);
    const cand = t.state.candidates.find((c) => c.sym === 'RUN')!;
    expect(cand.warnings).toContain('2 frenos hoy');
    expect(t.state.day.avoid).toContain('RUN');
  });

  it('dos perdedores en un tipo de setup lo evitan el resto del día (el agresivo solo lo baja de prioridad); dos perdedores en la acción la bajan 15 puntos', async () => {
    for (const profile of ['equilibrado', 'agresivo'] as const) {
      const run = fakeSym('RUN', 3.0);
      const abc = fakeSym('ABC', 5.0);
      // ABC todavía no tiene setup: recién después de los dos stops en RUN se le arma el bull flag.
      const flag = abc.detail.setup.flag;
      abc.detail.setup.flag = undefined;
      const { c, t, tick, buys, log } = await arm({ syms: [run, abc], profile });
      const shares = profile === 'agresivo' ? 270 : 180;
      // Dos stops seguidos en RUN (bull flag): la memoria del día anota dos perdedores en RUN y en el bull flag.
      for (let i = 0; i < 2; i++) {
        move(run, 3.0);
        run.quote.ask = 3.01;
        tick(i === 0 ? 1000 : 4 * MIN);
        tick();
        expect(c.broker!.position('RUN')?.shares).toBe(shares);
        move(run, 2.88);
        tick();
        tick();
        expect(c.broker!.position('RUN')).toBeUndefined();
        tick();
      }
      abc.detail.setup.flag = flag;
      expect(t.day.syms.RUN.losers).toBe(2);
      expect(t.day.setups.bullFlag).toMatchObject({ losers: 2, wins: 0 });
      expect(t.state.day).toMatchObject({ trades: 2, wins: 0 });
      expect(t.state.day.avoid).toEqual(expect.arrayContaining(['RUN', 'bull flag']));
      expect(log().some((x) => /RUN: dos perdedores hoy; baja 15 puntos/.test(x))).toBe(true);
      // Ahora ABC es la mejor (RUN perdió 15 puntos) y su setup es un bull flag.
      tick(30_000);
      expect(t.state.candidates[0].sym).toBe('ABC');
      expect(t.state.focus).toBe('ABC');
      if (profile === 'equilibrado') {
        expect(buys('ABC')).toHaveLength(0);
        expect(t.state.waiting).toMatch(/hoy evita bull flag/);
      } else {
        expect(buys('ABC')).toHaveLength(1);
        expect(log().some((x) => /baja de prioridad/.test(x))).toBe(true);
      }
    }
  });
});

describe('reentradas inteligentes', () => {
  it('tras un stop, si sostiene el VWAP y arma otro setup, reentra con el mismo tamaño (hasta 2 veces por acción); el conservador no', async () => {
    const run = fakeSym('RUN', 3.0);
    const { c, t, tick, buys, log } = await arm({ syms: [run], profile: 'agresivo' });
    const stopOut = () => {
      move(run, 3.0);
      run.quote.ask = 3.01;
      tick();
      tick();
      expect(c.broker!.position('RUN')?.shares).toBe(270);
      move(run, 2.88);
      tick();
      tick();
      expect(c.broker!.position('RUN')).toBeUndefined();
      tick();
    };
    tick(0);
    stopOut();
    expect(buys('RUN')).toHaveLength(1);
    // A los 60 s todavía no (espera 90 s y dos velas sobre VWAP); a los 2 min (el agresivo reconsidera el mismo plan a los 90 s) reentra.
    move(run, 3.0);
    run.quote.ask = 3.01;
    tick(60_000);
    expect(t.state.waiting).toMatch(/segunda chance/);
    expect(buys('RUN')).toHaveLength(1);
    tick(MIN + 5000);
    expect(buys('RUN')).toHaveLength(2);
    expect(buys('RUN')[1].shares).toBe(270);
    expect(log().some((x) => /Segunda chance en RUN/.test(x))).toBe(true);
    expect(t.day.syms.RUN.reentries).toBe(1);
    tick();
    expect(t.state.positions[0]).toMatchObject({ sym: 'RUN', secondChance: true });
    // Pierde de nuevo: segunda y última reentrada; a la tercera pérdida se deja pasar 5 min.
    move(run, 2.88);
    tick();
    tick();
    tick();
    move(run, 3.0);
    run.quote.ask = 3.01;
    tick(2 * MIN + 5000);
    expect(buys('RUN')).toHaveLength(3);
    tick();
    move(run, 2.88);
    tick();
    tick();
    tick();
    move(run, 3.0);
    run.quote.ask = 3.01;
    tick(2 * MIN + 5000);
    expect(buys('RUN')).toHaveLength(3);
    expect(t.state.waiting).toMatch(/se deja pasar hasta/);
    // Conservador: después del stop, 5 minutos sin volver.
    const cons = await arm({ syms: [fakeSym('RUN', 3.0)], profile: 'conservador' });
    cons.tick();
    cons.tick();
    move(cons.syms[0], 2.88);
    cons.tick();
    cons.tick();
    cons.tick();
    expect(cons.c.broker!.position('RUN')).toBeUndefined();
    move(cons.syms[0], 3.0);
    cons.tick(3 * MIN);
    expect(cons.t.state.waiting).toMatch(/se deja pasar hasta/);
    expect(cons.buys('RUN')).toHaveLength(1);
  });
});

describe('Claude con más contexto y menos costo', () => {
  it('no le pregunta cuál mirar cuando la mejor saca 80 o más, y la consulta de entrada lleva las velas de 10 s y el libro', async () => {
    ai.ask.mockResolvedValue('{"decision":"enter","confidence":80,"reason":"dale"}');
    const run = fakeSym('RUN', 3.0);
    run.detail.secBars = Array.from({ length: 14 }, (_, i) => ({ t: T0 - (14 - i) * 10_000, o: 2.98, h: 3.0, l: 2.97, c: 2.99, v: 1200, pv: 0, n: 5 }));
    const { t, tick, flush } = await arm({ consult: true, syms: [run, fakeSym('ABC', 5.0)] });
    tick();
    await flush();
    expect(t.state.candidates[0].score).toBeGreaterThanOrEqual(80);
    const prompts = ai.ask.mock.calls.map(([, p]) => p);
    expect(prompts.some((p) => /Elegí una sola/.test(p))).toBe(false);
    const entry = prompts.find((p) => /Las reglas proponen/.test(p))!;
    expect(entry).toMatch(/Velas de 10 s \(las últimas 12/);
    expect(entry).toMatch(/Libro: bids 3\.00×500, 2\.99×500, 2\.97×1K · asks 3\.01×5K/);
    expect(t.state.phase).toBe('entering');
  });

  it('con candidatas flojas sí elige entre ellas', async () => {
    ai.ask.mockResolvedValue('{"sym":"ABC","reason":"la obvia"}');
    const run = fakeSym('RUN', 3.0, { rvol: 4, hasNews: false, pctFromHod: -5 });
    const abc = fakeSym('ABC', 5.0, { rvol: 4, hasNews: false, pctFromHod: -5 });
    const { t, tick, flush } = await arm({ consult: true, syms: [run, abc] });
    tick();
    await flush();
    expect(t.state.candidates[0].score).toBeLessThan(80);
    expect(ai.ask.mock.calls.some(([, p]) => /Elegí una sola/.test(p))).toBe(true);
  });

  it('al terminar el día pide un resumen una sola vez, lo muestra y lo cuenta en el presupuesto', async () => {
    ai.ask.mockResolvedValue('{"summary":"Operó RUN con un bull flag y lo paró el stop. Mañana esperá el micro pullback."}');
    const run = fakeSym('RUN', 3.0);
    const { c, t, tick, flush, log } = await arm({ consult: false, syms: [run] });
    tick();
    tick();
    move(run, 2.85);
    tick();
    tick();
    tick();
    expect(c.active!.trades).toHaveLength(1);
    // Sin consultar a Claude no hay resumen; con "consultar" activo, el cambio de día lo pide.
    t.update({ consult: true });
    c.newDay({ clock: 'practice' });
    await flush();
    expect(ai.ask).toHaveBeenCalledTimes(1);
    expect(ai.ask.mock.calls[0][1]).toMatch(/terminó el día del IA Trader \(perfil equilibrado\)/);
    expect(ai.ask.mock.calls[0][1]).toMatch(/RUN 180 acc\./);
    expect(t.state.daySummary).toMatch(/Operó RUN/);
    expect(t.state.calls).toBe(1);
    expect(log().some((x) => /Resumen del día \(Claude\): Operó RUN/.test(x))).toBe(true);
    // El mismo día no se resume dos veces.
    c.newDay({ clock: 'practice' });
    await flush();
    expect(ai.ask).toHaveBeenCalledTimes(1);
  });

  it('al cierre del mercado (16:00 NY) se para y pide el resumen', async () => {
    ai.ask.mockResolvedValue('{"summary":"Día flojo."}');
    const run = fakeSym('RUN', 3.0);
    const { c, t, tick, flush } = await arm({ consult: true, syms: [run] });
    t.update({ consult: false });
    tick();
    tick();
    move(run, 2.85);
    tick();
    tick();
    tick();
    expect(c.active!.trades).toHaveLength(1);
    t.update({ consult: true });
    ai.ask.mockClear();
    tick(6 * 60 * MIN + 5 * MIN);
    await flush();
    expect(t.state.phase).toBe('paused');
    expect(t.state.pausedReason).toMatch(/Cerró el mercado/);
    expect(ai.ask).toHaveBeenCalledTimes(1);
    expect(t.state.daySummary).toBe('Día flojo.');
  });
});

describe('indicaciones del trader', () => {
  it('un nivel ("si ABCD supera 3,50") sigue la acción aunque no esté en el escáner, entra al cruzar con volumen sobre VWAP y queda cumplido', async () => {
    const abcd = fakeSym('ABCD', 3.4);
    abcd.detail.setup.flag = undefined;
    const { c, t, tick, buys, log } = await arm({ syms: [abcd] });
    // ABCD no está en ningún escáner: solo la fuente la conoce.
    t.setView(view([]), DEFAULT_SETTINGS);
    tick();
    expect(t.state.candidates).toHaveLength(0);
    const ins = await t.addInstruction('si ABCD supera 3,50 me interesa comprar');
    expect(ins?.rule).toEqual({ kind: 'level', sym: 'ABCD', price: 3.5, side: 'above' });
    expect(ins?.by).toBe('reglas');
    expect(log().some((x) => /Indicación: ABCD: comprar si supera 3,50/.test(x))).toBe(true);
    tick(6000);
    expect(t.state.candidates.map((x) => x.sym)).toEqual(['ABCD']);
    expect(t.state.candidates[0].reasons).toContain('indicación tuya');
    expect(t.state.focus).toBe('ABCD');
    tick();
    expect(buys('ABCD')).toHaveLength(0);
    expect(t.state.waiting).toMatch(/Esperando un setup limpio en ABCD/);
    // Cruza el nivel (ask 3,53) con la última vela trayendo volumen y sobre VWAP: entra con el stop a 3 % del nivel.
    move(abcd, 3.52);
    tick();
    expect(buys('ABCD')).toHaveLength(1);
    const buy = buys('ABCD')[0];
    expect(buy.setup).toBe('IA · Nivel del trader');
    expect(buy.plan?.stop).toBeCloseTo(3.4, 1);
    expect(buy.plan?.target).toBeGreaterThan(3.7);
    expect(log().some((x) => /Compra \d+ ABCD .*Nivel del trader/.test(x))).toBe(true);
    expect(log().some((x) => /Indicación cumplida: ABCD: comprar si supera 3,50/.test(x))).toBe(true);
    expect(t.instructions[0].done).toBe(true);
    tick();
    expect(c.broker!.position('ABCD')?.shares).toBeGreaterThan(0);
    // Lo para el stop; vuelve a cruzar el nivel y no vuelve a disparar (la indicación ya se cumplió).
    move(abcd, 3.3);
    tick();
    tick();
    expect(c.broker!.position('ABCD')).toBeUndefined();
    tick();
    move(abcd, 3.52);
    tick(4 * MIN);
    tick();
    expect(buys('ABCD')).toHaveLength(1);
  });

  it('"no operes RUN hoy" la saca del ranking y nunca la compra; "mirá" la mete aunque el escáner no la tenga', async () => {
    const run = fakeSym('RUN', 3.0);
    const abc = fakeSym('ABC', 5.0);
    const { t, tick, buys } = await arm({ syms: [run, abc] });
    await t.addInstruction('no operes RUN hoy');
    tick();
    expect(t.state.candidates.map((x) => x.sym)).toEqual(['ABC']);
    tick();
    tick();
    expect(buys('RUN')).toHaveLength(0);
    expect(buys('ABC')).toHaveLength(1);
    // "mirá DEF": entra al ranking con la fila de la fuente aunque no esté en ningún escáner.
    const def = fakeSym('DEF', 4.0, { changePct: 3, rvol: 1.5, hasNews: false });
    const w = await arm({ syms: [def] });
    w.t.setView(view([]), DEFAULT_SETTINGS);
    w.tick();
    expect(w.t.state.candidates).toHaveLength(0);
    await w.t.addInstruction('mirá DEF aunque no esté en el escáner');
    w.tick(6000);
    expect(w.t.state.candidates.map((x) => x.sym)).toEqual(['DEF']);
    expect(w.t.state.candidates[0].score).toBeGreaterThanOrEqual(w.t.settings.rules.minScore);
    expect(w.t.state.focus).toBe('DEF');
  });

  it('"después de las 9 no entres" acota el horario del perfil; "máximo 1 trade" para después del primero; "solo micro pullbacks" deja pasar el bull flag', async () => {
    const win = await arm();
    await win.t.addInstruction('después de las 9 no entres');
    win.tick();
    win.tick();
    expect(win.t.state.waiting).toMatch(/Fuera del horario de entradas que pediste \(7:00 a 9:00 NY\)/);
    expect(win.buys('RUN')).toHaveLength(0);

    const run = fakeSym('RUN', 3.0);
    const max = await arm({ syms: [run] });
    await max.t.addInstruction('máximo 1 trade hoy');
    expect(max.t.instructions[0].rule).toEqual({ kind: 'maxTrades', n: 1 });
    max.tick();
    max.tick();
    expect(max.c.broker!.position('RUN')?.shares).toBe(180);
    move(run, 2.85);
    max.tick();
    max.tick();
    expect(max.c.active!.trades).toHaveLength(1);
    // El bull flag se vuelve a armar, pero el único trade del día ya se hizo: queda parado por hoy.
    move(run, 3.0);
    max.tick(4 * MIN);
    expect(max.t.state.phase).toBe('paused');
    expect(max.t.state.pausedReason).toMatch(/Ya hubo 1 trades hoy.*el tope que pediste/);
    expect(max.buys('RUN')).toHaveLength(1);

    const only = await arm();
    await only.t.addInstruction('hoy solo micro pullbacks');
    only.tick();
    only.tick();
    expect(only.buys('RUN')).toHaveLength(0);
    expect(only.t.state.waiting).toMatch(/hoy evita bull flag/);
  });

  it('con IA, Claude convierte la indicación en regla (una consulta) y todas van en el prompt de cada entrada; si no la entiende, quedan las reglas', async () => {
    ai.ask.mockImplementation(async (_s, prompt) => (/Convertila en una sola regla/.test(prompt) ? '{"kind":"avoid","sym":"ZZZZ"}' : '{"decision":"enter","confidence":80,"reason":"dale"}'));
    const { t, tick, flush, log } = await arm({ consult: true, syms: [fakeSym('RUN', 3.0)] });
    const a = await t.addInstruction('no operes ZZZZ hoy');
    expect(a).toMatchObject({ by: 'claude', rule: { kind: 'avoid', sym: 'ZZZZ' } });
    expect(t.state.calls).toBe(1);
    expect(log().some((x) => /Claude entendió "no operes ZZZZ hoy" como: ZZZZ: no se opera/.test(x))).toBe(true);
    ai.ask.mockImplementationOnce(async () => 'ni idea');
    const b = await t.addInstruction('ojo con las extensiones');
    expect(b).toMatchObject({ by: 'reglas', rule: { kind: 'note' } });
    tick();
    await flush();
    const entry = ai.ask.mock.calls.map(([, p]) => p).find((p) => /Las reglas proponen/.test(p))!;
    expect(entry).toMatch(/Indicaciones del trader[^\n]*\n- no operes ZZZZ hoy \[ZZZZ: no se opera\]\n- ojo con las extensiones\n/);
    expect(t.state.phase).toBe('entering');
  });

  it('al cambiar el día se borran las indicaciones, salvo las permanentes', async () => {
    const { c, t } = await arm();
    await t.addInstruction('no operes ZZZZ hoy');
    await t.addInstruction('máximo 3 trades hoy', true);
    expect(t.instructions).toHaveLength(2);
    t.setInstructionPermanent(t.instructions[0].id, true);
    t.setInstructionPermanent(t.instructions[0].id, false);
    c.newDay({ clock: 'practice', date: '2026-10-22' });
    expect(t.instructions.map((i) => i.text)).toEqual(['máximo 3 trades hoy']);
    expect(t.instructions[0].permanent).toBe(true);
    t.removeInstruction(t.instructions[0].id);
    expect(t.instructions).toEqual([]);
  });
});
