// Hora de Nueva York (ET), sesiones del mercado y calendario de feriados NYSE.
import type { Session } from './types';

const MIN = 60_000;
const HOUR = 60 * MIN;

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const offsetCache = new Map<number, number>();

/** Diferencia (ms) entre la hora de pared de ET y UTC para el instante `ts` (−4 h o −5 h). */
export function etOffset(ts: number): number {
  const bucket = Math.floor(ts / HOUR);
  const cached = offsetCache.get(bucket);
  if (cached !== undefined) return cached;
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(new Date(bucket * HOUR))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const off = Math.round((asUtc - bucket * HOUR) / MIN) * MIN;
  if (offsetCache.size > 2000) offsetCache.clear();
  offsetCache.set(bucket, off);
  return off;
}

export interface EtParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  /** 0 = domingo. */
  dow: number;
  /** Minutos desde la medianoche ET. */
  minutes: number;
  dateKey: string;
}

export function etParts(ts: number): EtParts {
  const wall = new Date(ts + etOffset(ts));
  const y = wall.getUTCFullYear();
  const mo = wall.getUTCMonth() + 1;
  const d = wall.getUTCDate();
  const h = wall.getUTCHours();
  const mi = wall.getUTCMinutes();
  const s = wall.getUTCSeconds();
  return {
    y,
    mo,
    d,
    h,
    mi,
    s,
    dow: wall.getUTCDay(),
    minutes: h * 60 + mi + s / 60,
    dateKey: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  };
}

/** Convierte una hora de pared ET (fecha + minutos del día) a ms epoch. */
export function etWallToTs(y: number, mo: number, d: number, minutes: number): number {
  const guess = Date.UTC(y, mo - 1, d) + minutes * MIN;
  let ts = guess - etOffset(guess);
  ts = guess - etOffset(ts);
  return ts;
}

// Calendario NYSE por regla (feriados y cierres anticipados a las 13:00 ET), más los cierres excepcionales.
/** Cierres excepcionales que ninguna regla da (duelo nacional, etc.). */
const SPECIAL_CLOSED = new Set(['2025-01-09']); // Funeral de Estado de Jimmy Carter.

const key = (y: number, mo: number, d: number) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const dowOf = (y: number, mo: number, d: number) => new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
/** Fecha corrida `days` días (en UTC, sin horario de verano de por medio). */
function shift(y: number, mo: number, d: number, days: number): [number, number, number] {
  const x = new Date(Date.UTC(y, mo - 1, d + days));
  return [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()];
}
/** El enésimo (`n`) día de la semana `dow` del mes (n = −1: el último). */
function nthDow(y: number, mo: number, dow: number, n: number): [number, number, number] {
  if (n > 0) {
    const first = dowOf(y, mo, 1);
    return [y, mo, 1 + ((dow - first + 7) % 7) + (n - 1) * 7];
  }
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const last = dowOf(y, mo, lastDay);
  return [y, mo, lastDay - ((last - dow + 7) % 7)];
}
/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher, calendario gregoriano). */
function easter(y: number): [number, number, number] {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31);
  const d2 = ((h + l - 7 * m + 114) % 31) + 1;
  return [y, mo, d2];
}
/**
 * Observancia de un feriado de fecha fija: sábado → viernes anterior, domingo → lunes siguiente. Si el
 * viernes cae en el año anterior (1 de enero sábado), la NYSE no lo observa.
 */
function observed(y: number, mo: number, d: number): [number, number, number] | null {
  const dow = dowOf(y, mo, d);
  if (dow === 6) {
    const f = shift(y, mo, d, -1);
    return f[0] === y ? f : null;
  }
  if (dow === 0) return shift(y, mo, d, 1);
  return [y, mo, d];
}

const calendarCache = new Map<number, { holidays: Set<string>; early: Set<string> }>();

/** Feriados y cierres anticipados NYSE de un año, calculados por regla. */
export function nyseCalendar(y: number): { holidays: Set<string>; early: Set<string> } {
  const hit = calendarCache.get(y);
  if (hit) return hit;
  const holidays = new Set<string>();
  const early = new Set<string>();
  const add = (x: [number, number, number] | null) => x && holidays.add(key(...x));
  add(observed(y, 1, 1)); // Año Nuevo
  add(nthDow(y, 1, 1, 3)); // Martin Luther King (tercer lunes de enero)
  add(nthDow(y, 2, 1, 3)); // Presidentes (tercer lunes de febrero)
  add(shift(...easter(y), -2)); // Viernes Santo
  add(nthDow(y, 5, 1, -1)); // Memorial Day (último lunes de mayo)
  add(observed(y, 6, 19)); // Juneteenth
  add(observed(y, 7, 4)); // Independencia
  add(nthDow(y, 9, 1, 1)); // Labor Day (primer lunes de septiembre)
  const thanksgiving = nthDow(y, 11, 4, 4);
  add(thanksgiving); // Acción de Gracias (cuarto jueves de noviembre)
  add(observed(y, 12, 25)); // Navidad
  const weekday = (x: [number, number, number]) => dowOf(...x) >= 1 && dowOf(...x) <= 5 && !holidays.has(key(...x));
  // 3 de julio si es hábil y el 4 cae en día de semana; viernes después de Acción de Gracias; 24 de diciembre si es hábil.
  const july3: [number, number, number] = [y, 7, 3];
  if (weekday(july3) && dowOf(y, 7, 4) >= 1 && dowOf(y, 7, 4) <= 5) early.add(key(...july3));
  early.add(key(...shift(...thanksgiving, 1)));
  const dec24: [number, number, number] = [y, 12, 24];
  if (weekday(dec24)) early.add(key(...dec24));
  const out = { holidays, early };
  calendarCache.set(y, out);
  return out;
}

function isHoliday(dateKey: string): boolean {
  return SPECIAL_CLOSED.has(dateKey) || nyseCalendar(Number(dateKey.slice(0, 4))).holidays.has(dateKey);
}

export const PRE_OPEN = 4 * 60;
export const REG_OPEN = 9 * 60 + 30;
export const REG_CLOSE = 16 * 60;
export const POST_CLOSE = 20 * 60;

export function isTradingDay(p: EtParts): boolean {
  return p.dow !== 0 && p.dow !== 6 && !isHoliday(p.dateKey);
}

export function regularCloseMinutes(dateKey: string): number {
  return nyseCalendar(Number(dateKey.slice(0, 4))).early.has(dateKey) ? 13 * 60 : REG_CLOSE;
}

export function sessionAt(ts: number): Session {
  const p = etParts(ts);
  if (!isTradingDay(p)) return 'closed';
  const close = regularCloseMinutes(p.dateKey);
  if (p.minutes < PRE_OPEN) return 'closed';
  if (p.minutes < REG_OPEN) return 'pre';
  if (p.minutes < close) return 'regular';
  if (p.minutes < (close === REG_CLOSE ? POST_CLOSE : 17 * 60)) return 'post';
  return 'closed';
}

export const SESSION_LABEL: Record<Session, string> = {
  closed: 'MERCADO CERRADO',
  pre: 'PRE-MARKET',
  regular: 'RUEDA REGULAR',
  post: 'AFTER-HOURS',
};

/** Próximo cambio de sesión para la cuenta regresiva del encabezado. */
export function nextSessionChange(ts: number): { label: string; at: number } {
  const p = etParts(ts);
  const session = sessionAt(ts);
  const close = regularCloseMinutes(p.dateKey);
  if (session === 'pre') return { label: 'Apertura en', at: etWallToTs(p.y, p.mo, p.d, REG_OPEN) };
  if (session === 'regular') return { label: 'Cierre en', at: etWallToTs(p.y, p.mo, p.d, close) };
  if (session === 'post') {
    const end = close === REG_CLOSE ? POST_CLOSE : 17 * 60;
    return { label: 'Fin after-hours en', at: etWallToTs(p.y, p.mo, p.d, end) };
  }
  // Cerrado: buscar el próximo día hábil a las 4:00 ET.
  let probe = isTradingDay(p) && p.minutes < PRE_OPEN ? ts : ts + 24 * HOUR;
  for (let i = 0; i < 10; i++) {
    const q = etParts(probe);
    if (isTradingDay(q)) return { label: 'Pre-market en', at: etWallToTs(q.y, q.mo, q.d, PRE_OPEN) };
    probe += 24 * HOUR;
  }
  return { label: 'Pre-market en', at: probe };
}

/** Inicio del día de trading (4:00 ET) que contiene a `ts`. */
export function tradingDayStart(ts: number): number {
  const p = etParts(ts);
  return etWallToTs(p.y, p.mo, p.d, PRE_OPEN);
}

// Fracción acumulada típica del volumen diario según la hora (curva en "U" de una small cap: la
// apertura es lo más fuerte del día, el mediodía flojo y repunta al cierre). Sirve para un volumen
// relativo ajustado por horario: a las 9:00 nadie hizo todavía el volumen de un día entero, así que
// se compara contra lo esperable a esa hora.
const VOLUME_CURVE: Array<[number, number]> = [
  [PRE_OPEN, 0],
  [7 * 60, 0.005],
  [8 * 60 + 30, 0.015],
  [REG_OPEN, 0.03],
  [9 * 60 + 45, 0.12],
  [10 * 60, 0.187],
  [10 * 60 + 30, 0.288],
  [11 * 60, 0.368],
  [12 * 60, 0.487],
  [13 * 60, 0.578],
  [14 * 60, 0.669],
  [15 * 60, 0.78],
  [15 * 60 + 30, 0.853],
  [REG_CLOSE, 0.97],
  // After-hours: algo en la primera hora (balances y lo que venía en juego), casi nada después.
  [17 * 60, 0.99],
  [POST_CLOSE, 1],
];

/** Promedio de volumen por minuto de la rueda regular (fracción del día). */
const REG_RATE = (0.97 - 0.03) / (REG_CLOSE - REG_OPEN);

/**
 * Intensidad de la operatoria a esa hora, relativa al minuto promedio de la rueda regular (1 = un
 * minuto normal): casi nada a las 4:00, sube hacia la apertura, explota a las 9:30, baja al mediodía y
 * repunta al cierre; el after-hours es muy fino. Es la pendiente de la curva del volumen esperado.
 */
export function volumeIntensity(minutesOfDay: number): number {
  if (minutesOfDay < VOLUME_CURVE[0][0] || minutesOfDay >= POST_CLOSE) return 0;
  for (let i = 1; i < VOLUME_CURVE.length; i++) {
    const [m1, f1] = VOLUME_CURVE[i];
    if (minutesOfDay < m1) {
      const [m0, f0] = VOLUME_CURVE[i - 1];
      return (f1 - f0) / (m1 - m0) / REG_RATE;
    }
  }
  return 0;
}

/**
 * Minuto equivalente en la curva de una rueda completa: en una media rueda (cierre 13:00) la rueda regular
 * se estira para cubrir la curva entera, así el volumen esperado llega al cierre como un día normal.
 */
export function curveMinute(minutesOfDay: number, closeMinutes: number = REG_CLOSE): number {
  if (closeMinutes === REG_CLOSE || minutesOfDay < REG_OPEN) return minutesOfDay;
  if (minutesOfDay >= closeMinutes) return REG_CLOSE + (minutesOfDay - closeMinutes);
  return REG_OPEN + ((minutesOfDay - REG_OPEN) * (REG_CLOSE - REG_OPEN)) / (closeMinutes - REG_OPEN);
}

export function expectedVolumeFraction(minutesOfDay: number, dateKey?: string): number {
  if (dateKey) minutesOfDay = curveMinute(minutesOfDay, regularCloseMinutes(dateKey));
  if (minutesOfDay <= VOLUME_CURVE[0][0]) return 0.01;
  for (let i = 1; i < VOLUME_CURVE.length; i++) {
    const [m1, f1] = VOLUME_CURVE[i];
    if (minutesOfDay <= m1) {
      const [m0, f0] = VOLUME_CURVE[i - 1];
      const f = f0 + ((f1 - f0) * (minutesOfDay - m0)) / (m1 - m0);
      return Math.max(0.01, f);
    }
  }
  return 1;
}

export function formatEtClock(ts: number): string {
  const p = etParts(ts);
  return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}:${String(p.s).padStart(2, '0')}`;
}

export function formatEtTime(ts: number, withSeconds = true): string {
  const p = etParts(ts);
  const base = `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
  return withSeconds ? `${base}:${String(p.s).padStart(2, '0')}` : base;
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export interface EtDate {
  y: number;
  mo: number;
  d: number;
  dateKey: string;
}

/**
 * Día de la sesión vigente: hoy si es hábil y ya son las 4:00 ET, si no el último día hábil anterior.
 * Con el mercado cerrado (noche, fin de semana) los escáneres muestran la última sesión.
 */
export function sessionDate(ts: number): EtDate {
  let probe = ts;
  const p0 = etParts(ts);
  if (!(isTradingDay(p0) && p0.minutes >= PRE_OPEN)) probe -= 24 * HOUR;
  for (let i = 0; i < 12; i++) {
    const p = etParts(probe);
    if (isTradingDay(p)) return { y: p.y, mo: p.mo, d: p.d, dateKey: p.dateKey };
    probe -= 24 * HOUR;
  }
  return { y: p0.y, mo: p0.mo, d: p0.d, dateKey: p0.dateKey };
}

/** Días hábiles anteriores a `date` (el más reciente primero). */
export function previousTradingDays(date: EtDate, count: number): EtDate[] {
  const out: EtDate[] = [];
  let probe = etWallToTs(date.y, date.mo, date.d, 12 * 60) - 24 * HOUR;
  for (let i = 0; out.length < count && i < count * 3; i++) {
    const p = etParts(probe);
    if (isTradingDay(p)) out.push({ y: p.y, mo: p.mo, d: p.d, dateKey: p.dateKey });
    probe -= 24 * HOUR;
  }
  return out;
}

/** "2026-10-23" + "15:44:54.566" (hora ET) → ms epoch. */
export function etDateTimeToTs(dateKey: string, time: string): number {
  const [y, mo, d] = dateKey.split('-').map(Number);
  const [hh, mm, ss] = time.split(':');
  const minutes = Number(hh) * 60 + Number(mm) + Number(ss ?? 0) / 60;
  return etWallToTs(y, mo, d, minutes);
}
