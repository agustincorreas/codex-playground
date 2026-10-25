// Etiquetas de los días simulados: fecha, hora de inicio, clima del día y avisos del calendario.
import { etParts, etWallToTs, isTradingDay, REG_CLOSE, regularCloseMinutes } from '../../engine/time';
import { lastTradingDay } from '../../sim/simulator';

export type Heat = 'cold' | 'normal' | 'hot';

export const HEAT_LABEL: Record<Heat, string> = { cold: 'Día frío', normal: 'Día normal', hot: 'Día caliente' };
export const HEAT_HINT: Record<Heat, string> = {
  cold: 'pocos gappers y corridas cortas: más fácil perder plata que ganarla',
  normal: 'un día típico de small caps',
  hot: 'muchos gappers y corridas grandes, más seguidas',
};

const pad = (n: number) => String(n).padStart(2, '0');

export function dayKeyOf(d: { y: number; mo: number; d: number }): string {
  return `${d.y}-${pad(d.mo)}-${pad(d.d)}`;
}

function noonOf(dayKey: string): number {
  const [y, mo, d] = dayKey.split('-').map(Number);
  return etWallToTs(y, mo, d, 12 * 60);
}

/** "vie 23 oct" o "viernes 23 de octubre". */
export function fmtDay(dayKey: string, long = false): string {
  const f = new Intl.DateTimeFormat('es-AR', long ? { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/New_York' } : { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/New_York' });
  return f.format(noonOf(dayKey)).replace(/\./g, '').replace(',', '');
}

/** Minutos del día → "9:25". */
export function fmtMinutes(m: number): string {
  const r = Math.round(m);
  return `${Math.floor(r / 60)}:${pad(r % 60)}`;
}

/** "09:25" ↔ minutos (para los campos de hora). */
export function toHHMM(m: number): string {
  const r = Math.round(m);
  return `${pad(Math.floor(r / 60))}:${pad(r % 60)}`;
}

export function fromHHMM(s: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

/** Último día hábil hasta hoy (el día de práctica por defecto). */
export function lastSessionKey(now = Date.now()): string {
  return dayKeyOf(lastTradingDay(now));
}

/** Fin del after-hours de ese día (minutos ET). */
export function postEnd(dayKey: string): number {
  return regularCloseMinutes(dayKey) === REG_CLOSE ? 20 * 60 : 17 * 60;
}

export interface DayChoice {
  /** Día hábil que se simula (si el elegido no lo es, el hábil anterior). */
  key: string;
  notes: string[];
}

/** Qué día se simula si elegís `dayKey` y qué tiene de especial. */
export function resolveDay(dayKey: string): DayChoice {
  const noon = noonOf(dayKey);
  const p = etParts(noon);
  const key = isTradingDay(p) ? p.dateKey : dayKeyOf(lastTradingDay(noon));
  const notes: string[] = [];
  if (key !== p.dateKey) notes.push(`Ese día no hay mercado (fin de semana o feriado): se simula el ${fmtDay(key, true)}.`);
  if (regularCloseMinutes(key) !== REG_CLOSE) notes.push('Cierre anticipado: la rueda termina a las 13:00 y el after-hours a las 17:00.');
  const prev = lastTradingDay(noonOf(key) - 24 * 3_600_000);
  const gap = Math.round((noonOf(key) - noonOf(dayKeyOf(prev))) / 86_400_000);
  if (gap >= 3) notes.push('Viene de un fin de semana o un feriado: suele haber más gappers (se juntaron noticias).');
  return { key, notes };
}
