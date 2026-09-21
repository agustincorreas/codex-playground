// Motor de audio: sintetiza batería, pads y teclado con Web Audio (sin samples externos).
import type { Instrument } from '../engine/types';
import { PAD_SOUNDS } from '../engine/instruments';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let userVolume = 0.9;
let backingVolume = 0.6;

export function getAudioContext(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = userVolume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
  }
  return ctx;
}

export async function unlockAudio(): Promise<void> {
  const c = getAudioContext();
  if (c.state !== 'running') {
    try {
      await c.resume();
    } catch {
      /* ignore */
    }
  }
}

export function setMasterVolume(v: number) {
  userVolume = v;
  if (master) master.gain.value = v;
}
export function setBackingVolume(v: number) {
  backingVolume = v;
}
export function now(): number {
  return getAudioContext().currentTime;
}
/** Latencia de salida estimada en segundos. */
export function outputLatency(): number {
  const c = getAudioContext();
  return (c as unknown as { outputLatency?: number }).outputLatency ?? c.baseLatency ?? 0;
}

function getNoise(c: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

function env(c: AudioContext, t: number, peak: number, attack: number, decay: number, dest: AudioNode): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(dest);
  return g;
}

function noiseHit(c: AudioContext, t: number, gain: number, decay: number, filterType: BiquadFilterType, freq: number, dest: AudioNode, q = 1) {
  const src = c.createBufferSource();
  src.buffer = getNoise(c);
  const f = c.createBiquadFilter();
  f.type = filterType;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = env(c, t, gain, 0.002, decay, dest);
  src.connect(f).connect(g);
  src.start(t);
  src.stop(t + decay + 0.05);
}

function tone(c: AudioContext, t: number, type: OscillatorType, f0: number, f1: number, gain: number, decay: number, dest: AudioNode) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + decay * 0.6);
  const g = env(c, t, gain, 0.002, decay, dest);
  o.connect(g);
  o.start(t);
  o.stop(t + decay + 0.05);
}

// ---- Batería ----
export function drumSound(id: string, t: number, vel = 1, dest?: AudioNode) {
  const c = getAudioContext();
  const d = dest ?? master!;
  const v = 0.35 + 0.65 * vel;
  switch (id) {
    case 'kick':
      tone(c, t, 'sine', 150, 45, 1.1 * v, 0.35, d);
      noiseHit(c, t, 0.25 * v, 0.03, 'lowpass', 1200, d);
      break;
    case 'snare':
      tone(c, t, 'triangle', 220, 150, 0.6 * v, 0.12, d);
      noiseHit(c, t, 0.7 * v, 0.2, 'highpass', 1500, d);
      break;
    case 'rim':
      tone(c, t, 'square', 800, 500, 0.3 * v, 0.05, d);
      noiseHit(c, t, 0.3 * v, 0.04, 'bandpass', 3000, d, 4);
      break;
    case 'clap':
      for (let i = 0; i < 3; i++) noiseHit(c, t + i * 0.01, 0.5 * v, 0.06, 'bandpass', 1800, d, 1.5);
      noiseHit(c, t + 0.03, 0.5 * v, 0.2, 'bandpass', 1400, d, 1);
      break;
    case 'hihat':
      noiseHit(c, t, 0.35 * v, 0.06, 'highpass', 7000, d);
      break;
    case 'openhat':
      noiseHit(c, t, 0.35 * v, 0.35, 'highpass', 6000, d);
      break;
    case 'crash':
      noiseHit(c, t, 0.6 * v, 1.4, 'highpass', 4000, d);
      noiseHit(c, t, 0.3 * v, 0.9, 'bandpass', 6000, d, 0.6);
      break;
    case 'ride':
      noiseHit(c, t, 0.3 * v, 0.7, 'bandpass', 5500, d, 3);
      tone(c, t, 'sine', 3200, 3000, 0.12 * v, 0.5, d);
      break;
    case 'tom1':
      tone(c, t, 'sine', 240, 140, 0.9 * v, 0.3, d);
      break;
    case 'tom2':
      tone(c, t, 'sine', 180, 100, 0.9 * v, 0.35, d);
      break;
    case 'floor':
      tone(c, t, 'sine', 120, 70, 1.0 * v, 0.45, d);
      break;
    case 'shaker':
      noiseHit(c, t, 0.25 * v, 0.08, 'bandpass', 9000, d, 2);
      break;
    case 'cowbell':
      tone(c, t, 'square', 560, 560, 0.25 * v, 0.2, d);
      tone(c, t, 'square', 845, 845, 0.2 * v, 0.2, d);
      break;
    case 'perc1':
      tone(c, t, 'sine', 900, 400, 0.5 * v, 0.1, d);
      break;
    case 'perc2':
      tone(c, t, 'triangle', 400, 300, 0.5 * v, 0.15, d);
      break;
    case 'bass':
      tone(c, t, 'sawtooth', 55, 55, 0.5 * v, 0.4, d);
      break;
    case 'stab':
      [0, 4, 7].forEach((s) => tone(c, t, 'sawtooth', 220 * 2 ** (s / 12), 220 * 2 ** (s / 12), 0.2 * v, 0.25, d));
      break;
    case 'chord':
      [0, 3, 7, 10].forEach((s) => tone(c, t, 'triangle', 261 * 2 ** (s / 12), 261 * 2 ** (s / 12), 0.2 * v, 0.6, d));
      break;
    case 'vox':
      tone(c, t, 'sine', 660, 520, 0.4 * v, 0.3, d);
      tone(c, t, 'sine', 990, 780, 0.15 * v, 0.3, d);
      break;
    default:
      tone(c, t, 'sine', 400, 300, 0.5 * v, 0.15, d);
  }
}

// ---- Teclado (piano eléctrico sintético) ----
const activeKeys = new Map<number, { g: GainNode; stop: () => void }>();

export function keyNoteOn(midi: number, t?: number, vel = 0.8, dest?: AudioNode, holdSec?: number) {
  const c = getAudioContext();
  const d = dest ?? master!;
  const time = t ?? c.currentTime;
  const f = 440 * 2 ** ((midi - 69) / 12);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(0.5 * vel, time + 0.005);
  g.gain.exponentialRampToValueAtTime(0.18 * vel, time + 0.5);
  g.gain.exponentialRampToValueAtTime(0.06 * vel, time + 2.5);
  const filt = c.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(Math.min(12000, f * 8), time);
  filt.frequency.exponentialRampToValueAtTime(Math.min(8000, f * 2.5), time + 0.6);
  const o1 = c.createOscillator();
  o1.type = 'triangle';
  o1.frequency.value = f;
  const o2 = c.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = f * 2;
  const g2 = c.createGain();
  g2.gain.value = 0.25;
  o1.connect(filt);
  o2.connect(g2).connect(filt);
  filt.connect(g).connect(d);
  o1.start(time);
  o2.start(time);
  const stop = () => {
    const tt = Math.max(c.currentTime, time);
    g.gain.cancelScheduledValues(tt);
    g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), tt);
    g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.12);
    o1.stop(tt + 0.15);
    o2.stop(tt + 0.15);
  };
  if (holdSec != null) {
    const tEnd = time + holdSec;
    g.gain.setValueAtTime(g.gain.value, tEnd);
    g.gain.exponentialRampToValueAtTime(0.0001, tEnd + 0.12);
    o1.stop(tEnd + 0.15);
    o2.stop(tEnd + 0.15);
    return;
  }
  const prev = activeKeys.get(midi);
  if (prev) prev.stop();
  activeKeys.set(midi, { g, stop });
  // Seguridad: apagar a los 6 s.
  o1.stop(time + 6);
  o2.stop(time + 6);
}

export function keyNoteOff(midi: number) {
  const a = activeKeys.get(midi);
  if (a) {
    a.stop();
    activeKeys.delete(midi);
  }
}

/** Reproduce el sonido del carril de un instrumento. */
export function playLane(instrument: Instrument, lane: string, t?: number, vel = 1, backing = false) {
  const c = getAudioContext();
  const time = t ?? c.currentTime;
  let dest: AudioNode = master!;
  if (backing) {
    const g = c.createGain();
    g.gain.value = backingVolume;
    g.connect(master!);
    dest = g;
  }
  if (instrument === 'drums') drumSound(lane, time, vel, dest);
  else if (instrument === 'pads') drumSound(PAD_SOUNDS[Number(lane.slice(1))] ?? 'perc1', time, vel, dest);
  else keyNoteOn(Number(lane), time, vel * 0.9, dest, backing ? 0.4 : undefined);
}

export function releaseLane(instrument: Instrument, lane: string) {
  if (instrument === 'keys') keyNoteOff(Number(lane));
}

// ---- Metrónomo ----
export function click(t: number, accent: boolean) {
  const c = getAudioContext();
  const o = c.createOscillator();
  o.type = 'square';
  o.frequency.value = accent ? 1760 : 1175;
  const g = env(c, t, accent ? 0.35 : 0.22, 0.001, 0.05, master!);
  o.connect(g);
  o.start(t);
  o.stop(t + 0.08);
}

// ---- Base de acompañamiento (acorde + bajo) ----
export function backingChord(rootMidi: number, quality: 'maj' | 'min' | 'dom7' | 'min7', t: number, durSec: number) {
  const c = getAudioContext();
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.16 * backingVolume, t + 0.05);
  g.gain.setValueAtTime(0.16 * backingVolume, t + durSec - 0.1);
  g.gain.exponentialRampToValueAtTime(0.0001, t + durSec);
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 1800;
  g.connect(f).connect(master!);
  const intervals = quality === 'maj' ? [0, 4, 7] : quality === 'min' ? [0, 3, 7] : quality === 'dom7' ? [0, 4, 7, 10] : [0, 3, 7, 10];
  intervals.forEach((s) => {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 440 * 2 ** ((rootMidi + s - 69) / 12);
    o.detune.value = (Math.random() - 0.5) * 8;
    o.connect(g);
    o.start(t);
    o.stop(t + durSec + 0.05);
  });
  // bajo
  const b = c.createOscillator();
  b.type = 'triangle';
  b.frequency.value = 440 * 2 ** ((rootMidi - 12 - 69) / 12);
  const bg = env(c, t, 0.35 * backingVolume, 0.01, Math.min(0.8, durSec), master!);
  b.connect(bg);
  b.start(t);
  b.stop(t + durSec + 0.05);
}
