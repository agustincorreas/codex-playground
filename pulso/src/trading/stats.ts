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
  avg: number;
  avgR?: number;
}

export type Dimension = 'setup' | 'hora' | 'precio' | 'float' | 'pilares' | 'salida';

export const DIMENSIONS: Array<{ id: Dimension; label: string }> = [
  { id: 'setup', label: 'Setup' },
  { id: 'hora', label: 'Horario' },
  { id: 'precio', label: 'Precio' },
  { id: 'float', label: 'Float' },
  { id: 'pilares', label: 'Pilares' },
  { id: 'salida', label: 'Salida' },
];

const EXIT_LABEL: Record<string, string> = { manual: 'Manual', stop: 'Stop', target: 'Objetivo', eod: 'Fin del día' };

function bucketOf(t: Trade, dim: Dimension): [string, string, number] {
  switch (dim) {
    case 'setup':
      return [t.setup ?? '—', t.setup ?? 'Sin etiqueta', 0];
    case 'hora': {
      const m = t.ctx?.minutes;
      if (m === undefined) return ['?', 'Sin dato', 9];
      if (m < 9 * 60 + 30) return ['pre', 'Pre-market', 0];
      if (m < 10 * 60) return ['930', '9:30–10:00', 1];
      if (m < 10 * 60 + 30) return ['1000', '10:00–10:30', 2];
      if (m < 11 * 60 + 30) return ['1030', '10:30–11:30', 3];
      return ['tarde', 'Después de 11:30', 4];
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
      return { key, label: g.label, trades: s.trades, winRate: s.winRate, net: s.net, avg: s.expectancy, avgR: s.avgR, order: g.order };
    })
    .sort((a, b) => (dim === 'setup' || dim === 'salida' ? b.net - a.net : a.order - b.order))
    .map(({ order: _order, ...rest }) => rest);
}
