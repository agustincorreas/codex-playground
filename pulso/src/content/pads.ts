import type { Lesson, LessonStep } from '../engine/types';
import { grid, merge, type GridPattern } from './dsl';

// Sonidos por pad (ver PAD_SOUNDS): p12 kick, p13 snare, p14 clap, p15 hihat, p8 shaker, p9 cowbell, p10 perc1, p11 perc2,
// p4 openhat, p5 tom1, p6 tom2, p7 rim, p0 bass, p1 stab, p2 chord, p3 vox.
const K = 'p12', S = 'p13', C = 'p14', H = 'p15', OH = 'p4', T1 = 'p5', T2 = 'p6', RIM = 'p7', SH = 'p8', CB = 'p9', P1 = 'p10', P2 = 'p11', BASS = 'p0', STAB = 'p1', CH = 'p2', VOX = 'p3';

const ART = ['#22d3ee', '#60a5fa', '#a78bfa', '#e879f9', '#34d399', '#f6c343', '#fb7185', '#f97316'];

interface Def {
  id: string; title: string; artist: string; grade: number; genre: string; bpm: number; description: string; tags: string[];
  kind?: Lesson['kind']; free?: boolean; courseId?: string;
  steps: { title: string; pattern: GridPattern; bars?: number; tip?: string; fill?: GridPattern }[];
}

function build(d: Def, i: number): Lesson {
  const steps: LessonStep[] = d.steps.map((s, si) => {
    const bars = s.bars ?? 2;
    const notes = s.fill ? merge(grid(s.pattern, bars - 1), grid(s.fill, 1, bars - 1)) : grid(s.pattern, bars);
    return { id: `${d.id}-s${si}`, title: s.title, bars, notes, tip: s.tip };
  });
  const perf: LessonStep['notes'] = [];
  let off = 0;
  for (const s of steps) {
    perf.push(...s.notes.map((n) => ({ ...n, beat: n.beat + off })));
    off += s.bars * 4;
  }
  steps.push({ id: `${d.id}-perf`, title: 'Performance', bars: off / 4, notes: perf, tip: 'Tocá toda la lección de principio a fin.' });
  return { id: d.id, title: d.title, artist: d.artist, instrument: 'pads', kind: d.kind ?? 'lesson', grade: d.grade, genre: d.genre, bpm: d.bpm, timeSig: [4, 4], description: d.description, steps, art: ART[i % ART.length], free: d.free ?? d.grade <= 2, tags: d.tags, courseId: d.courseId };
}

const HH8 = 'x.x.x.x.x.x.x.x.';
const HH16 = 'xxxxxxxxxxxxxxxx';
const SN24 = '....x.......x...';
const KD13 = 'x.......x.......';

const DEFS: Def[] = [
  { id: 'pd-first-hits', title: 'Primeros golpes', artist: 'Pulso Originals', grade: 1, genre: 'Hip hop', bpm: 85, description: 'Bombo y caja en los pads: la base del finger drumming.', tags: ['básico'], courseId: 'c-pads-fund', free: true,
    steps: [
      { title: 'Bombo (pad 13)', pattern: { [K]: KD13 }, tip: 'Usá el dedo índice para el bombo.' },
      { title: 'Caja (pad 14)', pattern: { [S]: SN24 } },
      { title: 'Bombo + caja', pattern: { [K]: KD13, [S]: SN24 } },
    ] },
  { id: 'pd-hats', title: 'Hi-hats con dos dedos', artist: 'Pulso Originals', grade: 1, genre: 'Hip hop', bpm: 88, description: 'Alterná dos dedos en el hi-hat.', tags: ['hi-hat'], courseId: 'c-pads-fund', free: true,
    steps: [
      { title: 'Hi-hat en corcheas', pattern: { [H]: HH8 } },
      { title: 'Con bombo y caja', pattern: { [H]: HH8, [K]: KD13, [S]: SN24 } },
      { title: 'Bombo doble', pattern: { [H]: HH8, [K]: 'x.....x.x.......', [S]: SN24 } },
    ] },
  { id: 'pd-boom-bap', title: 'Boom Bap Classic', artist: 'MC Metronome', grade: 2, genre: 'Hip hop', bpm: 92, description: 'El beat de hip hop clásico con bombo sincopado y clap.', tags: ['boom bap'], courseId: 'c-pads-fund', free: true,
    steps: [
      { title: 'Bombo sincopado', pattern: { [K]: 'x.....x.x..x....' } },
      { title: 'Clap en 2 y 4', pattern: { [K]: 'x.....x.x..x....', [C]: SN24 } },
      { title: 'Beat completo', pattern: { [H]: HH8, [K]: 'x.....x.x..x....', [C]: SN24, [OH]: '..............x.' } },
    ] },
  { id: 'pd-house', title: 'House Four on the Floor', artist: 'Deep Circuit', grade: 3, genre: 'House', bpm: 124, description: 'Bombo constante, hi-hat abierto a contratiempo y clap.', tags: ['house'], courseId: 'c-pads-electronic', free: true,
    steps: [
      { title: 'Four on the floor', pattern: { [K]: 'x...x...x...x...' } },
      { title: 'Open hat a contratiempo', pattern: { [K]: 'x...x...x...x...', [OH]: '..x...x...x...x.' } },
      { title: 'Clap y shaker', pattern: { [K]: 'x...x...x...x...', [OH]: '..x...x...x...x.', [C]: SN24, [SH]: HH16 } },
    ] },
  { id: 'pd-techno', title: 'Techno Machine', artist: 'Deep Circuit', grade: 5, genre: 'Techno', bpm: 132, description: 'Percusiones desplazadas y rim shots sobre un bombo implacable.', tags: ['techno'], courseId: 'c-pads-electronic',
    steps: [
      { title: 'Bombo y rim', pattern: { [K]: 'x...x...x...x...', [RIM]: '...x..x....x..x.' } },
      { title: 'Percusión', pattern: { [K]: 'x...x...x...x...', [RIM]: '...x..x....x..x.', [P1]: '..x.....x.....x.' } },
      { title: 'Todo junto', pattern: { [K]: 'x...x...x...x...', [RIM]: '...x..x....x..x.', [P1]: '..x.....x.....x.', [H]: HH16, [C]: SN24 } },
    ] },
  { id: 'pd-trap', title: 'Trap 808', artist: 'Lil Tempo', grade: 6, genre: 'Trap', bpm: 140, description: 'Hi-hats en semicorcheas, rolls y 808 en el bombo.', tags: ['trap'], courseId: 'c-pads-electronic',
    steps: [
      { title: 'Half-time', pattern: { [K]: 'x......x..x.....', [S]: '........x.......' } },
      { title: 'Hi-hats en 16', pattern: { [K]: 'x......x..x.....', [S]: '........x.......', [H]: HH16 } },
      { title: 'Rolls', pattern: { [K]: 'x......x..x.....', [S]: '........x.......', [H]: 'x.x.x.x.x.xxxxxx', [BASS]: 'x......x..x.....' } },
    ] },
  { id: 'pd-melodic', title: 'Pads melódicos', artist: 'Pulso Originals', grade: 4, genre: 'Lo-fi', bpm: 80, description: 'Acordes y bajo desde los pads superiores.', tags: ['melódico', 'lo-fi'], courseId: 'c-pads-melodic',
    steps: [
      { title: 'Acorde y bajo', pattern: { [CH]: 'x.......x.......', [BASS]: '....x.......x...' } },
      { title: 'Con beat', pattern: { [CH]: 'x.......x.......', [BASS]: '....x.......x...', [K]: 'x.....x.x.......', [S]: SN24 } },
      { title: 'Stabs', pattern: { [CH]: 'x.......x.......', [STAB]: '......x.......x.', [BASS]: '....x.......x...', [K]: 'x.....x.x.......', [S]: SN24, [H]: HH8 } },
    ] },
  { id: 'pd-vox-chops', title: 'Vocal chops', artist: 'Velvet Circuit', grade: 7, genre: 'Lo-fi', bpm: 90, description: 'Chops de voz sincopados sobre un groove relajado.', tags: ['chops'], courseId: 'c-pads-melodic',
    steps: [
      { title: 'Chops', pattern: { [VOX]: 'x..x..x...x.x...' } },
      { title: 'Groove', pattern: { [K]: 'x.....x.x.......', [S]: SN24, [H]: HH8 } },
      { title: 'Chops + groove', pattern: { [VOX]: 'x..x..x...x.x...', [K]: 'x.....x.x.......', [S]: SN24, [H]: HH8, [SH]: '..x...x...x...x.' } },
    ] },
  { id: 'pd-latin-perc', title: 'Percusión latina', artist: 'Havana Circuit', grade: 8, genre: 'Latin', bpm: 100, description: 'Cowbell, congas y clave en cuatro dedos.', tags: ['latin', 'clave'], courseId: 'c-pads-melodic',
    steps: [
      { title: 'Clave 2-3', pattern: { [RIM]: '..x...x.x..x..x.' } },
      { title: 'Cowbell', pattern: { [RIM]: '..x...x.x..x..x.', [CB]: 'x..x..x.x..x..x.' } },
      { title: 'Congas', pattern: { [RIM]: '..x...x.x..x..x.', [CB]: 'x..x..x.x..x..x.', [T1]: '...x...x.x......', [T2]: '......x.....x.x.' } },
    ] },
  { id: 'pd-juke', title: 'Footwork 160', artist: 'Jungle Signal', grade: 10, genre: 'Electrónica', bpm: 160, description: 'Tresillos de bombo y claps a alta velocidad.', tags: ['footwork', 'velocidad'], courseId: 'c-pads-electronic',
    steps: [
      { title: 'Bombo en tresillos', pattern: { [K]: 'x..x..x.x..x..x.' } },
      { title: 'Claps', pattern: { [K]: 'x..x..x.x..x..x.', [C]: '....x.......x...' } },
      { title: 'Todo', pattern: { [K]: 'x..x..x.x..x..x.', [C]: '....x.......x...', [H]: 'x.x.x.x.x.x.x.x.', [P2]: '..x.....x.x.....' } },
    ] },
  { id: 'pd-ex-alternate', title: 'Alternancia de dedos', artist: 'Técnica', grade: 2, genre: 'Técnica', bpm: 90, description: 'Índice y medio alternados en un solo pad.', tags: ['técnica'], kind: 'exercise', free: true,
    steps: [
      { title: 'Corcheas', pattern: { [S]: HH8 } },
      { title: 'Semicorcheas', pattern: { [S]: HH16 } },
    ] },
  { id: 'pd-ex-four-fingers', title: 'Cuatro dedos', artist: 'Técnica', grade: 5, genre: 'Técnica', bpm: 96, description: 'Independencia de cuatro dedos en cuatro pads.', tags: ['técnica'], kind: 'exercise',
    steps: [
      { title: 'Secuencia', pattern: { [K]: 'x...x...x...x...', [S]: '.x...x...x...x..', [C]: '..x...x...x...x.', [H]: '...x...x...x...x' } },
      { title: 'Invertida', pattern: { [H]: 'x...x...x...x...', [C]: '.x...x...x...x..', [S]: '..x...x...x...x.', [K]: '...x...x...x...x' } },
    ] },
  { id: 'pd-song-midnight', title: 'Midnight Drive', artist: 'Deep Circuit', grade: 5, genre: 'House', bpm: 122, description: 'Un track de deep house con breakdown y drop.', tags: ['canción'], kind: 'song', free: true,
    steps: [
      { title: 'Intro', pattern: { [K]: 'x...x...x...x...', [SH]: HH16 }, bars: 4 },
      { title: 'Groove', pattern: { [K]: 'x...x...x...x...', [OH]: '..x...x...x...x.', [C]: SN24, [SH]: HH16 }, bars: 8 },
      { title: 'Breakdown', pattern: { [CH]: 'x.......x.......', [BASS]: '..x...x...x...x.' }, bars: 4 },
      { title: 'Drop', pattern: { [K]: 'x...x...x...x...', [OH]: '..x...x...x...x.', [C]: SN24, [SH]: HH16, [STAB]: '......x.......x.' }, bars: 8 },
    ] },
  { id: 'pd-song-cassette', title: 'Cassette Dreams', artist: 'Velvet Circuit', grade: 8, genre: 'Lo-fi', bpm: 84, description: 'Lo-fi hip hop con chops, acordes y swing.', tags: ['canción'], kind: 'song',
    steps: [
      { title: 'Verso', pattern: { [K]: 'x.....x.x..x....', [S]: SN24, [H]: HH8, [CH]: 'x.......x.......' }, bars: 8 },
      { title: 'Puente', pattern: { [VOX]: 'x..x..x...x.x...', [BASS]: 'x.......x.......', [SH]: HH8 }, bars: 4 },
      { title: 'Coro', pattern: { [K]: 'x.....x.x..x....', [S]: SN24, [H]: 'x.x.x.x.x.x.xxxx', [CH]: 'x.......x.......', [VOX]: '......x.......x.' }, bars: 8 },
    ] },
];

export const PAD_LESSONS: Lesson[] = DEFS.map(build);
