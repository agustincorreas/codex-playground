// Mini-lenguaje para escribir patrones rítmicos y melódicos.
import type { LessonNote } from '../engine/types';

/** Patrones de batería/pads en grilla de semicorcheas: { lane: 'x..x' } — cada carácter = 1/16, 'x' golpe, 'X' acento, '.' silencio. */
export type GridPattern = Record<string, string>;

export function grid(p: GridPattern, bars = 1, offsetBars = 0): LessonNote[] {
  const out: LessonNote[] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (const [lane, s] of Object.entries(p)) {
      const cleaned = s.replace(/[\s|]/g, '');
      const stepsPerBar = cleaned.length;
      for (let i = 0; i < stepsPerBar; i++) {
        const ch = cleaned[i];
        if (ch === 'x' || ch === 'X' || ch === 'o') {
          out.push({ lane, beat: (offsetBars + bar) * 4 + (i / stepsPerBar) * 4 });
        }
      }
    }
  }
  return out;
}

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function pitch(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error('Nota inválida: ' + name);
  let n = NOTE_INDEX[m[1]];
  if (m[2] === '#') n++;
  if (m[2] === 'b') n--;
  return (Number(m[3]) + 1) * 12 + n;
}

/**
 * Melodía como texto: "C4:1 E4:1 G4:2 r:1 [C4,E4,G4]:2" (nota:duración en negras; r = silencio; [..] acorde).
 * Sufijo opcional de mano: "C4:1L".
 */
export function melody(text: string, startBeat = 0, hand?: 'L' | 'R'): LessonNote[] {
  const out: LessonNote[] = [];
  let beat = startBeat;
  for (const tok of text.trim().split(/\s+/)) {
    if (!tok) continue;
    const m = /^(\[[^\]]+\]|r|[A-G][#b]?-?\d):([\d.]+)([LR])?$/.exec(tok);
    if (!m) throw new Error('Token inválido: ' + tok);
    const dur = Number(m[2]);
    const h = (m[3] as 'L' | 'R' | undefined) ?? hand;
    if (m[1] !== 'r') {
      const names = m[1].startsWith('[') ? m[1].slice(1, -1).split(',') : [m[1]];
      for (const nm of names) out.push({ lane: String(pitch(nm.trim())), beat, dur, hand: h });
    }
    beat += dur;
  }
  return out;
}

export function merge(...parts: LessonNote[][]): LessonNote[] {
  return parts.flat().sort((a, b) => a.beat - b.beat);
}

export function shift(notes: LessonNote[], beats: number): LessonNote[] {
  return notes.map((n) => ({ ...n, beat: n.beat + beats }));
}

export function repeat(notes: LessonNote[], times: number, lengthBeats: number): LessonNote[] {
  const out: LessonNote[] = [];
  for (let i = 0; i < times; i++) out.push(...shift(notes, i * lengthBeats));
  return out;
}

export function transpose(notes: LessonNote[], semis: number): LessonNote[] {
  return notes.map((n) => ({ ...n, lane: String(Number(n.lane) + semis) }));
}
