// Backtest del ORB de 5 min en "acciones en juego" sobre velas reales de 1 min (ver fetch.ts), con variantes:
// distancia del stop (fracción del ATR de 14 días o el otro extremo de la vela de apertura), objetivo (ninguno =
// cierre, o múltiplos de R), largo/corto/ambos, hasta qué hora se acepta la entrada, y costos. Imprime una tabla
// con trades, aciertos, R promedio, factor de ganancia, retorno con tamaño por riesgo y drawdown, y por año.
// Uso: npx tsx research/orb/backtest.ts [desde] [hasta] > research/orb/results.md
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Bar } from './fetch';

const ROOT = join(dirname(new URL(import.meta.url).pathname), 'data');
const FROM = process.argv[2] ?? '2021-01-01';
const TO = process.argv[3] ?? '2026-12-31';
/** Carpeta de selección: 'inplay' (top 1000 por volumen en dólares del año) o 'inplay-paper' (filtros rodantes del paper). */
const INPLAY = process.argv[4] ?? 'inplay';

export interface Variant {
  name: string;
  /** Stop: 'atr' a `k` × ATR14 de la entrada, o 'range' en el otro extremo de la vela de apertura (con tope de k × ATR). */
  stop: 'atr' | 'range';
  k: number;
  /** Objetivo en R (0 = ninguno: se sale al cierre o por el stop). */
  targetR: number;
  /** Minutos después de la apertura hasta los que se acepta la entrada (390 = todo el día). */
  entryUntil: number;
  side: 'long' | 'short' | 'both';
  /** Stop a la entrada cuando el trade va `beAtR` R a favor (0 = nunca). */
  beAtR: number;
  /** Solo las `topN` más en juego del día (20 = todas) y con volumen relativo de al menos `minRvol`. */
  topN?: number;
  minRvol?: number;
  /** Vela de entrada: 'pesimista' (si toca el stop en la misma vela, es stop) u 'optimista' (solo si cierra más allá del stop). */
  fill?: 'pesimista' | 'optimista';
  /** Costos: realistas (1 ¢ + 0,01 % por lado) o los del paper (0,35 ¢ por acción, sin deslizamiento). */
  cost?: 'real' | 'paper';
}

export interface Trade {
  day: string;
  sym: string;
  side: 'long' | 'short';
  entry: number;
  exit: number;
  stop: number;
  r: number;
  reason: 'stop' | 'target' | 'close';
  minutes: number;
  /** Minuto de la entrada desde las 9:30. */
  entryMin: number;
}

/** Costo por lado: un centavo por acción (medio spread de una acción líquida) más 0,01 % del precio (deslizamiento). */
const costOf = (price: number, cost: Variant['cost'] = 'real') => (cost === 'paper' ? 0.0035 : 0.01 + 0.0001 * price);

const load = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const dailyCache = new Map<string, Bar[]>();
function daily(sym: string): Bar[] {
  let d = dailyCache.get(sym);
  if (!d) {
    const f = join(ROOT, 'daily', `${sym}.json`);
    d = existsSync(f) ? load<Bar[]>(f) : [];
    dailyCache.set(sym, d);
  }
  return d;
}

/** ATR de 14 días hasta el día anterior a `day` (rango verdadero promedio). */
export function atr14(sym: string, day: string): number {
  const d = daily(sym);
  const idx = d.findIndex((b) => b.t.slice(0, 10) >= day);
  const upto = idx < 0 ? d : d.slice(0, idx);
  const last = upto.slice(-15);
  if (last.length < 10) return 0;
  let sum = 0;
  for (let i = 1; i < last.length; i++) {
    const b = last[i];
    const pc = last[i - 1].c;
    sum += Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  }
  return sum / (last.length - 1);
}

export function simulate(day: string, sym: string, open5: Bar, mins: Bar[], v: Variant): Trade | null {
  if (!mins.length || open5.c === open5.o) return null;
  const long = open5.c > open5.o;
  if ((long && v.side === 'short') || (!long && v.side === 'long')) return null;
  const atr = atr14(sym, day);
  if (!(atr > 0)) return null;
  const level = long ? open5.h : open5.l;
  // Velas desde las 9:35 (la primera de 5 min ya cerró).
  const after = mins.filter((b) => minuteOf(b.t) >= 5);
  let entry = 0;
  let i = 0;
  for (; i < after.length; i++) {
    const b = after[i];
    if (minuteOf(b.t) > v.entryUntil) return null;
    if (long ? b.h >= level : b.l <= level) {
      // Orden stop: se ejecuta al nivel, o peor si la vela abrió más allá.
      entry = long ? Math.max(level, b.o) : Math.min(level, b.o);
      break;
    }
  }
  if (!entry) return null;
  const entryMin = minuteOf(after[i].t);
  const dist = v.stop === 'atr' ? v.k * atr : Math.min(Math.abs(level - (long ? open5.l : open5.h)), v.k * atr);
  if (!(dist > 0)) return null;
  let stop = long ? entry - dist : entry + dist;
  const risk = dist;
  const target = v.targetR > 0 ? (long ? entry + v.targetR * risk : entry - v.targetR * risk) : 0;
  let be = false;
  // Primero se mira el resto de la vela de entrada (conservador: si toca el stop en la misma vela, se asume stop).
  for (let j = i; j < after.length; j++) {
    const b = after[j];
    const touched = long ? b.l <= stop : b.h >= stop;
    const hitStop = j === i && v.fill === 'optimista' ? (long ? b.c <= stop : b.c >= stop) : touched;
    if (hitStop) return done(day, sym, long, entry, stop, risk, 'stop', minuteOf(b.t) - entryMin, v, entryMin);
    if (target && (long ? b.h >= target : b.l <= target)) return done(day, sym, long, entry, target, risk, 'target', minuteOf(b.t) - entryMin, v, entryMin);
    if (v.beAtR > 0 && !be && (long ? b.h >= entry + v.beAtR * risk : b.l <= entry - v.beAtR * risk)) {
      be = true;
      stop = entry;
    }
  }
  const last = after[after.length - 1];
  return done(day, sym, long, entry, last.c, risk, 'close', minuteOf(last.t) - entryMin, v, entryMin);
}

function done(day: string, sym: string, long: boolean, entry: number, exit: number, risk: number, reason: Trade['reason'], minutes: number, v: Variant, entryMin: number): Trade {
  const gross = long ? exit - entry : entry - exit;
  const net = gross - costOf(entry, v.cost) - costOf(exit, v.cost);
  return { day, sym, side: long ? 'long' : 'short', entry, exit, stop: long ? entry - risk : entry + risk, r: net / risk, reason, minutes, entryMin };
}

/** Minutos desde las 9:30 NY de una vela (la hora viene en UTC; la fecha fija el huso). */
export function minuteOf(t: string): number {
  const d = new Date(t);
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  const openUtc = (d.getUTCMonth() + 1 > 3 && d.getUTCMonth() + 1 < 11) || isDst(d) ? 13 * 60 + 30 : 14 * 60 + 30;
  return utcMin - openUtc;
}
function isDst(d: Date): boolean {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const nthSunday = (month: number, n: number) => {
    const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + (n - 1) * 7;
  };
  return (m === 3 && day >= nthSunday(3, 2)) || (m === 11 && day < nthSunday(11, 1));
}

export interface Stats {
  trades: number;
  winRate: number;
  avgR: number;
  pf: number;
  avgWinR: number;
  avgLossR: number;
  ret: number;
  maxDd: number;
  perDay: number;
  stops: number;
  targets: number;
}

/** Tamaño por riesgo: 0,5 % del capital por trade, sin pasar el 20 % del capital en una posición (una vez la cuenta). */
export function stats(trades: Trade[], days: number): Stats {
  const wins = trades.filter((t) => t.r > 0);
  const losses = trades.filter((t) => t.r <= 0);
  const sumW = wins.reduce((a, t) => a + t.r, 0);
  const sumL = -losses.reduce((a, t) => a + t.r, 0);
  let eq = 1;
  let peak = 1;
  let maxDd = 0;
  const byDay = new Map<string, Trade[]>();
  for (const t of trades) (byDay.get(t.day) ?? byDay.set(t.day, []).get(t.day)!).push(t);
  for (const list of byDay.values()) {
    let pnl = 0;
    for (const t of list) {
      const riskFrac = Math.min(0.005, (0.2 * Math.abs(t.entry - t.stop)) / t.entry);
      pnl += riskFrac * t.r;
    }
    eq *= 1 + pnl;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, 1 - eq / peak);
  }
  return {
    trades: trades.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    avgR: trades.length ? trades.reduce((a, t) => a + t.r, 0) / trades.length : 0,
    pf: sumL > 0 ? sumW / sumL : Infinity,
    avgWinR: wins.length ? sumW / wins.length : 0,
    avgLossR: losses.length ? -sumL / losses.length : 0,
    ret: eq - 1,
    maxDd,
    perDay: days ? trades.length / days : 0,
    stops: trades.filter((t) => t.reason === 'stop').length / Math.max(1, trades.length),
    targets: trades.filter((t) => t.reason === 'target').length / Math.max(1, trades.length),
  };
}

const pct = (v: number) => `${(v * 100).toFixed(0)} %`;
const num = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '∞');

function main() {
  const days = readdirSync(join(ROOT, INPLAY))
    .map((f) => f.slice(0, 10))
    .filter((d) => d >= FROM && d <= TO && existsSync(join(ROOT, 'min', `${d}.json`)))
    .sort();
  const variants: Variant[] = [];
  // Réplica literal del paper: ambos lados, stop 0,1×ATR, salida al cierre; con sus costos y con los realistas,
  // y con las dos lecturas de la vela de entrada.
  variants.push({ name: 'PAPER · both · stop 0.1×ATR · al cierre · costos paper · entrada pesimista', stop: 'atr', k: 0.1, targetR: 0, entryUntil: 390, side: 'both', beAtR: 0, cost: 'paper' });
  variants.push({ name: 'PAPER · both · stop 0.1×ATR · al cierre · costos paper · entrada optimista', stop: 'atr', k: 0.1, targetR: 0, entryUntil: 390, side: 'both', beAtR: 0, cost: 'paper', fill: 'optimista' });
  variants.push({ name: 'PAPER · both · stop 0.1×ATR · al cierre · costos reales · entrada optimista', stop: 'atr', k: 0.1, targetR: 0, entryUntil: 390, side: 'both', beAtR: 0, fill: 'optimista' });
  variants.push({ name: 'both · stop 0.25×ATR · al cierre · entrada optimista', stop: 'atr', k: 0.25, targetR: 0, entryUntil: 390, side: 'both', beAtR: 0, fill: 'optimista' });
  variants.push({ name: 'both · stop 0.5×ATR · al cierre · entrada optimista', stop: 'atr', k: 0.5, targetR: 0, entryUntil: 390, side: 'both', beAtR: 0, fill: 'optimista' });
  variants.push({ name: 'both · stop vela apertura · obj 1R · entrada optimista', stop: 'range', k: 1, targetR: 1, entryUntil: 390, side: 'both', beAtR: 0, fill: 'optimista' });
  variants.push({ name: 'both · stop vela apertura · obj 2R · entrada optimista', stop: 'range', k: 1, targetR: 2, entryUntil: 390, side: 'both', beAtR: 0, fill: 'optimista' });
  for (const side of ['long', 'both'] as const) {
    for (const [stop, k] of [
      ['atr', 0.1],
      ['atr', 0.25],
      ['atr', 0.5],
      ['range', 1],
    ] as const) {
      for (const targetR of [0, 1, 2, 3]) {
        variants.push({ name: `${side} · stop ${stop === 'atr' ? `${k}×ATR` : 'vela apertura'} · ${targetR ? `obj ${targetR}R` : 'al cierre'}`, stop, k, targetR, entryUntil: 390, side, beAtR: 0 });
      }
    }
  }
  // Variantes de "porcentaje": objetivo 1R con stop a la entrada a 0,5R, y entrada solo en la primera hora.
  variants.push({ name: 'long · stop 0.25×ATR · obj 1R · BE a 0,5R', stop: 'atr', k: 0.25, targetR: 1, entryUntil: 390, side: 'long', beAtR: 0.5 });
  variants.push({ name: 'long · stop 0.25×ATR · obj 1R · solo 1.ª hora', stop: 'atr', k: 0.25, targetR: 1, entryUntil: 60, side: 'long', beAtR: 0 });
  variants.push({ name: 'long · stop vela apertura · obj 1R · solo 1.ª hora', stop: 'range', k: 1, targetR: 1, entryUntil: 60, side: 'long', beAtR: 0 });
  variants.push({ name: 'long · stop vela apertura · al cierre · BE a 1R', stop: 'range', k: 1, targetR: 0, entryUntil: 390, side: 'long', beAtR: 1 });
  // Selección más exigente: solo las 5 más en juego, o volumen relativo de 3× o más.
  variants.push({ name: 'long · top 5 · stop 0.5×ATR · obj 1R', stop: 'atr', k: 0.5, targetR: 1, entryUntil: 390, side: 'long', beAtR: 0, topN: 5 });
  variants.push({ name: 'long · top 5 · stop 0.25×ATR · al cierre', stop: 'atr', k: 0.25, targetR: 0, entryUntil: 390, side: 'long', beAtR: 0, topN: 5 });
  variants.push({ name: 'long · rvol ≥ 3 · stop 0.5×ATR · obj 1R', stop: 'atr', k: 0.5, targetR: 1, entryUntil: 390, side: 'long', beAtR: 0, minRvol: 3 });
  variants.push({ name: 'both · rvol ≥ 3 · stop 0.25×ATR · al cierre', stop: 'atr', k: 0.25, targetR: 0, entryUntil: 390, side: 'both', beAtR: 0, minRvol: 3 });
  variants.push({ name: 'long · rvol ≥ 3 · stop vela apertura · obj 2R · BE a 1R', stop: 'range', k: 1, targetR: 2, entryUntil: 390, side: 'long', beAtR: 1, minRvol: 3 });

  const results = variants.map((v) => ({ v, trades: [] as Trade[] }));
  for (const day of days) {
    const top = load<Array<{ sym: string; rvol: number }>>(join(ROOT, INPLAY, `${day}.json`));
    const open = load<Record<string, Bar>>(join(ROOT, 'open5', `${day}.json`));
    const mins = load<Record<string, Bar[]>>(join(ROOT, 'min', `${day}.json`));
    top.forEach(({ sym, rvol }, rank) => {
      const o = open[sym];
      const m = mins[sym];
      if (!o || !m) return;
      for (const r of results) {
        if (rank >= (r.v.topN ?? 20) || rvol < (r.v.minRvol ?? 0)) continue;
        const t = simulate(day, sym, o, m, r.v);
        if (t) r.trades.push(t);
      }
    });
  }
  console.log(`# ORB en acciones en juego · ${days[0]} a ${days[days.length - 1]} · ${days.length} días · velas reales de 1 min (Alpaca SIP) · selección ${INPLAY === 'inplay' ? 'top 1000 por volumen en dólares del año' : 'filtros rodantes del paper (precio > 5, vol. 14 d ≥ 1 M, ATR > 0,50, rvol ≥ 1)'}\n`);
  console.log('Costos: 1 ¢ por acción + 0,01 % por lado salvo que la variante diga "costos paper" (0,35 ¢ por acción). Vela de entrada pesimista (si toca el stop en la misma vela, cuenta como stop) salvo que diga "optimista". Tamaño: 0,5 % del capital en riesgo por trade, tope 20 % del capital por posición. R = resultado neto sobre la distancia al stop.\n');
  console.log('| Variante | Trades | /día | Aciertos | R prom. | Gan. prom. (R) | Pérd. prom. (R) | Factor | Retorno | Drawdown | Por stop | Por objetivo |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const s = stats(r.trades, days.length);
    console.log(`| ${r.v.name} | ${s.trades} | ${num(s.perDay, 1)} | ${pct(s.winRate)} | ${num(s.avgR)} | ${num(s.avgWinR)} | ${num(s.avgLossR)} | ${num(s.pf)} | ${pct(s.ret)} | ${pct(s.maxDd)} | ${pct(s.stops)} | ${pct(s.targets)} |`);
  }
  // Por año, para las variantes con mejor aciertos y mejor R.
  const years = [...new Set(days.map((d) => d.slice(0, 4)))];
  console.log('\n## Por año (aciertos / R promedio / retorno)\n');
  console.log(`| Variante | ${years.join(' | ')} |`);
  console.log(`|---|${years.map(() => '---').join('|')}|`);
  for (const r of results) {
    const cells = years.map((y) => {
      const t = r.trades.filter((x) => x.day.startsWith(y));
      const s = stats(t, days.filter((d) => d.startsWith(y)).length);
      return t.length ? `${pct(s.winRate)} / ${num(s.avgR)} / ${pct(s.ret)}` : '—';
    });
    console.log(`| ${r.v.name} | ${cells.join(' | ')} |`);
  }
}

if (process.argv[1]?.endsWith('backtest.ts')) main();
