import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readNow, resetClockForTests, setClock, subscribeNow } from '../src/client/lib/now';

describe('reloj compartido de la interfaz', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetClockForTests();
  });
  afterEach(() => {
    resetClockForTests();
    vi.useRealTimers();
  });

  it('sin fuente de datos vale 0 (el encabezado muestra --:--:--)', () => {
    expect(readNow()).toBe(0);
  });

  it('lee la hora de la fuente y avisa a los suscriptores cuatro veces por segundo', () => {
    let t = 1_000_000;
    setClock(() => t);
    const seen: number[] = [];
    const off = subscribeNow(() => seen.push(readNow()));
    t = 1_000_250;
    vi.advanceTimersByTime(250);
    t = 1_000_500;
    vi.advanceTimersByTime(250);
    expect(seen).toEqual([1_000_250, 1_000_500]);
    off();
    t = 1_000_750;
    vi.advanceTimersByTime(1000);
    // Sin suscriptores no hay intervalo corriendo.
    expect(seen).toEqual([1_000_250, 1_000_500]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('no avisa si la hora no cambió', () => {
    setClock(() => 42);
    let calls = 0;
    const off = subscribeNow(() => calls++);
    vi.advanceTimersByTime(1000);
    expect(calls).toBe(0);
    off();
  });

  it('con `null` el reloj se apaga', () => {
    setClock(() => 99);
    expect(readNow()).toBe(99);
    setClock(null);
    expect(readNow()).toBe(0);
  });
});
