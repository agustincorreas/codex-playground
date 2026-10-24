import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Quote } from '../src/engine/types';
import { Broker } from '../src/trading/broker';
import { breakdown, equityCurve, summarize } from '../src/trading/stats';
import { DbTrainingStore, fitSession, fitState, jsonBytes } from '../src/trading/store';
import { DEFAULT_TRADING, type ActiveSession, type Fill, type Position, type SessionRecord, type Trade, type TradingSettings, type TrainingState } from '../src/trading/types';

function session(cash = 1000): ActiveSession {
  return { id: 's1', mode: 'sim', dayKey: '2026-10-23', startedAt: 0, marketStart: 0, startCash: cash, cash, positions: [], orders: [], fills: [], trades: [], seq: 0 };
}

const q = (last: number, extra: Partial<Quote> = {}): Quote => ({ sym: 'RUN', last, bid: last - 0.01, ask: last + 0.01, ts: 0, halted: false, volPerMin: 100_000, ...extra });

function setup(settings: Partial<TradingSettings> = {}) {
  const b = new Broker(session(), { ...DEFAULT_TRADING, slippage: false, ...settings });
  let px = 3;
  const marks = () => px;
  return { b, marks, setPx: (p: number) => (px = p) };
}

describe('bróker de práctica', () => {
  it('compra a mercado en la punta vendedora y vende en la compradora', () => {
    const { b, marks } = setup();
    const r = b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100 }, q(3), 1000, marks);
    expect(r.ok).toBe(true);
    expect(r.fills[0].price).toBe(3.01);
    expect(b.session.cash).toBe(699);
    expect(b.position('RUN')).toMatchObject({ shares: 100, avgCost: 3.01 });
    const s = b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 100 }, q(3.2), 2000, marks);
    expect(s.fills[0].price).toBe(3.19);
    expect(b.position('RUN')).toBeUndefined();
    const t = b.session.trades[0];
    expect(t).toMatchObject({ sym: 'RUN', shares: 100, avgEntry: 3.01, avgExit: 3.19, net: 18, exitReason: 'manual' });
    expect(b.session.cash).toBe(1018);
  });

  it('rechaza compras sin poder de compra (cuenta cash de $1000)', () => {
    const { b, marks } = setup();
    const r = b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 400 }, q(3), 0, marks);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Poder de compra insuficiente/);
    expect(r.message).toMatch(/alcanza para 332 acciones/);
  });

  it('con margen 4x el poder de compra se multiplica', () => {
    const { b, marks } = setup({ margin: 4 });
    expect(b.buyingPower(marks)).toBe(4000);
    expect(b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 1000 }, q(3), 0, marks).ok).toBe(true);
  });

  it('no permite operar a mercado durante un halt', () => {
    const { b, marks } = setup();
    const r = b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 10 }, q(3, { halted: true }), 0, marks);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/halt/);
  });

  it('el deslizamiento crece con el tamaño contra la liquidez', () => {
    const b = new Broker(session(100_000), { ...DEFAULT_TRADING, slippage: true });
    const thin = q(4, { volPerMin: 4000 });
    expect(b.execPrice('buy', thin, 100)).toBe(4.01);
    // 5000 acciones contra 4000 por minuto: ~1,9% de deslizamiento.
    expect(b.execPrice('buy', thin, 5000)).toBeCloseTo(4.09, 2);
    expect(b.execPrice('sell', thin, 5000)).toBeCloseTo(3.92, 2);
    expect(b.execPrice('buy', thin, 50_000)).toBeCloseTo(4.21, 2);
  });

  it('el stop de un bracket vende con la punta compradora y calcula la R', () => {
    const { b, marks } = setup();
    const r = b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 200, stop: 2.9, target: 3.4, setup: 'Bull flag' }, q(3), 0, marks);
    expect(r.ok).toBe(true);
    expect(b.orders('RUN').map((o) => o.role).sort()).toEqual(['stop', 'target']);
    b.onQuote(q(3.1), 10);
    expect(b.position('RUN')).toBeDefined();
    // Cae fuerte: el bid (2.84) queda debajo del stop y se vende ahí (deslizamiento por gap).
    b.onQuote(q(2.85), 20);
    expect(b.position('RUN')).toBeUndefined();
    expect(b.orders('RUN')).toHaveLength(0);
    const t = b.session.trades[0];
    expect(t.exitReason).toBe('stop');
    expect(t.avgExit).toBe(2.84);
    expect(t.risk).toBe(22); // (3.01 − 2.90) × 200
    expect(t.r).toBeCloseTo(-34 / 22, 2);
    expect(t.setup).toBe('Bull flag');
    expect(t.mfePct).toBeGreaterThan(0);
    expect(t.maePct).toBeLessThan(0);
  });

  it('el objetivo cancela el stop (OCO)', () => {
    const { b, marks } = setup();
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100, stop: 2.9, target: 3.3 }, q(3), 0, marks);
    b.onQuote(q(3.35), 10);
    expect(b.position('RUN')).toBeUndefined();
    expect(b.orders()).toHaveLength(0);
    expect(b.session.trades[0]).toMatchObject({ exitReason: 'target', avgExit: 3.34 });
  });

  it('una venta parcial achica el stop y el objetivo a las acciones que quedan', () => {
    const { b, marks } = setup();
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 300, stop: 2.9, target: 3.5 }, q(3), 0, marks);
    b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 100 }, q(3.2), 5, marks);
    expect(b.position('RUN')!.shares).toBe(200);
    expect(b.orders('RUN').every((o) => o.shares === 200)).toBe(true);
    expect(b.session.trades).toHaveLength(0);
  });

  it('las compras límite esperan al precio y las compras stop entran en la ruptura', () => {
    const { b, marks } = setup();
    const lim = b.place({ sym: 'RUN', side: 'buy', type: 'limit', shares: 100, price: 2.9 }, q(3), 0, marks);
    expect(lim.ok).toBe(true);
    expect(b.position('RUN')).toBeUndefined();
    expect(b.buyingPower(marks)).toBe(710); // 1000 − 100 × 2.90 reservados
    b.onQuote(q(2.88), 10);
    expect(b.position('RUN')).toMatchObject({ shares: 100, avgCost: 2.89 });
    b.place({ sym: 'RUN', side: 'buy', type: 'stop', shares: 100, price: 3.1 }, q(2.95), 20, marks);
    b.onQuote(q(3.0), 30);
    expect(b.position('RUN')!.shares).toBe(100);
    b.onQuote(q(3.12), 40);
    expect(b.position('RUN')!.shares).toBe(200);
  });

  it('cobra comisiones por acción con mínimo', () => {
    const { b, marks } = setup({ commissionPerShare: 0.005, minCommission: 1 });
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100 }, q(3), 0, marks);
    b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 100 }, q(3.1), 1, marks);
    const t = b.session.trades[0];
    expect(t.fees).toBe(2);
    expect(t.net).toBe(t.gross - 2);
  });

  it('bloquea compras al llegar a la pérdida máxima del día', () => {
    const { b, marks, setPx } = setup({ maxDailyLoss: 30 });
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 200 }, q(3), 0, marks);
    setPx(2.8);
    b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 200 }, q(2.8), 1, marks);
    const r = b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 10 }, q(2.8), 2, marks);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/pérdida máxima/);
  });

  it('cierra todo al terminar el día', () => {
    const { b, marks } = setup();
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100, stop: 2.5 }, q(3), 0, marks);
    const trades = b.flatten(() => q(3.5), 99);
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
  const stateWith = (a: ActiveSession, updatedAt = 1): TrainingState => ({ version: 1, settings: DEFAULT_TRADING, balance: 1000, updatedAt, active: a });

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
