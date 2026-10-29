// Estadísticas de los trades: lo que conviene mirar para saber si una estrategia funciona
// (% de aciertos, relación ganancia/pérdida promedio, profit factor, R, drawdown) y en qué condiciones.
import type { Trade } from './types';

export interface Summary {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  net: number;
  fees: number;
  grossWins: number;
  grossLosses: number;
  avgWin: number;
  avgLoss: number;
  /** Ganancia promedio / pérdida promedio (en valor absoluto). */
  plRatio: number;
  /** Suma de ganancias / suma de pérdidas. */
  profitFactor: number;
  largestWin: number;
  largestLoss: number;
  /** Resultado esperado por trade. */
  expectancy: number;
  avgR?: number;
  /** Mayor caída de la curva de capital desde un máximo. */
  maxDrawdown: number;
  avgHoldMin: number;
  avgWinHoldMin: number;
  avgLossHoldMin: number;
  bestStreak: number;
  worstStreak: number;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const money = (v: number) => Math.round(v * 100) / 100;

export function summarize(trades: Trade[]): Summary {
  const sorted = [...trades].sort((a, b) => a.closedAt - b.closedAt);
  const wins = sorted.filter((t) => t.net > 0);
  const losses = sorted.filter((t) => t.net < 0);
  const grossWins = wins.reduce((a, t) => a + t.net, 0);
  const grossLosses = losses.reduce((a, t) => a + t.net, 0);
  const net = sorted.reduce((a, t) => a + t.net, 0);
  let peak = 0;
  let cum = 0;
  let maxDd = 0;
  let streak = 0;
  let best = 0;
  let worst = 0;
  for (const t of sorted) {
    cum += t.net;
    peak = Math.max(peak, cum);
    maxDd = Math.max(maxDd, peak - cum);
    if (t.net > 0) streak = streak > 0 ? streak + 1 : 1;
    else if (t.net < 0) streak = streak < 0 ? streak - 1 : -1;
    else streak = 0;
    best = Math.max(best, streak);
    worst = Math.min(worst, streak);
  }
  const hold = (ts: Trade[]) => avg(ts.map((t) => (t.closedAt - t.openedAt) / 60_000));
  const withR = sorted.filter((t) => t.r !== undefined);
  const avgWin = avg(wins.map((t) => t.net));
  const avgLoss = avg(losses.map((t) => t.net));
  return {
    trades: sorted.length,
    wins: wins.length,
    losses: losses.length,
    winRate: sorted.length ? (wins.length / sorted.length) * 100 : 0,
    net: money(net),
    fees: money(sorted.reduce((a, t) => a + t.fees, 0)),
    grossWins: money(grossWins),
    grossLosses: money(grossLosses),
    avgWin: money(avgWin),
    avgLoss: money(avgLoss),
    plRatio: avgLoss < 0 ? avgWin / Math.abs(avgLoss) : wins.length ? Infinity : 0,
    profitFactor: grossLosses < 0 ? grossWins / Math.abs(grossLosses) : grossWins > 0 ? Infinity : 0,
    largestWin: money(Math.max(0, ...sorted.map((t) => t.net))),
    largestLoss: money(Math.min(0, ...sorted.map((t) => t.net))),
    expectancy: sorted.length ? money(net / sorted.length) : 0,
    avgR: withR.length ? Math.round(avg(withR.map((t) => t.r!)) * 100) / 100 : undefined,
    maxDrawdown: money(maxDd),
    avgHoldMin: hold(sorted),
    avgWinHoldMin: hold(wins),
    avgLossHoldMin: hold(losses),
    bestStreak: best,
    worstStreak: -worst,
  };
}

export interface EquityPoint {
  i: number;
  ts: number;
  equity: number;
  net: number;
}

/** Curva de capital trade a trade, partiendo del saldo inicial. */
export function equityCurve(trades: Trade[], start: number): EquityPoint[] {
  const sorted = [...trades].sort((a, b) => a.closedAt - b.closedAt);
  const out: EquityPoint[] = [{ i: 0, ts: sorted[0]?.openedAt ?? 0, equity: start, net: 0 }];
  let eq = start;
  sorted.forEach((t, k) => {
    eq += t.net;
    out.push({ i: k + 1, ts: t.closedAt, equity: money(eq), net: t.net });
  });
  return out;
}

export interface Bucket {
  key: string;
  label: string;
  trades: number;
  winRate: number;
  net: number;
  /** Suma de los trades ganadores y de los perdedores (para las barras de ganancia y pérdida). */
  gains: number;
  losses: number;
  avg: number;
  avgR?: number;
}

export type Dimension = 'setup' | 'lado' | 'hora' | 'hora30' | 'hora15' | 'precio' | 'float' | 'gap' | 'volumen' | 'rvol' | 'pilares' | 'salida';

export const DIMENSIONS: Array<{ id: Dimension; label: string }> = [
  { id: 'setup', label: 'Setup' },
  { id: 'lado', label: 'Lado' },
  { id: 'hora', label: 'Horario' },
  { id: 'precio', label: 'Precio' },
  { id: 'gap', label: 'Gap' },
  { id: 'volumen', label: 'Volumen' },
  { id: 'rvol', label: 'Vol. relativo' },
  { id: 'float', label: 'Float' },
  { id: 'pilares', label: 'Pilares' },
  { id: 'salida', label: 'Salida' },
];

const EXIT_LABEL: Record<string, string> = { manual: 'Manual', stop: 'Stop', target: 'Objetivo', eod: 'Fin del día' };

function bucketOf(t: Trade, dim: Dimension): [string, string, number] {
  switch (dim) {
    case 'setup':
      return [t.setup ?? '—', t.setup ?? 'Sin etiqueta', 0];
    case 'lado':
      // Los trades guardados antes de los cortos no traen el lado: son largos.
      return t.side === 'short' ? ['short', 'Corto', 1] : ['long', 'Largo', 0];
    case 'hora': {
      const m = t.ctx?.minutes;
      if (m === undefined) return ['?', 'Sin dato', 9999];
      if (m < 9 * 60 + 30) return ['pre', 'Pre-market', 0];
      if (m < 10 * 60) return ['930', '9:30–10:00', 1];
      if (m < 10 * 60 + 30) return ['1000', '10:00–10:30', 2];
      if (m < 11 * 60 + 30) return ['1030', '10:30–11:30', 3];
      return ['tarde', 'Después de 11:30', 4];
    }
    case 'hora30':
    case 'hora15': {
      const m = t.ctx?.minutes;
      if (m === undefined) return ['?', 'Sin dato', 9999];
      const step = dim === 'hora30' ? 30 : 15;
      const from = Math.floor(m / step) * step;
      const hhmm = (x: number) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
      return [String(from), `${hhmm(from)}–${hhmm(from + step)}`, from];
    }
    case 'gap': {
      const g = t.ctx?.gapPct ?? t.ctx?.changePct;
      if (g === undefined) return ['?', 'Sin dato', 9];
      if (g >= 100) return ['100', 'Más de 100%', 0];
      if (g >= 50) return ['50', '50%–100%', 1];
      if (g >= 20) return ['20', '20%–50%', 2];
      if (g >= 10) return ['10', '10%–20%', 3];
      if (g >= 0) return ['0', '0%–10%', 4];
      return ['neg', 'Negativo', 5];
    }
    case 'volumen': {
      const v = t.ctx?.volume;
      if (v === undefined) return ['?', 'Sin dato', 9];
      if (v >= 25e6) return ['25m', '25M o más', 0];
      if (v >= 10e6) return ['10m', '10M–25M', 1];
      if (v >= 5e6) return ['5m', '5M–10M', 2];
      if (v >= 2.5e6) return ['2.5m', '2,5M–5M', 3];
      if (v >= 1e6) return ['1m', '1M–2,5M', 4];
      if (v >= 500e3) return ['500k', '500K–1M', 5];
      if (v >= 250e3) return ['250k', '250K–500K', 6];
      if (v >= 50e3) return ['50k', '50K–250K', 7];
      return ['<50k', 'Menos de 50K', 8];
    }
    case 'rvol': {
      const r = t.ctx?.rvol;
      if (r === undefined) return ['?', 'Sin dato', 9];
      if (r >= 7) return ['7', 'Más de 7x', 0];
      const lo = Math.floor(r);
      return [String(lo), `${lo}x–${lo + 1}x`, 7 - lo];
    }
    case 'precio': {
      const p = t.avgEntry;
      if (p < 1) return ['<1', 'Menos de $1', 0];
      if (p < 3) return ['1-3', '$1–$3', 1];
      if (p < 5) return ['3-5', '$3–$5', 2];
      if (p < 10) return ['5-10', '$5–$10', 3];
      if (p <= 20) return ['10-20', '$10–$20', 4];
      return ['>20', 'Más de $20', 5];
    }
    case 'float': {
      const f = t.ctx?.float;
      if (!f) return ['?', 'Sin dato', 9];
      if (f < 5e6) return ['<5', 'Menos de 5M', 0];
      if (f < 10e6) return ['5-10', '5M–10M', 1];
      if (f < 20e6) return ['10-20', '10M–20M', 2];
      return ['>20', 'Más de 20M', 3];
    }
    case 'pilares': {
      const s = t.ctx?.score;
      if (s === undefined) return ['?', 'Sin dato', 9];
      return [String(s), `${s} de 5`, 5 - s];
    }
    case 'salida':
      return [t.exitReason, EXIT_LABEL[t.exitReason] ?? t.exitReason, 0];
  }
}

export function breakdown(trades: Trade[], dim: Dimension): Bucket[] {
  const groups = new Map<string, { label: string; order: number; list: Trade[] }>();
  for (const t of trades) {
    const [key, label, order] = bucketOf(t, dim);
    const g = groups.get(key) ?? { label, order, list: [] };
    g.list.push(t);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => {
      const s = summarize(g.list);
      return { key, label: g.label, trades: s.trades, winRate: s.winRate, net: s.net, gains: s.grossWins, losses: s.grossLosses, avg: s.expectancy, avgR: s.avgR, order: g.order };
    })
    .sort((a, b) => (dim === 'setup' || dim === 'salida' ? b.net - a.net : a.order - b.order))
    .map(({ order: _order, ...rest }) => rest);
}

// ---------------------------------------------------------------- semanas y "Profit Trifecta"

/** Una semana de práctica son 5 días simulados seguidos (como una semana de rueda). */
export const DAYS_PER_WEEK = 5;

export interface DayResult {
  dayIndex: number;
  net: number;
  trades: number;
}

export interface WeekResult {
  week: number;
  days: DayResult[];
  net: number;
  trades: number;
  winRate: number;
  plRatio: number;
  score: TrifectaScore;
}

export interface TrifectaScore {
  consistency: number;
  winRate: number;
  plRatio: number;
  total: number;
  level: string;
}

export const LEVELS: Array<[number, number, string]> = [
  [1, 3, 'No rentable'],
  [4, 6, 'Principiante'],
  [7, 9, 'Intermedio'],
  [10, 13, 'Con experiencia'],
  [14, 18, 'Profesional'],
];

/** Puntaje de 1 a 6 del % de aciertos: 50% o menos = 1 ... 71% o más = 6. */
export function winRateScore(wr: number): number {
  if (wr >= 71) return 6;
  if (wr >= 66) return 5;
  if (wr >= 61) return 4;
  if (wr >= 56) return 3;
  if (wr >= 51) return 2;
  return 1;
}

/** Puntaje de 1 a 6 de la relación ganancia/pérdida promedio: menos de 1:1 = 1 ... más de 2:1 = 6. */
export function plScore(r: number): number {
  if (r > 2.25) return 6;
  if (r >= 2) return 5;
  if (r >= 1.75) return 4;
  if (r >= 1.5) return 3;
  if (r >= 1) return 2;
  return 1;
}

/** Puntaje de 1 a 6 de la constancia: semanas positivas seguidas (0 = 1 ... 6 o más = 6). */
export function consistencyScore(weeks: number): number {
  if (weeks >= 6) return 6;
  if (weeks >= 5) return 5;
  if (weeks >= 3) return 4;
  if (weeks >= 2) return 3;
  if (weeks >= 1) return 2;
  return 1;
}

export function levelOf(total: number): string {
  return LEVELS.find(([lo, hi]) => total >= lo && total <= hi)?.[2] ?? 'No rentable';
}

/**
 * Resultados por día y por semana de práctica, con el puntaje de la "trifecta" de Ross Cameron
 * (constancia, % de aciertos y relación ganancia/pérdida) de cada semana.
 * `dayOf` dice a qué día de práctica pertenece cada trade.
 */
export function weeklyResults(trades: Trade[], dayOf: (t: Trade) => number | undefined): WeekResult[] {
  const byDay = new Map<number, Trade[]>();
  for (const t of trades) {
    const d = dayOf(t);
    if (d === undefined) continue;
    const list = byDay.get(d) ?? [];
    list.push(t);
    byDay.set(d, list);
  }
  const weeks = new Map<number, Map<number, Trade[]>>();
  for (const [d, list] of byDay) {
    const w = Math.floor((d - 1) / DAYS_PER_WEEK) + 1;
    const m = weeks.get(w) ?? new Map<number, Trade[]>();
    m.set(d, list);
    weeks.set(w, m);
  }
  const out: WeekResult[] = [];
  let streak = 0;
  const first = Math.min(...weeks.keys());
  const last = Math.max(...weeks.keys());
  for (let w = first; w <= last && Number.isFinite(first); w++) {
    const days = weeks.get(w) ?? new Map<number, Trade[]>();
    const all = [...days.values()].flat();
    const s = summarize(all);
    // Una semana sin trades no corta la racha de semanas positivas (no operar no es perder).
    if (all.length) streak = s.net > 0 ? streak + 1 : 0;
    const pl = Number.isFinite(s.plRatio) ? s.plRatio : s.wins ? 3 : 0;
    const score = { consistency: consistencyScore(streak), winRate: winRateScore(s.winRate), plRatio: plScore(pl), total: 0, level: '' };
    score.total = score.consistency + score.winRate + score.plRatio;
    score.level = levelOf(score.total);
    out.push({
      week: w,
      days: [...days.entries()].sort((a, b) => a[0] - b[0]).map(([dayIndex, list]) => ({ dayIndex, net: money(list.reduce((x, t) => x + t.net, 0)), trades: list.length })),
      net: s.net,
      trades: s.trades,
      winRate: s.winRate,
      plRatio: pl,
      score,
    });
  }
  return out;
}
