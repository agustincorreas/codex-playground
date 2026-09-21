import type { Lesson, LessonStep } from '../engine/types';
import { grid, merge, type GridPattern } from './dsl';

const ART = ['#fb7185', '#f97316', '#f6c343', '#34d399', '#22d3ee', '#a78bfa', '#e879f9', '#60a5fa'];

interface Def {
  id: string;
  title: string;
  artist: string;
  grade: number;
  genre: string;
  bpm: number;
  description: string;
  tags: string[];
  kind?: Lesson['kind'];
  free?: boolean;
  /** Cada paso: patrón de 1 compás (o varios separados) + compases a repetir. */
  steps: { title: string; pattern: GridPattern; bars?: number; tip?: string; fill?: GridPattern }[];
  courseId?: string;
}

function build(d: Def, i: number): Lesson {
  const steps: LessonStep[] = d.steps.map((s, si) => {
    const bars = s.bars ?? 2;
    let notes = grid(s.pattern, bars);
    if (s.fill) {
      // el último compás se reemplaza por el fill
      notes = merge(grid(s.pattern, bars - 1), grid(s.fill, 1, bars - 1));
    }
    return { id: `${d.id}-s${si}`, title: s.title, bars, notes, tip: s.tip };
  });
  // Paso final: performance completa (todos los pasos encadenados)
  const perfNotes = [] as LessonStep['notes'];
  let off = 0;
  for (const s of steps) {
    perfNotes.push(...s.notes.map((n) => ({ ...n, beat: n.beat + off })));
    off += s.bars * 4;
  }
  steps.push({ id: `${d.id}-perf`, title: 'Performance', bars: off / 4, notes: perfNotes, tip: 'Tocá toda la lección de principio a fin.' });
  return {
    id: d.id,
    title: d.title,
    artist: d.artist,
    instrument: 'drums',
    kind: d.kind ?? 'lesson',
    grade: d.grade,
    genre: d.genre,
    bpm: d.bpm,
    timeSig: [4, 4],
    description: d.description,
    steps,
    art: ART[i % ART.length],
    free: d.free ?? d.grade <= 2,
    tags: d.tags,
    courseId: d.courseId,
  };
}

const HH8 = 'x.x.x.x.x.x.x.x.';
const HH16 = 'xxxxxxxxxxxxxxxx';
const HH4 = 'x...x...x...x...';
const SN24 = '....x.......x...';
const KD1 = 'x...............';
const KD13 = 'x.......x.......';

const DEFS: Def[] = [
  // ---- Fundamentos ----
  { id: 'dr-first-beat', title: 'Tu primer beat', artist: 'Pulso Originals', grade: 1, genre: 'Rock', bpm: 80, description: 'Bombo y redoblante: el corazón de cualquier groove.', tags: ['bombo', 'redoblante'], courseId: 'c-drums-fund', free: true,
    steps: [
      { title: 'Bombo en 1 y 3', pattern: { kick: KD13 }, tip: 'Sentí el pulso: bombo en los tiempos 1 y 3.' },
      { title: 'Redoblante en 2 y 4', pattern: { snare: SN24 }, tip: 'El backbeat va en los tiempos 2 y 4.' },
      { title: 'Juntos', pattern: { kick: KD13, snare: SN24 } },
    ] },
  { id: 'dr-add-hats', title: 'Sumando el hi-hat', artist: 'Pulso Originals', grade: 1, genre: 'Rock', bpm: 84, description: 'Corcheas en el hi-hat sobre el beat básico.', tags: ['hi-hat', 'corcheas'], courseId: 'c-drums-fund', free: true,
    steps: [
      { title: 'Hi-hat en negras', pattern: { hihat: HH4 } },
      { title: 'Hi-hat en corcheas', pattern: { hihat: HH8 } },
      { title: 'Groove completo', pattern: { hihat: HH8, kick: KD13, snare: SN24 } },
    ] },
  { id: 'dr-money-beat', title: 'El beat del millón', artist: 'Pulso Originals', grade: 2, genre: 'Pop', bpm: 92, description: 'El groove más usado en la historia del pop y el rock.', tags: ['groove', 'pop'], courseId: 'c-drums-fund', free: true,
    steps: [
      { title: 'Base', pattern: { hihat: HH8, kick: 'x.......x.x.....', snare: SN24 } },
      { title: 'Variación de bombo', pattern: { hihat: HH8, kick: 'x.....x...x.....', snare: SN24 } },
      { title: 'Con crash', pattern: { hihat: '..x.x.x.x.x.x.x.', crash: KD1, kick: 'x.....x...x.....', snare: SN24 } },
    ] },
  { id: 'dr-first-fill', title: 'Tu primer fill', artist: 'Pulso Originals', grade: 2, genre: 'Rock', bpm: 90, description: 'Un relleno de redoblante para cerrar la frase.', tags: ['fill', 'redoblante'], courseId: 'c-drums-fund',
    steps: [
      { title: 'Fill en negras', pattern: { hihat: HH8, kick: KD13, snare: SN24 }, bars: 4, fill: { snare: HH4, kick: KD1 } },
      { title: 'Fill en corcheas', pattern: { hihat: HH8, kick: KD13, snare: SN24 }, bars: 4, fill: { snare: HH8, kick: KD1 } },
      { title: 'Fill con toms', pattern: { hihat: HH8, kick: KD13, snare: SN24 }, bars: 4, fill: { snare: 'x.x.........', tom1: '....x.x.....', floor: '........x.x.', kick: KD1 } },
    ] },
  { id: 'dr-toms-tour', title: 'Paseo por los toms', artist: 'Pulso Originals', grade: 3, genre: 'Rock', bpm: 96, description: 'Moverte por el set con confianza.', tags: ['toms', 'fill'], courseId: 'c-drums-fund',
    steps: [
      { title: 'Tom alto y medio', pattern: { tom1: 'x.x.....x.x.....', tom2: '....x.x.....x.x.', kick: KD13 } },
      { title: 'Bajada de toms', pattern: { hihat: HH8, kick: KD13, snare: SN24 }, bars: 4, fill: { snare: 'xx..............', tom1: '....xx..........', tom2: '........xx......', floor: '............xx..' } },
      { title: 'Groove + bajada', pattern: { hihat: HH8, kick: 'x.......x.x.....', snare: SN24 }, bars: 4, fill: { snare: 'x.x.............', tom1: '....x.x.........', floor: '........x.x.x.x.', crash: '' } },
    ] },
  { id: 'dr-eighth-kicks', title: 'Bombos sincopados', artist: 'Pulso Originals', grade: 3, genre: 'Pop', bpm: 100, description: 'Bombo a contratiempo para darle movimiento al groove.', tags: ['bombo', 'síncopa'], courseId: 'c-drums-fund',
    steps: [
      { title: 'Bombo en el "y" de 3', pattern: { hihat: HH8, kick: 'x.........x.....', snare: SN24 } },
      { title: 'Doble bombo', pattern: { hihat: HH8, kick: 'x.x.......x.....', snare: SN24 } },
      { title: 'Todo junto', pattern: { hihat: HH8, kick: 'x.x.....x.x.....', snare: SN24 }, bars: 4, fill: { snare: 'x.x.x.x.xxxxxxxx' } },
    ] },
  // ---- Rock ----
  { id: 'dr-garage-rock', title: 'Garage Rock', artist: 'The Voltages', grade: 3, genre: 'Rock', bpm: 130, description: 'Energía cruda con crash y bombo constante.', tags: ['rock', 'crash'], courseId: 'c-drums-rock',
    steps: [
      { title: 'Ride abierto', pattern: { ride: HH8, kick: 'x...x...x...x...', snare: SN24 } },
      { title: 'Crash y bombo', pattern: { crash: KD1, hihat: '..x.x.x.x.x.x.x.', kick: 'x...x...x...x...', snare: SN24 } },
      { title: 'Cierre', pattern: { hihat: HH8, kick: 'x...x...x...x...', snare: SN24 }, bars: 4, fill: { snare: 'xxxxxxxx........', tom1: '........xxxx....', floor: '............xxxx' } },
    ] },
  { id: 'dr-half-time', title: 'Half-time pesado', artist: 'Stone Elephant', grade: 4, genre: 'Rock', bpm: 76, description: 'Redoblante en el 3 para un groove gigante.', tags: ['half-time', 'rock'], courseId: 'c-drums-rock',
    steps: [
      { title: 'Base half-time', pattern: { hihat: HH8, kick: 'x.......x.x.....', snare: '........x.......' } },
      { title: 'Ghost notes', pattern: { hihat: HH8, kick: 'x.......x.x.....', snare: '...x....x....x..' }, tip: 'Las notas fantasma son golpes muy suaves entre los acentos.' },
      { title: 'Hi-hat abierto', pattern: { hihat: 'x.x.x.x.x.x.x.x.', crash: KD1, kick: 'x.....x.x.x.....', snare: '........x.......' }, bars: 4, fill: { snare: 'x..x..x.x.x.x.x.', floor: '..............xx' } },
    ] },
  { id: 'dr-punk-drive', title: 'Punk Drive', artist: 'Riot Kids', grade: 5, genre: 'Rock', bpm: 165, description: 'Velocidad y precisión en un beat de punk.', tags: ['punk', 'velocidad'], courseId: 'c-drums-rock',
    steps: [
      { title: 'Beat rápido', pattern: { hihat: HH8, kick: 'x...x...x...x...', snare: SN24 } },
      { title: 'Snare en corcheas', pattern: { hihat: HH8, kick: 'x...x...x...x...', snare: '..x...x...x...x.' } },
      { title: 'D-beat', pattern: { hihat: HH8, kick: 'x.x...x.x.x...x.', snare: '..x...x...x...x.' }, bars: 4, fill: { snare: 'xxxxxxxxxxxxxxxx' } },
    ] },
  { id: 'dr-sixteenth-hats', title: 'Hi-hat en semicorcheas', artist: 'Pulso Originals', grade: 5, genre: 'Pop', bpm: 88, description: 'Control de la mano derecha con semicorcheas continuas.', tags: ['hi-hat', 'semicorcheas'], courseId: 'c-drums-rock',
    steps: [
      { title: 'Solo hi-hat', pattern: { hihat: HH16 } },
      { title: 'Con bombo y redoblante', pattern: { hihat: HH16, kick: KD13, snare: SN24 } },
      { title: 'Groove pop', pattern: { hihat: HH16, kick: 'x.....x...x.....', snare: SN24 }, bars: 4, fill: { snare: 'x...x...x.x.xxxx' } },
    ] },
  // ---- Funk ----
  { id: 'dr-funk-101', title: 'Funk 101', artist: 'The Groovers', grade: 5, genre: 'Funk', bpm: 100, description: 'Bombos sincopados y hi-hat abierto: la esencia del funk.', tags: ['funk', 'síncopa'], courseId: 'c-drums-funk',
    steps: [
      { title: 'Bombo funky', pattern: { hihat: HH8, kick: 'x..x..x...x.x...', snare: SN24 } },
      { title: 'Hi-hat abierto en el "y" de 4', pattern: { hihat: 'x.x.x.x.x.x.x.x.', kick: 'x..x..x...x.x...', snare: SN24 }, tip: 'Abrí el hi-hat en la última corchea y cerralo en el 1.' },
      { title: 'Ghost notes', pattern: { hihat: HH8, kick: 'x..x..x...x.x...', snare: '.x..x..x.x..x..x' } },
    ] },
  { id: 'dr-funky-drummer', title: 'Baterista Funky', artist: 'Soul Machine', grade: 7, genre: 'Funk', bpm: 96, description: 'Un break clásico lleno de notas fantasma.', tags: ['funk', 'break', 'ghost notes'], courseId: 'c-drums-funk',
    steps: [
      { title: 'Hi-hat + redoblante', pattern: { hihat: HH16, snare: '....x..x.x..x...' } },
      { title: 'Sumar bombo', pattern: { hihat: HH16, kick: 'x.x.......x.x...', snare: '....x..x.x..x...' } },
      { title: 'Break completo', pattern: { hihat: HH16, kick: 'x.x.......x.x...', snare: '....x..x.x..x.x.' }, bars: 4, fill: { snare: 'x.x.x.xx.x.xx.xx', kick: 'x.........x.....' } },
    ] },
  { id: 'dr-linear-funk', title: 'Funk lineal', artist: 'Pulso Originals', grade: 9, genre: 'Funk', bpm: 104, description: 'Ninguna extremidad toca al mismo tiempo: grooves lineales.', tags: ['lineal', 'coordinación'], courseId: 'c-drums-funk',
    steps: [
      { title: 'Patrón lineal', pattern: { hihat: 'x.x..x..x.x..x..', kick: '.x..x.x..x..x.x.', snare: '...x.......x....' } },
      { title: 'Con acentos', pattern: { hihat: 'x.x..x.xx.x..x.x', kick: '.x..x....x..x...', snare: '...x...x...x...x' } },
      { title: 'Performance lineal', pattern: { hihat: 'x.x..x..x.x..x..', kick: '.x..x.x..x..x.x.', snare: '...x.......x....' }, bars: 4, fill: { snare: 'x..x..x..x..x..x', tom1: '.x..x..x..x..x..', floor: '..x..x..x..x..x.' } },
    ] },
  // ---- Hip hop ----
  { id: 'dr-boom-bap', title: 'Boom Bap', artist: 'MC Metronome', grade: 3, genre: 'Hip hop', bpm: 90, description: 'El groove pesado y relajado del hip hop de los 90.', tags: ['hip hop', 'boom bap'], courseId: 'c-drums-hiphop', free: true,
    steps: [
      { title: 'Bombo y caja', pattern: { kick: 'x.....x.x.......', snare: SN24 } },
      { title: 'Con hi-hat', pattern: { hihat: HH8, kick: 'x.....x.x.......', snare: SN24 } },
      { title: 'Swing de bombo', pattern: { hihat: HH8, kick: 'x.....x.x..x....', snare: SN24 } },
    ] },
  { id: 'dr-trap-hats', title: 'Trap Hats', artist: 'Lil Tempo', grade: 6, genre: 'Hip hop', bpm: 70, description: 'Hi-hats rápidos con redobles de fusas.', tags: ['trap', 'hi-hat'], courseId: 'c-drums-hiphop',
    steps: [
      { title: 'Half-time trap', pattern: { hihat: HH8, kick: 'x......x..x.....', snare: '........x.......' } },
      { title: 'Rolls de hi-hat', pattern: { hihat: 'x.x.x.x.x.x.xxxx', kick: 'x......x..x.....', snare: '........x.......' } },
      { title: 'Groove completo', pattern: { hihat: 'x.x.xxxxx.x.x.xx', kick: 'x......x..x...x.', snare: '........x.......' } },
    ] },
  { id: 'dr-neo-soul', title: 'Neo Soul Pocket', artist: 'Velvet Circuit', grade: 8, genre: 'Hip hop', bpm: 82, description: 'Un groove atrás del beat, con ghost notes y hi-hat abierto.', tags: ['neo soul', 'pocket'], courseId: 'c-drums-hiphop',
    steps: [
      { title: 'Base', pattern: { hihat: HH8, kick: 'x.....x...x.....', snare: '....x.......x...' } },
      { title: 'Ghost notes', pattern: { hihat: HH8, kick: 'x.....x...x.....', snare: '..x.x..x..x.x.x.' } },
      { title: 'Hi-hat con aperturas', pattern: { hihat: 'x.x.x.xxx.x.x.xx', kick: 'x.....x...x..x..', snare: '..x.x..x..x.x.x.' }, bars: 4, fill: { snare: 'x.x..xx..x.xx.x.', kick: 'x.......x.......' } },
    ] },
  // ---- Latin ----
  { id: 'dr-bossa', title: 'Bossa Nova', artist: 'Praia Trio', grade: 5, genre: 'Latin', bpm: 120, description: 'Clave en el aro y bombo constante.', tags: ['bossa', 'clave'], courseId: 'c-drums-latin',
    steps: [
      { title: 'Bombo bossa', pattern: { kick: 'x..x..x.x..x..x.' }, tip: 'El bombo marca el 1 y el "y" de 2 en cada compás.' },
      { title: 'Hi-hat + bombo', pattern: { hihat: HH8, kick: 'x..x..x.x..x..x.' } },
      { title: 'Clave en el redoblante', pattern: { hihat: HH8, kick: 'x..x..x.x..x..x.', snare: 'x..x..x...x.x...' } },
    ] },
  { id: 'dr-songo', title: 'Songo', artist: 'Havana Circuit', grade: 9, genre: 'Latin', bpm: 110, description: 'Un ritmo cubano moderno con toms y bombo sincopado.', tags: ['songo', 'cuba'], courseId: 'c-drums-latin',
    steps: [
      { title: 'Cáscara en el hi-hat', pattern: { hihat: 'x.xx.x.xx.x.x.x.' } },
      { title: 'Bombo tumbao', pattern: { hihat: 'x.xx.x.xx.x.x.x.', kick: '...x...x..x....x' } },
      { title: 'Songo completo', pattern: { hihat: 'x.xx.x.xx.x.x.x.', kick: '...x...x..x....x', snare: '..x...x.x...x...', tom1: '.......x......x.' } },
    ] },
  { id: 'dr-afrobeat', title: 'Afrobeat', artist: 'Lagos Express', grade: 10, genre: 'Latin', bpm: 118, description: 'Groove entrelazado inspirado en Tony Allen.', tags: ['afrobeat', 'polirritmia'], courseId: 'c-drums-latin',
    steps: [
      { title: 'Hi-hat y bombo', pattern: { hihat: 'x.x.x.xxx.x.x.xx', kick: 'x..x..x...x..x..' } },
      { title: 'Redoblante conversando', pattern: { hihat: 'x.x.x.xxx.x.x.xx', kick: 'x..x..x...x..x..', snare: '..x..x..x..x..x.' } },
      { title: 'Afrobeat completo', pattern: { hihat: 'x.x.x.xxx.x.x.xx', kick: 'x..x..x...x..x..', snare: '..x..x..x..x..x.', tom2: '.......x.......x' }, bars: 4, fill: { tom1: 'x.x.x.x.', tom2: '.x.x.x.x' } },
    ] },
  // ---- Fills ----
  { id: 'dr-fill-vocab', title: 'Vocabulario de fills', artist: 'Pulso Originals', grade: 6, genre: 'Rock', bpm: 100, description: 'Cinco fills que todo baterista debería saber.', tags: ['fill'], courseId: 'c-drums-fills',
    steps: [
      { title: 'Fill 1: semicorcheas en caja', pattern: { hihat: HH8, kick: KD13, snare: SN24 }, bars: 4, fill: { snare: 'xxxxxxxxxxxxxxxx' } },
      { title: 'Fill 2: caja-toms', pattern: { hihat: HH8, kick: KD13, snare: SN24 }, bars: 4, fill: { snare: 'xxxx............', tom1: '....xxxx........', tom2: '........xxxx....', floor: '............xxxx' } },
      { title: 'Fill 3: bombo y caja', pattern: { hihat: HH8, kick: KD13, snare: SN24 }, bars: 4, fill: { snare: 'x.x.x.x.x.x.x.x.', kick: '.x.x.x.x.x.x.x.x' } },
    ] },
  { id: 'dr-odd-fills', title: 'Fills de tresillos', artist: 'Pulso Originals', grade: 11, genre: 'Rock', bpm: 92, description: 'Fills en tresillos de corcheas y sextillos.', tags: ['tresillos', 'fill'], courseId: 'c-drums-fills',
    steps: [
      { title: 'Tresillos en caja', pattern: { hihat: HH8, kick: KD13, snare: SN24 }, bars: 4, fill: { snare: 'xxxxxxxxxxxx' } },
      { title: 'Tresillos por los toms', pattern: { hihat: HH8, kick: KD13, snare: SN24 }, bars: 4, fill: { snare: 'xxx.........', tom1: '...xxx......', tom2: '......xxx...', floor: '.........xxx' } },
      { title: 'Sextillos', pattern: { hihat: HH8, kick: 'x.....x.x.......', snare: SN24 }, bars: 4, fill: { snare: 'xx.xx.xx.xx.xx.xx.xx.xx.', kick: '..x..x..x..x..x..x..x..x' } },
    ] },
  { id: 'dr-dnb', title: 'Drum & Bass', artist: 'Jungle Signal', grade: 12, genre: 'Electrónica', bpm: 170, description: 'Beat a 170 BPM con bombo sincopado y ghost notes.', tags: ['dnb', 'velocidad'], courseId: 'c-drums-fills',
    steps: [
      { title: 'Dos pasos', pattern: { hihat: HH8, kick: 'x.........x.....', snare: '....x.......x...' } },
      { title: 'Ghost notes', pattern: { hihat: HH8, kick: 'x.........x.....', snare: '....x..x..x.x..x' } },
      { title: 'Amen-ish', pattern: { ride: HH8, kick: 'x.x.......x.....', snare: '....x..x..x.x..x' }, bars: 4, fill: { snare: 'x.x..x.x.x..xx.x', kick: '..x.x.x...x.....' } },
    ] },
  // ---- Ejercicios (rudimentos) ----
  { id: 'dr-ex-single', title: 'Single stroke roll', artist: 'Rudimentos', grade: 2, genre: 'Técnica', bpm: 80, description: 'Alternancia D-I en corcheas y semicorcheas.', tags: ['rudimento'], kind: 'exercise', free: true,
    steps: [
      { title: 'Corcheas', pattern: { snare: HH8 } },
      { title: 'Semicorcheas', pattern: { snare: HH16 } },
    ] },
  { id: 'dr-ex-double', title: 'Double stroke roll', artist: 'Rudimentos', grade: 4, genre: 'Técnica', bpm: 76, description: 'DD-II: control de rebote.', tags: ['rudimento'], kind: 'exercise',
    steps: [
      { title: 'Dobles', pattern: { snare: HH16 } },
      { title: 'Dobles con bombo', pattern: { snare: HH16, kick: KD13 } },
    ] },
  { id: 'dr-ex-paradiddle', title: 'Paradiddle', artist: 'Rudimentos', grade: 5, genre: 'Técnica', bpm: 84, description: 'DIDD IDII — el rudimento más útil aplicado al set.', tags: ['rudimento'], kind: 'exercise',
    steps: [
      { title: 'En el redoblante', pattern: { snare: HH16 } },
      { title: 'Entre hi-hat y caja', pattern: { hihat: 'x.xx.x..x.xx.x..', snare: '.x..x.xx.x..x.xx' } },
      { title: 'Con bombo', pattern: { hihat: 'x.xx.x..x.xx.x..', snare: '.x..x.xx.x..x.xx', kick: 'x...x...x...x...' } },
    ] },
  { id: 'dr-ex-flams', title: 'Flams y acentos', artist: 'Rudimentos', grade: 7, genre: 'Técnica', bpm: 90, description: 'Acentos desplazados en semicorcheas.', tags: ['rudimento', 'acentos'], kind: 'exercise',
    steps: [
      { title: 'Acento en 1', pattern: { snare: 'Xxxx' + 'Xxxx'.repeat(3) } },
      { title: 'Acento desplazado', pattern: { snare: 'xXxxxXxxxXxxxXxx' } },
      { title: 'Acentos en toms', pattern: { snare: 'xxxxxxxx....xxxx', tom1: '........xx......', floor: '..........xx....' } },
    ] },
  // ---- Canciones ----
  { id: 'dr-song-neon', title: 'Neon Highway', artist: 'Pulso Band', grade: 4, genre: 'Pop', bpm: 118, description: 'Un tema synth-pop con verso, pre-coro y coro.', tags: ['canción'], kind: 'song', free: true,
    steps: [
      { title: 'Intro', pattern: { hihat: HH8, kick: 'x.......x.......' }, bars: 4 },
      { title: 'Verso', pattern: { hihat: HH8, kick: 'x.......x.x.....', snare: SN24 }, bars: 4 },
      { title: 'Pre-coro', pattern: { hihat: HH16, kick: 'x...x...x...x...', snare: SN24 }, bars: 4, fill: { snare: 'x.x.x.x.xxxxxxxx' } },
      { title: 'Coro', pattern: { crash: KD1, hihat: '..x.x.x.x.x.x.x.', kick: 'x.....x.x.x.....', snare: SN24 }, bars: 8, fill: { snare: 'xxxx....xxxx....', tom1: '....xxxx........', floor: '............xxxx' } },
    ] },
  { id: 'dr-song-basement', title: 'Basement Tapes', artist: 'MC Metronome', grade: 6, genre: 'Hip hop', bpm: 88, description: 'Beat de hip hop con puente en half-time.', tags: ['canción'], kind: 'song',
    steps: [
      { title: 'Verso', pattern: { hihat: HH8, kick: 'x.....x.x..x....', snare: SN24 }, bars: 8 },
      { title: 'Puente', pattern: { hihat: 'x.x.x.x.x.x.xxxx', kick: 'x......x..x.....', snare: '........x.......' }, bars: 4 },
      { title: 'Coro', pattern: { hihat: HH8, kick: 'x.....x.x..x..x.', snare: '....x.......x..x' }, bars: 8, fill: { snare: 'x..x..x.x.x.xxxx' } },
    ] },
  { id: 'dr-song-samba', title: 'Carnaval Nocturno', artist: 'Praia Trio', grade: 9, genre: 'Latin', bpm: 126, description: 'Samba con batucada en el coro.', tags: ['canción', 'samba'], kind: 'song',
    steps: [
      { title: 'Intro', pattern: { hihat: 'x.xx.x.xx.x.x.x.', kick: 'x..x..x.x..x..x.' }, bars: 4 },
      { title: 'Verso', pattern: { hihat: 'x.xx.x.xx.x.x.x.', kick: 'x..x..x.x..x..x.', snare: 'x..x..x...x.x...' }, bars: 8 },
      { title: 'Batucada', pattern: { floor: 'x..x..x.x..x..x.', tom1: '..x..x...x..x...', snare: 'xxxxxxxxxxxxxxxx', kick: 'x...x...x...x...' }, bars: 4 },
      { title: 'Coro', pattern: { ride: 'x.xx.x.xx.x.x.x.', crash: KD1, kick: 'x..x..x.x..x..x.', snare: 'x..x..x...x.x...' }, bars: 8, fill: { snare: 'x.x.x.x.', tom1: '.x.x....', floor: '.....x.x' } },
    ] },
  { id: 'dr-song-stadium', title: 'Stadium Lights', artist: 'Stone Elephant', grade: 12, genre: 'Rock', bpm: 140, description: 'Rock de estadio con fills largos y cambios de dinámica.', tags: ['canción'], kind: 'song',
    steps: [
      { title: 'Intro toms', pattern: { floor: 'x.x.x.x.x.x.x.x.', tom2: '..x...x...x...x.', kick: 'x...x...x...x...' }, bars: 4 },
      { title: 'Verso', pattern: { hihat: HH8, kick: 'x.x.....x.x.....', snare: SN24 }, bars: 8, fill: { snare: 'xxxxxxxx', tom1: '........xxxx....', floor: '............xxxx' } },
      { title: 'Coro', pattern: { crash: KD1, ride: HH8, kick: 'x.x...x.x.x...x.', snare: SN24 }, bars: 8, fill: { snare: 'x.x.x.x.xxxxxxxx' } },
      { title: 'Final', pattern: { crash: 'x...x...x...x...', kick: 'x...x...x...x...', snare: 'x...x...x...x...' }, bars: 2 },
    ] },
];

export const DRUM_LESSONS: Lesson[] = DEFS.map(build);
