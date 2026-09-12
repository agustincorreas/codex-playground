/* ==========================================================================
   ARMONÍA · motor de sonido (Web Audio)
   Keys · Bass · Arp · Pad → Drive → Filtro → Delay / Reverb → Master
   Fuentes de modulación: LFO · ENV · CLOCK · STRUM · RANDOM (patch bay)
   ========================================================================== */
(function (global) {
  'use strict';

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  class Engine {
    constructor() {
      this.ctx = null;
      this.ready = false;
      this.params = {
        keys: { level: 0.7, wave: 'sawtooth', attack: 0.01, release: 0.6, tone: 0.6, on: true },
        bass: { level: 0.8, decay: 0.5, tone: 0.5, on: true },
        arp:  { level: 0.55, gate: 0.5, tone: 0.7, on: true },
        pad:  { level: 0.5, swell: 0.5, detune: 0.4, tone: 0.35, on: true },
        fx:   { drive: 0.15, cutoff: 0.8, res: 0.15, dlyTime: 0.375, dlyFb: 0.35, dlyMix: 0.25, revSize: 0.6, revMix: 0.3, master: 0.8 },
        mod:  { lfoRate: 0.3, lfoShape: 'sine', envDecay: 0.4 },
      };
      this.voices = { keys: [], pad: [], arp: [], bass: null };
      this.cables = [];
    }

    init() {
      if (this.ready) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
      const P = this.params;

      // --- buses de módulos
      this.bus = {};
      for (const m of ['keys', 'bass', 'arp', 'pad']) {
        this.bus[m] = ctx.createGain();
        this.bus[m].gain.value = P[m].level;
      }
      this.mix = ctx.createGain();
      for (const m in this.bus) this.bus[m].connect(this.mix);

      // --- drive (waveshaper con dry/wet)
      this.drivePre = ctx.createGain();
      this.shaper = ctx.createWaveShaper();
      this.shaper.oversample = '2x';
      this.driveWet = ctx.createGain();
      this.driveDry = ctx.createGain();
      this.mix.connect(this.drivePre); this.drivePre.connect(this.shaper); this.shaper.connect(this.driveWet);
      this.mix.connect(this.driveDry);
      this.setDrive(P.fx.drive);

      // --- filtro master (2 polos en serie ≈ 24 dB)
      this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass';
      this.filter2 = ctx.createBiquadFilter(); this.filter2.type = 'lowpass';
      this.driveWet.connect(this.filter); this.driveDry.connect(this.filter);
      this.filter.connect(this.filter2);
      this.setCutoff(P.fx.cutoff); this.setRes(P.fx.res);

      // --- delay
      this.dlySend = ctx.createGain();
      this.delay = ctx.createDelay(2.0);
      this.dlyFb = ctx.createGain();
      this.dlyTone = ctx.createBiquadFilter(); this.dlyTone.type = 'lowpass'; this.dlyTone.frequency.value = 3200;
      this.dlyReturn = ctx.createGain();
      this.filter2.connect(this.dlySend); this.dlySend.connect(this.delay);
      this.delay.connect(this.dlyTone); this.dlyTone.connect(this.dlyFb); this.dlyFb.connect(this.delay);
      this.dlyTone.connect(this.dlyReturn);
      this.delay.delayTime.value = P.fx.dlyTime; this.dlyFb.gain.value = P.fx.dlyFb; this.dlyReturn.gain.value = P.fx.dlyMix;

      // --- reverb (convolución con IR sintética)
      this.revSend = ctx.createGain();
      this.conv = ctx.createConvolver();
      this.revReturn = ctx.createGain();
      this.filter2.connect(this.revSend); this.revSend.connect(this.conv); this.conv.connect(this.revReturn);
      this.revReturn.gain.value = P.fx.revMix;
      this.setReverbSize(P.fx.revSize);

      // --- master
      this.pan = ctx.createStereoPanner();
      this.master = ctx.createGain(); this.master.gain.value = P.fx.master;
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -8; this.limiter.knee.value = 6; this.limiter.ratio.value = 6;
      this.limiter.attack.value = 0.004; this.limiter.release.value = 0.2;
      this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024;
      this.filter2.connect(this.pan); this.dlyReturn.connect(this.pan); this.revReturn.connect(this.pan);
      this.pan.connect(this.master); this.master.connect(this.limiter);
      this.limiter.connect(this.analyser); this.analyser.connect(ctx.destination);

      // --- metrónomo (salida aux)
      this.metroGain = ctx.createGain(); this.metroGain.gain.value = 0.35; this.metroGain.connect(this.limiter);

      // --- buses de modulación para destinos "fan-out"
      this.vibratoBus = ctx.createGain(); this.vibratoBus.gain.value = 1;      // cents → detune de todas las voces
      this.padDetuneBus = ctx.createGain(); this.padDetuneBus.gain.value = 1;  // cents → detune del pad

      // --- fuentes de modulación
      this.lfo = ctx.createOscillator(); this.lfo.type = P.mod.lfoShape;
      this.lfo.frequency.value = this.lfoHz(P.mod.lfoRate);
      this.lfoOut = ctx.createGain(); this.lfoOut.gain.value = 1; this.lfo.connect(this.lfoOut); this.lfo.start();

      const cs = (v) => { const n = ctx.createConstantSource(); n.offset.value = v; n.start(); return n; };
      this.envSrc = cs(0);
      this.clockSrc = cs(0);
      this.strumSrc = cs(0);
      this.randSrc = cs(0);

      this.sources = {
        lfo:   { node: this.lfoOut, color: '#9ad7c2' },
        env:   { node: this.envSrc, color: '#f4b28e' },
        clock: { node: this.clockSrc, color: '#c9b8f2' },
        strum: { node: this.strumSrc, color: '#f0d27a' },
        rand:  { node: this.randSrc, color: '#f0a7bf' },
      };
      this.dests = {
        cutoff:   { params: [this.filter.frequency, this.filter2.frequency], scale: 2600 },
        pitch:    { params: [this.vibratoBus], scale: 60, bus: true },
        trem:     { params: [this.bus.keys.gain], scale: 0.5 },
        dlyTime:  { params: [this.delay.delayTime], scale: 0.012 },
        dlyMix:   { params: [this.dlyReturn.gain], scale: 0.5 },
        revMix:   { params: [this.revReturn.gain], scale: 0.5 },
        padDet:   { params: [this.padDetuneBus], scale: 25, bus: true },
        pan:      { params: [this.pan.pan], scale: 0.9 },
      };
      this.ready = true;
    }

    resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }
    now() { return this.ctx ? this.ctx.currentTime : 0; }

    // ------------------------------------------------------------ parámetros
    setLevel(m, v) { this.params[m].level = v; if (this.ready) this.bus[m].gain.setTargetAtTime(v, this.now(), 0.02); }
    setDrive(v) {
      this.params.fx.drive = v;
      if (!this.ready) return;
      const k = 1 + v * 40, n = 1024, curve = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
      this.shaper.curve = curve;
      this.drivePre.gain.value = 1 + v * 2;
      this.driveWet.gain.setTargetAtTime(v > 0.02 ? 0.35 + v * 0.35 : 0, this.now(), 0.02);
      this.driveDry.gain.setTargetAtTime(v > 0.02 ? 1 - v * 0.5 : 1, this.now(), 0.02);
    }
    setCutoff(v) {
      this.params.fx.cutoff = v;
      if (!this.ready) return;
      const hz = 60 * Math.pow(2, v * 8.2);
      this.filter.frequency.setTargetAtTime(hz, this.now(), 0.02);
      this.filter2.frequency.setTargetAtTime(hz, this.now(), 0.02);
    }
    setRes(v) { this.params.fx.res = v; if (this.ready) { this.filter.Q.value = 0.5 + v * 8; this.filter2.Q.value = 0.5 + v * 3; } }
    setDelayTime(sec) { this.params.fx.dlyTime = sec; if (this.ready) this.delay.delayTime.setTargetAtTime(clamp(sec, 0.01, 1.9), this.now(), 0.05); }
    setDelayFb(v) { this.params.fx.dlyFb = v; if (this.ready) this.dlyFb.gain.setTargetAtTime(v * 0.9, this.now(), 0.02); }
    setDelayMix(v) { this.params.fx.dlyMix = v; if (this.ready) this.dlyReturn.gain.setTargetAtTime(v, this.now(), 0.02); }
    setReverbMix(v) { this.params.fx.revMix = v; if (this.ready) this.revReturn.gain.setTargetAtTime(v, this.now(), 0.02); }
    setReverbSize(v) {
      this.params.fx.revSize = v;
      if (!this.ready) return;
      clearTimeout(this._irT);
      this._irT = setTimeout(() => {
        const ctx = this.ctx, sr = ctx.sampleRate, len = Math.floor(sr * (0.4 + v * 4.5));
        const ir = ctx.createBuffer(2, len, sr);
        for (let c = 0; c < 2; c++) {
          const d = ir.getChannelData(c);
          for (let i = 0; i < len; i++) {
            const t = i / len;
            d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2 + (1 - v) * 3) * (i < 300 ? i / 300 : 1);
          }
        }
        this.conv.buffer = ir;
      }, 60);
    }
    setMaster(v) { this.params.fx.master = v; if (this.ready) this.master.gain.setTargetAtTime(v, this.now(), 0.02); }
    setPan(v) { if (this.ready) this.pan.pan.setTargetAtTime(v, this.now(), 0.02); }
    lfoHz(v) { return 0.05 * Math.pow(2, v * 7.6); }
    setLfoRate(v) { this.params.mod.lfoRate = v; if (this.ready) this.lfo.frequency.setTargetAtTime(this.lfoHz(v), this.now(), 0.05); }
    setLfoShape(s) { this.params.mod.lfoShape = s; if (this.ready) this.lfo.type = s; }
    setEnvDecay(v) { this.params.mod.envDecay = v; }

    // ------------------------------------------------------------ patch bay
    connect(srcId, dstId, amount = 0.6) {
      if (!this.ready) return null;
      if (this.cables.find((c) => c.src === srcId && c.dst === dstId)) return null;
      const src = this.sources[srcId], dst = this.dests[dstId];
      const g = this.ctx.createGain();
      g.gain.value = dst.scale * amount;
      src.node.connect(g);
      for (const p of dst.params) g.connect(p);
      const cable = { src: srcId, dst: dstId, amount, gain: g, color: src.color };
      this.cables.push(cable);
      return cable;
    }
    disconnect(cable) {
      const i = this.cables.indexOf(cable);
      if (i < 0) return;
      try { cable.gain.disconnect(); this.sources[cable.src].node.disconnect(cable.gain); } catch (e) { /* noop */ }
      this.cables.splice(i, 1);
    }
    setAmount(dstId, amount) {
      for (const c of this.cables) if (c.dst === dstId) { c.amount = amount; c.gain.gain.setTargetAtTime(this.dests[dstId].scale * amount, this.now(), 0.02); }
    }

    // ------------------------------------------------------------ fuentes
    triggerEnv() {
      if (!this.ready) return;
      const t = this.now(), o = this.envSrc.offset;
      o.cancelScheduledValues(t); o.setValueAtTime(o.value, t);
      o.linearRampToValueAtTime(1, t + 0.012);
      o.setTargetAtTime(0, t + 0.012, 0.05 + this.params.mod.envDecay * 1.4);
    }
    pulseClock(time, accent) {
      if (!this.ready) return;
      const o = this.clockSrc.offset;
      o.setValueAtTime(accent ? 1 : 0.7, time);
      o.setTargetAtTime(0, time + 0.005, 0.06);
    }
    setStrum(v) { if (this.ready) this.strumSrc.offset.setTargetAtTime(v, this.now(), 0.01); }
    sampleRandom() { if (this.ready) this.randSrc.offset.setTargetAtTime(Math.random() * 2 - 1, this.now(), 0.005); }

    metronome(time, accent) {
      if (!this.ready) return;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'sine'; o.frequency.value = accent ? 1760 : 1320;
      g.gain.setValueAtTime(0.0001, time); g.gain.exponentialRampToValueAtTime(0.6, time + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
      o.connect(g); g.connect(this.metroGain); o.start(time); o.stop(time + 0.06);
    }

    // ------------------------------------------------------------ voces
    _osc(type, midi, detuneCents, time) {
      const o = this.ctx.createOscillator();
      o.type = type; o.frequency.setValueAtTime(mtof(midi), time); o.detune.value = detuneCents; o._base = detuneCents;
      this.vibratoBus.connect(o.detune);
      o.start(time);
      return o;
    }

    /** KEYS: 2 osciladores desafinados, filtro por voz, ADSR. */
    keysOn(midi, vel = 0.8, time = this.now()) {
      if (!this.ready || !this.params.keys.on) return null;
      const P = this.params.keys, ctx = this.ctx;
      const o1 = this._osc(P.wave, midi, -5, time), o2 = this._osc(P.wave === 'sine' ? 'triangle' : P.wave, midi, 6, time);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass';
      const fc = 300 * Math.pow(2, P.tone * 5.5);
      f.frequency.setValueAtTime(fc * 2.5, time); f.frequency.setTargetAtTime(fc, time + 0.005, 0.25); f.Q.value = 0.7;
      const g = ctx.createGain();
      const a = 0.004 + P.attack * 1.2;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.28 * vel, time + a);
      g.gain.setTargetAtTime(0.16 * vel, time + a, 0.9);
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.bus.keys);
      const v = { midi, g, oscs: [o1, o2], module: 'keys' };
      this.voices.keys.push(v);
      return v;
    }
    /** PAD: 3 saws desafinados + sub, swell lento. */
    padOn(midi, time = this.now()) {
      if (!this.ready || !this.params.pad.on) return null;
      const P = this.params.pad, ctx = this.ctx;
      const det = 4 + P.detune * 22;
      const oscs = [this._osc('sawtooth', midi, -det, time), this._osc('sawtooth', midi, det, time), this._osc('triangle', midi - 12, 0, time)];
      for (const o of oscs.slice(0, 2)) this.padDetuneBus.connect(o.detune);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 200 * Math.pow(2, P.tone * 5); f.Q.value = 0.5;
      const g = ctx.createGain();
      const a = 0.05 + P.swell * 2.5;
      g.gain.setValueAtTime(0.0001, time); g.gain.linearRampToValueAtTime(0.11, time + a);
      for (const o of oscs) o.connect(f);
      f.connect(g); g.connect(this.bus.pad);
      const v = { midi, g, oscs, module: 'pad' };
      this.voices.pad.push(v);
      return v;
    }
    /** ARP: pluck corto con gate. */
    arpNote(midi, time, gateSec) {
      if (!this.ready || !this.params.arp.on) return;
      const P = this.params.arp, ctx = this.ctx;
      const o1 = this._osc('square', midi, 0, time), o2 = this._osc('triangle', midi + 12, 3, time);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass';
      const fc = 400 * Math.pow(2, P.tone * 4.5);
      f.frequency.setValueAtTime(fc * 3, time); f.frequency.setTargetAtTime(fc * 0.6, time, 0.08); f.Q.value = 2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time); g.gain.exponentialRampToValueAtTime(0.22, time + 0.003);
      g.gain.setTargetAtTime(0.0001, time + gateSec, 0.03);
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.bus.arp);
      o1.stop(time + gateSec + 0.3); o2.stop(time + gateSec + 0.3);
    }
    /** BASS: monofónico, sub sine + saw con envolvente de filtro. */
    bassOn(midi, time = this.now()) {
      if (!this.ready || !this.params.bass.on) return;
      const P = this.params.bass, ctx = this.ctx;
      if (this.voices.bass) this._release(this.voices.bass, 0.05, time);
      const o1 = this._osc('sine', midi, 0, time), o2 = this._osc('sawtooth', midi, 0, time);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 3;
      const fc = 120 * Math.pow(2, P.tone * 4);
      f.frequency.setValueAtTime(fc * 4, time); f.frequency.setTargetAtTime(fc, time, 0.12);
      const sub = ctx.createGain(); sub.gain.value = 0.7; o1.connect(sub);
      const sawG = ctx.createGain(); sawG.gain.value = 0.35; o2.connect(sawG); sawG.connect(f);
      const g = ctx.createGain();
      const d = 0.15 + P.decay * 2.2;
      g.gain.setValueAtTime(0.0001, time); g.gain.exponentialRampToValueAtTime(0.5, time + 0.006);
      g.gain.setTargetAtTime(0.0001, time + 0.02, d / 3);
      sub.connect(g); f.connect(g); g.connect(this.bus.bass);
      const v = { midi, g, oscs: [o1, o2], module: 'bass' };
      this.voices.bass = v;
      setTimeout(() => { if (this.voices.bass === v) { this._stop(v, this.now() + 0.1); this.voices.bass = null; } }, (d + 0.5) * 1000);
    }

    _release(v, rel, time = this.now()) {
      if (!v || v.released) return;
      v.released = true;
      v.g.gain.cancelScheduledValues(time);
      v.g.gain.setValueAtTime(Math.max(v.g.gain.value, 0.0001), time);
      v.g.gain.setTargetAtTime(0.0001, time, rel / 4);
      this._stop(v, time + rel + 0.15);
    }
    _stop(v, when) {
      for (const o of v.oscs) { try { o.stop(when); } catch (e) { /* ya detenido */ } }
      setTimeout(() => { try { v.g.disconnect(); } catch (e) { /* noop */ } }, Math.max(0, (when - this.now()) * 1000 + 50));
    }
    releaseModule(m, time = this.now()) {
      const rel = m === 'keys' ? 0.05 + this.params.keys.release * 2.5 : 0.3 + this.params.pad.swell * 3;
      for (const v of this.voices[m]) this._release(v, rel, time);
      this.voices[m] = [];
    }
    releaseAll() { this.releaseModule('keys'); this.releaseModule('pad'); if (this.voices.bass) { this._release(this.voices.bass, 0.1); this.voices.bass = null; } }

    /** Pitch bend global (semitonos) sobre todas las voces activas. */
    bend(semis) {
      if (!this.ready) return;
      const t = this.now();
      const all = [...this.voices.keys, ...this.voices.pad, this.voices.bass].filter(Boolean);
      for (const v of all) for (const o of v.oscs) o.detune.setTargetAtTime((o._base || 0) + semis * 100, t, 0.01);
    }

    scope(arr) { if (this.ready) this.analyser.getFloatTimeDomainData(arr); }
  }

  /* ---------------------------------------------------------- reloj (24 ticks por negra) */
  class Clock {
    constructor(engine) {
      this.engine = engine; this.bpm = 96; this.running = false;
      this.tick = 0; this.nextTime = 0; this.listeners = [];
      this.lookahead = 0.12; this.interval = 25; this._timer = null;
    }
    get tickSec() { return 60 / this.bpm / 24; }
    on(fn) { this.listeners.push(fn); }
    start() {
      if (this.running) return;
      this.engine.init(); this.engine.resume();
      this.running = true; this.tick = 0; this.nextTime = this.engine.now() + 0.05;
      this._timer = setInterval(() => this._schedule(), this.interval);
    }
    stop() { this.running = false; clearInterval(this._timer); this._timer = null; }
    _schedule() {
      const now = this.engine.now();
      while (this.nextTime < now + this.lookahead) {
        for (const fn of this.listeners) fn(this.tick, this.nextTime);
        this.nextTime += this.tickSec; this.tick++;
      }
    }
  }

  global.Engine = Engine; global.Clock = Clock; global.mtof = mtof;
})(window);
