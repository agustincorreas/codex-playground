import type { Lesson, LessonStep } from '../engine/types';
import { melody, merge, repeat, transpose } from './dsl';

const ART = ['#7c5cff', '#a78bfa', '#60a5fa', '#22d3ee', '#34d399', '#f6c343', '#fb7185', '#e879f9'];

interface StepDef { title: string; bars: number; notes: ReturnType<typeof melody>; tip?: string }
interface Def {
  id: string; title: string; artist: string; grade: number; genre: string; bpm: number; description: string; tags: string[];
  kind?: Lesson['kind']; free?: boolean; courseId?: string; steps: StepDef[];
  chords?: { root: number; quality: 'maj' | 'min' | 'dom7' | 'min7' }[];
}

function build(d: Def, i: number): Lesson {
  const steps: LessonStep[] = d.steps.map((s, si) => ({ id: `${d.id}-s${si}`, title: s.title, bars: s.bars, notes: s.notes, tip: s.tip }));
  const perf: LessonStep['notes'] = [];
  let off = 0;
  for (const s of steps) {
    perf.push(...s.notes.map((n) => ({ ...n, beat: n.beat + off })));
    off += s.bars * 4;
  }
  steps.push({ id: `${d.id}-perf`, title: 'Performance', bars: off / 4, notes: perf, tip: 'Tocá toda la lección de principio a fin.' });
  const lesson: Lesson & { chords?: Def['chords'] } = { id: d.id, title: d.title, artist: d.artist, instrument: 'keys', kind: d.kind ?? 'lesson', grade: d.grade, genre: d.genre, bpm: d.bpm, timeSig: [4, 4], description: d.description, steps, art: ART[i % ART.length], free: d.free ?? d.grade <= 2, tags: d.tags, courseId: d.courseId };
  if (d.chords) lesson.chords = d.chords;
  return lesson;
}

const R = (t: string, start = 0) => melody(t, start, 'R');
const L = (t: string, start = 0) => melody(t, start, 'L');

// Escalas
function scaleUpDown(root: string, intervals: number[], dur: number): ReturnType<typeof melody> {
  const base = melody(`${root}:${dur}`);
  const rootMidi = Number(base[0].lane);
  const up = intervals.map((s) => rootMidi + s);
  const seq = [...up, ...up.slice(0, -1).reverse()];
  return seq.map((p, idx) => ({ lane: String(p), beat: idx * dur, dur, hand: 'R' as const }));
}
const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12];
const MINOR = [0, 2, 3, 5, 7, 8, 10, 12];
const PENTA = [0, 2, 4, 7, 9, 12];
const BLUES = [0, 3, 5, 6, 7, 10, 12];

const DEFS: Def[] = [
  { id: 'ky-first-notes', title: 'Primeras notas', artist: 'Pulso Originals', grade: 1, genre: 'Pop', bpm: 70, description: 'Do, Re, Mi con la mano derecha.', tags: ['mano derecha', 'básico'], courseId: 'c-keys-fund', free: true,
    steps: [
      { title: 'Do y Re', bars: 2, notes: R('C4:1 r:1 D4:1 r:1 C4:1 r:1 D4:1 r:1'), tip: 'Pulgar en Do, índice en Re.' },
      { title: 'Do Re Mi', bars: 2, notes: R('C4:1 D4:1 E4:1 r:1 E4:1 D4:1 C4:1 r:1') },
      { title: 'Frase', bars: 4, notes: R('C4:1 D4:1 E4:1 D4:1 C4:2 r:2 E4:1 E4:1 D4:1 D4:1 C4:2 r:2') },
    ] },
  { id: 'ky-five-finger', title: 'Cinco dedos', artist: 'Pulso Originals', grade: 1, genre: 'Pop', bpm: 76, description: 'Posición de cinco dedos en Do mayor.', tags: ['mano derecha'], courseId: 'c-keys-fund', free: true,
    steps: [
      { title: 'Subir', bars: 2, notes: R('C4:1 D4:1 E4:1 F4:1 G4:2 r:2') },
      { title: 'Bajar', bars: 2, notes: R('G4:1 F4:1 E4:1 D4:1 C4:2 r:2') },
      { title: 'Ida y vuelta', bars: 4, notes: R('C4:1 D4:1 E4:1 F4:1 G4:1 F4:1 E4:1 D4:1 C4:1 E4:1 G4:1 E4:1 C4:2 r:2') },
    ] },
  { id: 'ky-left-hand', title: 'La mano izquierda', artist: 'Pulso Originals', grade: 2, genre: 'Pop', bpm: 76, description: 'Bajos con la mano izquierda: Do, Fa y Sol.', tags: ['mano izquierda'], courseId: 'c-keys-fund', free: true,
    steps: [
      { title: 'Do y Sol', bars: 2, notes: L('C3:2 G3:2 C3:2 G3:2') },
      { title: 'Do Fa Sol', bars: 4, notes: L('C3:2 C3:2 F3:2 F3:2 G3:2 G3:2 C3:2 r:2') },
      { title: 'Dos manos', bars: 4, notes: merge(L('C3:2 C3:2 F3:2 F3:2 G3:2 G3:2 C3:4'), R('E4:1 E4:1 E4:2 F4:1 F4:1 A4:2 G4:1 G4:1 B4:2 C5:4')) },
    ] },
  { id: 'ky-first-chords', title: 'Primeros acordes', artist: 'Pulso Originals', grade: 2, genre: 'Pop', bpm: 80, description: 'Tríadas de Do, Fa y Sol mayor.', tags: ['acordes'], courseId: 'c-keys-chords', free: true,
    chords: [{ root: 60, quality: 'maj' }, { root: 65, quality: 'maj' }, { root: 67, quality: 'maj' }, { root: 60, quality: 'maj' }],
    steps: [
      { title: 'Do mayor', bars: 2, notes: R('[C4,E4,G4]:2 [C4,E4,G4]:2 [C4,E4,G4]:2 [C4,E4,G4]:2'), tip: 'Pulgar, medio y meñique.' },
      { title: 'Fa y Sol', bars: 2, notes: R('[F4,A4,C5]:2 [F4,A4,C5]:2 [G4,B4,D5]:2 [G4,B4,D5]:2') },
      { title: 'I - IV - V - I', bars: 4, notes: R('[C4,E4,G4]:4 [F4,A4,C5]:4 [G4,B4,D5]:4 [C4,E4,G4]:4') },
    ] },
  { id: 'ky-pop-progression', title: 'La progresión pop', artist: 'Neon Choir', grade: 3, genre: 'Pop', bpm: 92, description: 'I - V - vi - IV en Do mayor, el secreto de mil hits.', tags: ['acordes', 'pop'], courseId: 'c-keys-chords', free: true,
    chords: [{ root: 60, quality: 'maj' }, { root: 67, quality: 'maj' }, { root: 69, quality: 'min' }, { root: 65, quality: 'maj' }],
    steps: [
      { title: 'Acordes por compás', bars: 4, notes: R('[C4,E4,G4]:4 [G3,B3,D4]:4 [A3,C4,E4]:4 [F3,A3,C4]:4') },
      { title: 'Ritmo en blancas', bars: 4, notes: R('[C4,E4,G4]:2 [C4,E4,G4]:2 [G3,B3,D4]:2 [G3,B3,D4]:2 [A3,C4,E4]:2 [A3,C4,E4]:2 [F3,A3,C4]:2 [F3,A3,C4]:2') },
      { title: 'Con bajo', bars: 4, notes: merge(L('C3:4 G2:4 A2:4 F2:4'), R('[C4,E4,G4]:2 [C4,E4,G4]:2 [G3,B3,D4]:2 [G3,B3,D4]:2 [A3,C4,E4]:2 [A3,C4,E4]:2 [F3,A3,C4]:2 [F3,A3,C4]:2')) },
    ] },
  { id: 'ky-minor-mood', title: 'Modo menor', artist: 'Neon Choir', grade: 4, genre: 'Pop', bpm: 88, description: 'vi - IV - I - V: la progresión melancólica.', tags: ['acordes', 'menor'], courseId: 'c-keys-chords',
    chords: [{ root: 69, quality: 'min' }, { root: 65, quality: 'maj' }, { root: 60, quality: 'maj' }, { root: 67, quality: 'maj' }],
    steps: [
      { title: 'Acordes', bars: 4, notes: R('[A3,C4,E4]:4 [F3,A3,C4]:4 [C4,E4,G4]:4 [G3,B3,D4]:4') },
      { title: 'Arpegios', bars: 4, notes: R('A3:1 C4:1 E4:1 C4:1 F3:1 A3:1 C4:1 A3:1 C4:1 E4:1 G4:1 E4:1 G3:1 B3:1 D4:1 B3:1') },
      { title: 'Bajo + arpegio', bars: 4, notes: merge(L('A2:4 F2:4 C3:4 G2:4'), R('A3:1 C4:1 E4:1 C4:1 F3:1 A3:1 C4:1 A3:1 C4:1 E4:1 G4:1 E4:1 G3:1 B3:1 D4:1 B3:1')) },
    ] },
  { id: 'ky-rhythm-chords', title: 'Acordes con ritmo', artist: 'The Groovers', grade: 5, genre: 'Funk', bpm: 100, description: 'Comping sincopado con acordes menores séptima.', tags: ['comping', 'síncopa'], courseId: 'c-keys-chords',
    chords: [{ root: 62, quality: 'min7' }, { root: 67, quality: 'dom7' }, { root: 62, quality: 'min7' }, { root: 67, quality: 'dom7' }],
    steps: [
      { title: 'Dm7 sincopado', bars: 2, notes: R('[D4,F4,A4,C5]:0.5 r:1 [D4,F4,A4,C5]:0.5 r:0.5 [D4,F4,A4,C5]:0.5 r:1 [D4,F4,A4,C5]:0.5 r:1 [D4,F4,A4,C5]:0.5 r:0.5 [D4,F4,A4,C5]:0.5 r:1') },
      { title: 'G7', bars: 2, notes: R('[G3,B3,D4,F4]:0.5 r:1 [G3,B3,D4,F4]:0.5 r:0.5 [G3,B3,D4,F4]:0.5 r:1 [G3,B3,D4,F4]:0.5 r:1 [G3,B3,D4,F4]:0.5 r:0.5 [G3,B3,D4,F4]:0.5 r:1') },
      { title: 'Dm7 - G7', bars: 4, notes: merge(L('D3:1 r:0.5 D3:0.5 r:1 A2:1 G2:1 r:0.5 G2:0.5 r:1 D3:1 D3:1 r:0.5 D3:0.5 r:1 A2:1 G2:1 r:0.5 G2:0.5 r:1 D3:1'), R('[D4,F4,A4,C5]:0.5 r:1 [D4,F4,A4,C5]:0.5 r:0.5 [D4,F4,A4,C5]:0.5 r:1.5 [G3,B3,D4,F4]:0.5 r:1 [G3,B3,D4,F4]:0.5 r:0.5 [G3,B3,D4,F4]:0.5 r:1.5 [D4,F4,A4,C5]:0.5 r:1 [D4,F4,A4,C5]:0.5 r:0.5 [D4,F4,A4,C5]:0.5 r:1.5 [G3,B3,D4,F4]:0.5 r:1 [G3,B3,D4,F4]:0.5 r:0.5 [G3,B3,D4,F4]:0.5 r:1.5')) },
    ] },
  { id: 'ky-melody-hook', title: 'Melodía pegadiza', artist: 'Neon Choir', grade: 4, genre: 'Pop', bpm: 96, description: 'Una melodía de synth-pop en corcheas.', tags: ['melodía'], courseId: 'c-keys-melody',
    chords: [{ root: 60, quality: 'maj' }, { root: 67, quality: 'maj' }, { root: 69, quality: 'min' }, { root: 65, quality: 'maj' }],
    steps: [
      { title: 'Frase A', bars: 2, notes: R('E4:0.5 G4:0.5 A4:1 G4:0.5 E4:0.5 D4:1 E4:0.5 G4:0.5 B4:1 A4:0.5 G4:0.5 E4:1') },
      { title: 'Frase B', bars: 2, notes: R('C5:0.5 B4:0.5 A4:1 G4:0.5 A4:0.5 B4:1 A4:0.5 G4:0.5 E4:1 D4:0.5 E4:0.5 C4:1') },
      { title: 'Hook completo', bars: 4, notes: R('E4:0.5 G4:0.5 A4:1 G4:0.5 E4:0.5 D4:1 E4:0.5 G4:0.5 B4:1 A4:0.5 G4:0.5 E4:1 C5:0.5 B4:0.5 A4:1 G4:0.5 A4:0.5 B4:1 A4:0.5 G4:0.5 E4:1 D4:0.5 E4:0.5 C4:1') },
    ] },
  { id: 'ky-both-hands', title: 'Dos manos juntas', artist: 'Pulso Originals', grade: 6, genre: 'Pop', bpm: 90, description: 'Melodía en la derecha, bajo en corcheas en la izquierda.', tags: ['dos manos', 'independencia'], courseId: 'c-keys-melody',
    chords: [{ root: 60, quality: 'maj' }, { root: 69, quality: 'min' }, { root: 65, quality: 'maj' }, { root: 67, quality: 'maj' }],
    steps: [
      { title: 'Izquierda en corcheas', bars: 4, notes: L('C3:0.5 G3:0.5 C3:0.5 G3:0.5 C3:0.5 G3:0.5 C3:0.5 G3:0.5 A2:0.5 E3:0.5 A2:0.5 E3:0.5 A2:0.5 E3:0.5 A2:0.5 E3:0.5 F2:0.5 C3:0.5 F2:0.5 C3:0.5 F2:0.5 C3:0.5 F2:0.5 C3:0.5 G2:0.5 D3:0.5 G2:0.5 D3:0.5 G2:0.5 D3:0.5 G2:0.5 D3:0.5') },
      { title: 'Derecha', bars: 4, notes: R('E4:1 G4:1 C5:2 E4:1 A4:1 C5:2 F4:1 A4:1 C5:2 D4:1 G4:1 B4:2') },
      { title: 'Juntas', bars: 4, notes: merge(L('C3:0.5 G3:0.5 C3:0.5 G3:0.5 C3:0.5 G3:0.5 C3:0.5 G3:0.5 A2:0.5 E3:0.5 A2:0.5 E3:0.5 A2:0.5 E3:0.5 A2:0.5 E3:0.5 F2:0.5 C3:0.5 F2:0.5 C3:0.5 F2:0.5 C3:0.5 F2:0.5 C3:0.5 G2:0.5 D3:0.5 G2:0.5 D3:0.5 G2:0.5 D3:0.5 G2:0.5 D3:0.5'), R('E4:1 G4:1 C5:2 E4:1 A4:1 C5:2 F4:1 A4:1 C5:2 D4:1 G4:1 B4:2')) },
    ] },
  { id: 'ky-blues-riff', title: 'Riff de blues', artist: 'Delta Wire', grade: 7, genre: 'Blues', bpm: 104, description: 'Riff de boogie en la izquierda y notas blue en la derecha.', tags: ['blues', 'riff'], courseId: 'c-keys-melody',
    chords: [{ root: 60, quality: 'dom7' }, { root: 60, quality: 'dom7' }, { root: 65, quality: 'dom7' }, { root: 60, quality: 'dom7' }],
    steps: [
      { title: 'Boogie izquierda', bars: 2, notes: L('C3:0.5 E3:0.5 G3:0.5 A3:0.5 A#3:0.5 A3:0.5 G3:0.5 E3:0.5 C3:0.5 E3:0.5 G3:0.5 A3:0.5 A#3:0.5 A3:0.5 G3:0.5 E3:0.5') },
      { title: 'Lick derecha', bars: 2, notes: R('r:2 D#4:0.5 E4:0.5 G4:0.5 A#4:0.5 r:2 A#4:0.5 G4:0.5 E4:0.5 C4:0.5') },
      { title: 'Riff completo', bars: 4, notes: merge(L('C3:0.5 E3:0.5 G3:0.5 A3:0.5 A#3:0.5 A3:0.5 G3:0.5 E3:0.5 C3:0.5 E3:0.5 G3:0.5 A3:0.5 A#3:0.5 A3:0.5 G3:0.5 E3:0.5 F3:0.5 A3:0.5 C4:0.5 D4:0.5 D#4:0.5 D4:0.5 C4:0.5 A3:0.5 C3:0.5 E3:0.5 G3:0.5 A3:0.5 A#3:0.5 A3:0.5 G3:0.5 E3:0.5'), R('r:2 D#4:0.5 E4:0.5 G4:0.5 A#4:0.5 r:2 A#4:0.5 G4:0.5 E4:0.5 C4:0.5 r:2 G4:0.5 G#4:0.5 A4:0.5 C5:0.5 r:2 A#4:0.5 G4:0.5 D#4:0.5 C4:0.5')) },
    ] },
  { id: 'ky-jazz-voicings', title: 'Voicings de jazz', artist: 'Blue Note Lab', grade: 9, genre: 'Jazz', bpm: 120, description: 'ii - V - I con voicings de séptima en ambas manos.', tags: ['jazz', 'voicings'], courseId: 'c-keys-advanced',
    chords: [{ root: 62, quality: 'min7' }, { root: 67, quality: 'dom7' }, { root: 60, quality: 'maj' }, { root: 60, quality: 'maj' }],
    steps: [
      { title: 'Shells (izquierda)', bars: 4, notes: L('[D3,C4]:4 [G2,F3]:4 [C3,B3]:4 [C3,B3]:4') },
      { title: 'Extensiones (derecha)', bars: 4, notes: R('[F4,A4]:4 [B3,E4]:4 [E4,G4]:4 [E4,G4]:4') },
      { title: 'ii - V - I completo', bars: 4, notes: merge(L('[D3,C4]:2 r:1 [D3,C4]:1 [G2,F3]:2 r:1 [G2,F3]:1 [C3,B3]:4 [C3,B3]:4'), R('[F4,A4]:2 r:1 [F4,A4]:1 [B3,E4]:2 r:1 [B3,E4]:1 [E4,G4]:4 [E4,G4,D5]:4')) },
    ] },
  { id: 'ky-latin-montuno', title: 'Montuno', artist: 'Havana Circuit', grade: 11, genre: 'Latin', bpm: 112, description: 'Un montuno de salsa en octavas sincopadas.', tags: ['latin', 'montuno'], courseId: 'c-keys-advanced',
    chords: [{ root: 60, quality: 'maj' }, { root: 65, quality: 'maj' }, { root: 67, quality: 'dom7' }, { root: 65, quality: 'maj' }],
    steps: [
      { title: 'Patrón base', bars: 2, notes: merge(R('[C4,C5]:0.5 E4:0.5 G4:0.5 E4:0.5 [C4,C5]:0.5 E4:0.5 G4:0.5 E4:0.5 [F4,F5]:0.5 A4:0.5 C5:0.5 A4:0.5 [G4,G5]:0.5 B4:0.5 D5:0.5 B4:0.5')) },
      { title: 'Sincopado', bars: 2, notes: R('[C4,C5]:0.5 E4:0.5 G4:1 E4:0.5 [C4,C5]:0.5 G4:1 [F4,F5]:0.5 A4:0.5 C5:1 A4:0.5 [G4,G5]:0.5 D5:1') },
      { title: 'Con tumbao', bars: 4, notes: merge(L('r:1.5 C3:1 r:1.5 C3:1 r:1.5 F2:1 r:1.5 G2:1 r:1.5 C3:1 r:1.5 C3:1 r:1.5 F2:1 r:1.5 G2:1'), R('[C4,C5]:0.5 E4:0.5 G4:1 E4:0.5 [C4,C5]:0.5 G4:1 [F4,F5]:0.5 A4:0.5 C5:1 A4:0.5 [G4,G5]:0.5 D5:1 [C4,C5]:0.5 E4:0.5 G4:1 E4:0.5 [C4,C5]:0.5 G4:1 [F4,F5]:0.5 A4:0.5 C5:1 A4:0.5 [G4,G5]:0.5 D5:1')) },
    ] },
  { id: 'ky-arp-trance', title: 'Arpegio trance', artist: 'Deep Circuit', grade: 13, genre: 'Electrónica', bpm: 138, description: 'Arpegios en semicorcheas a 138 BPM.', tags: ['arpegio', 'velocidad'], courseId: 'c-keys-advanced',
    chords: [{ root: 69, quality: 'min' }, { root: 65, quality: 'maj' }, { root: 60, quality: 'maj' }, { root: 67, quality: 'maj' }],
    steps: [
      { title: 'Am', bars: 2, notes: repeat(R('A4:0.25 C5:0.25 E5:0.25 A5:0.25'), 8, 1) },
      { title: 'Am - F', bars: 2, notes: merge(repeat(R('A4:0.25 C5:0.25 E5:0.25 A5:0.25'), 4, 1), repeat(R('F4:0.25 A4:0.25 C5:0.25 F5:0.25'), 4, 1).map((n) => ({ ...n, beat: n.beat + 4 }))) },
      { title: 'Progresión', bars: 4, notes: merge(repeat(R('A4:0.25 C5:0.25 E5:0.25 A5:0.25'), 4, 1), repeat(R('F4:0.25 A4:0.25 C5:0.25 F5:0.25'), 4, 1).map((n) => ({ ...n, beat: n.beat + 4 })), repeat(R('C5:0.25 E5:0.25 G5:0.25 C6:0.25'), 4, 1).map((n) => ({ ...n, beat: n.beat + 8 })), repeat(R('G4:0.25 B4:0.25 D5:0.25 G5:0.25'), 4, 1).map((n) => ({ ...n, beat: n.beat + 12 }))) },
    ] },
  // Escalas / warmups
  { id: 'ky-scale-c', title: 'Escala de Do mayor', artist: 'Escalas', grade: 2, genre: 'Técnica', bpm: 80, description: 'Una octava, subida y bajada.', tags: ['escala'], kind: 'warmup', free: true,
    steps: [{ title: 'Negras', bars: 4, notes: scaleUpDown('C4', MAJOR, 1) }, { title: 'Corcheas', bars: 2, notes: scaleUpDown('C4', MAJOR, 0.5) }] },
  { id: 'ky-scale-g', title: 'Escala de Sol mayor', artist: 'Escalas', grade: 3, genre: 'Técnica', bpm: 84, description: 'Con Fa sostenido.', tags: ['escala'], kind: 'warmup',
    steps: [{ title: 'Negras', bars: 4, notes: scaleUpDown('G4', MAJOR, 1) }, { title: 'Corcheas', bars: 2, notes: scaleUpDown('G4', MAJOR, 0.5) }] },
  { id: 'ky-scale-am', title: 'Escala de La menor', artist: 'Escalas', grade: 3, genre: 'Técnica', bpm: 84, description: 'Menor natural.', tags: ['escala'], kind: 'warmup',
    steps: [{ title: 'Negras', bars: 4, notes: scaleUpDown('A3', MINOR, 1) }, { title: 'Corcheas', bars: 2, notes: scaleUpDown('A3', MINOR, 0.5) }] },
  { id: 'ky-scale-penta', title: 'Pentatónica de Do', artist: 'Escalas', grade: 4, genre: 'Técnica', bpm: 96, description: 'Cinco notas para improvisar.', tags: ['escala', 'improvisación'], kind: 'warmup',
    steps: [{ title: 'Corcheas', bars: 2, notes: scaleUpDown('C4', PENTA, 0.5) }, { title: 'Dos octavas', bars: 4, notes: merge(scaleUpDown('C4', PENTA, 0.5), transpose(scaleUpDown('C4', PENTA, 0.5), 12).map((n) => ({ ...n, beat: n.beat + 8 }))) }] },
  { id: 'ky-scale-blues', title: 'Escala de blues', artist: 'Escalas', grade: 6, genre: 'Técnica', bpm: 100, description: 'La escala de blues en Do.', tags: ['escala', 'blues'], kind: 'warmup',
    steps: [{ title: 'Corcheas', bars: 2, notes: scaleUpDown('C4', BLUES, 0.5) }, { title: 'Semicorcheas', bars: 2, notes: merge(scaleUpDown('C4', BLUES, 0.25), scaleUpDown('C4', BLUES, 0.25).map((n) => ({ ...n, beat: n.beat + 4 }))) }] },
  { id: 'ky-scale-d', title: 'Escala de Re mayor', artist: 'Escalas', grade: 5, genre: 'Técnica', bpm: 90, description: 'Dos sostenidos.', tags: ['escala'], kind: 'warmup',
    steps: [{ title: 'Negras', bars: 4, notes: scaleUpDown('D4', MAJOR, 1) }, { title: 'Corcheas', bars: 2, notes: scaleUpDown('D4', MAJOR, 0.5) }] },
  // Canciones
  { id: 'ky-song-aurora', title: 'Aurora', artist: 'Neon Choir', grade: 5, genre: 'Pop', bpm: 100, description: 'Balada synth-pop con acordes y melodía.', tags: ['canción'], kind: 'song', free: true,
    chords: [{ root: 60, quality: 'maj' }, { root: 67, quality: 'maj' }, { root: 69, quality: 'min' }, { root: 65, quality: 'maj' }],
    steps: [
      { title: 'Intro', bars: 4, notes: R('[C4,E4,G4]:4 [G3,B3,D4]:4 [A3,C4,E4]:4 [F3,A3,C4]:4') },
      { title: 'Verso', bars: 4, notes: merge(L('C3:4 G2:4 A2:4 F2:4'), R('E4:1 G4:1 C5:2 D4:1 G4:1 B4:2 C4:1 E4:1 A4:2 A4:1 C5:1 F4:2')) },
      { title: 'Coro', bars: 4, notes: merge(L('C3:2 C3:2 G2:2 G2:2 A2:2 A2:2 F2:2 F2:2'), R('[E4,G4,C5]:1 r:0.5 [E4,G4,C5]:0.5 [E4,G4,C5]:2 [D4,G4,B4]:1 r:0.5 [D4,G4,B4]:0.5 [D4,G4,B4]:2 [C4,E4,A4]:1 r:0.5 [C4,E4,A4]:0.5 [C4,E4,A4]:2 [C4,F4,A4]:1 r:0.5 [C4,F4,A4]:0.5 [C4,F4,A4]:2')) },
    ] },
  { id: 'ky-song-velvet', title: 'Velvet Hours', artist: 'Velvet Circuit', grade: 8, genre: 'Lo-fi', bpm: 78, description: 'Acordes de séptima con melodía relajada.', tags: ['canción'], kind: 'song',
    chords: [{ root: 65, quality: 'maj' }, { root: 64, quality: 'min7' }, { root: 62, quality: 'min7' }, { root: 60, quality: 'maj' }],
    steps: [
      { title: 'Acordes', bars: 4, notes: merge(L('F2:4 E2:4 D2:4 C2:4'), R('[F3,A3,C4,E4]:4 [E3,G3,B3,D4]:4 [D3,F3,A3,C4]:4 [C3,E3,G3,B3]:4')) },
      { title: 'Melodía', bars: 4, notes: R('r:1 A4:0.5 C5:0.5 E5:1 D5:1 r:1 G4:0.5 B4:0.5 D5:1 C5:1 r:1 F4:0.5 A4:0.5 C5:1 A4:1 G4:2 E4:2') },
      { title: 'Todo junto', bars: 4, notes: merge(L('F2:2 [F3,A3,C4,E4]:2 E2:2 [E3,G3,B3,D4]:2 D2:2 [D3,F3,A3,C4]:2 C2:2 [C3,E3,G3,B3]:2'), R('r:1 A4:0.5 C5:0.5 E5:1 D5:1 r:1 G4:0.5 B4:0.5 D5:1 C5:1 r:1 F4:0.5 A4:0.5 C5:1 A4:1 G4:2 E4:2')) },
    ] },
  { id: 'ky-song-havana', title: 'Noche en La Habana', artist: 'Havana Circuit', grade: 12, genre: 'Latin', bpm: 116, description: 'Salsa con montuno y tumbao.', tags: ['canción'], kind: 'song',
    chords: [{ root: 60, quality: 'maj' }, { root: 65, quality: 'maj' }, { root: 67, quality: 'dom7' }, { root: 65, quality: 'maj' }],
    steps: [
      { title: 'Intro', bars: 4, notes: R('[C4,E4,G4]:0.5 r:1 [C4,E4,G4]:0.5 r:0.5 [C4,E4,G4]:0.5 r:1 [F4,A4,C5]:0.5 r:1 [F4,A4,C5]:0.5 r:0.5 [F4,A4,C5]:0.5 r:1 [G4,B4,D5]:0.5 r:1 [G4,B4,D5]:0.5 r:0.5 [G4,B4,D5]:0.5 r:1 [F4,A4,C5]:0.5 r:1 [F4,A4,C5]:0.5 r:0.5 [F4,A4,C5]:0.5 r:1') },
      { title: 'Montuno', bars: 4, notes: merge(L('r:1.5 C3:1 r:1.5 C3:1 r:1.5 F2:1 r:1.5 G2:1 r:1.5 C3:1 r:1.5 C3:1 r:1.5 F2:1 r:1.5 G2:1'), R('[C4,C5]:0.5 E4:0.5 G4:1 E4:0.5 [C4,C5]:0.5 G4:1 [F4,F5]:0.5 A4:0.5 C5:1 A4:0.5 [G4,G5]:0.5 D5:1 [C4,C5]:0.5 E4:0.5 G4:1 E4:0.5 [C4,C5]:0.5 G4:1 [F4,F5]:0.5 A4:0.5 C5:1 A4:0.5 [G4,G5]:0.5 D5:1')) },
      { title: 'Mambo', bars: 4, notes: R('C5:0.5 E5:0.5 G5:1 r:0.5 G5:0.5 E5:1 F5:0.5 A5:0.5 C6:1 r:0.5 C6:0.5 A5:1 G5:0.5 B5:0.5 D6:1 r:0.5 D6:0.5 B5:1 A5:0.5 F5:0.5 C5:1 r:2') },
    ] },
];

export const KEY_LESSONS: Lesson[] = DEFS.map(build);
