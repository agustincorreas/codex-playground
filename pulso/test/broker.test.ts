import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Quote, TapePrint } from '../src/engine/types';
import { Broker, type MarketAccess } from '../src/trading/broker';
import { DepthBook } from '../src/trading/depth';
import { breakdown, consistencyScore, equityCurve, levelOf, plScore, summarize, weeklyResults, winRateScore } from '../src/trading/stats';
import { DbTrainingStore, fitSession, fitState, jsonBytes } from '../src/trading/store';
import { DEFAULT_TRADING, type ActiveSession, type Fill, type Position, type SessionRecord, type Trade, type TradingSettings, type TrainingState } from '../src/trading/types';

function session(cash = 1000): ActiveSession {
  return { id: 's1', mode: 'sim', dayKey: '2026-10-23', dayIndex: 1, startedAt: 0, marketStart: 0, startCash: cash, cash, unsettled: 0, positions: [], orders: [], history: [], fills: [], trades: [], seq: 0 };
}

/** Libro fijo para los tests: no cambia solo (las órdenes propias igual lo consumen). */
class StaticBook extends DepthBook {
  sync(): void {}
}

const lvl = (price: number, ...sizes: number[]) => ({ price, rows: sizes.map((size, i) => ({ venue: ['NSDQ', 'ARCA', 'EDGX'][i] ?? 'BATS', size })) });

/** Mercado falso: NBBO, libro, cinta y sesión controlados por el test. */
function market(bid: number, ask: number) {
  const book = new StaticBook(1);
  book.bids = [lvl(bid, 300, 200), lvl(Math.round((bid - 0.01) * 100) / 100, 500), lvl(Math.round((bid - 0.03) * 100) / 100, 1000)];
  book.asks = [lvl(ask, 200), lvl(Math.round((ask + 0.01) * 100) / 100, 300), lvl(Math.round((ask + 0.05) * 100) / 100, 2000)];
  const quote: Quote = { sym: 'RUN', last: bid, bid, ask, bidSize: 500, askSize: 200, real: true, ts: 0, halted: false, volPerMin: 100_000 };
  const tape: TapePrint[] = [];
  let seq = 0;
  let sess: 'pre' | 'regular' | 'post' | 'closed' = 'regular';
  const m: MarketAccess = {
    quote: () => quote,
    book: () => (quote.halted ? null : book),
    printsSince: (_sym, after) => tape.filter((p) => p.seq > after),
    lastSeq: () => seq,
    session: () => sess,
  };
  return {
    m,
    book,
    quote,
    marks: () => quote.last,
    print(price: number, size: number, side: TapePrint['side']) {
      tape.push({ seq: ++seq, ts: 0, price, size, side });
      quote.last = price;
    },
    setSession(s: typeof sess) {
      sess = s;
    },
  };
}

function setup(settings: Partial<TradingSettings> = {}, cash = 1000, priorDayTrades = 0) {
  const b = new Broker(session(cash), { ...DEFAULT_TRADING, latencyMs: 100, ...settings }, {}, () => ({ priorDayTrades }));
  return { b, ...market(3.0, 3.01) };
}

/** Pasa el tiempo suficiente para que llegue la orden (la latencia máxima es 1,6 × 100 ms). */
const LAT = 200;

describe('bróker de práctica', () => {
  it('la orden llega después de la latencia y una compra a mercado recorre el libro', () => {
    const { b, m, marks } = setup();
    const r = b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 300 }, 0, m, marks);
    expect(r.ok).toBe(true);
    expect(b.process(10, m, marks)).toHaveLength(0);
    expect(b.orders()[0].status).toBe('sent');
    const fills = b.process(LAT, m, marks);
    expect(fills).toHaveLength(1);
    // 200 a 3,01 (todo el ask) y 100 a 3,02 (el nivel siguiente).
    expect(fills[0]).toMatchObject({ shares: 300, price: 3.0133 });
    expect(b.position('RUN')).toMatchObject({ shares: 300, avgCost: 3.0133 });
    expect(b.session.cash).toBe(96);
    expect(b.session.history[0]).toMatchObject({ status: 'filled', filled: 300 });
  });

  it('fuera de la rueda regular solo acepta órdenes límite', () => {
    const { b, m, marks, setSession } = setup();
    setSession('pre');
    expect(b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100 }, 0, m, marks).message).toMatch(/solo se aceptan órdenes límite/);
    const r = b.place({ sym: 'RUN', side: 'buy', type: 'limit', price: 3.06, shares: 100 }, 0, m, marks);
    expect(r.ok).toBe(true);
    expect(b.process(LAT, m, marks)[0]).toMatchObject({ shares: 100, price: 3.01 });
  });

  it('una compra límite marketable toma el libro hasta su precio y el resto queda esperando', () => {
    const { b, m, marks } = setup({}, 5000);
    b.place({ sym: 'RUN', side: 'buy', type: 'limit', price: 3.02, shares: 1000 }, 0, m, marks);
    const fills = b.process(LAT, m, marks);
    expect(fills[0]).toMatchObject({ shares: 500, price: 3.016 });
    expect(b.orders()[0]).toMatchObject({ status: 'partial', filled: 500 });
  });

  it('una compra límite debajo del mercado espera su turno en la cola', () => {
    const { b, m, marks, print } = setup();
    b.place({ sym: 'RUN', side: 'buy', type: 'limit', price: 3.0, shares: 200 }, 0, m, marks);
    b.process(LAT, m, marks);
    expect(b.orders()[0].queueAhead).toBe(500);
    print(3.0, 300, 'bid');
    expect(b.process(LAT + 100, m, marks)).toHaveLength(0);
    expect(b.orders()[0].queueAhead).toBe(200);
    // Este print se come los 200 de adelante y 100 son míos: ejecución parcial.
    print(3.0, 300, 'bid');
    const f1 = b.process(LAT + 200, m, marks);
    expect(f1[0]).toMatchObject({ shares: 100, price: 3.0 });
    expect(b.orders()[0].status).toBe('partial');
    // Un print más abajo: yo era la mejor punta, me tocaba.
    print(2.99, 400, 'bid');
    const f2 = b.process(LAT + 300, m, marks);
    expect(f2[0]).toMatchObject({ shares: 100, price: 3.0 });
    expect(b.position('RUN')!.shares).toBe(200);
  });

  it('el stop puesto sobre la posición no se dispara con prints anteriores a la orden', () => {
    const { b, m, marks, print, quote } = setup();
    print(2.9, 100, 'bid');
    print(3.0, 100, 'bid');
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100 }, 0, m, marks);
    b.process(LAT, m, marks);
    expect(b.setBracket('RUN', { stop: 2.95 }, LAT, quote).ok).toBe(true);
    expect(b.process(LAT + 100, m, marks)).toHaveLength(0);
    expect(b.position('RUN')!.shares).toBe(100);
    print(2.95, 100, 'bid');
    expect(b.process(LAT + 200, m, marks)[0]).toMatchObject({ side: 'sell', shares: 100 });
  });

  it('al reanudar, las órdenes vivas vuelven a mirar la cinta desde ahora', () => {
    const { b, m, marks, print } = setup();
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100, stop: 2.95 }, 0, m, marks);
    b.process(LAT, m, marks);
    const saved = structuredClone(b.session);
    print(2.9, 100, 'bid');
    print(3.0, 100, 'bid');
    // Página nueva: otro bróker con la sesión guardada; los prints de antes no disparan el stop.
    const b2 = new Broker(saved, b.settings, {}, () => ({ priorDayTrades: 0 }));
    expect(b2.process(LAT + 100, m, marks)).toHaveLength(0);
    print(2.94, 100, 'bid');
    expect(b2.process(LAT + 200, m, marks)[0]).toMatchObject({ side: 'sell', shares: 100 });
  });

  it('el stop se dispara con el último precio y vende contra el bid, nivel por nivel', () => {
    const { b, m, marks, print } = setup();
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 300, stop: 2.95 }, 0, m, marks);
    b.process(LAT, m, marks);
    expect(b.orders().map((o) => o.role).sort()).toEqual(['stop']);
    print(2.96, 100, 'bid');
    expect(b.process(LAT + 100, m, marks)).toHaveLength(0);
    print(2.95, 100, 'bid');
    const fills = b.process(LAT + 200, m, marks);
    // Sale a mercado: 300 en el bid de 3,00 (el libro del test no se movió).
    expect(fills[0]).toMatchObject({ shares: 300, price: 3.0, role: 'stop' });
    const t = b.session.trades[0];
    expect(t.exitReason).toBe('stop');
    expect(t.r).toBeCloseTo(-0.21, 2);
  });

  it('el objetivo cancela el stop (OCO)', () => {
    const { b, m, marks, print } = setup();
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100, stop: 2.9, target: 3.2 }, 0, m, marks);
    b.process(LAT, m, marks);
    print(3.21, 200, 'ask');
    const fills = b.process(LAT + 100, m, marks);
    expect(fills[0]).toMatchObject({ role: 'target', price: 3.2, shares: 100 });
    expect(b.orders()).toHaveLength(0);
    expect(b.session.history.find((o) => o.role === 'stop')).toMatchObject({ status: 'canceled' });
    expect(b.session.trades[0].exitReason).toBe('target');
  });

  it('una venta parcial achica el stop y el objetivo a las acciones que quedan', () => {
    const { b, m, marks } = setup({}, 5000);
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 400, stop: 2.9, target: 3.5 }, 0, m, marks);
    b.process(LAT, m, marks);
    b.place({ sym: 'RUN', side: 'sell', type: 'limit', price: 2.95, shares: 200 }, LAT, m, marks);
    b.process(LAT * 2, m, marks);
    expect(b.position('RUN')!.shares).toBe(200);
    expect(b.orders().every((o) => o.shares - o.filled === 200)).toBe(true);
  });

  it('cuenta cash: el dinero de las ventas se libera al día siguiente (T+1)', () => {
    const { b, m, marks } = setup();
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 300 }, 0, m, marks);
    b.process(LAT, m, marks);
    b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 300 }, LAT, m, marks);
    b.process(LAT * 2, m, marks);
    expect(b.session.unsettled).toBeGreaterThan(890);
    expect(b.buyingPower(marks)).toBeLessThan(100);
    const r = b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100 }, LAT * 2, m, marks);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/liquidación T\+1/);
  });

  it('cuenta margen chica: la regla PDT bloquea el cuarto day trade', () => {
    const { b, m, marks } = setup({ account: 'margin', leverage: 4 }, 1000, 3);
    expect(b.buyingPower(marks)).toBe(2000);
    expect(b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100 }, 0, m, marks).message).toMatch(/Regla PDT/);
    const big = setup({ account: 'margin', leverage: 4 }, 30_000, 3);
    expect(big.b.buyingPower(big.marks)).toBe(120_000);
    expect(big.b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100 }, 0, big.m, big.marks).ok).toBe(true);
  });

  it('cobra las tasas de la SEC y de FINRA en las ventas', () => {
    const { b, m, marks } = setup({}, 5000);
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 200 }, 0, m, marks);
    b.process(LAT, m, marks);
    b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 200 }, LAT, m, marks);
    const [f] = b.process(LAT * 2, m, marks);
    // 600 vendidos: SEC 0,0124 → 0,02; TAF 200 × 0,000195 = 0,039 → 0,04.
    expect(f.fee).toBe(0.06);
    expect(b.session.trades[0].fees).toBe(0.06);
  });

  it('en halt no se ejecuta nada y no acepta órdenes a mercado', () => {
    const { b, m, marks, quote } = setup();
    b.place({ sym: 'RUN', side: 'buy', type: 'limit', price: 3.05, shares: 100 }, 0, m, marks);
    quote.halted = true;
    expect(b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100 }, 0, m, marks).message).toMatch(/halt/);
    expect(b.process(LAT, m, marks)).toHaveLength(0);
    expect(b.orders()[0].note).toMatch(/halt/);
    quote.halted = false;
    expect(b.process(LAT + 100, m, marks)).toHaveLength(1);
  });

  it('una orden DAY mandada en el pre-market espera la apertura y vence al cierre', () => {
    const { b, m, marks, setSession } = setup();
    setSession('pre');
    b.place({ sym: 'RUN', side: 'buy', type: 'limit', price: 2.5, shares: 100, tif: 'DAY' }, 0, m, marks);
    b.process(LAT, m, marks);
    expect(b.orders()[0].note).toMatch(/rueda regular/);
    setSession('post');
    b.process(LAT + 100, m, marks);
    expect(b.orders()).toHaveLength(0);
    expect(b.session.history[0]).toMatchObject({ status: 'canceled' });
  });

  it('sin stop automático, el stop y el objetivo quedan como plan: sin órdenes, pero con la R del trade', () => {
    const { b, m, marks, print } = setup();
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100, planStop: 2.9, planTarget: 3.2 }, 0, m, marks);
    b.process(LAT, m, marks);
    expect(b.orders()).toHaveLength(0);
    expect(b.position('RUN')).toMatchObject({ planStop: 2.9, planTarget: 3.2, initialStop: 2.9 });
    expect(b.position('RUN')!.stop).toBeUndefined();
    // El precio pasa por el stop del plan y no pasa nada: la salida la hace el usuario.
    print(2.85, 100, 'bid');
    expect(b.process(LAT + 100, m, marks)).toHaveLength(0);
    b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 100 }, LAT + 100, m, marks);
    b.process(LAT * 2 + 100, m, marks);
    const t = b.session.trades[0];
    expect(t.exitReason).toBe('manual');
    // Entró a 3,01 con el stop del plan en 2,90: 1R = 11 centavos por acción.
    expect(t.risk).toBe(11);
    expect(t.r).toBeCloseTo(t.net / 11, 2);
  });

  it('avisa cuando una orden queda en espera y cuando se cancela sola, pero no las cancelaciones del usuario ni las del OCO', () => {
    const events: string[] = [];
    const b = new Broker(session(1000), { ...DEFAULT_TRADING, latencyMs: 100 }, { onOrder: (kind, o) => events.push(`${kind}:${o.side}:${o.note ?? ''}`) }, () => ({ priorDayTrades: 0 }));
    const { m, marks, print, setSession } = market(3.0, 3.01);
    // Límite debajo del mercado: queda en espera.
    b.place({ sym: 'RUN', side: 'buy', type: 'limit', price: 2.95, shares: 100 }, 0, m, marks);
    b.process(LAT, m, marks);
    expect(events).toEqual(['open:buy:']);
    // La cancela el usuario: no hay aviso del bróker (lo da el controlador).
    b.cancel(b.orders()[0].id, LAT);
    expect(events).toHaveLength(1);
    // Compra con stop y objetivo: el objetivo se ejecuta y el stop se cancela por OCO, sin aviso.
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100, stop: 2.9, target: 3.05 }, LAT, m, marks);
    b.process(LAT * 2, m, marks);
    print(3.06, 200, 'ask');
    b.process(LAT * 2 + 100, m, marks);
    expect(b.session.history.find((o) => o.role === 'stop')).toMatchObject({ status: 'canceled' });
    expect(events).toHaveLength(1);
    // Una orden DAY que vence al cierre sí avisa.
    setSession('pre');
    b.place({ sym: 'RUN', side: 'buy', type: 'limit', price: 2.5, shares: 10, tif: 'DAY' }, LAT * 3, m, marks);
    b.process(LAT * 4, m, marks);
    setSession('post');
    b.process(LAT * 5, m, marks);
    expect(events.slice(1)).toEqual(['open:buy:Espera la rueda regular (TIF DAY)', 'canceled:buy:Venció al cierre de la rueda (DAY)']);
  });

  it('bloquea compras al llegar a la pérdida máxima del día', () => {
    const { b, m, marks, quote } = setup({ maxDailyLoss: 20 });
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 300 }, 0, m, marks);
    b.process(LAT, m, marks);
    quote.last = 2.9;
    expect(b.place({ sym: 'RUN', side: 'buy', type: 'limit', price: 2.9, shares: 10 }, LAT, m, marks).message).toMatch(/pérdida máxima/);
  });

  it('cierra todo al terminar el día', () => {
    const { b, m, marks } = setup();
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100, stop: 2.5 }, 0, m, marks);
    b.process(LAT, m, marks);
    const trades = b.flatten(LAT * 2, m, marks);
    expect(trades).toHaveLength(1);
    expect(trades[0].exitReason).toBe('eod');
    expect(b.orders()).toHaveLength(0);
    expect(b.session.positions).toHaveLength(0);
  });
});

describe('estadísticas', () => {
  const mk = (net: number, i: number, extra: Partial<Trade> = {}): Trade => ({
    id: `t${i}`,
    sessionId: 's',
    sym: 'X',
    openedAt: i * 60_000,
    closedAt: i * 60_000 + 120_000,
    shares: 100,
    avgEntry: 4,
    avgExit: 4 + net / 100,
    gross: net,
    fees: 0,
    net,
    returnPct: net / 4,
    mfePct: 0,
    maePct: 0,
    exitReason: 'manual',
    fills: 2,
    ...extra,
  });

  it('% de aciertos, promedio de ganancia y pérdida, profit factor, drawdown y rachas', () => {
    const trades = [mk(30, 1, { r: 1.5 }), mk(-10, 2, { r: -0.5 }), mk(-20, 3, { r: -1 }), mk(50, 4, { r: 2.5 }), mk(10, 5)];
    const s = summarize(trades);
    expect(s).toMatchObject({ trades: 5, wins: 3, losses: 2, winRate: 60, net: 60, avgWin: 30, avgLoss: -15, largestWin: 50, largestLoss: -20, expectancy: 12, maxDrawdown: 30, bestStreak: 2, worstStreak: 2 });
    expect(s.plRatio).toBe(2);
    expect(s.profitFactor).toBe(3);
    expect(s.avgR).toBe(0.63);
    const curve = equityCurve(trades, 1000);
    expect(curve.map((p) => p.equity)).toEqual([1000, 1030, 1020, 1000, 1050, 1060]);
  });

  it('desglosa por horario y precio', () => {
    const trades = [mk(10, 1, { ctx: { minutes: 9 * 60 + 40, price: 4, changePct: 20, rvol: 9, score: 5 } }), mk(-5, 2, { avgEntry: 12, ctx: { minutes: 8 * 60, price: 12, changePct: 30, rvol: 20, score: 4 } })];
    const hora = breakdown(trades, 'hora');
    expect(hora.map((b) => b.label)).toEqual(['Pre-market', '9:30–10:00']);
    const precio = breakdown(trades, 'precio');
    expect(precio.map((b) => [b.label, b.net])).toEqual([
      ['$3–$5', 10],
      ['$10–$20', -5],
    ]);
  });

  it('puntajes del Profit Trifecta y niveles', () => {
    expect([50, 51, 56, 61, 66, 71].map(winRateScore)).toEqual([1, 2, 3, 4, 5, 6]);
    expect([0.9, 1, 1.5, 1.75, 2, 2.3].map(plScore)).toEqual([1, 2, 3, 4, 5, 6]);
    expect([0, 1, 2, 3, 4, 5, 6, 9].map(consistencyScore)).toEqual([1, 2, 3, 4, 4, 5, 6, 6]);
    expect([3, 4, 9, 10, 13, 14, 18].map(levelOf)).toEqual(['No rentable', 'Principiante', 'Intermedio', 'Con experiencia', 'Con experiencia', 'Profesional', 'Profesional']);
  });

  it('agrupa los días de práctica en semanas de 5 y cuenta las semanas positivas seguidas', () => {
    // Semana 1 (días 1 a 5): +30, −10 y +20. Semana 2 (día 6): −40. Semana 3 (día 11): +15.
    const day = new Map<string, number>();
    const trades = (
      [
        [30, 1],
        [-10, 2],
        [20, 5],
        [-40, 6],
        [15, 11],
      ] as const
    ).map(([net, d], i) => {
      const t = mk(net, i);
      day.set(t.id, d);
      return t;
    });
    const weeks = weeklyResults(trades, (t) => day.get(t.id));
    expect(weeks.map((w) => [w.week, w.net, w.trades])).toEqual([
      [1, 40, 3],
      [2, -40, 1],
      [3, 15, 1],
    ]);
    expect(weeks[0].days.map((d) => d.dayIndex)).toEqual([1, 2, 5]);
    // Semana 1: 67% de aciertos (5), relación G/P 25/10 = 2,5 (6) y 1 semana positiva (2): 13 puntos.
    expect(weeks[0].score).toMatchObject({ winRate: 5, plRatio: 6, consistency: 2, total: 13, level: 'Con experiencia' });
    // La semana 2 corta la racha y la 3 la vuelve a empezar.
    expect(weeks.map((w) => w.score.consistency)).toEqual([2, 1, 2]);
  });

  it('una sesión enorme se achica quitando velas para entrar en un documento', () => {
    const bars = Array.from({ length: 60 }, (_, i) => [i, 1, 2, 0.5, 1.5, 1000]);
    const trades = Array.from({ length: 200 }, (_, i) => mk(1, i, { bars }));
    const rec = { id: 's', mode: 'sim' as const, dayKey: 'x', startedAt: 0, endedAt: 1, marketStart: 0, marketEnd: 1, startCash: 1000, endCash: 1200, trades };
    const fitted = fitSession(rec, 50_000);
    expect(jsonBytes(fitted)).toBeLessThanOrEqual(50_000);
    expect(fitted.trades).toHaveLength(200);
  });
});

describe('guardado de la cuenta de práctica', () => {
  const tr = (i: number, extra: Partial<Trade> = {}): Trade => ({
    id: `t${i}`,
    sessionId: 's1',
    sym: `S${i % 5}`,
    openedAt: i * 60_000,
    closedAt: i * 60_000 + 30_000,
    shares: 100,
    avgEntry: 4,
    avgExit: 4.1,
    gross: 10,
    fees: 0,
    net: 10,
    returnPct: 2.5,
    mfePct: 3,
    maePct: -1,
    exitReason: 'manual',
    fills: 2,
    ...extra,
  });
  const bars = Array.from({ length: 60 }, (_, i) => [i * 60_000, 4, 4.2, 3.9, 4.1, 12_000]);
  const fill = (i: number, sym: string): Fill => ({ id: `f${i}`, orderId: `o${i}`, sym, side: 'buy', shares: 100, price: 4, fee: 0, ts: i, role: 'entry' });
  const stateWith = (a: ActiveSession, updatedAt = 1): TrainingState => ({ version: 1, settings: DEFAULT_TRADING, balance: 1000, dayIndex: 1, dayTrades: [], updatedAt, active: a });

  it('un día con muchos trades entra en un documento: se quitan las velas de los más viejos', () => {
    const a = session();
    a.trades = Array.from({ length: 120 }, (_, i) => tr(i, { bars, note: 'Entré tarde, ¿por qué?' }));
    const state = stateWith(a);
    expect(jsonBytes(state)).toBeGreaterThan(200_000);
    const fitted = fitState(state, 200_000);
    expect(jsonBytes(fitted)).toBeLessThanOrEqual(200_000);
    expect(fitted.active!.trades).toHaveLength(120);
    expect(fitted.active!.trades[0].bars).toBeUndefined();
    expect(fitted.active!.trades[119].bars).toHaveLength(60);
    // El estado en memoria no se toca.
    expect(state.active!.trades[0].bars).toHaveLength(60);
  });

  it('si no alcanza, descarta ejecuciones viejas pero nunca las de una posición abierta', () => {
    const a = session();
    a.positions = [{ sym: 'OPEN' } as Position];
    a.fills = Array.from({ length: 3000 }, (_, i) => fill(i, i % 10 === 0 ? 'OPEN' : 'DONE'));
    const fitted = fitState(stateWith(a), 150_000);
    expect(jsonBytes(fitted)).toBeLessThanOrEqual(150_000);
    const kept = fitted.active!.fills;
    expect(kept.filter((f) => f.sym === 'OPEN')).toHaveLength(300);
    expect(kept.at(-1)!.id).toBe('f2999');
    expect(kept.length).toBeLessThan(3000);
  });

  // Base falsa con la forma de la API `db` del artifact y un localStorage en memoria.
  function fakeDb(fail: (attempt: number) => string | null = () => null) {
    const docs = new Map<string, Record<string, unknown>>();
    let writes = 0;
    const snap = (path: string) => ({ id: path.split('/').at(-1)!, exists: docs.has(path), data: () => docs.get(path) });
    const coll = (path: string) => ({
      doc: (id?: string) => doc(`${path}/${id}`),
      orderBy: () => ({
        limit: () => ({ get: async () => ({ docs: [...docs.keys()].filter((k) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/')).map(snap) }) }),
      }),
    });
    const doc = (path: string) => ({
      get: async () => snap(path),
      set: async (data: Record<string, unknown>) => {
        const code = fail(writes++);
        if (code) throw { code, message: code };
        docs.set(path, data);
      },
      delete: async () => void docs.delete(path),
      collection: (sub: string) => coll(`${path}/${sub}`),
    });
    return { db: { doc }, docs, writes: () => writes };
  }
  const mem = new Map<string, string>();
  beforeEach(() => {
    mem.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    vi.useRealTimers();
  });
  const rec: SessionRecord = { id: 'sabc', mode: 'sim', dayKey: '2026-10-23', startedAt: 0, endedAt: 5, marketStart: 0, marketEnd: 1, startCash: 1000, endCash: 1010, trades: [tr(1)] };

  it('guarda el día y el historial en el espacio privado de la persona y los vuelve a cargar', async () => {
    const { db, docs } = fakeDb();
    const store = new DbTrainingStore(db, 'u_1');
    await store.saveState(stateWith(session(), 7));
    await store.saveSession(rec);
    expect([...docs.keys()].sort()).toEqual(['data/users/u_1/training', 'data/users/u_1/training/sessions/sabc']);
    const loaded = await new DbTrainingStore(db, 'u_1').load();
    expect(loaded.state?.updatedAt).toBe(7);
    expect(loaded.sessions.map((x) => x.id)).toEqual(['sabc']);
    expect(store.kind).toBe('cuenta');
  });

  it('si la base rechaza las escrituras sigue en el navegador, y al recargar gana lo más nuevo', async () => {
    const { db, writes } = fakeDb(() => 'invalid_argument');
    const store = new DbTrainingStore(db, 'u_1');
    const onFallback = vi.fn();
    store.onFallback = onFallback;
    await store.saveState(stateWith(session(), 8));
    expect(store.kind).toBe('navegador');
    expect(onFallback).toHaveBeenCalledTimes(1);
    await store.saveState(stateWith(session(900), 9));
    await store.saveSession(rec);
    expect(writes()).toBe(1);
    const loaded = await new DbTrainingStore(db, 'u_1').load();
    expect(loaded.state?.updatedAt).toBe(9);
    expect(loaded.state?.active?.cash).toBe(900);
    expect(loaded.sessions.map((x) => x.id)).toEqual(['sabc']);
  });

  it('borrar todo y guardar la cuenta nueva: queda la nueva', async () => {
    const { db, docs } = fakeDb();
    const store = new DbTrainingStore(db, 'u_1');
    await store.saveState(stateWith(session(), 5));
    await store.saveSession(rec);
    void store.saveState(stateWith(session(4000), 6));
    void store.clear();
    await store.saveState(stateWith(session(5000), 7));
    expect(docs.has('data/users/u_1/training/sessions/sabc')).toBe(false);
    const loaded = await new DbTrainingStore(db, 'u_1').load();
    expect(loaded.state?.active?.cash).toBe(5000);
  });

  it('los datos leídos de la base se pueden modificar (la base los entrega congelados)', async () => {
    const { db, docs } = fakeDb();
    const store = new DbTrainingStore(db, 'u_1');
    await store.saveSession(rec);
    for (const [k, v] of docs) docs.set(k, Object.freeze(v));
    const loaded = await new DbTrainingStore(db, 'u_1').load();
    expect(() => {
      loaded.sessions[0].trades = [];
    }).not.toThrow();
  });

  it('reintenta una vez si la base está momentáneamente no disponible', async () => {
    vi.useFakeTimers();
    const { db, docs } = fakeDb((n) => (n === 0 ? 'unavailable' : null));
    const store = new DbTrainingStore(db, 'u_1');
    const saving = store.saveState(stateWith(session(), 3));
    await vi.advanceTimersByTimeAsync(3000);
    await saving;
    expect(docs.has('data/users/u_1/training')).toBe(true);
    expect(store.kind).toBe('cuenta');
  });
});
