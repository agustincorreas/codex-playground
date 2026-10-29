// El libro de jugadas del "IA Trader": las reglas de momentum en small caps al estilo Ross Cameron,
// escritas como funciones puras sobre lo que ya calcula el motor (pilares, escáneres, velas, VWAP,
// EMA 9, bull flag). Elige qué acción mirar, cuándo entrar (con stop y objetivo 2:1) y cómo salir.
// La IA (Claude) opina encima de esto; sin IA, estas reglas alcanzan para operar.
import { REG_OPEN, etParts } from '../engine/time';
import type { Bar, Quote, ScanRow, Settings, SymbolDetail } from '../engine/types';
import type { Position } from './types';

const MIN = 60_000;

/** Horario y límites del IA Trader (minutos ET). */
export interface PlaybookRules {
  /** Desde cuándo se buscan entradas (7:00) y hasta cuándo (11:30: después del mediodía Ross no opera). */
  entryFrom: number;
  entryTo: number;
  /** Máximo de trades por día y de perdedores seguidos antes de parar. */
  maxTrades: number;
  maxLosers: number;
  /** Pérdida máxima del día en R (múltiplos del riesgo por trade). */
  maxLossR: number;
  /** Puntaje mínimo (0-100) para que una candidata merezca mirarse de cerca. */
  minScore: number;
  /** El objetivo tiene que pagar al menos tantas veces el riesgo (si Claude propone otro stop/objetivo). */
  minRewardR: number;
  /** Multiplica el riesgo por trade de la cuenta (0,5 = la mitad; 1,5 = una vez y media). */
  riskMult: number;
  /** Objetivo del plan en múltiplos del riesgo (2 = 2:1). */
  targetR: number;
  /** Minutos sin avanzar antes de salir sin esperar el stop. */
  timeStopMin: number;
}

export const DEFAULT_RULES: PlaybookRules = { entryFrom: 7 * 60, entryTo: 11 * 60 + 30, maxTrades: 8, maxLosers: 3, maxLossR: 3, minScore: 45, minRewardR: 1.5, riskMult: 1, targetR: 2, timeStopMin: 6 };

/** Perfiles del modo automático: fijan todas las reglas de una vez. "Personalizado" = reglas tocadas a mano. */
export type AiProfile = 'conservador' | 'equilibrado' | 'agresivo' | 'personalizado';

export const PROFILES: Record<Exclude<AiProfile, 'personalizado'>, PlaybookRules> = {
  // Solo la primera hora, pocas entradas, medio riesgo, exige la obvia y un objetivo 2:1 limpio.
  conservador: { entryFrom: 9 * 60 + 30, entryTo: 10 * 60 + 30, maxTrades: 4, maxLosers: 2, maxLossR: 2, minScore: 65, minRewardR: 2, riskMult: 0.5, targetR: 2, timeStopMin: 5 },
  equilibrado: { ...DEFAULT_RULES },
  // Pre-market y hasta el mediodía, más trades, una vez y media el riesgo, acepta setups menos obvios y apunta a 3:1.
  agresivo: { entryFrom: 7 * 60, entryTo: 12 * 60 + 30, maxTrades: 15, maxLosers: 4, maxLossR: 5, minScore: 35, minRewardR: 1.2, riskMult: 1.5, targetR: 3, timeStopMin: 8 },
};

export const PROFILE_LABEL: Record<AiProfile, string> = { conservador: 'Conservador', equilibrado: 'Equilibrado', agresivo: 'Agresivo', personalizado: 'Personalizado' };

export const PROFILE_HINT: Record<AiProfile, string> = {
  conservador: 'Solo de 9:30 a 10:30, hasta 4 trades, para a los 2 perdedores o 2R, la mitad del riesgo, exige la obvia del día (65+) y objetivo 2:1 que pague 2R.',
  equilibrado: 'Lo que hace Ross: de 7:00 a 11:30, hasta 8 trades, para a los 3 perdedores o 3R, riesgo normal, candidatas de 45+ y objetivo 2:1.',
  agresivo: 'De 7:00 a 12:30, hasta 15 trades, para a los 4 perdedores o 5R, una vez y media el riesgo, acepta candidatas de 35+ y apunta a 3:1 dejando correr más.',
  personalizado: 'Reglas tocadas a mano (elegí un perfil para volver a los valores de fábrica).',
};

/** Qué perfil representan estas reglas (o "personalizado" si no coinciden con ninguno). */
export function profileOf(rules: PlaybookRules): AiProfile {
  for (const [name, r] of Object.entries(PROFILES) as Array<[Exclude<AiProfile, 'personalizado'>, PlaybookRules]>) {
    if ((Object.keys(r) as Array<keyof PlaybookRules>).every((k) => Math.abs(r[k] - rules[k]) < 1e-9)) return name;
  }
  return 'personalizado';
}

export interface Candidate {
  sym: string;
  /** 0 a 100: cuánto se parece a "la obvia" (5 pilares, RVOL enorme, float chico, noticia, cerca del máximo). */
  score: number;
  reasons: string[];
  warnings: string[];
  row: ScanRow;
}

const fmtM = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : String(Math.round(v)));

/**
 * Ordena las acciones del escáner como lo haría Ross: primero las que cumplen los 5 pilares, con el
 * volumen relativo más grande, el float más chico y noticia, y que todavía están cerca del máximo del
 * día. Descarta las que están en halt, muy lejos del máximo o con spread imposible.
 */
export function rankCandidates(rows: ScanRow[], settings: Settings): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const r of rows) {
    if (seen.has(r.sym)) continue;
    seen.add(r.sym);
    if (r.halted || r.price <= 0) continue;
    if (r.price < settings.priceMin || r.price > settings.priceMax) continue;
    if (r.changePct < Math.min(settings.minChangePct, 5)) continue;
    if (r.pctFromHod < -15) continue;
    const reasons: string[] = [];
    const warnings: string[] = [];
    let score = 0;
    score += r.pillars.score * 12; // hasta 60
    reasons.push(`${r.pillars.score} pilares`);
    if (r.rvol >= 20) score += 12;
    else if (r.rvol >= 5) score += 8;
    else if (r.rvol >= 2) score += 3;
    if (r.rvol >= 5) reasons.push(`RVOL ${r.rvol.toFixed(0)}x`);
    if (r.float !== undefined) {
      if (r.float <= 5e6) score += 10;
      else if (r.float <= settings.maxFloat) score += 6;
      else if (r.float <= settings.maxFloatSoft) score += 2;
      else warnings.push(`float grande (${fmtM(r.float)})`);
      if (r.float <= settings.maxFloat) reasons.push(`float ${fmtM(r.float)}`);
    } else warnings.push('float desconocido');
    if (r.hasNews) {
      score += 8;
      reasons.push('con noticia');
    } else warnings.push('sin noticia');
    if (r.pctFromHod >= -3) {
      score += 6;
      reasons.push('en el máximo');
    } else if (r.pctFromHod >= -8) score += 2;
    else warnings.push(`${Math.abs(r.pctFromHod).toFixed(0)} % bajo el máximo`);
    if (r.chg5m > 0) score += Math.min(4, r.chg5m);
    if (r.price > 0 && r.ask > r.bid && (r.ask - r.bid) / r.price > 0.015) {
      score -= 10;
      warnings.push('spread ancho');
    }
    if (r.vol5m < 20_000) {
      score -= 8;
      warnings.push('poco volumen ahora');
    }
    if (r.changePct > 150) {
      score -= 8;
      warnings.push(`muy extendida (+${r.changePct.toFixed(0)} %)`);
    }
    const dil = (r.flags ?? []).filter((f) => /424B|S-1/.test(f));
    if (dil.length) {
      score -= 6;
      warnings.push(`riesgo de dilución (${dil[0]})`);
    }
    out.push({ sym: r.sym, score: Math.max(0, Math.min(100, Math.round(score))), reasons, warnings, row: r });
  }
  return out.sort((a, b) => b.score - a.score || b.row.rvol - a.row.rvol);
}

export type EntryKind = 'bullFlag' | 'microPullback' | 'hodBreak' | 'pmhBreak';

export interface EntryPlan {
  kind: EntryKind;
  entry: number;
  stop: number;
  target: number;
  reason: string;
}

const LABEL: Record<EntryKind, string> = { bullFlag: 'Bull flag', microPullback: 'Micro pullback', hodBreak: 'Ruptura del máximo', pmhBreak: 'Ruptura del máximo pre-market' };
export const entryLabel = (k: EntryKind) => LABEL[k];

const r2 = (p: number) => Math.round(p * 100) / 100;
const tick = (p: number) => (p >= 1 ? 0.01 : 0.0001);

/** Un plan solo sirve si el stop está cerca (hasta 6 % del precio, menos en acciones caras) y paga el objetivo (2:1 por defecto). */
function finish(kind: EntryKind, entry: number, stop: number, reason: string, nextLevel?: number, targetR = 2): EntryPlan | null {
  if (!(entry > 0) || !(stop > 0) || stop >= entry) return null;
  const risk = entry - stop;
  if (risk / entry > 0.06 || risk < tick(entry) * 2) return null;
  let target = r2(entry + targetR * risk);
  // Si hay un nivel redondo cerca por encima del objetivo, se apunta ahí (nunca por debajo del objetivo).
  if (nextLevel && nextLevel > target && nextLevel - entry <= (targetR + 1) * risk) target = r2(nextLevel);
  return { kind, entry: r2(entry), stop: r2(stop), target, reason };
}

/** Lo que lleva operado la acción recién (para no entrar en algo que se murió). */
function recentVolumeOk(bars: Bar[]): boolean {
  const last = bars.slice(-3);
  return last.length > 0 && last.reduce((v, b) => v + b.v, 0) >= 15_000;
}

/**
 * Busca una entrada en la acción que se está mirando, con las velas de 1 minuto y la cotización:
 * 1. Bull flag armado por el motor (la vela que supera el máximo del banderín).
 * 2. Micro pullback: subida fuerte, 1 a 3 velas de descanso con menos volumen y la vela actual supera
 *    el máximo de la anterior.
 * 3. Ruptura del máximo del día con volumen, estando sobre VWAP y EMA 9.
 * 4. Ruptura del máximo del pre-market en los primeros minutos de la rueda.
 * Devuelve null si no hay nada limpio: no entrar también es una decisión.
 */
export function findEntry(detail: SymbolDetail, quote: Quote | null, now: number, rules: Pick<PlaybookRules, 'targetR'> = DEFAULT_RULES): EntryPlan | null {
  const { row, bars, setup } = detail;
  const tr = rules.targetR;
  if (row.halted || bars.length < 3) return null;
  const ask = quote?.ask || row.ask || row.price;
  const bid = quote?.bid || row.bid || row.price;
  if (!(ask > 0) || !(bid > 0)) return null;
  if ((ask - bid) / ask > 0.02) return null;
  if (!recentVolumeOk(bars)) return null;
  const last = bars[bars.length - 1];
  const closed = bars.slice(0, -1);
  const prev = closed[closed.length - 1];

  // 1. Bull flag del motor.
  if (setup.flag && ask >= setup.flag.entry && ask <= setup.flag.entry * 1.01 && setup.aboveVwap) {
    return finish('bullFlag', ask, setup.flag.stop, 'Bull flag: la vela supera el máximo del banderín con el precio sobre VWAP', setup.nextLevel, tr);
  }

  // 2. Micro pullback.
  if (prev && setup.aboveVwap && setup.aboveEma9 && row.pctFromHod >= -6) {
    // Impulso en las últimas 6 velas cerradas y descanso de 1 a 3 velas.
    const window = closed.slice(-8);
    const lowStart = Math.min(...window.slice(0, 3).map((b) => b.l));
    const hiIdx = window.reduce((best, b, i) => (b.h > window[best].h ? i : best), 0);
    const pole = window.slice(0, hiIdx + 1);
    const rest = window.slice(hiIdx + 1);
    const poleHigh = window[hiIdx]?.h ?? 0;
    if (rest.length >= 1 && rest.length <= 3 && poleHigh > 0 && (poleHigh - lowStart) / lowStart >= 0.03) {
      const restLow = Math.min(...rest.map((b) => b.l));
      const restVol = rest.reduce((v, b) => v + b.v, 0) / rest.length;
      const poleVol = pole.reduce((v, b) => v + b.v, 0) / Math.max(1, pole.length);
      const retrace = (poleHigh - restLow) / Math.max(tick(poleHigh), poleHigh - lowStart);
      const breaking = last.h > prev.h && ask >= prev.h && ask <= prev.h * 1.012;
      if (restVol < poleVol && retrace <= 0.5 && breaking && restLow > 0) {
        return finish('microPullback', ask, restLow - tick(ask), `Micro pullback: ${rest.length} vela${rest.length === 1 ? '' : 's'} de descanso con menos volumen y rompe el máximo de la anterior`, setup.nextLevel, tr);
      }
    }
  }

  // 3. Ruptura del máximo del día.
  if (prev && setup.aboveVwap && setup.aboveEma9 && row.hod > 0 && ask >= row.hod && ask <= row.hod * 1.008 && last.v >= prev.v * 0.8) {
    const lows = closed.slice(-3).map((b) => b.l);
    const stop = Math.max(Math.min(...lows), detail.ema9 > 0 ? Math.min(detail.ema9, ask * 0.97) : 0);
    return finish('hodBreak', ask, stop, 'Rompe el máximo del día con volumen, sobre VWAP y EMA 9', setup.nextLevel, tr);
  }

  // 4. Ruptura del máximo del pre-market al abrir.
  const m = etParts(now).minutes;
  if (prev && m >= REG_OPEN && m <= REG_OPEN + 15 && detail.pmHigh > 0 && ask >= detail.pmHigh && ask <= detail.pmHigh * 1.01 && setup.aboveVwap) {
    const stop = Math.max(Math.min(...closed.slice(-2).map((b) => b.l)), ask * 0.95);
    return finish('pmhBreak', ask, stop, 'Rompe el máximo del pre-market en los primeros minutos de la rueda', setup.nextLevel, tr);
  }
  return null;
}

/** Cuántas acciones: por riesgo, sin pasar del poder de compra ni de la liquidez (y en lotes cómodos). */
export function sizeFor(riskAmount: number, entry: number, stop: number, buyingPower: number, volPerMin: number): number {
  const risk = entry - stop;
  if (!(risk > 0) || !(entry > 0)) return 0;
  let shares = Math.floor(riskAmount / risk);
  shares = Math.min(shares, Math.floor((buyingPower * 0.95) / entry));
  if (volPerMin > 0) shares = Math.min(shares, Math.floor(volPerMin * 0.1));
  const lot = shares >= 1000 ? 100 : shares >= 100 ? 10 : 1;
  return Math.max(0, Math.floor(shares / lot) * lot);
}

export type ExitKind = 'hold' | 'sellHalf' | 'sellAll' | 'stopToBreakeven';

export interface ExitAdvice {
  action: ExitKind;
  reason: string;
}

/** Lo que el trader recuerda de una posición mientras la maneja. */
export interface PositionMemory {
  halfTaken: boolean;
  breakeven: boolean;
  enteredAt: number;
  /** Última vela de 1 minuto evaluada (las reglas de cierre se miran una vez por vela). */
  lastBarT: number;
  /** Máximo alcanzado desde la entrada. */
  high: number;
}

export function newMemory(now: number, price: number): PositionMemory {
  return { halfTaken: false, breakeven: false, enteredAt: now, lastBarT: 0, high: price };
}

/**
 * Cómo manejar una posición abierta, como Ross: stop sin discutir; en 2R se vende la mitad y el stop
 * sube al precio de entrada; el resto se deja correr mientras el precio respete la EMA 9 de 1 minuto y
 * el VWAP; si en 6 minutos no avanzó, se sale; y si se extendió mucho y aparece una mecha arriba, se toma.
 */
export function manage(pos: Position, detail: SymbolDetail, quote: Quote | null, now: number, mem: PositionMemory, rules: Pick<PlaybookRules, 'targetR' | 'timeStopMin'> = DEFAULT_RULES): ExitAdvice {
  const last = quote?.last || detail.row.price;
  const bid = quote?.bid || detail.row.bid || last;
  if (!(last > 0)) return { action: 'hold', reason: '' };
  mem.high = Math.max(mem.high, last);
  const stop = pos.stop ?? pos.planStop ?? pos.initialStop;
  const risk = pos.initialStop ? pos.avgCost - pos.initialStop : pos.avgCost * 0.03;
  const r = risk > 0 ? (last - pos.avgCost) / risk : 0;
  const target = pos.target ?? pos.planTarget ?? pos.avgCost + rules.targetR * risk;

  if (detail.row.halted) return { action: 'hold', reason: 'En halt: no se puede operar.' };
  // Stop: sin discutir (con el bid, que es lo que se cobra).
  if (stop && bid <= stop && !pos.stop) return { action: 'sellAll', reason: `Tocó el stop (${stop.toFixed(2)})` };
  if (mem.breakeven && !pos.stop && bid <= pos.avgCost) return { action: 'sellAll', reason: 'Volvió al precio de entrada después de tomar la mitad' };

  // Objetivo: mitad afuera y el stop al precio de entrada.
  if (!mem.halfTaken && bid >= target) return { action: 'sellHalf', reason: `Llegó al objetivo (${target.toFixed(2)}, ${r.toFixed(1)}R): se vende la mitad` };
  if (mem.halfTaken && !mem.breakeven) return { action: 'stopToBreakeven', reason: 'Con la mitad tomada, el stop sube a la entrada' };

  // Reglas por vela cerrada: EMA 9 y VWAP.
  const bars = detail.bars;
  const prev = bars.length >= 2 ? bars[bars.length - 2] : undefined;
  if (prev && prev.t !== mem.lastBarT) {
    mem.lastBarT = prev.t;
    if (mem.halfTaken && detail.ema9 > 0 && prev.c < detail.ema9) return { action: 'sellAll', reason: 'Cerró una vela debajo de la EMA 9: se toma el resto' };
    if (prev.c < detail.row.vwap && detail.row.vwap > 0) return { action: 'sellAll', reason: 'Perdió el VWAP' };
    // Mecha arriba después de una extensión: se toma.
    const range = prev.h - prev.l;
    if (r >= 3 && range > 0 && (prev.h - prev.c) / range > 0.6) return { action: mem.halfTaken ? 'sellAll' : 'sellHalf', reason: `Mecha de rechazo con ${r.toFixed(1)}R de ganancia` };
  }
  // Tiempo: si no avanza, afuera.
  if (!mem.halfTaken && now - mem.enteredAt > rules.timeStopMin * MIN && last < pos.avgCost + 0.25 * risk) return { action: 'sellAll', reason: `${rules.timeStopMin} minutos sin avanzar: se sale sin esperar el stop` };
  return { action: 'hold', reason: '' };
}

/** ¿Es hora de buscar entradas? (ET en minutos). */
export function inEntryWindow(now: number, rules: PlaybookRules): boolean {
  const m = etParts(now).minutes;
  return m >= rules.entryFrom && m <= rules.entryTo;
}
