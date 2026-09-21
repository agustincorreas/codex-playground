import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { InputMethod, Instrument, LessonResult } from '../engine/types';
import { levelFromXp } from '../engine/scoring';
import { getLesson } from '../content';

export type Lang = 'es' | 'en';

export interface Settings {
  metronome: boolean;
  countIn: boolean;
  guide: boolean;
  backing: boolean;
  latencyMs: number;
  midiDevice: string | 'all';
  volume: number;
  backingVolume: number;
  latinNames: boolean;
  lang: Lang;
  dailyGoalMin: 5 | 10 | 15 | 20 | 30;
  showHands: boolean;
  showKeyLabels: boolean;
  noteSpeed: 1 | 2 | 3; // 1 lento, 2 normal, 3 rápido
  haptics: boolean;
  theme: 'dark' | 'light' | 'system';
}

export interface LessonProgress {
  bestScore: number;
  bestStars: 0 | 1 | 2 | 3;
  attempts: number;
  lastPlayed: string;
  history: { date: string; score: number; bpm: number }[];
}

export interface Trophy {
  id: string;
  unlockedAt: string;
}

export interface State {
  onboarded: boolean;
  name: string;
  instrument: Instrument;
  inputMethod: InputMethod;
  experience: 'new' | 'some' | 'pro';
  premium: boolean;
  settings: Settings;
  xp: number;
  progress: Record<string, LessonProgress>;
  /** Segundos practicados por día (YYYY-MM-DD). */
  practice: Record<string, number>;
  /** Días en que se cumplió la meta diaria. */
  goalsHit: string[];
  trophies: Trophy[];
  lastLessonId: string | null;
  recentLessonIds: string[];
  favorites: string[];
  freePlaysToday: { date: string; count: number };

  // acciones
  completeOnboarding: (p: { name: string; instrument: Instrument; inputMethod: InputMethod; experience: State['experience'] }) => void;
  setInstrument: (i: Instrument) => void;
  setInputMethod: (m: InputMethod) => void;
  setSettings: (s: Partial<Settings>) => void;
  setPremium: (p: boolean) => void;
  addPractice: (seconds: number) => void;
  recordResult: (r: LessonResult) => { newTrophies: string[]; leveledUp: boolean; goalJustHit: boolean };
  setLastLesson: (id: string) => void;
  toggleFavorite: (id: string) => void;
  consumeFreePlay: () => boolean;
  resetProgress: () => void;
}

export const todayKey = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export function dayOffset(key: string, offset: number) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d + offset);
  return todayKey(dt);
}

/** Racha: días consecutivos (terminando hoy o ayer) con al menos 5 minutos de práctica. */
export function computeStreak(practice: Record<string, number>): number {
  const MIN = 5 * 60;
  let day = todayKey();
  if ((practice[day] ?? 0) < MIN) day = dayOffset(day, -1);
  let n = 0;
  while ((practice[day] ?? 0) >= MIN) {
    n++;
    day = dayOffset(day, -1);
  }
  return n;
}

export function bestStreak(practice: Record<string, number>): number {
  const MIN = 5 * 60;
  const days = Object.keys(practice).filter((k) => practice[k] >= MIN).sort();
  let best = 0;
  let cur = 0;
  let prev: string | null = null;
  for (const d of days) {
    cur = prev && dayOffset(prev, 1) === d ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = d;
  }
  return best;
}

export const TROPHY_DEFS: { id: string; title: string; description: string; emoji: string; check: (s: State) => boolean }[] = [
  { id: 'first-lesson', title: 'Primer paso', description: 'Completaste tu primera lección.', emoji: '🎉', check: (s) => Object.keys(s.progress).length >= 1 },
  { id: 'first-record', title: 'Primer récord', description: 'Conseguiste 2 estrellas en una lección.', emoji: '💿', check: (s) => Object.values(s.progress).some((p) => p.bestStars >= 2) },
  { id: 'three-stars', title: 'Perfeccionista', description: 'Conseguiste 3 estrellas en una lección.', emoji: '🌟', check: (s) => Object.values(s.progress).some((p) => p.bestStars >= 3) },
  { id: 'ten-lessons', title: 'Diez de diez', description: 'Completaste 10 lecciones.', emoji: '🔟', check: (s) => Object.keys(s.progress).length >= 10 },
  { id: 'twenty-five-lessons', title: 'Coleccionista', description: 'Completaste 25 lecciones.', emoji: '📚', check: (s) => Object.keys(s.progress).length >= 25 },
  { id: 'streak-3', title: 'Calentando', description: 'Racha de 3 días.', emoji: '🔥', check: (s) => bestStreak(s.practice) >= 3 },
  { id: 'streak-7', title: 'Una semana', description: 'Racha de 7 días.', emoji: '🔥', check: (s) => bestStreak(s.practice) >= 7 },
  { id: 'streak-30', title: 'Imparable', description: 'Racha de 30 días.', emoji: '🏆', check: (s) => bestStreak(s.practice) >= 30 },
  { id: 'hour', title: 'Una hora', description: 'Practicaste 1 hora en total.', emoji: '⏱️', check: (s) => Object.values(s.practice).reduce((a, b) => a + b, 0) >= 3600 },
  { id: 'ten-hours', title: 'Diez horas', description: 'Practicaste 10 horas en total.', emoji: '⏳', check: (s) => Object.values(s.practice).reduce((a, b) => a + b, 0) >= 36000 },
  { id: 'goals-5', title: 'Constante', description: 'Cumpliste la meta diaria 5 veces.', emoji: '🎯', check: (s) => s.goalsHit.length >= 5 },
  { id: 'goals-20', title: 'Disciplina', description: 'Cumpliste la meta diaria 20 veces.', emoji: '🥇', check: (s) => s.goalsHit.length >= 20 },
  { id: 'level-5', title: 'Nivel 5', description: 'Alcanzaste el nivel 5.', emoji: '⬆️', check: (s) => levelFromXp(s.xp).level >= 5 },
  { id: 'level-10', title: 'Nivel 10', description: 'Alcanzaste el nivel 10.', emoji: '🚀', check: (s) => levelFromXp(s.xp).level >= 10 },
  { id: 'stars-25', title: '25 estrellas', description: 'Juntaste 25 estrellas.', emoji: '✨', check: (s) => Object.values(s.progress).reduce((a, p) => a + p.bestStars, 0) >= 25 },
  { id: 'stars-100', title: '100 estrellas', description: 'Juntaste 100 estrellas.', emoji: '💫', check: (s) => Object.values(s.progress).reduce((a, p) => a + p.bestStars, 0) >= 100 },
  { id: 'all-instruments', title: 'Multiinstrumentista', description: 'Completaste lecciones en los 3 instrumentos.', emoji: '🎼', check: (s) => new Set(Object.keys(s.progress).map((id) => getLesson(id)?.instrument)).size >= 3 },
  { id: 'song', title: 'Cantautor', description: 'Completaste una canción.', emoji: '🎤', check: (s) => Object.keys(s.progress).some((id) => getLesson(id)?.kind === 'song') },
];

const DEFAULT_SETTINGS: Settings = {
  metronome: true,
  countIn: true,
  guide: true,
  backing: true,
  latencyMs: 0,
  midiDevice: 'all',
  volume: 0.9,
  backingVolume: 0.6,
  latinNames: false,
  lang: 'es',
  dailyGoalMin: 10,
  showHands: true,
  showKeyLabels: true,
  noteSpeed: 2,
  haptics: true,
  theme: 'dark',
};

export const FREE_PLAYS_PER_DAY = 5;

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      onboarded: false,
      name: '',
      instrument: 'drums',
      inputMethod: 'touch',
      experience: 'new',
      premium: false,
      settings: DEFAULT_SETTINGS,
      xp: 0,
      progress: {},
      practice: {},
      goalsHit: [],
      trophies: [],
      lastLessonId: null,
      recentLessonIds: [],
      favorites: [],
      freePlaysToday: { date: todayKey(), count: 0 },

      completeOnboarding: (p) => set({ onboarded: true, ...p }),
      setInstrument: (instrument) => set({ instrument }),
      setInputMethod: (inputMethod) => set({ inputMethod }),
      setSettings: (s) => set({ settings: { ...get().settings, ...s } }),
      setPremium: (premium) => set({ premium }),
      addPractice: (seconds) => {
        const key = todayKey();
        const practice = { ...get().practice, [key]: (get().practice[key] ?? 0) + seconds };
        set({ practice });
      },
      recordResult: (r) => {
        const s = get();
        const prev = s.progress[r.lessonId];
        const lp: LessonProgress = {
          bestScore: Math.max(prev?.bestScore ?? 0, r.score),
          bestStars: Math.max(prev?.bestStars ?? 0, r.stars) as 0 | 1 | 2 | 3,
          attempts: (prev?.attempts ?? 0) + 1,
          lastPlayed: r.date,
          history: [...(prev?.history ?? []), { date: r.date, score: r.score, bpm: r.bpm }].slice(-30),
        };
        const beforeLevel = levelFromXp(s.xp).level;
        const xp = s.xp + r.xp;
        const key = todayKey();
        const practice = { ...s.practice, [key]: (s.practice[key] ?? 0) + r.durationSec };
        const goalMet = practice[key] >= s.settings.dailyGoalMin * 60;
        const goalJustHit = goalMet && !s.goalsHit.includes(key);
        const goalsHit = goalJustHit ? [...s.goalsHit, key] : s.goalsHit;
        const recentLessonIds = [r.lessonId, ...s.recentLessonIds.filter((x) => x !== r.lessonId)].slice(0, 8);
        const next: State = { ...s, xp, practice, goalsHit, progress: { ...s.progress, [r.lessonId]: lp }, lastLessonId: r.lessonId, recentLessonIds };
        const newTrophies: string[] = [];
        const trophies = [...s.trophies];
        for (const t of TROPHY_DEFS) {
          if (!trophies.some((x) => x.id === t.id) && t.check(next)) {
            trophies.push({ id: t.id, unlockedAt: r.date });
            newTrophies.push(t.id);
          }
        }
        set({ xp, practice, goalsHit, progress: next.progress, lastLessonId: r.lessonId, recentLessonIds, trophies });
        return { newTrophies, leveledUp: levelFromXp(xp).level > beforeLevel, goalJustHit };
      },
      setLastLesson: (id) => set({ lastLessonId: id }),
      toggleFavorite: (id) => {
        const f = get().favorites;
        set({ favorites: f.includes(id) ? f.filter((x) => x !== id) : [...f, id] });
      },
      consumeFreePlay: () => {
        const s = get();
        if (s.premium) return true;
        const today = todayKey();
        const cur = s.freePlaysToday.date === today ? s.freePlaysToday.count : 0;
        if (cur >= FREE_PLAYS_PER_DAY) return false;
        set({ freePlaysToday: { date: today, count: cur + 1 } });
        return true;
      },
      resetProgress: () => set({ xp: 0, progress: {}, practice: {}, goalsHit: [], trophies: [], lastLessonId: null, recentLessonIds: [], favorites: [] }),
    }),
    { name: 'pulso-v1' },
  ),
);

export function freePlaysLeft(s: State): number {
  if (s.premium) return Infinity;
  return s.freePlaysToday.date === todayKey() ? Math.max(0, FREE_PLAYS_PER_DAY - s.freePlaysToday.count) : FREE_PLAYS_PER_DAY;
}
