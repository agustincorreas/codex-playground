// Dos familias intradía que apuntan a más del 50 % de aciertos, sobre los mismos datos reales del ORB (velas de
// 1 min de las 20 acciones "en juego" de cada día, selección del paper):
//   A. Retroceso a VWAP: la acción viene por arriba del VWAP, lo toca y cierra por arriba; se entra al superar el
//      máximo de la vela del toque, stop debajo del mínimo del toque, objetivo en R (o al cierre). Espejo en corto.
//   B. Reversión del gap: gap de apertura grande cuya primera vela de 5 min va en contra del gap; se entra al romper
//      el extremo de esa vela hacia el cierre del gap, stop en el otro extremo, objetivo el cierre anterior
//      (tope en R) o 1 R fijo. Espejo para gaps a la baja.
// Uso: npx tsx research/orb/strategies.ts [inplay-paper|inplay] [desde] [hasta] > research/orb/results-vwap-gap.md
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Bar } from './fetch';
import { type Trade, atr14, costOf, minuteOf, stats } from './backtest';

const ROOT = join(new URL('.', import.meta.url).pathname, 'data');
const INPLAY = process.argv[2] ?? 'inplay-paper';
const FROM = process.argv[3] ?? '2021-01-01';
const TO = process.argv[4] ?? '2026-12-31';
const load = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8')) as T;

interface Common {
  name: string;
  /** Objetivo en R (0 = al cierre). */
  targetR: number;
  /** Hasta qué minuto desde las 9:30 se acepta la entrada. */
  entryUntil: number;
  side: 'long' | 'short' | 'both';
  /** Vela de entrada: si toca el stop en la misma vela, 'pesimista' lo cuenta como stop; 'optimista' solo si cierra más allá. */
  fill: 'pesimista' | 'optimista';
  /** Riesgo mínimo como fracción del ATR (evita stops de ruido). */
  minRiskAtr: number;
  /** Riesgo máximo como fracción del ATR (si el stop queda más lejos, no se opera). */
  maxRiskAtr: number;
}
interface VwapVariant extends Common {
  kind: 'vwap';
  /** Velas previas al toque que tenían que cerrar por arriba (largo) del VWAP. */
  priorBars: number;
  /** Tolerancia del toque como fracción del precio (la vela llega a VWAP × (1 + tol)). */
  touchTol: number;
  /** Stop a la entrada (BE) cuando va `beAtR` R a favor (0 = nunca). */
  beAtR: number;
  /** Máximo de trades por acción y día. */
  maxPerDay: number;
}
interface GapVariant extends Common {
  kind: 'gap';
  /** Gap mínimo de apertura (fracción del cierre anterior). */
  minGap: number;
  /** Objetivo: 'cierre anterior' (cubrir el gap, con tope `targetR`) o 'R' fijo. */
  targetMode: 'gapfill' | 'R';
  /** Variante de entrada: 'primera vela en contra' o 'ruptura fallida' (rompe a favor del gap y vuelve a entrar al rango). */
  entryMode: 'contra' | 'fallida';
  /** Volumen relativo mínimo de la primera vela (0 = sin filtro). */
  minRvol?: number;
}
type Variant = VwapVariant | GapVariant;

const dailyCache = new Map<string, Bar[]>();
function prevClose(sym: string, day: string): number {
  let d = dailyCache.get(sym);
  if (!d) {
    const f = join(ROOT, 'daily', `${sym}.json`);
    d = existsSync(f) ? load<Bar[]>(f) : [];
    dailyCache.set(sym, d);
  }
  const idx = d.findIndex((b) => b.t.slice(0, 10) >= day);
  const prev = idx < 0 ? d[d.length - 1] : d[idx - 1];
  return prev?.c ?? 0;
}

/** Corre un trade desde la vela `i` (entrada ya ejecutada en `entry`) con stop, objetivo y salida al cierre. */
function run(day: string, sym: string, long: boolean, bars: Bar[], i: number, entry: number, stop0: number, target: number, v: Common, beAtR = 0): Trade {
  const risk = Math.abs(entry - stop0);
  let stop = stop0;
  let be = false;
  const entryMin = minuteOf(bars[i].t);
  for (let j = i; j < bars.length; j++) {
    const b = bars[j];
    const touched = long ? b.l <= stop : b.h >= stop;
    const hitStop = j === i && v.fill === 'optimista' && touched ? (long ? b.c <= stop : b.c >= stop) : touched;
    if (hitStop) return done(day, sym, long, entry, stop, risk, 'stop', minuteOf(b.t) - entryMin, entryMin);
    if (target && (long ? b.h >= target : b.l <= target)) return done(day, sym, long, entry, target, risk, 'target', minuteOf(b.t) - entryMin, entryMin);
    if (beAtR > 0 && !be && (long ? b.h >= entry + beAtR * risk : b.l <= entry - beAtR * risk)) {
      be = true;
      stop = entry;
    }
  }
  const last = bars[bars.length - 1];
  return done(day, sym, long, entry, last.c, risk, 'close', minuteOf(last.t) - entryMin, entryMin);
}
function done(day: string, sym: string, long: boolean, entry: number, exit: number, risk: number, reason: Trade['reason'], minutes: number, entryMin: number): Trade {
  const gross = long ? exit - entry : entry - exit;
  const net = gross - costOf(entry) - costOf(exit);
  return { day, sym, side: long ? 'long' : 'short', entry, exit, stop: long ? entry - risk : entry + risk, r: net / risk, reason, minutes, entryMin };
}

// ---------------------------------------------------------------- A. retroceso a VWAP
function simulateVwap(day: string, sym: string, bars: Bar[], v: VwapVariant): Trade[] {
  const atr = atr14(sym, day);
  if (!(atr > 0) || bars.length < 30) return [];
  // VWAP acumulado desde las 9:30.
  const vwap: number[] = [];
  let pv = 0;
  let vol = 0;
  for (const b of bars) {
    pv += b.vw * b.v;
    vol += b.v;
    vwap.push(vol ? pv / vol : b.c);
  }
  const out: Trade[] = [];
  let busyUntil = -1;
  for (let i = v.priorBars + 5; i < bars.length; i++) {
    if (i <= busyUntil || out.length >= v.maxPerDay) break;
    const m = minuteOf(bars[i].t);
    if (m < 10 || m > v.entryUntil) continue;
    for (const long of v.side === 'both' ? [true, false] : [v.side === 'long']) {
      const b = bars[i];
      const w = vwap[i];
      // Las velas previas cerraron del lado de la tendencia; la del toque llega al VWAP y cierra del mismo lado.
      let prior = true;
      for (let k = i - v.priorBars; k < i; k++) if (long ? bars[k].c <= vwap[k] * (1 + v.touchTol) : bars[k].c >= vwap[k] * (1 - v.touchTol)) prior = false;
      if (!prior) continue;
      const touch = long ? b.l <= w * (1 + v.touchTol) && b.c > w : b.h >= w * (1 - v.touchTol) && b.c < w;
      if (!touch) continue;
      // Entrada: orden stop en el extremo de la vela del toque, válida 5 velas.
      const trigger = long ? b.h : b.l;
      const stop = long ? Math.min(b.l, w) : Math.max(b.h, w);
      let entry = 0;
      let j = i + 1;
      for (; j < Math.min(bars.length, i + 6); j++) {
        const n = bars[j];
        if (long ? n.h >= trigger : n.l <= trigger) {
          entry = long ? Math.max(trigger, n.o) : Math.min(trigger, n.o);
          break;
        }
        // Si antes de disparar se va del otro lado del VWAP, se cancela.
        if (long ? n.c < vwap[j] : n.c > vwap[j]) break;
      }
      if (!entry) continue;
      const risk = Math.abs(entry - stop);
      if (risk < v.minRiskAtr * atr || risk > v.maxRiskAtr * atr) continue;
      const target = v.targetR ? (long ? entry + v.targetR * risk : entry - v.targetR * risk) : 0;
      const t = run(day, sym, long, bars, j, entry, stop, target, v, v.beAtR);
      out.push(t);
      busyUntil = j + t.minutes;
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- B. reversión del gap
function simulateGap(day: string, sym: string, open5: Bar, bars: Bar[], v: GapVariant): Trade | null {
  const pc = prevClose(sym, day);
  const atr = atr14(sym, day);
  if (!pc || !(atr > 0) || !bars.length) return null;
  const gap = open5.o / pc - 1;
  if (Math.abs(gap) < v.minGap) return null;
  const long = gap < 0; // gap a la baja: se compra la reversión; gap al alza: se vende.
  if ((long && v.side === 'short') || (!long && v.side === 'long')) return null;
  const after = bars.filter((b) => minuteOf(b.t) >= 5);
  let trigger: number;
  let stop: number;
  let from = 0;
  if (v.entryMode === 'contra') {
    // La primera vela fue en contra del gap: entrada al romper su extremo hacia el cierre del gap.
    if (long ? open5.c <= open5.o : open5.c >= open5.o) return null;
    trigger = long ? open5.h : open5.l;
    stop = long ? open5.l : open5.h;
  } else {
    // Ruptura fallida: rompió a favor del gap y volvió a cerrar dentro del rango de apertura; entrada al romper el
    // otro extremo, stop en el extremo que alcanzó.
    let broke = -1;
    let extreme = long ? open5.l : open5.h;
    for (let k = 0; k < after.length; k++) {
      const b = after[k];
      if (minuteOf(b.t) > v.entryUntil) return null;
      if (long ? b.l < open5.l : b.h > open5.h) {
        broke = k;
        extreme = long ? Math.min(extreme, b.l) : Math.max(extreme, b.h);
      } else if (broke >= 0 && (long ? b.c > open5.l : b.c < open5.h)) {
        from = k + 1;
        break;
      }
      if (broke >= 0 && k === after.length - 1) return null;
    }
    if (broke < 0 || !from) return null;
    trigger = long ? open5.h : open5.l;
    stop = extreme;
  }
  let entry = 0;
  let j = from;
  for (; j < after.length; j++) {
    const b = after[j];
    if (minuteOf(b.t) > v.entryUntil) return null;
    if (long ? b.h >= trigger : b.l <= trigger) {
      entry = long ? Math.max(trigger, b.o) : Math.min(trigger, b.o);
      break;
    }
  }
  if (!entry) return null;
  const risk = Math.abs(entry - stop);
  if (risk < v.minRiskAtr * atr || risk > v.maxRiskAtr * atr) return null;
  let target = v.targetR ? (long ? entry + v.targetR * risk : entry - v.targetR * risk) : 0;
  if (v.targetMode === 'gapfill') {
    // Cubrir el gap: el cierre anterior, sin pasar el tope en R.
    target = long ? Math.min(pc, target || Infinity) : Math.max(pc, target || 0);
    if (long ? target <= entry : target >= entry) return null;
  }
  return run(day, sym, long, after, j, entry, stop, target, v);
}

// ---------------------------------------------------------------- principal
const pct = (v: number) => `${(v * 100).toFixed(0)} %`;
const num = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '∞');

function main() {
  const days = readdirSync(join(ROOT, INPLAY)).map((f) => f.slice(0, 10)).filter((d) => d >= FROM && d <= TO && existsSync(join(ROOT, 'min', `${d}.json`))).sort();
  const variants: Variant[] = [];
  const base = { entryUntil: 120, fill: 'pesimista' as const, minRiskAtr: 0.1, maxRiskAtr: 1 };
  for (const side of ['long', 'both'] as const)
    for (const targetR of [1, 1.5, 2, 0])
      variants.push({ kind: 'vwap', name: `VWAP · ${side} · obj ${targetR || 'cierre'} · hasta 11:30`, ...base, side, targetR, priorBars: 10, touchTol: 0.001, beAtR: 0, maxPerDay: 1 });
  variants.push({ kind: 'vwap', name: 'VWAP · both · obj 1 · hasta 11:30 · optimista', ...base, fill: 'optimista', side: 'both', targetR: 1, priorBars: 10, touchTol: 0.001, beAtR: 0, maxPerDay: 1 });
  variants.push({ kind: 'vwap', name: 'VWAP · both · obj 1 · hasta 11:30 · 20 velas previas', ...base, side: 'both', targetR: 1, priorBars: 20, touchTol: 0.001, beAtR: 0, maxPerDay: 1 });
  variants.push({ kind: 'vwap', name: 'VWAP · both · obj 1 · hasta 11:30 · riesgo ≥ 0,25 ATR', ...base, minRiskAtr: 0.25, side: 'both', targetR: 1, priorBars: 10, touchTol: 0.001, beAtR: 0, maxPerDay: 1 });
  variants.push({ kind: 'vwap', name: 'VWAP · both · obj 2 · BE a 1R · hasta 11:30', ...base, side: 'both', targetR: 2, priorBars: 10, touchTol: 0.001, beAtR: 1, maxPerDay: 1 });
  variants.push({ kind: 'vwap', name: 'VWAP · both · obj 1 · todo el día · 2 por acción', ...base, entryUntil: 360, side: 'both', targetR: 1, priorBars: 10, touchTol: 0.001, beAtR: 0, maxPerDay: 2 });
  variants.push({ kind: 'vwap', name: 'VWAP · both · obj 1 · hasta 10:30', ...base, entryUntil: 60, side: 'both', targetR: 1, priorBars: 10, touchTol: 0.001, beAtR: 0, maxPerDay: 1 });
  for (const minGap of [0.03, 0.05, 0.08])
    for (const [targetMode, targetR] of [
      ['gapfill', 3],
      ['R', 1],
      ['R', 2],
    ] as const)
      for (const entryMode of ['contra', 'fallida'] as const)
        variants.push({ kind: 'gap', name: `GAP ≥ ${pct(minGap)} · ${entryMode === 'contra' ? '1.ª vela en contra' : 'ruptura fallida'} · ${targetMode === 'gapfill' ? 'cubrir el gap (tope 3R)' : `obj ${targetR}R`} · both`, ...base, entryUntil: 360, side: 'both', targetR, minGap, targetMode, entryMode });
  variants.push({ kind: 'gap', name: 'GAP ≥ 5 % · 1.ª vela en contra · obj 1R · solo cortos (gap al alza)', ...base, entryUntil: 360, side: 'short', targetR: 1, minGap: 0.05, targetMode: 'R', entryMode: 'contra' });
  variants.push({ kind: 'gap', name: 'GAP ≥ 5 % · 1.ª vela en contra · obj 1R · solo largos (gap a la baja)', ...base, entryUntil: 360, side: 'long', targetR: 1, minGap: 0.05, targetMode: 'R', entryMode: 'contra' });
  variants.push({ kind: 'gap', name: 'GAP ≥ 5 % · 1.ª vela en contra · obj 1R · both · optimista', ...base, fill: 'optimista', entryUntil: 360, side: 'both', targetR: 1, minGap: 0.05, targetMode: 'R', entryMode: 'contra' });
  variants.push({ kind: 'gap', name: 'GAP ≥ 5 % · 1.ª vela en contra · obj 1R · both · riesgo ≤ 0,5 ATR', ...base, maxRiskAtr: 0.5, entryUntil: 360, side: 'both', targetR: 1, minGap: 0.05, targetMode: 'R', entryMode: 'contra' });

  // Grilla fina de la única con señal: vender el gap al alza cuya primera vela va en contra.
  if (process.argv[5] === 'gapup') {
    variants.length = 0;
    for (const minGap of [0.03, 0.04, 0.05, 0.06, 0.08, 0.1])
      for (const targetR of [0.75, 1, 1.5])
        for (const maxRiskAtr of [0.5, 1])
          for (const entryUntil of [30, 90, 360])
            variants.push({ kind: 'gap', name: `GAP ↑ ≥ ${pct(minGap)} · 1.ª vela roja · corto · obj ${targetR}R · riesgo ≤ ${maxRiskAtr} ATR · hasta ${entryUntil === 360 ? '15:30' : entryUntil === 90 ? '11:00' : '10:00'}`, ...base, maxRiskAtr, entryUntil, side: 'short', targetR, minGap, targetMode: 'R', entryMode: 'contra' });
    for (const minGap of [0.05, 0.08])
      variants.push({ kind: 'gap', name: `GAP ↑ ≥ ${pct(minGap)} · 1.ª vela roja · corto · cubrir el gap (tope 2R) · riesgo ≤ 1 ATR · hasta 15:30`, ...base, entryUntil: 360, side: 'short', targetR: 2, minGap, targetMode: 'gapfill', entryMode: 'contra' });
    // ¿Es el volumen relativo lo que separa el gap que revierte? (solo tiene sentido con la selección 'gappers').
    for (const minRvol of [2, 3, 5, 10])
      for (const minGap of [0.05, 0.08])
        for (const targetR of [1, 1.5])
          variants.push({ kind: 'gap', name: `GAP ↑ ≥ ${pct(minGap)} · rvol ≥ ${minRvol}× · 1.ª vela roja · corto · obj ${targetR}R · riesgo ≤ 1 ATR · hasta 15:30`, ...base, entryUntil: 360, side: 'short', targetR, minGap, targetMode: 'R', entryMode: 'contra', minRvol });
  }
  const results = variants.map((v) => ({ v, trades: [] as Trade[] }));
  for (const day of days) {
    const top = load<Array<{ sym: string; rvol?: number }>>(join(ROOT, INPLAY, `${day}.json`));
    const open = load<Record<string, Bar>>(join(ROOT, 'open5', `${day}.json`));
    const mins = load<Record<string, Bar[]>>(join(ROOT, 'min', `${day}.json`));
    for (const { sym, rvol } of top) {
      const o = open[sym];
      const m = mins[sym];
      if (!o || !m?.length) continue;
      for (const r of results) {
        if (r.v.kind === 'vwap') r.trades.push(...simulateVwap(day, sym, m, r.v));
        else {
          if (r.v.minRvol && (rvol ?? 0) < r.v.minRvol) continue;
          const t = simulateGap(day, sym, o, m, r.v);
          if (t) r.trades.push(t);
        }
      }
    }
  }
  console.log(`# Retroceso a VWAP y reversión del gap en acciones en juego · ${days[0]} a ${days[days.length - 1]} · ${days.length} días · velas reales de 1 min · selección ${INPLAY}\n`);
  console.log('Costos: 1 ¢ por acción + 0,01 % por lado. Vela de entrada pesimista salvo que diga "optimista". Riesgo entre 0,1 y 1 ATR salvo que se indique. Tamaño: 0,5 % del capital en riesgo por trade, tope 20 % por posición.\n');
  console.log('| Variante | Trades | /día | Aciertos | R prom. | Gan. prom. (R) | Pérd. prom. (R) | Factor | Retorno | Drawdown | Por stop | Por objetivo |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const s = stats(r.trades, days.length);
    console.log(`| ${r.v.name} | ${s.trades} | ${num(s.perDay, 1)} | ${pct(s.winRate)} | ${num(s.avgR)} | ${num(s.avgWinR)} | ${num(s.avgLossR)} | ${num(s.pf)} | ${pct(s.ret)} | ${pct(s.maxDd)} | ${pct(s.stops)} | ${pct(s.targets)} |`);
  }
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

main();
