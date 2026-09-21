// Tipos centrales de Pulso.

export type Instrument = 'keys' | 'pads' | 'drums';
export type InputMethod = 'midi' | 'keyboard' | 'touch';

/** Una nota de la lección. `beat` en negras desde el inicio del paso (0 = primer tiempo). */
export interface LessonNote {
  /** Identificador de carril: para batería 'kick','snare'...; para pads 'p0'..'p15'; para keys número MIDI. */
  lane: string;
  beat: number;
  /** Duración en negras (solo se usa para dibujar en keys). */
  dur?: number;
  /** Mano sugerida (keys): 'L' | 'R'. */
  hand?: 'L' | 'R';
}

export interface LessonStep {
  id: string;
  title: string;
  /** Compases del paso. */
  bars: number;
  notes: LessonNote[];
  /** Texto de ayuda que aparece antes del paso. */
  tip?: string;
}

export type LessonKind = 'lesson' | 'song' | 'exercise' | 'warmup';

export interface Lesson {
  id: string;
  title: string;
  artist: string;
  instrument: Instrument;
  kind: LessonKind;
  /** Grado 1–16. */
  grade: number;
  genre: string;
  bpm: number;
  timeSig: [number, number];
  description: string;
  steps: LessonStep[];
  /** Colores/arte de la tarjeta. */
  art: string;
  /** Disponible en el plan gratuito. */
  free: boolean;
  /** Etiquetas de técnica. */
  tags: string[];
  courseId?: string;
  /** Progresión armónica para la base de acompañamiento. */
  chords?: { root: number; quality: 'maj' | 'min' | 'dom7' | 'min7' }[];
}

export interface Course {
  id: string;
  title: string;
  instrument: Instrument;
  description: string;
  art: string;
  lessonIds: string[];
  grade: number;
}

export type HitJudgement = 'perfect' | 'early' | 'late' | 'miss' | 'extra';

export interface HitResult {
  noteIndex: number | null; // null para 'extra'
  lane: string;
  judgement: HitJudgement;
  deltaMs: number;
  time: number;
}

export interface StepScore {
  stepId: string;
  score: number; // 0–100
  perfect: number;
  early: number;
  late: number;
  miss: number;
  extra: number;
  total: number;
  bestStreak: number;
}

export interface LessonResult {
  lessonId: string;
  score: number;
  stars: 0 | 1 | 2 | 3;
  steps: StepScore[];
  bpm: number;
  durationSec: number;
  date: string; // ISO
  xp: number;
}
