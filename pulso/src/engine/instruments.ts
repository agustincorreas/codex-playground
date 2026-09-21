import type { Instrument } from './types';

export interface LaneDef {
  id: string;
  label: string;
  shortLabel: string;
  color: string;
  /** Notas MIDI que activan este carril (General MIDI para batería / pads estándar 4x4). */
  midi: number[];
  /** Tecla del teclado de la computadora (event.code). */
  key: string;
  keyLabel: string;
}

export const DRUM_LANES: LaneDef[] = [
  { id: 'crash', label: 'Crash', shortLabel: 'CR', color: '#f6c343', midi: [49, 57, 55, 52], key: 'KeyR', keyLabel: 'R' },
  { id: 'ride', label: 'Ride', shortLabel: 'RD', color: '#f59e0b', midi: [51, 59, 53], key: 'KeyU', keyLabel: 'U' },
  { id: 'hihat', label: 'Hi-hat', shortLabel: 'HH', color: '#22d3ee', midi: [42, 44, 46], key: 'KeyE', keyLabel: 'E' },
  { id: 'tom1', label: 'Tom alto', shortLabel: 'T1', color: '#a78bfa', midi: [48, 50], key: 'KeyI', keyLabel: 'I' },
  { id: 'tom2', label: 'Tom medio', shortLabel: 'T2', color: '#c084fc', midi: [45, 47], key: 'KeyO', keyLabel: 'O' },
  { id: 'snare', label: 'Redoblante', shortLabel: 'SN', color: '#fb7185', midi: [38, 40, 37], key: 'KeyF', keyLabel: 'F' },
  { id: 'floor', label: 'Tom de piso', shortLabel: 'FT', color: '#e879f9', midi: [41, 43], key: 'KeyK', keyLabel: 'K' },
  { id: 'kick', label: 'Bombo', shortLabel: 'BD', color: '#34d399', midi: [36, 35], key: 'Space', keyLabel: '␣' },
];

const PAD_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyZ', 'KeyX', 'KeyC', 'KeyV'];
const PAD_KEY_LABELS = ['1', '2', '3', '4', 'Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V'];
const PAD_COLORS = ['#fb7185', '#f97316', '#f6c343', '#a3e635', '#34d399', '#22d3ee', '#60a5fa', '#a78bfa', '#e879f9', '#f472b6', '#fb7185', '#f97316', '#f6c343', '#a3e635', '#34d399', '#22d3ee'];
export const PAD_SOUNDS = ['kick', 'snare', 'clap', 'hihat', 'openhat', 'tom1', 'tom2', 'rim', 'shaker', 'cowbell', 'perc1', 'perc2', 'bass', 'stab', 'chord', 'vox'];

/** Pads 4x4: fila superior p0..p3 (MIDI 48–51), fila inferior p12..p15 (MIDI 36–39), como en un controlador estándar. */
export const PAD_LANES: LaneDef[] = Array.from({ length: 16 }, (_, i) => {
  const row = Math.floor(i / 4); // 0 arriba
  const col = i % 4;
  const midi = 36 + (3 - row) * 4 + col;
  return {
    id: `p${i}`,
    label: `Pad ${i + 1}`,
    shortLabel: PAD_KEY_LABELS[i],
    color: PAD_COLORS[i],
    midi: [midi, midi + 16],
    key: PAD_KEYS[i],
    keyLabel: PAD_KEY_LABELS[i],
  };
});

// Teclado: rango C3 (48) a C6 (84). Mapeo de teclado de computadora estilo DAW.
export const KEYS_LOW = 48;
export const KEYS_HIGH = 84;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_ES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];

export function noteName(midi: number, latin = false): string {
  const names = latin ? NOTE_NAMES_ES : NOTE_NAMES;
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}
export function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(midi % 12);
}

// Fila inferior = octava 4 (C4=60), fila superior = octava 5 (C5=72). Se puede transponer con Z / X.
const KEYBOARD_ROW_LOW: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};
const KEYBOARD_ROW_HIGH: Record<string, number> = {
  Digit1: 12, Digit2: 14, Digit3: 16, Digit4: 17, Digit5: 19, Digit6: 21, Digit7: 23, Digit8: 24, Digit9: 26, Digit0: 28,
};

export function keyToPitch(code: string, octaveShift: number): number | null {
  if (code in KEYBOARD_ROW_LOW) return 60 + KEYBOARD_ROW_LOW[code] + octaveShift * 12;
  if (code in KEYBOARD_ROW_HIGH) return 60 + KEYBOARD_ROW_HIGH[code] + octaveShift * 12;
  return null;
}
export function pitchToKeyLabel(midi: number, octaveShift: number): string | null {
  const rel = midi - 60 - octaveShift * 12;
  for (const [code, v] of Object.entries(KEYBOARD_ROW_LOW)) if (v === rel) return code.replace('Key', '').replace('Semicolon', ';');
  for (const [code, v] of Object.entries(KEYBOARD_ROW_HIGH)) if (v === rel) return code.replace('Digit', '');
  return null;
}

export const KEY_LANES: LaneDef[] = Array.from({ length: KEYS_HIGH - KEYS_LOW + 1 }, (_, i) => {
  const midi = KEYS_LOW + i;
  return {
    id: String(midi),
    label: noteName(midi),
    shortLabel: noteName(midi),
    color: isBlackKey(midi) ? '#a78bfa' : '#7c5cff',
    midi: [midi],
    key: '',
    keyLabel: '',
  };
});

export function lanesFor(instrument: Instrument): LaneDef[] {
  return instrument === 'drums' ? DRUM_LANES : instrument === 'pads' ? PAD_LANES : KEY_LANES;
}

export function laneForMidi(instrument: Instrument, note: number): string | null {
  if (instrument === 'keys') return note >= 0 && note < 128 ? String(note) : null;
  const lanes = lanesFor(instrument);
  const l = lanes.find((x) => x.midi.includes(note));
  return l ? l.id : null;
}

export function laneForKey(instrument: Instrument, code: string, octaveShift: number): string | null {
  if (instrument === 'keys') {
    const p = keyToPitch(code, octaveShift);
    return p == null ? null : String(p);
  }
  const l = lanesFor(instrument).find((x) => x.key === code);
  return l ? l.id : null;
}

export const INSTRUMENT_META: Record<Instrument, { label: string; emoji: string; accent: string; description: string }> = {
  keys: { label: 'Teclado', emoji: '🎹', accent: '#7c5cff', description: 'Piano, sintes y controladores MIDI.' },
  pads: { label: 'Pads', emoji: '🎛️', accent: '#22d3ee', description: 'Finger drumming en controladores de pads.' },
  drums: { label: 'Batería', emoji: '🥁', accent: '#fb7185', description: 'Batería electrónica o acústica.' },
};
