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
    c.active!.positions.push({ sym: 'RUN', shares: 10, avgCost: 3, openedAt: 0, boughtShares: 10, boughtCost: 30, soldShares: 0, soldValue: 0, fees: 0, realized: 0, high: 3, low: 3, fills: 1 });
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
