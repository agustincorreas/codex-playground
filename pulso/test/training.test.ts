// Controlador de la cuenta de práctica: la regla PDT a través de los días archivados al cargar, el
// cierre del día sin fuente de datos, los retiros y la relectura de la cuenta por revisión.
import { describe, expect, it, vi } from 'vitest';
import { narrative, type ReviewFacts } from '../src/client/lib/review';
import { TrainingController } from '../src/client/training';
import type { TrainingStore } from '../src/trading/store';
import { DEFAULT_TRADING, SIM_VERSION, type ActiveSession, type Position, type Trade, type TrainingState } from '../src/trading/types';

const emptyStore = (): TrainingStore => ({ kind: 'navegador', load: async () => ({ state: null, sessions: [] }), saveState: async () => {}, saveSession: async () => {}, clear: async () => {} });

const trade = (i: number, net = 10): Trade =>
  ({ id: `t${i}`, sessionId: 's', sym: 'RUN', openedAt: 1, closedAt: 2, shares: 100, avgEntry: 3, avgExit: 3.1, gross: net, fees: 0, net, returnPct: 1, mfePct: 1, maePct: 0, exitReason: 'manual', fills: 2 }) as Trade;

const position = (shares: number, avgCost: number): Position => ({ sym: 'RUN', side: 'long', shares, avgCost, openedAt: 1, boughtShares: shares, boughtCost: shares * avgCost, soldShares: 0, soldValue: 0, fees: 0, realized: 0, high: avgCost, low: avgCost, fills: 1 });

/** Un día simulado guardado con la versión actual: se puede reanudar. */
function simDay(dayIndex: number, extra: Partial<ActiveSession> = {}): ActiveSession {
  return { id: `d${dayIndex}`, mode: 'sim', seed: 7, simVersion: SIM_VERSION, dayTs: Date.now(), startMinutes: 565, dayKey: '2026-10-23', dayIndex, startedAt: 1, marketStart: 1, startCash: 1000, cash: 1000, unsettled: 0, positions: [], orders: [], history: [], fills: [], trades: [], seq: 0, ...extra };
}

function state(active: ActiveSession | undefined, extra: Partial<TrainingState> = {}): TrainingState {
  return { version: 1, settings: { ...DEFAULT_TRADING, account: 'margin', pdt: true }, balance: 1000, dayIndex: active?.dayIndex ?? 0, dayTrades: [], active, updatedAt: 1, ...extra };
}

describe('regla PDT a través de settle()', () => {
  it('los day trades de un día viejo que se archiva al cargar cuentan en la ventana de 5 días', () => {
    // Un día de "Mercado ahora" de otra fecha con 3 trades: al cargar se archiva y bloquea el cuarto day trade.
    const old = simDay(4, { clock: 'ny', dayKey: '2020-01-02', trades: [trade(1), trade(2), trade(3)] });
    const c = new TrainingController(emptyStore(), { state: state(old), sessions: [] }, 'local');
    expect(c.active!.dayIndex).toBe(5);
    expect(c.state.dayTrades).toEqual([4, 4, 4]);
    expect(c.summary().dayTrades).toBe(3);
    // Un día de otro modo (en vivo) con posiciones vivas: se archiva y las posiciones vuelven al efectivo a su costo.
    const withPos = simDay(2, { mode: 'live', seed: undefined, simVersion: undefined, cash: 400, positions: [position(200, 3)] });
    const c2 = new TrainingController(emptyStore(), { state: state(withPos), sessions: [] }, 'local');
    expect(c2.state.balance).toBe(1000);
    expect(c2.active!.cash).toBe(1000);
  });

  it('la ventana se corre con los días: a los 5 días de práctica el day trade viejo deja de contar', () => {
    const a = simDay(9);
    const c = new TrainingController(emptyStore(), { state: state(a, { dayTrades: [4, 4, 4, 5, 6] }), sessions: [] }, 'local');
    // Ventana del día 9: días 5 a 8.
    expect(c.summary().dayTrades).toBe(2);
  });
});

describe('fin del día', () => {
  it('sin fuente de datos, las posiciones se cierran al costo antes de archivar: nada queda vivo ni se pierde dinero', () => {
    const a = simDay(1, { cash: 400, positions: [position(200, 3)], orders: [] });
    const st = state(a);
    st.settings = { ...st.settings, regFees: false };
    const c = new TrainingController(emptyStore(), { state: st, sessions: [] }, 'local');
    expect(c.active!.positions).toHaveLength(1);
    const rec = c.endDay()!;
    expect(rec.trades).toHaveLength(1);
    expect(rec.trades[0]).toMatchObject({ exitReason: 'eod', shares: 200, avgExit: 3 });
    expect(rec.endCash).toBe(1000);
    expect(c.state.balance).toBe(1000);
    expect(c.state.dayTrades).toEqual([1]);
  });
});

describe('retiros y depósitos', () => {
  it('un retiro no libera lo vendido hoy que espera la liquidación (T+1); un depósito sí', () => {
    const c = new TrainingController(emptyStore(), { state: null, sessions: [] }, 'local');
    c.active!.cash = 1000;
    c.active!.unsettled = 600;
    expect(c.setBalance(500).ok).toBe(true);
    expect(c.active!.unsettled).toBe(500);
    c.active!.unsettled = 300;
    expect(c.setBalance(2000).ok).toBe(true);
    expect(c.active!.unsettled).toBe(0);
  });
});

describe('relectura de la cuenta (otro dispositivo la cambió)', () => {
  function serverStore(initial: TrainingState | null) {
    let rev = 3;
    let saved: TrainingState | null = initial;
    const s: TrainingStore & { rev: number; loads: number; flushes: number } = {
      kind: 'servidor',
      rev,
      loads: 0,
      flushes: 0,
      load: async () => {
        s.loads++;
        s.rev = rev;
        return { state: saved, sessions: [] };
      },
      saveState: async (st) => {
        saved = st;
        s.rev = ++rev;
      },
      saveSession: async () => {},
      clear: async () => {},
      flush: async () => {
        s.flushes++;
      },
      /** El servidor subió de revisión por otro dispositivo. */
      bump: undefined as unknown as () => number,
    } as TrainingStore & { rev: number; loads: number; flushes: number };
    return Object.assign(s, { bump: (st: TrainingState) => ((saved = st), ++rev) });
  }

  it('un aviso con una revisión ya conocida no hace nada; uno más nuevo cancela el guardado pendiente, espera y relee', async () => {
    vi.useFakeTimers();
    try {
      const day = simDay(1);
      const store = serverStore(state(day));
      const c = new TrainingController(store, { state: state(day), sessions: [] }, 'local');
      await c.reload(3);
      expect(store.loads).toBe(0);
      c.updateSettings({ defaultShares: 50 });
      // Otro dispositivo guardó un saldo distinto en el mismo día.
      const rev = store.bump(state({ ...day, cash: 2500 }, { balance: 2500, updatedAt: 2 }));
      await c.reload(rev);
      expect(store.flushes).toBe(1);
      expect(store.loads).toBe(1);
      expect(c.active!.cash).toBe(2500);
      // Mismo día: el mercado simulado no se regenera.
      expect(c.simKey).toBe(`${day.id}:0`);
      // Otro día: sí.
      const other = store.bump(state(simDay(2), { updatedAt: 3 }));
      await c.reload(other);
      expect(c.active!.id).toBe('d2');
      expect(c.simKey).toBe('d2:1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('un conflicto al guardar (el servidor tiene una cuenta más nueva) reemplaza la de la página', () => {
    const day = simDay(1);
    const store = serverStore(state(day));
    const c = new TrainingController(store, { state: state(day), sessions: [] }, 'local');
    store.onConflict!({ state: state({ ...day, cash: 1800 }, { balance: 1800, updatedAt: 9 }), sessions: [] });
    expect(c.active!.cash).toBe(1800);
    expect(c.notices.at(-1)?.text).toMatch(/Otro dispositivo/);
  });
});

describe('análisis automático', () => {
  it('no deja una "y" suelta cuando hay horarios pero un solo setup', () => {
    const facts = {
      trades: 20,
      days: 5,
      net: 100,
      winRate: 50,
      plRatio: 1.2,
      withStopPct: 80,
      avgWinHoldMin: 3,
      avgLossHoldMin: 3,
      maxDrawdown: 0,
      capital: 1000,
      worstStreak: 1,
      largestLoss: -10,
      bestHour: { label: '9:30 a 10:00', net: 80, trades: 5 },
      worstHour: { label: '11:00 a 12:00', net: -20, trades: 3 },
      worstSetup: { label: 'Rojo a verde', net: -15, trades: 4, winRate: 25 },
      lastDays: [],
    } as unknown as ReviewFacts;
    const text = narrative(facts).join(' ');
    expect(text).not.toMatch(/\. y /);
    expect(text).not.toMatch(/\by\s+y\b/);
    expect(text).toMatch(/Tu mejor horario es 9:30 a 10:00 \(\$80\.00 en 5 trades\) y el que más te cuesta es 11:00 a 12:00 \(−?-?\$20\.00\)\./);
    expect(text).toMatch(/Con Rojo a verde te está costando/);
  });
});
