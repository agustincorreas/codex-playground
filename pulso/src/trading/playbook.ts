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
  /** Cuántas posiciones puede manejar a la vez (mientras administra una, sigue buscando otra). */
  maxPositions: number;
  /** Riesgo abierto total (entrada − stop actual, de todas las posiciones) en múltiplos del riesgo por trade. */
  maxOpenRiskR: number;
}

export const DEFAULT_RULES: PlaybookRules = { entryFrom: 7 * 60, entryTo: 11 * 60 + 30, maxTrades: 8, maxLosers: 3, maxLossR: 3, minScore: 45, minRewardR: 1.5, riskMult: 1, targetR: 2, timeStopMin: 6, maxPositions: 2, maxOpenRiskR: 2 };

/** Perfiles del modo automático: fijan todas las reglas de una vez. "Personalizado" = reglas tocadas a mano. */
export type AiProfile = 'conservador' | 'equilibrado' | 'agresivo' | 'personalizado';

export const PROFILES: Record<Exclude<AiProfile, 'personalizado'>, PlaybookRules> = {
  // Solo la primera hora, pocas entradas, medio riesgo, exige la obvia y un objetivo 2:1 limpio.
  conservador: { entryFrom: 9 * 60 + 30, entryTo: 10 * 60 + 30, maxTrades: 4, maxLosers: 2, maxLossR: 2, minScore: 65, minRewardR: 2, riskMult: 0.5, targetR: 2, timeStopMin: 5, maxPositions: 1, maxOpenRiskR: 1 },
  equilibrado: { ...DEFAULT_RULES },
  // Pre-market y hasta el mediodía, más trades, una vez y media el riesgo, acepta setups menos obvios y apunta a 3:1.
  agresivo: { entryFrom: 7 * 60, entryTo: 12 * 60 + 30, maxTrades: 15, maxLosers: 4, maxLossR: 5, minScore: 35, minRewardR: 1.2, riskMult: 1.5, targetR: 3, timeStopMin: 8, maxPositions: 3, maxOpenRiskR: 3 },
};

export const PROFILE_LABEL: Record<AiProfile, string> = { conservador: 'Conservador', equilibrado: 'Equilibrado', agresivo: 'Agresivo', personalizado: 'Personalizado' };

export const PROFILE_HINT: Record<AiProfile, string> = {
  conservador: 'Solo de 9:30 a 10:30, hasta 4 trades, para a los 2 perdedores o 2R, la mitad del riesgo, exige la obvia del día (65+) y objetivo 2:1 que pague 2R. Una posición a la vez, sin reentradas.',
  equilibrado: 'Lo que hace Ross: de 7:00 a 11:30, hasta 8 trades, para a los 3 perdedores o 3R, riesgo normal, candidatas de 45+ y objetivo 2:1. Hasta 2 posiciones a la vez (2R de riesgo abierto).',
  agresivo: 'De 7:00 a 12:30, hasta 15 trades, para a los 4 perdedores o 5R, una vez y media el riesgo, acepta candidatas de 35+ y apunta a 3:1 dejando correr más. Hasta 3 posiciones a la vez (3R de riesgo abierto).',
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
export function rankCandidates(rows: ScanRow[], settings: Settings, force?: ReadonlySet<string>): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const r of rows) {
    if (seen.has(r.sym)) continue;
    seen.add(r.sym);
    if (r.halted || r.price <= 0) continue;
    // Las que pidió el trader ("mirá DEF", un nivel) entran aunque no cumplan los filtros del escáner.
    const forced = !!force?.has(r.sym);
    if (!forced) {
      if (r.price < settings.priceMin || r.price > settings.priceMax) continue;
      if (r.changePct < Math.min(settings.minChangePct, 5)) continue;
      if (r.pctFromHod < -15) continue;
    }
    const reasons: string[] = forced ? ['indicación tuya'] : [];
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
      else {
        // Una acción de float grande no es una small cap de las de Ross: no hace los movimientos explosivos.
        score -= 10;
        warnings.push(`float grande (${fmtM(r.float)})`);
      }
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
    if (!(r.rvol > 0)) {
      score -= 15;
      warnings.push('sin volumen relativo todavía');
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

export type EntryKind = 'bullFlag' | 'microPullback' | 'newHigh' | 'hodBreak' | 'pmhBreak' | 'level';

export interface EntryPlan {
  kind: EntryKind;
  entry: number;
  stop: number;
  target: number;
  reason: string;
}

const LABEL: Record<EntryKind, string> = { bullFlag: 'Bull flag', microPullback: 'Micro pullback', newHigh: 'Primera vela que hace máximo nuevo', hodBreak: 'Ruptura del máximo', pmhBreak: 'Ruptura del máximo pre-market', level: 'Nivel del trader' };
export const entryLabel = (k: EntryKind) => LABEL[k];

const r2 = (p: number) => Math.round(p * 100) / 100;
const tick = (p: number) => (p >= 1 ? 0.01 : 0.0001);

/** Hasta cuánto puede llevar la vela de 1 min actual desde su apertura al momento de comprar: más que eso es perseguir. */
export const MAX_CHASE = 0.03;
/** El stop no puede ser más chico que este múltiplo del rango promedio de las últimas 5 velas de 1 min (el ruido de una vela: medido en el simulador con 8 semillas, 1× rango duplica el neto y reduce a la mitad los stops tocados en el primer minuto; 0,5× o 1,5× rinden peor). */
export const MIN_STOP_RANGES = 1;

/** Rango promedio (máximo − mínimo) de las últimas `n` velas cerradas. */
export function avgRange(bars: Bar[], n = 5): number {
  const closed = bars.slice(0, -1).slice(-n);
  if (!closed.length) return 0;
  return closed.reduce((v, b) => v + Math.max(0, b.h - b.l), 0) / closed.length;
}

/**
 * Un plan solo sirve si el stop está cerca (hasta 6 % del precio, menos en acciones caras) y paga el objetivo
 * (2:1 por defecto). Si el stop del setup queda más cerca que el ruido de una vela (`minRisk`), se baja hasta
 * ahí: un stop de 1 % en una acción que se mueve 3 % por vela es un segundo de ruido, no un stop.
 */
function finish(kind: EntryKind, entry: number, stop: number, reason: string, nextLevel?: number, targetR = 2, minRisk = 0, bid = 0): EntryPlan | null {
  if (!(entry > 0) || !(stop > 0) || stop >= entry) return null;
  if (minRisk > 0 && entry - stop < minRisk) stop = r2(entry - minRisk);
  // Un stop en el bid (o arriba) ya está tocado: se compraría para vender al segundo siguiente.
  if (bid > 0 && stop >= bid) return null;
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
export function findEntry(detail: SymbolDetail, quote: Quote | null, now: number, rules: Pick<PlaybookRules, 'targetR'> = DEFAULT_RULES, skip?: ReadonlySet<EntryKind>): EntryPlan | null {
  const { row, bars, setup } = detail;
  const tr = rules.targetR;
  const ok = (k: EntryKind) => !skip?.has(k);
  if (row.halted || bars.length < 3) return null;
  const ask = quote?.ask || row.ask || row.price;
  const bid = quote?.bid || row.bid || row.price;
  if (!(ask > 0) || !(bid > 0)) return null;
  if ((ask - bid) / ask > 0.02) return null;
  if (!recentVolumeOk(bars)) return null;
  const last = bars[bars.length - 1];
  const closed = bars.slice(0, -1);
  const prev = closed[closed.length - 1];
  // No perseguir: si la vela de 1 min actual ya lleva más de 2 % desde su apertura, el que compra ahora
  // compra el techo de un impulso vertical (y el stop queda a una vela de distancia).
  if (last.o > 0 && ask / last.o - 1 > MAX_CHASE) return null;
  const minRisk = MIN_STOP_RANGES * avgRange(bars);

  // 1. Bull flag del motor.
  if (ok('bullFlag') && setup.flag && ask >= setup.flag.entry && ask <= setup.flag.entry * 1.01 && setup.aboveVwap) {
    return finish('bullFlag', ask, setup.flag.stop, 'Bull flag: la vela supera el máximo del banderín con el precio sobre VWAP', setup.nextLevel, tr, minRisk, bid);
  }

  // 2. Micro pullback.
  if (ok('microPullback') && prev && setup.aboveVwap && setup.aboveEma9 && row.pctFromHod >= -6) {
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
        return finish('microPullback', ask, restLow - tick(ask), `Micro pullback: ${rest.length} vela${rest.length === 1 ? '' : 's'} de descanso con menos volumen y rompe el máximo de la anterior`, setup.nextLevel, tr, minRisk, bid);
      }
    }
  }

  // 2b. Micro pullback en velas de 10 segundos (como lo mira Ross en la pantalla de 10 s): impulso de
  // los últimos 2 minutos, descanso de 1 a 3 velas de 10 s con menos volumen y la vela actual supera el
  // máximo de la anterior. Entra rápido para subirse al momentum.
  const sec = detail.secBars;
  if (ok('microPullback') && prev && sec.length >= 8 && setup.aboveVwap && setup.aboveEma9 && row.pctFromHod >= -6) {
    const plan = microPullback10s(sec, ask, tr, setup.nextLevel, minRisk, bid);
    if (plan) return plan;
  }

  // 2c. La primera vela de 1 minuto que hace un máximo nuevo (la regla de Ross): en una acción en juego
  // sobre VWAP y EMA 9, después de 1 a 4 velas de retroceso (rojas o con máximos descendentes), la vela
  // actual supera el máximo de la anterior. Se compra ahí, con el stop en el mínimo del retroceso.
  if (ok('newHigh') && prev && setup.aboveVwap && setup.aboveEma9 && row.pctFromHod >= -8 && closed.length >= 4) {
    const plan = firstCandleNewHigh(closed, last, ask, tr, setup.nextLevel, minRisk, bid);
    if (plan) return plan;
  }

  // 3. Ruptura del máximo del día.
  if (ok('hodBreak') && prev && setup.aboveVwap && setup.aboveEma9 && row.hod > 0 && ask >= row.hod && ask <= row.hod * 1.008 && last.v >= prev.v * 0.8) {
    const lows = closed.slice(-3).map((b) => b.l);
    const stop = Math.max(Math.min(...lows), detail.ema9 > 0 ? Math.min(detail.ema9, ask * 0.97) : 0);
    return finish('hodBreak', ask, stop, 'Rompe el máximo del día con volumen, sobre VWAP y EMA 9', setup.nextLevel, tr, minRisk, bid);
  }

  // 4. Ruptura del máximo del pre-market al abrir.
  const m = etParts(now).minutes;
  if (ok('pmhBreak') && prev && m >= REG_OPEN && m <= REG_OPEN + 15 && detail.pmHigh > 0 && ask >= detail.pmHigh && ask <= detail.pmHigh * 1.01 && setup.aboveVwap) {
    const stop = Math.max(Math.min(...closed.slice(-2).map((b) => b.l)), ask * 0.95);
    return finish('pmhBreak', ask, stop, 'Rompe el máximo del pre-market en los primeros minutos de la rueda', setup.nextLevel, tr, minRisk, bid);
  }
  return null;
}

/**
 * Un nivel que marcó el trader ("si XYZ supera 4,50 me interesa comprar"): se entra cuando el ask lo
 * cruza hacia arriba (hasta 2 % por encima, para no perseguir), la vela de 1 min actual trae volumen
 * (al menos 0,8× la anterior) y el precio está sobre VWAP. El stop va en el mínimo de las últimas dos
 * velas de 1 min, nunca más de 3 % debajo del nivel; el objetivo es el del perfil.
 */
export function findLevelEntry(detail: SymbolDetail, quote: Quote | null, level: number, rules: Pick<PlaybookRules, 'targetR'> = DEFAULT_RULES): EntryPlan | null {
  const { row, bars, setup } = detail;
  if (!(level > 0) || row.halted || bars.length < 2) return null;
  const ask = quote?.ask || row.ask || row.price;
  const bid = quote?.bid || row.bid || row.price;
  if (!(ask > 0) || !(bid > 0) || (ask - bid) / ask > 0.02) return null;
  if (ask < level || ask > level * 1.02) return null;
  if (!setup.aboveVwap) return null;
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  if (!(last.v >= prev.v * 0.8)) return null;
  // (Acá no aplica "no perseguir" por la vela: el nivel lo marcó el trader y ya se limita a 2 % por encima.)
  const stop = Math.max(Math.min(last.l, prev.l), level * 0.97);
  return finish('level', ask, stop, `Supera el nivel ${r2(level).toFixed(2)} que marcaste, con volumen y sobre VWAP`, setup.nextLevel, rules.targetR, MIN_STOP_RANGES * avgRange(bars), bid);
}

/**
 * "First 1-minute candle to make a new high": cuenta las velas de retroceso al final (rojas o con máximo
 * menor que la anterior, de 1 a 4), exige que antes hubiera subida (el máximo previo al retroceso está
 * por encima del mínimo del retroceso) y que la vela actual rompa el máximo de la anterior.
 */
function firstCandleNewHigh(closed: Bar[], last: Bar, ask: number, targetR: number, nextLevel: number | undefined, minRisk: number, bid: number): EntryPlan | null {
  const prev = closed[closed.length - 1];
  let n = 0;
  for (let i = closed.length - 1; i >= 1 && n < 4; i--) {
    const b = closed[i];
    const before = closed[i - 1];
    if (b.c < b.o || b.h < before.h) n++;
    else break;
  }
  if (n < 1) return null;
  const pull = closed.slice(-n);
  const pullLow = Math.min(...pull.map((b) => b.l));
  const pole = closed.slice(Math.max(0, closed.length - n - 6), closed.length - n);
  if (!pole.length) return null;
  const poleHigh = Math.max(...pole.map((b) => b.h));
  const poleLow = Math.min(...pole.map((b) => b.l));
  // Subida previa de al menos 2 % y retroceso que no se comió más de la mitad de esa subida (más que eso es
  // una bandera caída, no un pullback). Exigir además que el impulso fuera el máximo del día mataba
  // ganadoras en el simulador (medido con 4 semillas): no se exige; alcanza con estar a 8 % del máximo.
  if (!(poleHigh > poleLow) || (poleHigh - poleLow) / poleLow < 0.02 || (poleHigh - pullLow) / (poleHigh - poleLow) > 0.5) return null;
  const breaking = last.h > prev.h && ask >= prev.h && ask <= prev.h * 1.012;
  if (!breaking || !(pullLow > 0)) return null;
  return finish('newHigh', ask, pullLow - tick(ask), `Primera vela de 1 min que hace un máximo nuevo tras ${n} vela${n === 1 ? '' : 's'} de retroceso`, nextLevel, targetR, minRisk, bid);
}

/** Micro pullback sobre velas de 10 s: ventana de 12 velas cerradas (2 minutos), palo hasta el máximo y descanso corto. */
function microPullback10s(sec: Bar[], ask: number, targetR: number, nextLevel: number | undefined, minRisk: number, bid: number): EntryPlan | null {
  const closed = sec.slice(0, -1);
  const last = sec[sec.length - 1];
  const window = closed.slice(-12);
  if (window.length < 6) return null;
  const prev = window[window.length - 1];
  const lowStart = Math.min(...window.slice(0, 3).map((b) => b.l));
  const hiIdx = window.reduce((best, b, i) => (b.h > window[best].h ? i : best), 0);
  const pole = window.slice(0, hiIdx + 1);
  const rest = window.slice(hiIdx + 1);
  const poleHigh = window[hiIdx]?.h ?? 0;
  if (rest.length < 1 || rest.length > 3 || !(poleHigh > 0) || (poleHigh - lowStart) / lowStart < 0.02) return null;
  const restLow = Math.min(...rest.map((b) => b.l));
  const restVol = rest.reduce((v, b) => v + b.v, 0) / rest.length;
  const poleVol = pole.reduce((v, b) => v + b.v, 0) / Math.max(1, pole.length);
  const retrace = (poleHigh - restLow) / Math.max(tick(poleHigh), poleHigh - lowStart);
  const breaking = last.h > prev.h && ask >= prev.h && ask <= prev.h * 1.01;
  if (!(restVol < poleVol && retrace <= 0.5 && breaking && restLow > 0)) return null;
  return finish('microPullback', ask, restLow - tick(ask), `Micro pullback de 10 s: ${rest.length} vela${rest.length === 1 ? '' : 's'} de descanso con menos volumen y rompe el máximo de la anterior`, nextLevel, targetR, minRisk, bid);
}

/** Qué parte del capital puede ir a una sola posición según el perfil (y la mitad en pre-market, donde el libro es fino). */
export function notionalCap(profile: AiProfile, preMarket: boolean): number {
  const frac = profile === 'conservador' ? 0.5 : profile === 'agresivo' ? 1 : 0.75;
  return preMarket ? frac / 2 : frac;
}

/** Cuántas acciones: por riesgo, sin pasar del poder de compra, del tope de valor por posición ni de la liquidez (y en lotes cómodos). */
export function sizeFor(riskAmount: number, entry: number, stop: number, buyingPower: number, volPerMin: number, maxNotional = 0): number {
  const risk = entry - stop;
  if (!(risk > 0) || !(entry > 0)) return 0;
  let shares = Math.floor(riskAmount / risk);
  shares = Math.min(shares, Math.floor((buyingPower * 0.95) / entry));
  if (maxNotional > 0) shares = Math.min(shares, Math.floor(maxNotional / entry));
  if (volPerMin > 0) shares = Math.min(shares, Math.floor(volPerMin * 0.1));
  const lot = shares >= 1000 ? 100 : shares >= 100 ? 10 : 1;
  return Math.max(0, Math.floor(shares / lot) * lot);
}

export type ExitKind = 'hold' | 'sellHalf' | 'sellAll' | 'stopToBreakeven';

export interface ExitAdvice {
  action: ExitKind;
  reason: string;
  /** Qué salida es (para que el trade quede anotado como "stop" u "objetivo" y no como venta manual). */
  role?: 'stop' | 'target';
}

/** Lo que el trader recuerda de una posición mientras la maneja. */
export interface PositionMemory {
  halfTaken: boolean;
  breakeven: boolean;
  enteredAt: number;
  /** Última vela de 1 minuto evaluada (las reglas de cierre se miran una vez por vela). */
  lastBarT: number;
  /** Última vela de 10 s evaluada (la mecha de rechazo se mira una vez por vela). */
  lastSecT: number;
  /** Máximo alcanzado desde la entrada. */
  high: number;
  /** Precio de entrada original (antes de agregar): el "volvió a la entrada" se mide contra este. */
  entry: number;
  /** Stop dinámico de la IA (el mínimo del último pullback de 10 s con el trade en ganancia): solo sube. */
  stop?: number;
  /** Qué setup abrió la posición (para la memoria del día). */
  kind?: EntryKind;
  /** Acciones de la entrada original: al agregar no se supera ese tamaño. */
  shares0: number;
  /** Ya se agregó una vez a esta ganadora (se agrega una sola vez). */
  addedOnce: boolean;
  /** Es una segunda chance (reentrada después de un stop en la misma acción). */
  secondChance?: boolean;
}

export function newMemory(now: number, price: number, kind?: EntryKind, shares0 = 0): PositionMemory {
  return { halfTaken: false, breakeven: false, enteredAt: now, lastBarT: 0, lastSecT: 0, high: price, entry: 0, kind, shares0, addedOnce: false };
}

/**
 * Cómo manejar una posición abierta, como Ross: stop sin discutir; en 2R se vende la mitad y el stop
 * sube al precio de entrada; el resto se deja correr mientras el precio respete la EMA 9 de 1 minuto y
 * el VWAP; si en 6 minutos no avanzó, se sale; y si se extendió mucho y aparece una mecha arriba, se toma.
 * En 10 segundos: con el trade en ganancia (1,5R o más, o la mitad tomada) el stop sube al mínimo del último
 * pullback de 10 s y no baja más; y a 2R o más, una vela de 10 s que cierra en el tercio inferior de su
 * rango con volumen alto (mecha de rechazo) toma la mitad (o el resto).
 */
export function manage(pos: Position, detail: SymbolDetail, quote: Quote | null, now: number, mem: PositionMemory, rules: Pick<PlaybookRules, 'targetR' | 'timeStopMin'> = DEFAULT_RULES): ExitAdvice {
  const last = quote?.last || detail.row.price;
  const bid = quote?.bid || detail.row.bid || last;
  if (!(last > 0)) return { action: 'hold', reason: '' };
  mem.high = Math.max(mem.high, last);
  if (!mem.entry) mem.entry = pos.avgCost;
  const stop = pos.stop ?? pos.planStop ?? pos.initialStop;
  const risk = pos.initialStop ? pos.avgCost - pos.initialStop : pos.avgCost * 0.03;
  const r = risk > 0 ? (last - pos.avgCost) / risk : 0;
  const target = pos.target ?? pos.planTarget ?? pos.avgCost + rules.targetR * risk;
  const sec = detail.secBars;

  if (detail.row.halted) return { action: 'hold', reason: 'En halt: no se puede operar.' };
  // Stop: sin discutir (con el bid, que es lo que se cobra).
  if (stop && bid <= stop && !pos.stop) return { action: 'sellAll', reason: `Tocó el stop (${stop.toFixed(2)})`, role: 'stop' };
  // Stop dinámico de 10 s: el mínimo del último pullback, que solo sube mientras el trade va en ganancia.
  if (sec.length >= 8 && (mem.halfTaken || r >= 1.5)) {
    const recent = sec.slice(-7, -1);
    const swingLow = Math.min(...recent.map((b) => b.l));
    if (swingLow > pos.avgCost && swingLow > (mem.stop ?? 0)) mem.stop = swingLow;
  }
  if (mem.stop && bid < mem.stop) return { action: 'sellAll', reason: `Perdió el mínimo del último pullback de 10 s (${mem.stop.toFixed(2)}): ${mem.halfTaken ? 'se toma el resto' : 'se toma la ganancia'}`, role: 'stop' };
  if (mem.breakeven && !pos.stop && bid <= (mem.entry || pos.avgCost)) return { action: 'sellAll', reason: 'Volvió al precio de entrada después de tomar la mitad', role: 'stop' };

  // Objetivo: mitad afuera y el stop al precio de entrada.
  if (!mem.halfTaken && bid >= target) return { action: 'sellHalf', reason: `Llegó al objetivo (${target.toFixed(2)}, ${r.toFixed(1)}R): se vende la mitad`, role: 'target' };
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
  // Mecha de rechazo en 10 s: a 2R o más, una vela de 10 s que hizo el máximo de las últimas 7 y cerró en el
  // tercio inferior de su rango con volumen alto (una vez y media el de las 6 anteriores) es el techo: se toma.
  const prevSec = sec.length >= 8 ? sec[sec.length - 2] : undefined;
  if (prevSec && prevSec.t !== mem.lastSecT) {
    mem.lastSecT = prevSec.t;
    const before = sec.slice(-8, -2);
    const avgVol = before.reduce((v, b) => v + b.v, 0) / Math.max(1, before.length);
    const range = prevSec.h - prevSec.l;
    const topOfRecent = prevSec.h >= Math.max(...before.map((b) => b.h));
    if (r >= 2 && range > 0 && topOfRecent && (prevSec.c - prevSec.l) / range <= 1 / 3 && prevSec.v >= avgVol * 1.5) {
      return { action: mem.halfTaken ? 'sellAll' : 'sellHalf', reason: `Mecha de rechazo en 10 s con ${r.toFixed(1)}R de ganancia: ${mem.halfTaken ? 'se toma el resto' : 'se vende la mitad'}` };
    }
  }
  // Tiempo: si no avanza, afuera (salvo que en 10 s siga haciendo máximos nuevos: el momentum sigue vivo).
  if (!mem.halfTaken && now - mem.enteredAt > rules.timeStopMin * MIN && last < pos.avgCost + 0.25 * risk) {
    const fresh = sec.length >= 4 && sec.slice(-3).some((b) => b.h >= mem.high);
    if (!fresh) return { action: 'sellAll', reason: `${rules.timeStopMin} minutos sin avanzar: se sale sin esperar el stop` };
  }
  return { action: 'hold', reason: '' };
}

/** Tipos de setup con los que se agrega a una ganadora (micro pullback de 1 min o 10 s, primera vela con máximo nuevo). */
export const ADD_KINDS: ReadonlySet<EntryKind> = new Set<EntryKind>(['microPullback', 'newHigh']);
const NOT_ADD: ReadonlySet<EntryKind> = new Set<EntryKind>(['bullFlag', 'hodBreak', 'pmhBreak', 'level']);

/**
 * Agregar a la ganadora: con la mitad tomada y el stop en la entrada, si aparece otro setup (micro pullback o
 * primera vela con máximo nuevo) con el stop por encima de la entrada original, se agrega una sola vez con el
 * tamaño por riesgo medido desde el stop nuevo, sin superar el tamaño original; el stop de toda la posición
 * sube al del setup nuevo. Devuelve el plan y las acciones, o null.
 */
export function findAdd(pos: Position, detail: SymbolDetail, quote: Quote | null, now: number, mem: PositionMemory, rules: Pick<PlaybookRules, 'targetR'>, riskAmount: number, buyingPower: number, volPerMin: number): { plan: EntryPlan; shares: number } | null {
  if (!mem.halfTaken || !mem.breakeven || mem.addedOnce || mem.shares0 < 1) return null;
  const plan = findEntry(detail, quote, now, rules, NOT_ADD);
  if (!plan || plan.stop <= (mem.entry || pos.avgCost)) return null;
  const shares = Math.min(mem.shares0, sizeFor(riskAmount, plan.entry, plan.stop, buyingPower, volPerMin));
  return shares >= 1 ? { plan, shares } : null;
}

/** ¿Es hora de buscar entradas? (ET en minutos). */
export function inEntryWindow(now: number, rules: PlaybookRules): boolean {
  const m = etParts(now).minutes;
  return m >= rules.entryFrom && m <= rules.entryTo;
}
