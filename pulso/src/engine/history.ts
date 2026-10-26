// Velas de temporalidades largas (4 h, diaria, semanal, mensual) y la historia de días anteriores para
// los gráficos: se arman con las velas históricas del proveedor más las del día en curso del motor.
import { etParts, etWallToTs, tradingDayStart } from './time';
import type { Bar } from './types';

/** Qué historia necesita cada temporalidad: velas de 1 min de días previos, de 1 hora o diarias. */
export type HistoryTf = 'minute' | 'hour' | 'day';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Temporalidades largas del gráfico, en segundos (la semanal y la mensual son nominales: son claves). */
export const TF_4H = 4 * 3600;
export const TF_DAY = 86_400;
export const TF_WEEK = 7 * 86_400;
export const TF_MONTH = 30 * 86_400;

export function historyFor(tf: number): HistoryTf | null {
  if (tf >= TF_DAY) return 'day';
  if (tf >= TF_4H) return 'hour';
  if (tf >= 60) return 'minute';
  return null;
}

function merge(into: Bar | undefined, b: Bar, t: number): Bar {
  if (!into) return { t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, pv: b.pv, n: b.n };
  into.h = Math.max(into.h, b.h);
  into.l = Math.min(into.l, b.l);
  into.c = b.c;
  into.v += b.v;
  into.pv += b.pv;
  into.n += b.n;
  return into;
}

/** Agrupa velas por una clave de tiempo (el inicio de la vela grande), ordenadas. */
export function groupBy(bars: Bar[], keyOf: (t: number) => number): Bar[] {
  const map = new Map<number, Bar>();
  for (const b of [...bars].sort((a, c) => a.t - c.t)) {
    const k = keyOf(b.t);
    map.set(k, merge(map.get(k), b, k));
  }
  return [...map.values()].sort((a, c) => a.t - c.t);
}

/** Velas de 4 horas alineadas al día de operaciones: 4:00, 8:00, 12:00 y 16:00 ET. */
export function key4h(t: number): number {
  let s = tradingDayStart(t);
  if (t < s) s -= DAY;
  return s + Math.floor((t - s) / (4 * HOUR)) * 4 * HOUR;
}

/** Medianoche ET del día. */
export function keyDay(t: number): number {
  const p = etParts(t);
  return etWallToTs(p.y, p.mo, p.d, 0);
}

/** Medianoche ET del lunes de la semana. */
export function keyWeek(t: number): number {
  const p = etParts(t);
  const dow = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
  const monday = new Date(Date.UTC(p.y, p.mo - 1, p.d - ((dow + 6) % 7)));
  return etWallToTs(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), 0);
}

/** Medianoche ET del primer día del mes. */
export function keyMonth(t: number): number {
  const p = etParts(t);
  return etWallToTs(p.y, p.mo, 1, 0);
}

/** Velas de días anteriores seguidas por las del día en curso (las del día las pone el motor). */
export function withPastDays(past: Bar[], today: Bar[]): Bar[] {
  const first = today.length ? tradingDayStart(today[0].t) : Infinity;
  const older = past.filter((b) => b.t < first);
  return older.length ? [...older, ...today] : today;
}

/** Velas de 4 h: la historia por horas más el día en curso (velas de 1 min) en el mismo molde. */
export function fourHour(hours: Bar[], today: Bar[]): Bar[] {
  return groupBy(withPastDays(hours, today), key4h);
}

/** Lo que lleva el día, para cerrar la vela diaria en curso. */
export interface DayStats {
  open: number;
  high: number;
  low: number;
  last: number;
  volume: number;
  vwap?: number;
  /** Un instante de hoy (para la fecha de la vela). */
  ts: number;
}

/** La vela de hoy a partir de lo que lleva el día (null si todavía no operó). */
export function todayBar(s: DayStats): Bar | null {
  if (!(s.volume > 0) || !(s.open > 0) || !(s.last > 0)) return null;
  const h = Math.max(s.high, s.open, s.last);
  const l = Math.min(s.low > 0 ? s.low : Infinity, s.open, s.last);
  return { t: keyDay(s.ts), o: s.open, h, l, c: s.last, v: s.volume, pv: (s.vwap || s.last) * s.volume, n: 1 };
}

/** Velas diarias: la historia más la de hoy (que reemplaza a la del proveedor si ya la tenía). */
export function daily(days: Bar[], today: Bar | null): Bar[] {
  const past = today ? days.filter((b) => keyDay(b.t) < today.t) : days;
  return groupBy(today ? [...past, today] : past, keyDay);
}

export function weekly(dailyBars: Bar[]): Bar[] {
  return groupBy(dailyBars, keyWeek);
}

export function monthly(dailyBars: Bar[]): Bar[] {
  return groupBy(dailyBars, keyMonth);
}

/** VWAP que arranca de cero cada día de operaciones (para gráficos con varios días). */
export function vwapByDay(bars: Bar[]): number[] {
  let pv = 0;
  let v = 0;
  let day = NaN;
  return bars.map((b) => {
    const d = tradingDayStart(b.t);
    if (d !== day) {
      day = d;
      pv = 0;
      v = 0;
    }
    pv += b.pv;
    v += b.v;
    return v > 0 ? pv / v : b.c;
  });
}
