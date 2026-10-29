import { describe, expect, it } from 'vitest';
import { parseMoney } from '../src/client/lib/format';
import { TrainingController } from '../src/client/training';
import type { TrainingStore } from '../src/trading/store';

const store: TrainingStore = {
  kind: 'navegador',
  load: async () => ({ state: null, sessions: [] }),
  saveState: async () => {},
  saveSession: async () => {},
  clear: async () => {},
};

describe('saldo de la cuenta', () => {
  it('se cambia como un depósito o un retiro: no cuenta como ganancia', () => {
    const c = new TrainingController(store, { state: null, sessions: [] }, 'local');
    expect(c.capital).toBe(1000);
    expect(c.setBalance(5000).ok).toBe(true);
    expect(c.active!.cash).toBe(5000);
    // El inicio del día sube igual que el saldo: el resultado de hoy sigue en cero.
    expect(c.active!.startCash).toBe(5000);
    expect(c.capital).toBe(5000);
    expect(c.setBalance(2500).ok).toBe(true);
    expect(c.capital).toBe(2500);
    expect(c.summary().equity).toBe(2500);
  });

  it('no se cambia con posiciones abiertas ni a menos de US$ 1', () => {
    const c = new TrainingController(store, { state: null, sessions: [] }, 'local');
    expect(c.setBalance(0).ok).toBe(false);
    c.active!.positions.push({ sym: 'RUN', side: 'long', shares: 10, avgCost: 3, openedAt: 0, boughtShares: 10, boughtCost: 30, soldShares: 0, soldValue: 0, fees: 0, realized: 0, high: 3, low: 3, fills: 1 });
    expect(c.setBalance(5000).message).toMatch(/Cerrá tus posiciones/);
    expect(c.active!.cash).toBe(1000);
  });

  it('reiniciar la cuenta vuelve el capital al saldo inicial', () => {
    const c = new TrainingController(store, { state: null, sessions: [] }, 'local');
    c.setBalance(8000);
    c.resetAccount(false);
    expect(c.capital).toBe(1000);
    expect(c.active!.cash).toBe(1000);
  });

  it('lee montos escritos con puntos o comas', () => {
    expect(parseMoney('5000')).toBe(5000);
    expect(parseMoney('5.000')).toBe(5000);
    expect(parseMoney('25,000')).toBe(25000);
    expect(parseMoney('US$ 1.500,50')).toBe(1500.5);
    expect(parseMoney('1,500.50')).toBe(1500.5);
    expect(parseMoney('12,5')).toBe(12.5);
    expect(parseMoney('1.000.000')).toBe(1000000);
    expect(parseMoney('abc')).toBeUndefined();
  });
});

describe('análisis de cómo te está yendo', () => {
  it('redacta párrafos con los números clave y maneja la cuenta vacía', async () => {
    const { buildFacts, narrative, reviewPrompt } = await import('../src/client/lib/review');
    const { summarize } = await import('../src/trading/stats');
    const mk = (i: number, net: number, r?: number) =>
      ({ id: `t${i}`, sessionId: `s${i % 3}`, sym: 'RUN', shares: 100, avgEntry: 3, avgExit: 3 + net / 100, openedAt: 1_700_000_000_000 + i * 60_000, closedAt: 1_700_000_000_000 + i * 60_000 + 90_000, gross: net, fees: 0, net, returnPct: net / 3, r, exitReason: 'manual', setup: i % 2 ? 'Bull flag' : 'Gap and go' }) as never;
    const trades = [mk(1, 40, 2), mk(2, -20, -1), mk(3, 60, 3), mk(4, -25, -1), mk(5, 30, 1.5), mk(6, -15)];
    const facts = buildFacts(trades, summarize(trades), [], 1000, (t) => Number(t.sessionId.slice(1)) + 1);
    expect(facts.trades).toBe(6);
    expect(facts.days).toBe(3);
    expect(facts.net).toBe(70);
    const text = narrative(facts).join(' ');
    expect(text).toMatch(/6 trades/);
    expect(text).toMatch(/\$70\.00/);
    expect(text).toMatch(/50 %/);
    expect(reviewPrompt(facts)).toMatch(/voseo/);
    expect(narrative(buildFacts([], summarize([]), [], 1000, () => undefined))[0]).toMatch(/Todavía no hay trades/);
  });
});

