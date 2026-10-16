// engine.js — Motor de audio del Estudio
// AudioContext, transporte con loop por compases, metrónomo, sintetizador
// polifónico, batería sintetizada y un scheduler con lookahead.
// Sin dependencias. Diseñado para Web Audio API en móvil (iOS/Android) y escritorio.

'use strict';

// --- Notas / frecuencias -----------------------------------------------------
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Devuelve la frecuencia en Hz de un número MIDI (69 = A4 = 440 Hz).
function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function midiToName(midi) {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return name + octave;
}

// --- Definición de instrumentos de software ----------------------------------
// Cada preset describe el timbre de un oscilador con envolvente ADSR simple.
const INSTRUMENTS = {
  piano:   { label: 'Piano',   type: 'triangle', attack: 0.004, decay: 0.9,  sustain: 0.0,  release: 0.25, detune: 0,  color: '#7cc5ff' },
  epiano:  { label: 'E-Piano', type: 'sine',     attack: 0.004, decay: 1.4,  sustain: 0.0,  release: 0.4,  detune: 0,  color: '#b39cff' },
  synth:   { label: 'Synth',   type: 'sawtooth', attack: 0.02,  decay: 0.2,  sustain: 0.6,  release: 0.3,  detune: 6,  color: '#ff9fb0' },
  bass:    { label: 'Bajo',    type: 'square',   attack: 0.01,  decay: 0.2,  sustain: 0.7,  release: 0.2,  detune: 0,  color: '#ffd27c' },
  pad:     { label: 'Pad',     type: 'sawtooth', attack: 0.4,   decay: 0.5,  sustain: 0.7,  release: 0.8,  detune: 8,  color: '#8affc9' },
};

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bpm = 100;
    this.beatsPerBar = 4;
    this.bars = 4;
    this.metronomeOn = true;

    this.isPlaying = false;
    this.loopStartTime = 0;     // ctx.currentTime en que arrancó la iteración 0
    this.currentIteration = -1; // última iteración ya agendada
    this.lookahead = 0.2;       // segundos que miramos hacia adelante
    this._timer = null;

    // Pistas registradas por la app. Cada pista aporta sus eventos a agendar.
    // tracks es un array de objetos { instrument, events, muted, solo, volume, gain, kind, buffer }
    this.tracks = [];

    // Voces de micrófono/audio activas (para poder cortarlas al parar).
    this._activeSources = [];

    // Callback de UI por cada click de metrónomo/beat (para el playhead/animación).
    this.onBeat = null;
  }

  // El contexto de audio se crea con el primer gesto del usuario (requisito iOS).
  ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
  }

  get loopDuration() {
    return this.bars * this.beatsPerBar * (60 / this.bpm);
  }

  get beatDuration() {
    return 60 / this.bpm;
  }

  // Posición del playhead dentro del loop, en segundos (0..loopDuration).
  get playheadTime() {
    if (!this.isPlaying || !this.ctx) return 0;
    const elapsed = this.ctx.currentTime - this.loopStartTime;
    const d = this.loopDuration;
    return ((elapsed % d) + d) % d;
  }

  // --- Síntesis de una nota de instrumento ------------------------------------
  // when: tiempo absoluto del ctx; dur: duración en segundos; destino: nodo gain.
  playNote(instrumentId, midi, when, dur, dest, velocity = 0.8) {
    const preset = INSTRUMENTS[instrumentId] || INSTRUMENTS.synth;
    const ctx = this.ctx;
    const freq = midiToFreq(midi);
    const out = dest || this.master;

    const osc = ctx.createOscillator();
    osc.type = preset.type;
    osc.frequency.value = freq;

    // Un segundo oscilador desafinado para engrosar (si el preset lo pide).
    let osc2 = null;
    if (preset.detune) {
      osc2 = ctx.createOscillator();
      osc2.type = preset.type;
      osc2.frequency.value = freq;
      osc2.detune.value = preset.detune;
    }

    const g = ctx.createGain();
    g.gain.value = 0;

    osc.connect(g);
    if (osc2) osc2.connect(g);
    g.connect(out);

    const peak = Math.max(0.0001, velocity * 0.6);
    const a = preset.attack;
    const d = preset.decay;
    const s = preset.sustain;
    const r = preset.release;

    const t = Math.max(when, ctx.currentTime);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    const sustainLevel = Math.max(0.0001, peak * s);
    g.gain.linearRampToValueAtTime(sustainLevel, t + a + d);

    // Fin de la nota: soltar la envolvente.
    const holdUntil = t + Math.max(dur, 0.03);
    g.gain.setValueAtTime(Math.max(g.gain.value, sustainLevel), holdUntil);
    g.gain.linearRampToValueAtTime(0.0001, holdUntil + r);

    osc.start(t);
    if (osc2) osc2.start(t);
    const stopAt = holdUntil + r + 0.02;
    osc.stop(stopAt);
    if (osc2) osc2.stop(stopAt);

    return { osc, osc2, gain: g, stopAt };
  }

  // --- Batería sintetizada ----------------------------------------------------
  playDrum(voice, when, dest, velocity = 1) {
    const ctx = this.ctx;
    const out = dest || this.master;
    const t = Math.max(when, ctx.currentTime);
    const vol = velocity;

    if (voice === 'kick') {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(g); g.connect(out);
      osc.start(t); osc.stop(t + 0.32);
    } else if (voice === 'snare') {
      const noise = this._noiseBurst(t, 0.2, out, vol * 0.7, 1800, 'highpass');
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(190, t);
      g.gain.setValueAtTime(vol * 0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc.connect(g); g.connect(out);
      osc.start(t); osc.stop(t + 0.16);
    } else if (voice === 'hat') {
      this._noiseBurst(t, 0.05, out, vol * 0.4, 8000, 'highpass');
    } else if (voice === 'openhat') {
      this._noiseBurst(t, 0.3, out, vol * 0.35, 7000, 'highpass');
    } else if (voice === 'clap') {
      this._noiseBurst(t, 0.12, out, vol * 0.5, 1200, 'bandpass');
    } else if (voice === 'tom') {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(90, t + 0.2);
      g.gain.setValueAtTime(vol * 0.8, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      osc.connect(g); g.connect(out);
      osc.start(t); osc.stop(t + 0.3);
    }
  }

  _noiseBurst(t, dur, out, vol, filterFreq, filterType) {
    const ctx = this.ctx;
    const frames = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter); filter.connect(g); g.connect(out);
    src.start(t); src.stop(t + dur + 0.02);
    return src;
  }

  // --- Metrónomo --------------------------------------------------------------
  _click(when, accent) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.3, when + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    osc.connect(g); g.connect(this.master);
    osc.start(when); osc.stop(when + 0.06);
  }

  // --- Transporte / scheduler -------------------------------------------------
  play() {
    this.ensureContext();
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.loopStartTime = this.ctx.currentTime + 0.1;
    this.currentIteration = -1;
    this._scheduleIteration(0, this.loopStartTime);
    this.currentIteration = 0;
    this._timer = setInterval(() => this._tick(), 25);
  }

  stop() {
    this.isPlaying = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    // Cortar fuentes de audio (mic) que puedan seguir sonando.
    const now = this.ctx ? this.ctx.currentTime : 0;
    this._activeSources.forEach((s) => { try { s.stop(now); } catch (e) {} });
    this._activeSources = [];
  }

  _tick() {
    if (!this.isPlaying) return;
    const d = this.loopDuration;
    const nextStart = this.loopStartTime + (this.currentIteration + 1) * d;
    if (nextStart < this.ctx.currentTime + this.lookahead) {
      this._scheduleIteration(this.currentIteration + 1, nextStart);
      this.currentIteration++;
    }
  }

  // Agenda una pasada completa del loop con inicio en iterStart (tiempo del ctx).
  _scheduleIteration(iteration, iterStart) {
    const d = this.loopDuration;
    const beat = this.beatDuration;
    const totalBeats = this.bars * this.beatsPerBar;

    // Metrónomo.
    if (this.metronomeOn) {
      for (let b = 0; b < totalBeats; b++) {
        const when = iterStart + b * beat;
        const accent = (b % this.beatsPerBar) === 0;
        this._click(when, accent);
      }
    }

    // ¿Hay alguna pista en solo?
    const anySolo = this.tracks.some((t) => t.solo);

    // Eventos de cada pista.
    this.tracks.forEach((track) => {
      const audible = anySolo ? track.solo : !track.muted;
      if (!audible) return;

      if (track.kind === 'audio' && track.buffer) {
        const src = this.ctx.createBufferSource();
        src.buffer = track.buffer;
        src.connect(track.gain || this.master);
        src.start(iterStart);
        this._activeSources.push(src);
        return;
      }

      const dest = track.gain || this.master;
      (track.events || []).forEach((ev) => {
        const when = iterStart + ev.time;
        if (track.kind === 'drum') {
          this.playDrum(ev.voice, when, dest, ev.velocity);
        } else {
          this.playNote(track.instrument, ev.midi, when, ev.dur, dest, ev.velocity);
        }
      });
    });

    // Avisar a la UI en cada beat para animar el playhead.
    if (this.onBeat) {
      for (let b = 0; b < totalBeats; b++) {
        const when = iterStart + b * beat - this.ctx.currentTime;
        const idx = b;
        setTimeout(() => {
          if (this.isPlaying && this.onBeat) this.onBeat(idx, totalBeats);
        }, Math.max(0, when * 1000));
      }
    }
  }

  // Posición cuantizada para grabar: devuelve el tiempo del evento dentro del loop.
  quantize(time, division) {
    if (!division) return time;
    const step = this.beatDuration / division; // division = subdivisiones por beat
    return Math.round(time / step) * step % this.loopDuration;
  }

  createTrackGain() {
    this.ensureContext();
    const g = this.ctx.createGain();
    g.gain.value = 0.9;
    g.connect(this.master);
    return g;
  }

  async decodeAudio(arrayBuffer) {
    this.ensureContext();
    return await this.ctx.decodeAudioData(arrayBuffer);
  }
}

// Export global simple (sin módulos, igual que el resto del repo).
window.AudioEngine = AudioEngine;
window.INSTRUMENTS = INSTRUMENTS;
window.midiToName = midiToName;
window.midiToFreq = midiToFreq;
