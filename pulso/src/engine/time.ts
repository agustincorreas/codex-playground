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

// Feriados NYSE (mercado cerrado) y cierres anticipados a las 13:00 ET.
const HOLIDAYS = new Set([
  '2025-01-01', '2025-01-09', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26', '2025-06-19',
  '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03',
  '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05',
  '2027-09-06', '2027-11-25', '2027-12-24',
]);
const EARLY_CLOSE = new Set(['2025-07-03', '2025-11-28', '2025-12-24', '2026-11-27', '2026-12-24', '2027-11-26']);

export const PRE_OPEN = 4 * 60;
export const REG_OPEN = 9 * 60 + 30;
export const REG_CLOSE = 16 * 60;
export const POST_CLOSE = 20 * 60;

export function isTradingDay(p: EtParts): boolean {
  return p.dow !== 0 && p.dow !== 6 && !HOLIDAYS.has(p.dateKey);
}

export function regularCloseMinutes(dateKey: string): number {
  return EARLY_CLOSE.has(dateKey) ? 13 * 60 : REG_CLOSE;
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

// Fracción acumulada típica del volumen diario según la hora (curva en "U").
// Sirve para un volumen relativo ajustado por horario: a las 9:00 nadie hizo todavía
// el volumen de un día entero, así que se compara contra lo esperable a esa hora.
const VOLUME_CURVE: Array<[number, number]> = [
  [PRE_OPEN, 0],
  [7 * 60, 0.005],
  [8 * 60 + 30, 0.015],
  [REG_OPEN, 0.03],
  [10 * 60, 0.12],
  [10 * 60 + 30, 0.19],
  [11 * 60, 0.25],
  [12 * 60, 0.35],
  [13 * 60, 0.44],
  [14 * 60, 0.53],
  [15 * 60, 0.65],
  [15 * 60 + 30, 0.75],
  [REG_CLOSE, 0.97],
  [POST_CLOSE, 1],
];

export function expectedVolumeFraction(minutesOfDay: number): number {
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
