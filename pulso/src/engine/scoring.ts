import type { HitJudgement, StepScore } from './types';

/** Ventanas de timing en ms (relativas al instante exacto de la nota). */
export const TIMING = {
  perfect: 45,
  good: 130, // hasta aquí se marca como temprano/tarde
};

export function judge(deltaMs: number): HitJudgement {
  const a = Math.abs(deltaMs);
  if (a <= TIMING.perfect) return 'perfect';
  if (a <= TIMING.good) return deltaMs < 0 ? 'early' : 'late';
  return 'miss';
}

export const JUDGEMENT_COLORS: Record<HitJudgement, string> = {
  perfect: '#34d399',
  early: '#fb923c',
  late: '#a78bfa',
  miss: '#f43f5e',
  extra: '#64748b',
};

export function computeStepScore(stepId: string, counts: { perfect: number; early: number; late: number; miss: number; extra: number; total: number; bestStreak: number }): StepScore {
  const { perfect, early, late, miss, extra, total, bestStreak } = counts;
  if (total === 0) return { stepId, score: 100, perfect, early, late, miss, extra, total, bestStreak };
  const raw = (perfect * 1 + (early + late) * 0.6) / total;
  const extraPenalty = Math.min(0.25, (extra / total) * 0.15);
  const score = Math.max(0, Math.round((raw - extraPenalty) * 100));
  return { stepId, score, perfect, early, late, miss, extra, total, bestStreak };
}

export function starsFor(score: number): 0 | 1 | 2 | 3 {
  if (score >= 95) return 3;
  if (score >= 80) return 2;
  if (score >= 60) return 1;
  return 0;
}

export const STAR_THRESHOLDS = [60, 80, 95];

export function xpFor(score: number, grade: number, notes: number): number {
  const base = 20 + grade * 6 + Math.min(60, notes / 2);
  return Math.round(base * (0.3 + 0.7 * (score / 100)));
}

export function levelFromXp(xp: number): { level: number; into: number; needed: number } {
  let level = 1;
  let remaining = xp;
  let needed = 200;
  while (remaining >= needed) {
    remaining -= needed;
    level++;
    needed = Math.round(needed * 1.18);
  }
  return { level, into: remaining, needed };
}
