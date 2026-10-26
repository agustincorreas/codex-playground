// Temporalidades largas: velas de 4 h alineadas al día de operaciones, diarias, semanales y mensuales,
// con el día en curso; y la historia inventada del simulador.
import { describe, expect, it } from 'vitest';
import { daily, fourHour, historyFor, key4h, keyWeek, monthly, TF_4H, TF_DAY, TF_MONTH, TF_WEEK, todayBar, vwapByDay, weekly, withPastDays } from '../src/engine/history';
import { etParts, etWallToTs } from '../src/engine/time';
import type { Bar } from '../src/engine/types';
import { synthHistory } from '../src/sim/history';

const bar = (t: number, c: number, v = 100): Bar => ({ t, o: c, h: c + 0.1, l: c - 0.1, c, v, pv: c * v, n: 1 });
// Lunes 26 de octubre de 2026.
const at = (d: number, minutes: number) => etWallToTs(2026, 10, d, minutes);

describe('temporalidades largas', () => {
  it('elige la historia según la temporalidad', () => {
    expect(historyFor(10)).toBeNull();
    expect(historyFor(60)).toBe('minute');
    expect(historyFor(TF_4H)).toBe('hour');
    expect([TF_DAY, TF_WEEK, TF_MONTH].map(historyFor)).toEqual(['day', 'day', 'day']);
  });

  it('las velas de 4 h empiezan a las 4:00, 8:00, 12:00 y 16:00 ET', () => {
    expect(etParts(key4h(at(26, 9 * 60 + 31))).h).toBe(8);
    expect(etParts(key4h(at(26, 15 * 60 + 59))).h).toBe(12);
    expect(etParts(key4h(at(26, 19 * 60))).h).toBe(16);
    const hours = [bar(at(23, 8 * 60), 2), bar(at(23, 9 * 60), 2.2), bar(at(23, 12 * 60), 2.1)];
    const today = [bar(at(26, 9 * 60 + 30), 3), bar(at(26, 9 * 60 + 31), 3.5, 50)];
    const out = fourHour(hours, today);
    expect(out.map((b) => [etParts(b.t).d, etParts(b.t).h, b.o, b.c, b.v])).toEqual([
      [23, 8, 2, 2.2, 200],
      [23, 12, 2.1, 2.1, 100],
      [26, 8, 3, 3.5, 150],
    ]);
  });

  it('la diaria reemplaza la vela de hoy del proveedor por lo que lleva el día; semanal y mensual agrupan', () => {
    const days = [bar(etWallToTs(2026, 9, 30, 0), 1), bar(etWallToTs(2026, 10, 1, 0), 1.2), bar(etWallToTs(2026, 10, 23, 0), 2), bar(etWallToTs(2026, 10, 26, 0), 2.5)];
    const today = todayBar({ open: 2.1, high: 3.3, low: 2.0, last: 3.1, volume: 900_000, vwap: 2.8, ts: at(26, 10 * 60) });
    const d = daily(days, today);
    expect(d).toHaveLength(4);
    expect(d[3]).toMatchObject({ o: 2.1, h: 3.3, l: 2.0, c: 3.1, v: 900_000 });
    expect(etParts(d[3].t)).toMatchObject({ d: 26, h: 0 });
    // Sin operar todavía no hay vela de hoy.
    expect(todayBar({ open: 0, high: 0, low: 0, last: 0, volume: 0, ts: at(26, 5 * 60) })).toBeNull();
    const w = weekly(d);
    expect(w.map((b) => etParts(b.t).d)).toEqual([28, 19, 26]); // lunes 28/9, 19/10 y 26/10
    expect(etParts(keyWeek(at(26, 600))).dow).toBe(1);
    const m = monthly(d);
    expect(m.map((b) => [etParts(b.t).mo, b.o, b.c])).toEqual([
      [9, 1, 1],
      [10, 1.2, 3.1],
    ]);
  });

  it('agrega los días anteriores antes de las velas del día y el VWAP arranca de cero cada día', () => {
    const past = [bar(at(23, 9 * 60 + 30), 2, 100), bar(at(23, 9 * 60 + 31), 4, 100), bar(at(26, 4 * 60), 9)];
    const today = [bar(at(26, 9 * 60 + 30), 3, 100)];
    const all = withPastDays(past, today);
    // La vela del proveedor de hoy a las 4:00 no se mezcla con las del motor.
    expect(all.map((b) => b.c)).toEqual([2, 4, 3]);
    expect(vwapByDay(all)).toEqual([2, 3, 3]);
  });

  it('la historia del simulador es determinista, ordenada y termina en el cierre anterior', () => {
    const now = at(26, 10 * 60);
    const a = synthHistory('RUNR', 2.5, 400_000, 'day', now);
    const b = synthHistory('RUNR', 2.5, 400_000, 'day', now);
    expect(a).toEqual(b);
    expect(a.length).toBe(600);
    expect(a[a.length - 1].c).toBe(2.5);
    expect(etParts(a[a.length - 1].t).d).toBe(23);
    for (let i = 1; i < a.length; i++) expect(a[i].t).toBeGreaterThan(a[i - 1].t);
    for (const x of a) expect(x.h >= Math.max(x.o, x.c) && x.l <= Math.min(x.o, x.c) && x.l > 0).toBe(true);
    const h = synthHistory('RUNR', 2.5, 400_000, 'hour', now);
    expect(h.length).toBe(90 * 16);
    expect(etParts(h[0].t).h).toBe(4);
    const m = synthHistory('RUNR', 2.5, 400_000, 'minute', now);
    expect(m.length).toBe(5 * 960);
    expect(synthHistory('X', undefined, 1, 'day', now)).toEqual([]);
  });
});
