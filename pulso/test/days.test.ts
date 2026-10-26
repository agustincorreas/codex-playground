import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseBackup, TrainingController } from '../src/client/training';
import type { DataSource } from '../src/client/source/types';
import { etWallToTs, sessionAt } from '../src/engine/time';
import { seedForDay } from '../src/sim/simulator';
import type { TrainingStore } from '../src/trading/store';
import { SIM_VERSION, type SessionRecord, type TrainingState } from '../src/trading/types';

function memoryStore(): TrainingStore & { state: TrainingState | null; sessions: SessionRecord[] } {
  const s = {
    kind: 'navegador' as const,
    state: null as TrainingState | null,
    sessions: [] as SessionRecord[],
    load: async () => ({ state: s.state, sessions: s.sessions }),
    saveState: async (st: TrainingState) => {
      s.state = structuredClone(st);
    },
    saveSession: async (rec: SessionRecord) => {
      s.sessions = [structuredClone(rec), ...s.sessions.filter((x) => x.id !== rec.id)];
    },
    clear: async () => {
      s.state = null;
      s.sessions = [];
    },
  };
  return s;
}

/** Fuente mínima: un reloj de mercado y nada más (alcanza para el fin del día). */
function fakeSource(clock: { now: number }): DataSource {
  return {
    kind: 'local',
    ready: true,
    depthIsReal: true,
    start: () => {},
    stop: () => {},
    select: () => {},
    setSettings: () => {},
    setWatchlist: () => {},
    setTracked: () => {},
    setSpeed: () => {},
    search: async () => [],
    now: () => clock.now,
    quote: () => null,
    row: () => null,
    reviewBars: () => undefined,
    book: () => null,
    printsSince: () => [],
    lastSeq: () => 0,
    session: (t) => sessionAt(t),
  };
}

const at = (iso: string) => vi.setSystemTime(new Date(iso));

afterEach(() => {
  vi.useRealTimers();
});

describe('días de práctica', () => {
  it('"Mercado ahora": el día de hoy, con la semilla de la fecha y el reloj de Nueva York', () => {
    vi.useFakeTimers();
    at('2026-10-26T14:42:00Z'); // lunes 10:42 ET
    const c = new TrainingController(memoryStore(), { state: null, sessions: [] }, 'local');
    c.newDay({ clock: 'ny' });
    const a = c.active!;
    expect(a.clock).toBe('ny');
    expect(a.dayKey).toBe('2026-10-26');
    expect(a.seed).toBe(seedForDay('2026-10-26'));
    expect(Math.round(a.startMinutes!)).toBe(10 * 60 + 42);
    expect(c.simConfig).toMatchObject({ realtime: true, sessionId: a.id });
    expect(c.state.settings.clock).toBe('ny');
    // Con órdenes en espera, al volver se repasa desde donde quedó (con solo posiciones no hace falta).
    a.simNow = Date.now();
    a.positions.push({ sym: 'RUN', shares: 10, avgCost: 3, openedAt: 0, boughtShares: 10, boughtCost: 30, soldShares: 0, soldValue: 0, fees: 0, realized: 0, high: 3, low: 3, fills: 1 });
    expect(c.simConfig?.catchUpFrom).toBeUndefined();
    a.orders.push({ id: 'o1', sym: 'RUN', side: 'sell', type: 'stop', role: 'stop', shares: 10, stopPrice: 2.8, tif: 'DAY+', route: 'SMRT', status: 'open', createdAt: 0, activeAt: 0, updatedAt: 0, filled: 0, avgPrice: 0 });
    expect(c.simConfig?.catchUpFrom).toBe(a.simNow);
  });

  it('con Nueva York cerrado no arranca: queda elegido y avisa cuándo abre', () => {
    vi.useFakeTimers();
    at('2026-10-24T15:00:00Z'); // sábado
    const c = new TrainingController(memoryStore(), { state: null, sessions: [] }, 'local');
    c.newDay({ clock: 'ny' });
    expect(c.active).toBeUndefined();
    expect(c.nyClosedUntil).toBe(etWallToTs(2026, 10, 26, 4 * 60));
    expect(c.ensureSession()).toBe(false);
    at('2026-10-26T08:01:00Z'); // lunes 4:01 ET: abrió el pre-market
    expect(c.ensureSession()).toBe(true);
    expect(c.active?.dayKey).toBe('2026-10-26');
  });

  it('un día de práctica con fecha y hora elegidas, y repetirlo da el mismo mercado', () => {
    vi.useFakeTimers();
    at('2026-10-25T15:00:00Z');
    const c = new TrainingController(memoryStore(), { state: null, sessions: [] }, 'local');
    c.newDay({ clock: 'practice', date: '2026-10-17', startMinutes: 7 * 60 }); // sábado: usa el viernes 16
    const a = c.active!;
    expect(a.dayKey).toBe('2026-10-16');
    expect(a.startMinutes).toBe(7 * 60);
    expect(a.clock).toBeUndefined();
    expect(c.state.settings.startMinutes).toBe(7 * 60);
    a.trades.push({ id: 't1', sessionId: a.id, sym: 'RUN', shares: 10, entry: 3, exit: 3.2, openedAt: 0, closedAt: 1, gross: 2, fees: 0, net: 2, r: 0 } as never);
    const rec = c.endDay()!;
    expect(rec.seed).toBe(a.seed);
    expect(rec.simVersion).toBe(SIM_VERSION);
    expect(c.canReplay(rec)).toBe(true);
    c.replayDay(rec);
    const b = c.active!;
    expect(b.id).not.toBe(a.id);
    expect([b.seed, b.dayKey, b.startMinutes]).toEqual([a.seed, a.dayKey, a.startMinutes]);
    expect(c.canReplay({ ...rec, simVersion: SIM_VERSION - 1 })).toBe(false);
  });

  it('el día termina con el after-hours: con trades se cierra solo; "Mercado ahora" siempre', () => {
    vi.useFakeTimers();
    at('2026-10-26T14:00:00Z');
    const c = new TrainingController(memoryStore(), { state: null, sessions: [] }, 'local');
    const clock = { now: etWallToTs(2026, 10, 23, 16 * 60 + 30) };
    c.newDay({ clock: 'practice', date: '2026-10-23' });
    c.attach(fakeSource(clock));
    c.onTick(clock.now);
    expect(c.active).toBeDefined(); // 16:30: sigue el after-hours
    clock.now = etWallToTs(2026, 10, 23, 19 * 60 + 59);
    c.onTick(clock.now);
    expect(c.active).toBeDefined(); // sin trades no se archiva nada
    c.active!.trades.push({ id: 't1', net: 5 } as never);
    c.onTick(clock.now);
    expect(c.active).toBeUndefined();
    expect(c.sessions[0].trades).toHaveLength(1);

    c.newDay({ clock: 'ny' });
    expect(c.active?.clock).toBe('ny');
    const nyClock = { now: etWallToTs(2026, 10, 26, 19 * 60 + 59) };
    at('2026-10-26T23:59:10Z'); // 19:59 ET
    c.attach(fakeSource(nyClock));
    c.onTick(nyClock.now);
    // Terminó y no arranca otro día en el último minuto: el próximo es el pre-market del martes.
    expect(c.active).toBeUndefined();
    expect(c.nyClosedUntil).toBe(etWallToTs(2026, 10, 27, 4 * 60));
  });

  it('al cargar, un día de "Mercado ahora" que ya terminó se archiva; con posiciones se deja para cerrarlas', () => {
    vi.useFakeTimers();
    at('2026-10-26T14:00:00Z');
    const store = memoryStore();
    const c = new TrainingController(store, { state: null, sessions: [] }, 'local');
    c.newDay({ clock: 'ny' });
    const st = structuredClone(c.state);
    at('2026-10-27T13:00:00Z'); // al otro día, 9:00 ET
    const empty = new TrainingController(memoryStore(), { state: structuredClone(st), sessions: [] }, 'local');
    expect(empty.active?.dayKey).toBe('2026-10-27');
    st.active!.positions.push({ sym: 'RUN', shares: 10, avgCost: 3, openedAt: 0, boughtShares: 10, boughtCost: 30, soldShares: 0, soldValue: 0, fees: 0, realized: 0, high: 3, low: 3, fills: 1 });
    st.active!.simNow = etWallToTs(2026, 10, 26, 11 * 60);
    const open = new TrainingController(memoryStore(), { state: st, sessions: [] }, 'local');
    expect(open.active?.dayKey).toBe('2026-10-26');
    expect(open.simConfig?.realtime).toBe(true);
  });
});

describe('respaldo de la cuenta', () => {
  it('se exporta y se importa en otro navegador con el saldo, los ajustes y el diario', async () => {
    const a = new TrainingController(memoryStore(), { state: null, sessions: [] }, 'local');
    a.setBalance(7500);
    a.updateSettings({ defaultShares: 250 });
    a.active!.trades.push({ id: 't1', sessionId: a.active!.id, net: 12 } as never);
    a.endDay();
    a.newDay({ clock: 'practice' });
    const file = JSON.parse(JSON.stringify(a.exportBackup()));
    expect(file).toMatchObject({ app: 'pulso', kind: 'cuenta-de-practica', version: 1 });

    const store = memoryStore();
    const b = new TrainingController(store, { state: null, sessions: [] }, 'local');
    const res = await b.importBackup(file);
    expect(res.ok).toBe(true);
    expect(b.state.balance).toBe(7500);
    expect(b.capital).toBe(7500);
    expect(b.state.settings.defaultShares).toBe(250);
    expect(b.sessions.map((s) => s.id)).toEqual(a.sessions.map((s) => s.id));
    expect(b.active?.id).toBe(a.active?.id);
    // Quedó guardado (la cuenta anterior de este navegador se reemplazó).
    expect(store.state?.balance).toBe(7500);
    expect(store.sessions).toHaveLength(1);
  });

  it('con la cuenta en el servidor, un cambio desde otro dispositivo se recarga sin perder la fuente', async () => {
    const shared = memoryStore();
    const a = new TrainingController(shared, { state: null, sessions: [] }, 'remote');
    const src = fakeSource({ now: Date.now() });
    a.attach(src);
    expect(a.ready).toBe(true);
    // "Otro dispositivo" (b) cambia el saldo y cierra un día sobre el mismo almacenamiento.
    const b = new TrainingController(shared, await shared.load(), 'remote');
    b.setBalance(4200);
    b.active!.trades.push({ id: 't9', sessionId: b.active!.id, net: 5 } as never);
    b.endDay();
    await new Promise((r) => setTimeout(r, 0));
    expect(a.state.balance).not.toBe(4200);
    await a.reload();
    expect(a.state.balance).toBe(4200);
    expect(a.sessions.map((s) => s.id)).toEqual(b.sessions.map((s) => s.id));
    // Sigue enganchado a la misma fuente de datos: se puede operar enseguida.
    expect(a.ready).toBe(true);
  });

  it('rechaza archivos que no son un respaldo de Pulso', () => {
    expect(parseBackup(null)).toMatch(/no es un respaldo/);
    expect(parseBackup({ app: 'otra' })).toMatch(/no es un respaldo/);
    expect(parseBackup({ app: 'pulso', kind: 'cuenta-de-practica', version: 9, state: {}, sessions: [] })).toMatch(/versión más nueva/);
    expect(parseBackup({ app: 'pulso', kind: 'cuenta-de-practica', version: 1, state: { balance: 'x' }, sessions: [] })).toMatch(/falta la cuenta/);
    const ok = parseBackup({ app: 'pulso', kind: 'cuenta-de-practica', version: 1, state: { balance: 10, settings: {}, active: { cash: 1 } }, sessions: [{ id: 'x', dayKey: '2026-10-23', trades: [] }, { bad: true }] });
    expect(typeof ok).toBe('object');
    if (typeof ok === 'object') {
      expect(ok.sessions).toHaveLength(1);
      expect(ok.state.active).toBeUndefined();
    }
  });
});

describe('venta desde la barra del celular', () => {
  it('vende la cantidad pedida, sin pasarse de la posición', () => {
    vi.useFakeTimers();
    at('2026-10-26T14:00:00Z');
    const c = new TrainingController(memoryStore(), { state: null, sessions: [] }, 'local');
    c.newDay({ clock: 'practice', date: '2026-10-23' });
    const clock = { now: etWallToTs(2026, 10, 23, 10 * 60) };
    const src = fakeSource(clock);
    src.quote = (sym) => ({ sym, last: 3, bid: 2.99, ask: 3.01, bidSize: 500, askSize: 500, real: true, ts: clock.now, halted: false, volPerMin: 10_000 });
    c.attach(src);
    c.active!.positions.push({ sym: 'RUN', shares: 100, avgCost: 3, openedAt: 0, boughtShares: 100, boughtCost: 300, soldShares: 0, soldValue: 0, fees: 0, realized: 0, high: 3, low: 3, fills: 1 });
    expect(c.sell('RUN', 1, 'bid', -0.05, 37).ok).toBe(true);
    const first = c.orderLog()[0];
    expect([first.side, first.shares, first.price]).toEqual(['sell', 37, 2.94]);
    c.cancelAll('RUN');
    expect(c.sell('RUN', 1, 'bid', -0.05, 500).ok).toBe(true);
    expect(c.orderLog()[0].shares).toBe(100);
  });
});

