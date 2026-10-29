// Máquina de estados del IA Trader con un mercado falso (fuente de datos controlada por el test) y la
// cuenta de práctica real: mira → entra → maneja → sale; compra que no se ejecuta; ejecución parcial;
// presupuesto de consultas a Claude; stop y objetivo que devuelve Claude.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { etDateTimeToTs } from '../src/engine/time';
import { DEFAULT_SETTINGS, type Bar, type Quote, type ScanRow, type SymbolDetail, type TapePrint, type ViewModel } from '../src/engine/types';
import { DepthBook } from '../src/trading/depth';
import type { TrainingStore } from '../src/trading/store';
import type { DataSource, SourceHandlers } from '../src/client/source/types';
import { TrainingController } from '../src/client/training';

// La IA: un `ask` que el test decide (por defecto, ninguna respuesta pendiente).
const ai = vi.hoisted(() => ({ ask: vi.fn<(system: string, prompt: string) => Promise<string>>() }));
vi.mock('../src/client/lib/ai', () => ({ aiAvailable: () => Promise.resolve({ via: 'servidor', ask: ai.ask }) }));

import { AiTrader } from '../src/client/aitrader';

const store: TrainingStore = { kind: 'navegador', load: async () => ({ state: null, sessions: [] }), saveState: async () => {}, saveSession: async () => {}, clear: async () => {} };

class StaticBook extends DepthBook {
  sync(): void {}
}
const lvl = (price: number, ...sizes: number[]) => ({ price, rows: sizes.map((size, i) => ({ venue: ['NSDQ', 'ARCA'][i] ?? 'EDGX', size })) });

/** 10:00 de Nueva York de un día hábil: dentro del horario de entradas. */
const T0 = etDateTimeToTs('2026-10-23', '10:00');
const MIN = 60_000;

function row(sym: string, price: number): ScanRow {
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
  };
}

function bars(price: number): Bar[] {
  return Array.from({ length: 6 }, (_, i) => ({ t: T0 - (6 - i) * MIN, o: price - 0.05, h: price, l: price - 0.08, c: price - 0.01, v: 30_000, pv: 0, n: 100 }));
}

/** Fuente de datos falsa: una acción en foco con bull flag armado, libro fijo y cotización que el test mueve. */
function fakeSource(sym = 'RUN', price = 3.0) {
  const quote: Quote = { sym, last: price, bid: price, ask: price + 0.01, bidSize: 500, askSize: 200, real: true, ts: T0, halted: false, volPerMin: 100_000 };
  const book = new StaticBook(1);
  book.bids = [lvl(price, 300, 200), lvl(price - 0.01, 500), lvl(price - 0.03, 1000)];
  book.asks = [lvl(price + 0.01, 200), lvl(price + 0.02, 300), lvl(price + 0.06, 2000)];
  const r = row(sym, price);
  const detail: SymbolDetail = {
    sym,
    ref: { sym, name: 'Run Inc' },
    row: r,
    bars: bars(price),
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
    setup: { aboveVwap: true, aboveEma9: true, aboveEma20: true, macdBullish: true, flag: { entry: price, stop: 2.9, target: 3.23, poleHigh: price, armedAt: T0 - MIN }, nextLevel: price + 0.5 },
  };
  const tape: TapePrint[] = [];
  let seq = 0;
  let now = T0;
  let focus: string | null = null;
  const src: DataSource & { quoteOf: Quote; detail: SymbolDetail; tick(ms: number): number; setFocus(s: string | null): void } = {
    kind: 'local',
    quoteOf: quote,
    detail,
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
    quote: (s) => (s === sym ? quote : null),
    row: (s) => (s === sym ? r : null),
    reviewBars: () => undefined,
    book: (s) => (s === sym && !quote.halted ? book : null),
    printsSince: (_s, after) => tape.filter((p) => p.seq > after),
    lastSeq: () => seq,
    session: () => 'regular',
    focus: (s) => {
      focus = s;
    },
    focusDetail: () => (focus === sym ? detail : null),
    tick(ms: number) {
      now += ms;
      return now;
    },
    setFocus(s: string | null) {
      focus = s;
    },
  };
  return { src, quote, book, detail, print: (price: number, size: number, side: TapePrint['side']) => tape.push({ seq: ++seq, ts: now, price, size, side }) };
}

function view(rows: ScanRow[]): ViewModel {
  return { ts: T0, session: 'regular', scanners: { gappers: rows, pillars: [], running: [], lowFloat: [], rvol: [], fades: [] }, watch: [], tracked: [], hodBoard: [], halts: [], stats: { tracked: 0, active: 0, eventsPerSec: 0 } };
}

/** Arma la cuenta, la fuente y el IA Trader en automático, listos para el primer paso. */
async function arm(opts: { consult?: boolean; autoBracket?: boolean; rows?: ScanRow[]; maxCalls?: number } = {}) {
  const c = new TrainingController(store, { state: null, sessions: [] }, 'local');
  c.updateSettings({ autoBracket: opts.autoBracket ?? false, latencyMs: 100 });
  const f = fakeSource();
  c.attach(f.src);
  const selected: string[] = [];
  const t = new AiTrader(c, (s) => selected.push(s));
  await Promise.resolve();
  t.attach(f.src);
  t.setView(view(opts.rows ?? [f.detail.row]), DEFAULT_SETTINGS);
  t.update({ mode: 'auto', consult: opts.consult ?? false, maxCalls: opts.maxCalls ?? 120 });
  /** Un segundo de mercado: el bróker trabaja las órdenes y la IA da un paso. */
  const tick = (ms = 1000) => {
    const now = f.src.tick(ms);
    c.onTick(now);
    t.step(now);
    return now;
  };
  const flush = async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  };
  return { c, t, f, tick, flush, selected, log: () => t.state.log.map((l) => l.text) };
}

beforeEach(() => {
  ai.ask.mockReset();
});

describe('IA Trader', () => {
  it('mira la mejor del escáner, entra con stop y objetivo, maneja la posición y sale por el stop', async () => {
    const { c, t, f, tick, log } = await arm();
    // Elige la mejor del escáner y, con su ficha en foco, ve el bull flag: compra límite por el tamaño según el riesgo.
    tick();
    expect(t.state.candidates[0]?.sym).toBe('RUN');
    expect(t.state.focus).toBe('RUN');
    expect(t.state.phase).toBe('entering');
    const buy = c.broker!.orders('RUN')[0];
    expect(buy).toMatchObject({ side: 'buy', type: 'limit', shares: 180 });
    expect(buy.plan).toMatchObject({ stop: 2.9, target: 3.23 });
    // La orden llega al mercado y se ejecuta contra el libro.
    tick();
    expect(c.broker!.position('RUN')?.shares).toBe(180);
    expect(t.state.phase).toBe('inPosition');
    // Toca el stop: la IA vende todo (cancelando lo que hubiera) y al cerrar vuelve a escanear.
    f.quote.bid = 2.89;
    f.quote.last = 2.89;
    f.quote.ask = 2.9;
    f.book.bids = [lvl(2.89, 1000)];
    tick();
    expect(c.broker!.orders('RUN').some((o) => o.side === 'sell')).toBe(true);
    tick();
    expect(c.broker!.position('RUN')).toBeUndefined();
    expect(c.active!.trades).toHaveLength(1);
    tick();
    expect(t.state.phase).toBe('scanning');
    expect(t.state.focus).toBeNull();
    expect(log().some((x) => /RUN cerrado: −\$/.test(x))).toBe(true);
    // Perdió: en los 20 s siguientes no busca nada y en RUN no vuelve a entrar por 5 min.
    f.quote.bid = 3.0;
    f.quote.last = 3.0;
    f.quote.ask = 3.01;
    tick(10_000);
    expect(t.state.phase).toBe('scanning');
    tick(15_000);
    expect(t.state.focus).toBe('RUN');
    expect(t.state.phase).toBe('watching');
    expect(c.broker!.orders('RUN')).toHaveLength(0);
    tick(4 * MIN);
    expect(c.broker!.orders('RUN')).toHaveLength(0);
    tick(2 * MIN);
    expect(t.state.phase).toBe('entering');
  });

  it('una compra que no se ejecuta en 25 s se cancela y la IA vuelve a mirar (sin posición no hay nada que manejar)', async () => {
    const { c, t, f, tick } = await arm();
    tick();
    expect(t.state.phase).toBe('entering');
    // El precio se escapa antes de que la orden llegue: queda esperando en el libro.
    f.quote.ask = 3.2;
    f.quote.bid = 3.19;
    f.book.asks = [lvl(3.2, 2000)];
    tick();
    expect(c.broker!.orders('RUN')[0].status).toBe('open');
    expect(t.state.phase).toBe('entering');
    tick(20_000);
    expect(c.broker!.orders('RUN')).toHaveLength(1);
    tick(6_000);
    expect(c.broker!.orders('RUN')).toHaveLength(0);
    expect(t.state.phase).toBe('watching');
    // `askNow` con órdenes vivas pero sin posición no revienta: pregunta por lo que mira.
    ai.ask.mockResolvedValue('{"decision":"wait","reason":"todavía no"}');
    await expect(t.askNow()).resolves.toBeUndefined();
  });

  it('con una ejecución parcial maneja lo ejecutado y a los 25 s cancela el resto', async () => {
    const { c, t, f, tick } = await arm();
    // Solo 100 acciones en el ask hasta el límite de la IA.
    f.book.asks = [lvl(3.01, 100), lvl(3.3, 5000)];
    tick();
    tick();
    expect(c.broker!.position('RUN')?.shares).toBe(100);
    expect(c.broker!.orders('RUN')[0]).toMatchObject({ side: 'buy', status: 'partial', filled: 100 });
    expect(t.state.phase).toBe('inPosition');
    tick(26_000);
    expect(c.broker!.orders('RUN').filter((o) => o.side === 'buy')).toHaveLength(0);
    expect(c.broker!.position('RUN')?.shares).toBe(100);
    expect(t.state.phase).toBe('inPosition');
  });

  it('reset() olvida foco, memoria y posición pendiente; lo dispara el cambio de día de la cuenta', async () => {
    const { c, t, tick } = await arm();
    tick();
    expect(t.state.phase).toBe('entering');
    c.newDay({ clock: 'practice' });
    expect(t.state.phase).toBe('scanning');
    expect(t.state.focus).toBeNull();
    expect(t.state.candidates).toEqual([]);
  });

  it('consulta a Claude solo en la ventana de entradas, cuando cambian las candidatas, y respeta el tope diario', async () => {
    const rows = [row('RUN', 3.0), row('ABC', 5.0)];
    ai.ask.mockResolvedValue('{"decision":"wait","sym":"RUN","reason":"espero"}');
    const { t, tick, flush, log } = await arm({ consult: true, rows, maxCalls: 3 });
    tick();
    await flush();
    // Elige entre las candidatas una vez; con las mismas candidatas y foco no vuelve a preguntar.
    const picks = () => ai.ask.mock.calls.filter(([, p]) => /Elegí una sola/.test(p)).length;
    expect(picks()).toBe(1);
    // Al segundo siguiente, con la ficha en foco y Claude libre, consulta la entrada (bull flag).
    tick();
    await flush();
    expect(picks()).toBe(1);
    expect(ai.ask).toHaveBeenCalledTimes(2);
    // "Esperar": el mismo plan se vuelve a consultar a los 3 min.
    tick(3 * MIN);
    await flush();
    expect(picks()).toBe(1);
    expect(ai.ask).toHaveBeenCalledTimes(3);
    expect(t.state.phase).toBe('watching');
    // Tope: 3 consultas por día (la elección más dos entradas); después sigue con las reglas y avisa.
    tick(3 * MIN + 1000);
    await flush();
    expect(ai.ask).toHaveBeenCalledTimes(3);
    expect(log().some((x) => /tope de 3 consultas/.test(x))).toBe(true);
    expect(t.state.phase).toBe('entering');
    expect(t.state.calls).toBe(3);
  });

  it('fuera del horario de entradas no le pregunta a Claude cuál mirar', async () => {
    const rows = [row('RUN', 3.0), row('ABC', 5.0)];
    ai.ask.mockResolvedValue('{"sym":"RUN","reason":"la obvia"}');
    const { t, tick, flush } = await arm({ consult: true, rows });
    t.update({ rules: { ...t.settings.rules, entryFrom: 7 * 60, entryTo: 9 * 60 } });
    tick();
    await flush();
    expect(ai.ask).not.toHaveBeenCalled();
    expect(t.state.candidates).toHaveLength(2);
  });

  it('con el stop de Claude recalcula las acciones; si su objetivo no paga 1,5R, entra igual apuntando al del perfil', async () => {
    ai.ask.mockResolvedValue('{"decision":"enter","confidence":80,"reason":"dale","stop":2.95,"target":3.03}');
    const { c, t, tick, flush, log } = await arm({ consult: true });
    tick();
    await flush();
    expect(ai.ask).toHaveBeenCalledTimes(1);
    expect(t.state.phase).toBe('entering');
    expect(log().some((x) => /no paga 1.5R/.test(x) && /se apunta a/.test(x))).toBe(true);
    const buy = c.broker!.orders('RUN')[0];
    // Riesgo $20 / 0,06 = 333 → tope por poder de compra (95 % de $1000 / 3,01 = 315) → lote de 10.
    expect(buy).toMatchObject({ side: 'buy', shares: 310 });
    // Objetivo: 2R sobre el stop de Claude (3,01 + 2 × 0,06 = 3,13).
    expect(buy.plan).toMatchObject({ stop: 2.95, target: 3.13 });
  });

  it('con stop y objetivo automáticos: el objetivo vende la mitad y recién al ejecutarse la IA sube el stop a la entrada', async () => {
    const { c, t, f, tick } = await arm({ autoBracket: true });
    tick();
    tick();
    const pos = c.broker!.position('RUN')!;
    expect(pos.shares).toBe(180);
    expect(c.broker!.orders('RUN').map((o) => [o.role, o.shares])).toEqual(expect.arrayContaining([['stop', 180], ['target', 90]]));
    // Llega al objetivo: la orden del objetivo vende 90; la IA no manda otra venta encima.
    f.quote.bid = 3.24;
    f.quote.ask = 3.25;
    f.quote.last = 3.24;
    f.print(3.24, 500, 'ask');
    tick();
    expect(c.broker!.position('RUN')!.shares).toBe(90);
    expect(c.broker!.orders('RUN').filter((o) => o.side === 'sell' && o.role === 'exit')).toHaveLength(0);
    tick();
    const stop = c.broker!.orders('RUN').find((o) => o.role === 'stop')!;
    expect(stop.shares).toBe(90);
    expect(stop.stopPrice).toBe(pos.avgCost);
    expect(t.state.phase).toBe('inPosition');
  });
});

describe('perfiles', () => {
  it('elegir un perfil carga sus reglas, tocar una lo vuelve personalizado, y el riesgo del perfil cambia el tamaño', async () => {
    const { PROFILES } = await import('../src/trading/playbook');
    const { t } = await arm();
    t.update({ profile: 'agresivo' });
    expect(t.settings.profile).toBe('agresivo');
    expect(t.settings.rules).toEqual(PROFILES.agresivo);
    expect(t.state.log.some((l) => /Perfil agresivo/.test(l.text))).toBe(true);
    t.update({ rules: { ...t.settings.rules, maxTrades: 9 } });
    expect(t.settings.profile).toBe('personalizado');
    t.update({ profile: 'conservador' });
    expect(t.settings.rules.riskMult).toBe(0.5);
    expect(t.settings.rules.entryFrom).toBe(9 * 60 + 30);
  });
});

describe('por qué no entra, y el precio que se mueve mientras Claude piensa', () => {
  it('dice en el panel por qué está esperando', async () => {
    const { t, tick } = await arm({ consult: true });
    t.update({ rules: { ...t.settings.rules, entryFrom: 7 * 60, entryTo: 9 * 60 } });
    tick();
    expect(t.state.phase).toBe('watching');
    expect(t.state.waiting).toMatch(/Fuera del horario/);
  });

  it('si el precio subió 2 % mientras Claude pensaba, entra igual al precio nuevo; a 5 % lo deja y vuelve a mirar en 30 s', async () => {
    ai.ask.mockImplementation(async () => '{"decision":"enter","confidence":85,"reason":"dale"}');
    const { c, t, f, tick, flush, log } = await arm({ consult: true });
    tick();
    // Mientras Claude responde, el ask sube 2 %.
    f.quote.ask = 3.06;
    f.quote.last = 3.05;
    f.quote.bid = 3.05;
    await flush();
    expect(t.state.phase).toBe('entering');
    const buy = c.broker!.orders('RUN')[0];
    expect(buy.price).toBeGreaterThanOrEqual(3.06);
    // Otra acción: ahora se escapó 5 %.
    const second = await arm({ consult: true });
    second.tick();
    second.f.quote.ask = 3.16;
    second.f.quote.last = 3.15;
    second.f.quote.bid = 3.15;
    await second.flush();
    expect(second.t.state.phase).toBe('watching');
    expect(second.log().some((x) => /se escapó/.test(x))).toBe(true);
    expect(second.c.broker!.orders('RUN')).toHaveLength(0);
    // Vuelve el precio: a los 31 s ya consulta de nuevo (no espera 3 min).
    second.f.quote.ask = 3.01;
    second.f.quote.last = 3.0;
    second.f.quote.bid = 3.0;
    const calls = ai.ask.mock.calls.length;
    second.tick(31_000);
    await second.flush();
    expect(ai.ask.mock.calls.length).toBeGreaterThan(calls);
    expect(log().length).toBeGreaterThan(0);
  });
});

describe('escenario ideal para cada perfil', () => {
  for (const profile of ['conservador', 'equilibrado', 'agresivo'] as const) {
    it(`${profile}: con la obvia del día y un bull flag limpio a las 10:00, entra`, async () => {
      const { c, t, tick } = await arm();
      t.update({ profile });
      tick();
      expect(t.state.candidates[0]?.score).toBeGreaterThanOrEqual(t.settings.rules.minScore);
      expect(t.state.phase).toBe('entering');
      const buy = c.broker!.orders('RUN')[0];
      expect(buy.side).toBe('buy');
      // El tamaño sigue al riesgo del perfil (riesgo $20 de la cuenta × 0,5 / 1 / 1,5, con 11 ¢ por acción, en lotes de 10).
      expect(buy.shares).toBe({ conservador: 90, equilibrado: 180, agresivo: 270 }[profile]);
    });
  }
});
