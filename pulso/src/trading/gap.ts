// Pulso: Gap. La estrategia de reversión del gap con volumen, medida sobre seis años de velas reales
// (ver research/orb/results.md): una acción que abre 5 % o más arriba del cierre anterior, con al menos
// 5 veces el volumen normal en los primeros 5 minutos, cuya primera vela de 5 min cierra en rojo. Se vende
// en corto al romper el mínimo de esa vela, con el stop en su máximo y el objetivo a 1 R (54 % de aciertos)
// o 1,5 R (50 %, más ganancia por trade). Lo que no se cerró a las 15:55 se cubre. Funciones puras.
import type { ScanRow, Settings } from '../engine/types';
import type { Position } from './types';

export interface GapRules {
  /** Gap mínimo de apertura respecto del cierre anterior, en %. */
  minGapPct: number;
  /** Volumen relativo mínimo de la primera vela de 5 min (contra lo normal a esa hora). */
  minRvol: number;
  /** Objetivo en múltiplos del riesgo. */
  targetR: number;
  /** Riesgo (máximo − mínimo de la primera vela) mínimo y máximo como fracción del ATR de 14 días. */
  minRiskAtr: number;
  maxRiskAtr: number;
  /** Hasta qué minuto ET se acepta la entrada (la ruptura puede tardar). */
  entryUntil: number;
  /** Minuto ET en el que se cubre lo que quedó abierto. */
  flatAt: number;
  /** Riesgo por trade como % del capital. */
  riskPct: number;
  /** Posiciones a la vez y trades por día. */
  maxPositions: number;
  maxTrades: number;
  /** Precio mínimo de la acción. */
  minPrice: number;
}

export type GapProfile = 'seguro' | 'rinde' | 'personalizado';

/** Escáneres para Pulso: Gap: acciones de US$ 5 o más (sin tope) con gap de 5 % y volumen; el resto queda como está. */
export const GAP_SCAN_SETTINGS: Partial<Settings> = { priceMin: 5, priceMax: 5000, gapperMinPct: 5, minChangePct: 5, minVolume: 100_000 };

export const DEFAULT_GAP_RULES: GapRules = { minGapPct: 5, minRvol: 5, targetR: 1, minRiskAtr: 0.1, maxRiskAtr: 1, entryUntil: 15 * 60 + 30, flatAt: 15 * 60 + 55, riskPct: 0.5, maxPositions: 2, maxTrades: 4, minPrice: 5 };

export const GAP_PROFILES: Record<Exclude<GapProfile, 'personalizado'>, GapRules> = {
  seguro: { ...DEFAULT_GAP_RULES, targetR: 1 },
  rinde: { ...DEFAULT_GAP_RULES, targetR: 1.5 },
};

export const GAP_PROFILE_LABEL: Record<GapProfile, string> = { seguro: 'Objetivo 1 R', rinde: 'Objetivo 1,5 R', personalizado: 'Personalizado' };
export const GAP_PROFILE_HINT: Record<GapProfile, string> = {
  seguro: 'Objetivo igual al riesgo: 54 % de aciertos y +0,07 R por trade en seis años de datos reales (ningún año perdedor).',
  rinde: 'Objetivo de una vez y media el riesgo: 50 % de aciertos y +0,12 R por trade, más ganancia por trade y menos aciertos.',
  personalizado: 'Reglas tocadas a mano: lo que mida no es lo medido en la investigación.',
};

export function gapProfileOf(rules: GapRules): GapProfile {
  for (const [name, r] of Object.entries(GAP_PROFILES) as Array<[Exclude<GapProfile, 'personalizado'>, GapRules]>) {
    if ((Object.keys(r) as Array<keyof GapRules>).every((k) => r[k] === rules[k])) return name;
  }
  return 'personalizado';
}

/** Estadísticas de apertura de una acción: ATR de 14 días y volumen normal de los primeros 5 minutos. */
export interface OpenStats {
  atr: number;
  avgOpen5: number;
  /** De dónde salió: del servidor (velas reales de 14 días) o estimado con el volumen diario promedio. */
  source: 'servidor' | 'estimado';
}

export type GapStatus = 'esperando' | 'armado' | 'descartado' | 'vencido';

export interface GapSetup {
  sym: string;
  status: GapStatus;
  why: string;
  gapPct: number;
  /** Volumen relativo de la primera vela (0 si todavía no cerró o no se puede calcular). */
  rvol: number;
  /** Nivel de venta (mínimo de la primera vela), stop (su máximo) y objetivo. */
  trigger: number;
  stop: number;
  target: number;
  risk: number;
  price: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** ATR de 14 días (rango verdadero promedio) a partir de velas diarias ordenadas; 0 si no alcanzan. */
export function atrOf(daily: Array<{ h: number; l: number; c: number }>, n = 14): number {
  const last = daily.slice(-(n + 1));
  if (last.length < 6) return 0;
  let sum = 0;
  for (let i = 1; i < last.length; i++) {
    const b = last[i];
    const pc = last[i - 1].c;
    sum += Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  }
  return sum / (last.length - 1);
}

/** Qué dice la estrategia de esta acción ahora. `nowMin` son minutos ET desde la medianoche. */
export function gapSetup(row: ScanRow, stats: OpenStats | null, nowMin: number, rules: GapRules): GapSetup {
  const base: GapSetup = { sym: row.sym, status: 'descartado', why: '', gapPct: row.gapPct, rvol: 0, trigger: 0, stop: 0, target: 0, risk: 0, price: row.price };
  if (!(row.prevClose > 0)) return { ...base, why: 'sin cierre anterior' };
  if (row.gapPct < rules.minGapPct) return { ...base, why: `gap de ${row.gapPct.toFixed(1)} %, menor a ${rules.minGapPct} %` };
  if (row.price < rules.minPrice) return { ...base, why: `precio menor a $${rules.minPrice}` };
  if (row.halted) return { ...base, why: 'halt' };
  const c = row.open5;
  if (!c) return { ...base, status: nowMin < 9 * 60 + 35 ? 'esperando' : 'descartado', why: nowMin < 9 * 60 + 35 ? 'la primera vela de 5 min todavía no cerró' : 'sin velas de la apertura' };
  const rvol = stats && stats.avgOpen5 > 0 ? c.v / stats.avgOpen5 : 0;
  const withRvol = { ...base, rvol };
  if (!stats) return { ...withRvol, status: 'esperando', why: 'faltan las estadísticas de apertura (ATR y volumen normal)' };
  if (rvol < rules.minRvol) return { ...withRvol, why: `volumen de apertura ${rvol.toFixed(1)}×, menor a ${rules.minRvol}×` };
  if (c.c >= c.o) return { ...withRvol, why: 'la primera vela de 5 min no cerró en rojo' };
  const risk = c.h - c.l;
  if (stats.atr > 0 && risk < rules.minRiskAtr * stats.atr) return { ...withRvol, why: `riesgo de $${r2(risk)}: menos de ${rules.minRiskAtr} ATR` };
  if (stats.atr > 0 && risk > rules.maxRiskAtr * stats.atr) return { ...withRvol, why: `riesgo de $${r2(risk)}: más de ${rules.maxRiskAtr} ATR` };
  if (nowMin > rules.entryUntil) return { ...withRvol, status: 'vencido', why: 'pasó la hora límite de entrada' };
  const trigger = r2(c.l);
  const stop = r2(c.h);
  const target = r2(trigger - rules.targetR * risk);
  if (target <= 0) return { ...withRvol, why: 'objetivo por debajo de cero' };
  return { ...withRvol, status: 'armado', why: `gap de ${row.gapPct.toFixed(1)} % con ${rvol.toFixed(1)}× el volumen normal y la primera vela en rojo`, trigger, stop, target, risk: r2(risk) };
}

/** ¿El precio rompió el mínimo de la primera vela? (se vende al bid, nunca por encima del nivel). */
export function gapTriggered(setup: GapSetup, last: number, bid: number): boolean {
  return setup.status === 'armado' && last > 0 && last <= setup.trigger && bid > 0 && bid <= setup.trigger * 1.002;
}

/** Acciones a vender: el riesgo por trade dividido por la distancia al stop, sin pasar el poder de compra. */
export function gapShares(riskAmount: number, entry: number, stop: number, buyingPower: number): number {
  const risk = stop - entry;
  if (!(risk > 0) || !(entry > 0)) return 0;
  const byRisk = Math.floor(riskAmount / risk);
  const byPower = Math.floor(buyingPower / entry);
  return Math.max(0, Math.min(byRisk, byPower));
}

export interface GapExit {
  action: 'hold' | 'cover';
  reason: string;
  role?: 'stop' | 'target' | 'eod';
}

/**
 * Manejo de un corto abierto: cubrir todo en el stop, en el objetivo o a la hora de quedar plano. El objetivo
 * del plan (`planTarget`) manda sobre el de la orden: el bróker de práctica cubre la mitad en el objetivo y el
 * resto lo cubre la estrategia acá.
 */
export function gapExit(pos: Position, last: number, nowMin: number, rules: GapRules, planTarget?: number): GapExit {
  if (nowMin >= rules.flatAt) return { action: 'cover', reason: `${Math.floor(rules.flatAt / 60)}:${String(rules.flatAt % 60).padStart(2, '0')}: nada queda abierto al cierre`, role: 'eod' };
  const stop = pos.stop ?? pos.planStop ?? pos.initialStop;
  if (stop && last >= stop) return { action: 'cover', reason: `tocó el stop ($${r2(stop)})`, role: 'stop' };
  const target = planTarget ?? pos.target ?? pos.planTarget;
  if (target && last > 0 && last <= target) return { action: 'cover', reason: `llegó al objetivo ($${r2(target)})`, role: 'target' };
  return { action: 'hold', reason: '' };
}

/** Resumen del perfil en una frase (para el registro). */
export function gapSummary(r: GapRules): string {
  const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  return `gap ≥ ${r.minGapPct} %, volumen de apertura ≥ ${r.minRvol}×, primera vela en rojo, venta al romper su mínimo, stop en su máximo, objetivo ${r.targetR} R, entradas hasta ${hhmm(r.entryUntil)}, plano a las ${hhmm(r.flatAt)}, riesgo ${r.riskPct} % por trade, hasta ${r.maxTrades} trades y ${r.maxPositions} posiciones.`;
}

/** Lo medido en la investigación (research/orb/results.md): seis años de velas reales, costos de 1 ¢ + 0,01 % por lado. */
export const GAP_RESEARCH = {
  period: '2021-01 a 2026-10 (1.459 ruedas, velas reales de 1 minuto, Alpaca SIP)',
  rows: [
    { name: 'Todos los gaps ≥ 5 % · obj 1 R', trades: 5890, perDay: 4.0, winRate: 52, avgR: 0.01, pf: 1.03, years: '4 de 6' },
    { name: 'Volumen de apertura ≥ 3× · obj 1 R', trades: 1674, perDay: 1.1, winRate: 53, avgR: 0.04, pf: 1.1, years: '6 de 6' },
    { name: 'Volumen de apertura ≥ 5× · obj 1 R (perfil «Objetivo 1 R»)', trades: 810, perDay: 0.6, winRate: 54, avgR: 0.07, pf: 1.19, years: '6 de 6' },
    { name: 'Volumen de apertura ≥ 5× · obj 1,5 R (perfil «Objetivo 1,5 R»)', trades: 810, perDay: 0.6, winRate: 50, avgR: 0.12, pf: 1.29, years: '6 de 6' },
    { name: 'Volumen de apertura ≥ 10× · obj 1,5 R', trades: 259, perDay: 0.2, winRate: 48, avgR: 0.11, pf: 1.26, years: '4 de 6' },
  ],
};
