import type { Course, Instrument, Lesson } from '../engine/types';
import { DRUM_LESSONS } from './drums';
import { PAD_LESSONS } from './pads';
import { KEY_LESSONS } from './keys';

export const LESSONS: Lesson[] = [...DRUM_LESSONS, ...PAD_LESSONS, ...KEY_LESSONS];
const byId = new Map(LESSONS.map((l) => [l.id, l]));
export function getLesson(id: string): Lesson | undefined {
  return byId.get(id);
}

const COURSE_DEFS: Omit<Course, 'lessonIds'>[] = [
  { id: 'c-drums-fund', title: 'Fundamentos de batería', instrument: 'drums', description: 'Bombo, redoblante, hi-hat y tus primeros fills.', art: '#fb7185', grade: 1 },
  { id: 'c-drums-rock', title: 'Rock esencial', instrument: 'drums', description: 'De garage a punk: energía y precisión.', art: '#f97316', grade: 3 },
  { id: 'c-drums-funk', title: 'Funk y groove', instrument: 'drums', description: 'Síncopa, ghost notes y grooves lineales.', art: '#f6c343', grade: 5 },
  { id: 'c-drums-hiphop', title: 'Hip hop y neo soul', instrument: 'drums', description: 'Boom bap, trap y el pocket perfecto.', art: '#a78bfa', grade: 3 },
  { id: 'c-drums-latin', title: 'Ritmos latinos y afro', instrument: 'drums', description: 'Bossa, songo y afrobeat.', art: '#34d399', grade: 5 },
  { id: 'c-drums-fills', title: 'Fills y velocidad', instrument: 'drums', description: 'Vocabulario de fills, tresillos y drum & bass.', art: '#22d3ee', grade: 6 },
  { id: 'c-pads-fund', title: 'Finger drumming 101', instrument: 'pads', description: 'Bombo, caja y hi-hat con los dedos.', art: '#22d3ee', grade: 1 },
  { id: 'c-pads-electronic', title: 'Electrónica en pads', instrument: 'pads', description: 'House, techno, trap y footwork.', art: '#60a5fa', grade: 3 },
  { id: 'c-pads-melodic', title: 'Pads melódicos y percusión', instrument: 'pads', description: 'Acordes, chops y percusión latina.', art: '#e879f9', grade: 4 },
  { id: 'c-keys-fund', title: 'Primeras notas', instrument: 'keys', description: 'Posición de la mano, cinco dedos y mano izquierda.', art: '#7c5cff', grade: 1 },
  { id: 'c-keys-chords', title: 'Acordes esenciales', instrument: 'keys', description: 'Tríadas, progresiones pop y comping.', art: '#a78bfa', grade: 2 },
  { id: 'c-keys-melody', title: 'Melodía y dos manos', instrument: 'keys', description: 'Hooks, independencia de manos y blues.', art: '#60a5fa', grade: 4 },
  { id: 'c-keys-advanced', title: 'Jazz, latin y arpegios', instrument: 'keys', description: 'Voicings, montuno y arpegios veloces.', art: '#34d399', grade: 9 },
];

export const COURSES: Course[] = COURSE_DEFS.map((c) => ({
  ...c,
  lessonIds: LESSONS.filter((l) => l.courseId === c.id).sort((a, b) => a.grade - b.grade).map((l) => l.id),
}));
export function getCourse(id: string) {
  return COURSES.find((c) => c.id === id);
}

export function lessonsFor(instrument: Instrument) {
  return LESSONS.filter((l) => l.instrument === instrument);
}
export const GENRES = Array.from(new Set(LESSONS.map((l) => l.genre))).sort();

export function lessonDurationSec(l: Lesson): number {
  const beats = l.steps.reduce((a, s) => a + s.bars * l.timeSig[0], 0);
  return (beats * 60) / l.bpm;
}
export function lessonNoteCount(l: Lesson): number {
  return l.steps.reduce((a, s) => a + s.notes.length, 0);
}
