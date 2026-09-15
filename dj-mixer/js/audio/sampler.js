// Sampler de 8 pads: samples sintetizados de fábrica + archivos propios. Disparo opcionalmente cuantizado al beat.
import { clamp } from '../utils.js';

const SR = 44100;
export const DEFAULT_PADS = [
  { name: 'Kick', color: '#ff4e42', synth: 'kick' },
  { name: 'Clap', color: '#ffb020', synth: 'clap' },
  { name: 'Hat', color: '#48de84', synth: 'hat' },
  { name: 'Open hat', color: '#2ee6d6', synth: 'ohat' },
  { name: 'Snare', color: '#56aaff', synth: 'snare' },
  { name: 'Crash', color: '#c77dff', synth: 'crash' },
  { name: 'Air horn', color: '#ff6ad5', synth: 'horn' },
  { name: 'Riser', color: '#f5f5f5', synth: 'riser' },
];

function noiseBuffer(ctx, seconds) {
  const b = ctx.createBuffer(1, Math.ceil(seconds * SR), SR); const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
const env = (ctx, g, t0, peak, decay, hold = 0) => { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + 0.002); g.gain.setValueAtTime(peak, t0 + 0.002 + hold); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.002 + hold + decay); };

export async function synthSample(kind) {
  const dur = { kick: 0.6, clap: 0.5, hat: 0.15, ohat: 0.5, snare: 0.35, crash: 2.2, horn: 1.1, riser: 4 }[kind] || 1;
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
  const out = ctx.createGain(); out.connect(ctx.destination);
  const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuffer(ctx, dur); return s; };
  const bq = (type, f, q = 1) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  if (kind === 'kick') {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(160, 0); o.frequency.exponentialRampToValueAtTime(48, 0.09);
    const g = ctx.createGain(); env(ctx, g, 0, 1, 0.45); o.connect(g); g.connect(out); o.start(0); o.stop(dur);
    const c = noise(); const cg = ctx.createGain(); env(ctx, cg, 0, 0.5, 0.012); c.connect(bq('highpass', 2000)).connect(cg); cg.connect(out); c.start(0);
  } else if (kind === 'clap') {
    for (const t of [0, 0.011, 0.022, 0.034]) { const n = noise(); const g = ctx.createGain(); env(ctx, g, t, 0.9, t === 0.034 ? 0.28 : 0.02); n.connect(bq('bandpass', 1800, 0.9)).connect(g); g.connect(out); n.start(t); }
  } else if (kind === 'hat' || kind === 'ohat') {
    const n = noise(); const g = ctx.createGain(); env(ctx, g, 0, 0.7, kind === 'hat' ? 0.07 : 0.4);
    n.connect(bq('highpass', 7500)).connect(bq('peaking', 10000, 2)).connect(g); g.connect(out); n.start(0);
  } else if (kind === 'snare') {
    const n = noise(); const g = ctx.createGain(); env(ctx, g, 0, 0.8, 0.22); n.connect(bq('bandpass', 2500, 0.6)).connect(g); g.connect(out); n.start(0);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(220, 0); o.frequency.exponentialRampToValueAtTime(150, 0.1);
    const og = ctx.createGain(); env(ctx, og, 0, 0.6, 0.15); o.connect(og); og.connect(out); o.start(0); o.stop(dur);
  } else if (kind === 'crash') {
    const n = noise(); const g = ctx.createGain(); env(ctx, g, 0, 0.6, 1.9); n.connect(bq('highpass', 4500)).connect(bq('peaking', 8000, 1.5)).connect(g); g.connect(out); n.start(0);
  } else if (kind === 'horn') {
    const lp = bq('lowpass', 1800, 2); lp.frequency.setValueAtTime(2500, 0); lp.frequency.exponentialRampToValueAtTime(900, 1.0);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(0.35, 0.03); g.gain.setValueAtTime(0.35, 0.75); g.gain.exponentialRampToValueAtTime(0.0001, 1.05);
    for (const d of [-8, 0, 7, 12]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(466 + d, 0); o.frequency.exponentialRampToValueAtTime(392 + d, 0.9); o.connect(lp); o.start(0); o.stop(dur); }
    lp.connect(g); g.connect(out);
  } else if (kind === 'riser') {
    const n = noise(); const lp = bq('lowpass', 300, 1.5); lp.frequency.setValueAtTime(250, 0); lp.frequency.exponentialRampToValueAtTime(14000, dur - 0.05);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.05, 0); g.gain.linearRampToValueAtTime(0.7, dur - 0.05); g.gain.linearRampToValueAtTime(0.0001, dur);
    n.connect(lp).connect(g); g.connect(out); n.start(0);
  }
  return ctx.startRendering();
}

export class Sampler {
  constructor(engine, { masterDeck }) {
    this.engine = engine; this.masterDeck = masterDeck; // () => deck que manda el beat (o null)
    const c = engine.ctx;
    this.out = c.createGain(); this.out.connect(engine.master);
    this.cueGain = c.createGain(); this.cueGain.gain.value = 0; this.out.connect(this.cueGain); this.cueGain.connect(engine.cueBus);
    this.pads = DEFAULT_PADS.map(p => ({ ...p, buffer: null, gain: 1, playing: null, custom: false }));
    this.quantize = false; this.volume = 0.9; this.out.gain.value = this.volume;
    this.onChange = null;
  }
  async loadDefaults() {
    await Promise.all(this.pads.map(async (p, i) => { if (!p.custom) { p.buffer = await synthSample(p.synth); this.onChange?.(i); } }));
  }
  async loadFile(i, file) {
    const buf = await this.engine.ctx.decodeAudioData(await file.arrayBuffer());
    const p = this.pads[i]; p.buffer = buf; p.custom = true; p.name = file.name.replace(/\.[^.]+$/, '').slice(0, 18); this.onChange?.(i);
  }
  async restoreDefault(i) { const p = this.pads[i]; Object.assign(p, DEFAULT_PADS[i], { custom: false }); p.buffer = await synthSample(p.synth); this.onChange?.(i); }
  _when() {
    const d = this.masterDeck?.(); const now = this.engine.now;
    if (!this.quantize || !d?.playing || !d.bpm) return now;
    const phase = d.phaseAt(d.position);
    const wait = (1 - phase) * d.beatLen / d.rate; // segundos reales hasta el próximo beat
    return now + (wait < 0.02 ? 0 : wait);
  }
  trigger(i) {
    const p = this.pads[i]; if (!p?.buffer) return;
    this.engine.resume();
    this.stop(i);
    const s = this.engine.ctx.createBufferSource(); s.buffer = p.buffer;
    const g = this.engine.ctx.createGain(); g.gain.value = p.gain; s.connect(g); g.connect(this.out);
    const t = this._when(); s.start(t); p.playing = s; p.playAt = t;
    s.onended = () => { if (p.playing === s) { p.playing = null; this.onChange?.(i); } };
    this.onChange?.(i);
  }
  stop(i) { const p = this.pads[i]; if (p.playing) { try { p.playing.stop(); } catch { /* ya terminó */ } p.playing = null; this.onChange?.(i); } }
  stopAll() { this.pads.forEach((_, i) => this.stop(i)); }
  setVolume(v) { this.volume = clamp(v, 0, 1.25); this.out.gain.setTargetAtTime(this.volume, this.engine.now, 0.01); }
  setCue(on) { this.cueGain.gain.setTargetAtTime(on ? 1 : 0, this.engine.now, 0.01); }
}
