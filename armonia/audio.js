/* ==========================================================================
   ARMONÍA · motor de sonido (Web Audio) — modelo Orchid
   Sonidos (presets) · Bajo · Batería sintetizada · FX master · Reloj
   ========================================================================== */
(function (global) {
  'use strict';

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const SOUNDS = {
    keys:    { name: 'Keys',     oscs: [{ t: 'sine', r: 1, g: .55 }, { t: 'triangle', r: 1, d: 6, g: .3 }, { t: 'sine', r: 2, g: .12 }], a: .004, dcy: 1.1, s: .3, rel: .9, cut: 2200, env: 2600, q: .7 },
    epiano:  { name: 'E-Piano',  oscs: [{ t: 'sine', r: 1, g: .5 }, { t: 'sine', r: 2, g: .2 }, { t: 'sine', r: 14, g: .04 }], a: .003, dcy: 1.4, s: .2, rel: .8, cut: 3000, env: 3000, q: .6 },
    organ:   { name: 'Organ',    oscs: [{ t: 'sine', r: 1, g: .45 }, { t: 'sine', r: 2, g: .3 }, { t: 'sine', r: 3, g: .14 }, { t: 'sine', r: 4, g: .1 }], a: .01, dcy: .1, s: 1, rel: .12, cut: 6000, env: 0, q: .5 },
    pad:     { name: 'Pad',      oscs: [{ t: 'sawtooth', r: 1, d: -9, g: .22 }, { t: 'sawtooth', r: 1, d: 9, g: .22 }, { t: 'triangle', r: .5, g: .3 }], a: .55, dcy: 1, s: .85, rel: 1.8, cut: 800, env: 700, q: .6 },
    strings: { name: 'Strings',  oscs: [{ t: 'sawtooth', r: 1, d: -5, g: .2 }, { t: 'sawtooth', r: 1, d: 5, g: .2 }, { t: 'sawtooth', r: 2, d: 3, g: .08 }], a: .3, dcy: .5, s: .9, rel: 1.2, cut: 1600, env: 400, q: .5 },
    pluck:   { name: 'Pluck',    oscs: [{ t: 'sawtooth', r: 1, g: .3 }, { t: 'square', r: 1, d: 4, g: .14 }], a: .002, dcy: .32, s: 0, rel: .3, cut: 500, env: 3800, q: 2 },
    brass:   { name: 'Brass',    oscs: [{ t: 'sawtooth', r: 1, d: -6, g: .28 }, { t: 'sawtooth', r: 1, d: 6, g: .28 }], a: .07, dcy: .3, s: .75, rel: .35, cut: 600, env: 2600, q: 1.2 },
    bells:   { name: 'Bells',    oscs: [{ t: 'sine', r: 1, g: .5 }, { t: 'sine', r: 3.5, g: .18 }, { t: 'sine', r: 5.4, g: .07 }], a: .002, dcy: 1.8, s: 0, rel: 1.8, cut: 7000, env: 0, q: .5 },
  };

  const FX = {
    dry:    { name: 'Dry',    rev: [.4, 0],   dly: [.375, 0, 0],   wob: 0,    drive: 0,   cut: 1 },
    room:   { name: 'Room',   rev: [.35, .28], dly: [.375, 0, 0],  wob: 0,    drive: 0,   cut: 1 },
    hall:   { name: 'Hall',   rev: [.85, .5], dly: [.375, 0, 0],   wob: 0,    drive: 0,   cut: .95 },
    echo:   { name: 'Echo',   rev: [.4, .2],  dly: [.75, .45, .35], wob: 0,   drive: 0,   cut: 1 },
    tape:   { name: 'Tape',   rev: [.5, .25], dly: [.5, .55, .4],  wob: .006, drive: .12, cut: .8 },
    chorus: { name: 'Chorus', rev: [.4, .18], dly: [.018, 0, .5],  wob: .004, drive: 0,   cut: 1 },
    lofi:   { name: 'Lo-fi',  rev: [.3, .3],  dly: [.375, .3, .2], wob: .003, drive: .35, cut: .55 },
  };

  class Engine {
    constructor() {
      this.ctx = null; this.ready = false;
      this.sound = 'keys'; this.fx = 'room'; this.fxAmount = .6;
      this.voices = []; this.bassVoice = null;
      this.levels = { chord: .8, bass: .8, drums: .7, master: .8 };
    }

    init() {
      if (this.ready) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));

      this.chordBus = ctx.createGain(); this.chordBus.gain.value = this.levels.chord;
      this.bassBus = ctx.createGain(); this.bassBus.gain.value = this.levels.bass;
      this.drumBus = ctx.createGain(); this.drumBus.gain.value = this.levels.drums;
      this.mix = ctx.createGain(); this.chordBus.connect(this.mix); this.bassBus.connect(this.mix);

      // drive
      this.shaper = ctx.createWaveShaper(); this.shaper.oversample = '2x';
      this.driveWet = ctx.createGain(); this.driveDry = ctx.createGain();
      this.mix.connect(this.shaper); this.shaper.connect(this.driveWet); this.mix.connect(this.driveDry);

      // filtro
      this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.Q.value = .7;
      this.driveWet.connect(this.filter); this.driveDry.connect(this.filter);

      // delay + wobble
      this.dlySend = ctx.createGain(); this.delay = ctx.createDelay(2); this.dlyFb = ctx.createGain();
      this.dlyTone = ctx.createBiquadFilter(); this.dlyTone.type = 'lowpass'; this.dlyTone.frequency.value = 3000;
      this.dlyReturn = ctx.createGain();
      this.filter.connect(this.dlySend); this.dlySend.connect(this.delay); this.delay.connect(this.dlyTone);
      this.dlyTone.connect(this.dlyFb); this.dlyFb.connect(this.delay); this.dlyTone.connect(this.dlyReturn);
      this.wobble = ctx.createOscillator(); this.wobble.frequency.value = .8; this.wobbleAmt = ctx.createGain(); this.wobbleAmt.gain.value = 0;
      this.wobble.connect(this.wobbleAmt); this.wobbleAmt.connect(this.delay.delayTime); this.wobble.start();

      // reverb
      this.revSend = ctx.createGain(); this.conv = ctx.createConvolver(); this.revReturn = ctx.createGain();
      this.filter.connect(this.revSend); this.revSend.connect(this.conv); this.conv.connect(this.revReturn);

      // master
      this.master = ctx.createGain(); this.master.gain.value = this.levels.master;
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -6; this.limiter.knee.value = 8; this.limiter.ratio.value = 5; this.limiter.attack.value = .004; this.limiter.release.value = .18;
      this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024;
      this.filter.connect(this.master); this.dlyReturn.connect(this.master); this.revReturn.connect(this.master); this.drumBus.connect(this.master);
      this.master.connect(this.limiter); this.limiter.connect(this.analyser); this.analyser.connect(ctx.destination);

      this.metroGain = ctx.createGain(); this.metroGain.gain.value = .3; this.metroGain.connect(this.limiter);
      this.noise = this._noiseBuffer();
      this.ready = true;
      this.applyFx();
    }
    resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }
    now() { return this.ctx ? this.ctx.currentTime : 0; }

    _noiseBuffer() {
      const len = this.ctx.sampleRate * 1.5, b = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return b;
    }

    // ------------------------------------------------------------ niveles / FX
    setLevel(k, v) { this.levels[k] = v; if (!this.ready) return; const n = { chord: this.chordBus, bass: this.bassBus, drums: this.drumBus, master: this.master }[k]; n.gain.setTargetAtTime(v, this.now(), .02); }
    setSound(id) { if (SOUNDS[id]) this.sound = id; }
    setFx(id, amount) {
      if (FX[id]) this.fx = id;
      if (amount != null) this.fxAmount = amount;
      this.applyFx();
    }
    setTempo(bpm) { this.bpm = bpm; this.applyFx(); }
    applyFx() {
      if (!this.ready) return;
      const p = FX[this.fx], a = this.fxAmount, t = this.now(), bpm = this.bpm || 96;
      // reverb
      this._setIr(p.rev[0]);
      this.revReturn.gain.setTargetAtTime(p.rev[1] * a * 1.4, t, .05);
      // delay (tiempo en negras salvo el chorus, en segundos)
      const time = p.dly[0] < .1 ? p.dly[0] : (60 / bpm) * p.dly[0];
      this.delay.delayTime.setTargetAtTime(clamp(time, .005, 1.9), t, .05);
      this.dlyFb.gain.setTargetAtTime(p.dly[1] * (0.5 + a * .6), t, .05);
      this.dlyReturn.gain.setTargetAtTime(p.dly[2] * a * 1.4, t, .05);
      this.wobbleAmt.gain.setTargetAtTime(p.wob * (0.3 + a), t, .05);
      this.wobble.frequency.setTargetAtTime(this.fx === 'chorus' ? 1.3 : .7, t, .05);
      // drive
      const d = p.drive * a, k = 1 + d * 60, n = 512, curve = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
      this.shaper.curve = curve;
      this.driveWet.gain.setTargetAtTime(d > .01 ? .6 : 0, t, .02); this.driveDry.gain.setTargetAtTime(d > .01 ? .5 : 1, t, .02);
      // filtro
      const cut = 1 - (1 - p.cut) * a;
      this.filter.frequency.setTargetAtTime(200 * Math.pow(2, cut * 6.6), t, .05);
    }
    _setIr(size) {
      if (this._irSize === size) return;
      this._irSize = size;
      const ctx = this.ctx, sr = ctx.sampleRate, len = Math.floor(sr * (.3 + size * 4.2));
      const ir = ctx.createBuffer(2, len, sr);
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        for (let i = 0; i < len; i++) { const x = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, 2 + (1 - size) * 3) * (i < 200 ? i / 200 : 1); }
      }
      this.conv.buffer = ir;
    }

    // ------------------------------------------------------------ voces de acorde
    /** Dispara una nota con el preset de sonido actual. Devuelve la voz. */
    noteOn(midi, vel = .8, time = this.now(), opts = {}) {
      if (!this.ready) return null;
      const ctx = this.ctx, P = SOUNDS[this.sound], f0 = mtof(midi);
      const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.Q.value = P.q;
      filt.frequency.setValueAtTime(P.cut + P.env * vel, time);
      filt.frequency.setTargetAtTime(P.cut, time + P.a, Math.max(.05, P.dcy / 3));
      const vca = ctx.createGain();
      const peak = .28 * (0.35 + vel * .65), sus = peak * P.s;
      vca.gain.setValueAtTime(.0001, time);
      vca.gain.linearRampToValueAtTime(peak, time + P.a);
      vca.gain.setTargetAtTime(Math.max(sus, .0001), time + P.a, P.dcy / 3);
      const oscs = P.oscs.map((o) => {
        const osc = ctx.createOscillator(); osc.type = o.t; osc.frequency.setValueAtTime(f0 * o.r, time); osc.detune.value = o.d || 0; osc._base = o.d || 0;
        const g = ctx.createGain(); g.gain.value = o.g; osc.connect(g); g.connect(filt); osc.start(time); return osc;
      });
      filt.connect(vca); vca.connect(this.chordBus);
      const v = { midi, vca, oscs, rel: P.rel * (opts.relMul || 1), sustain: P.s };
      this.voices.push(v);
      if (opts.gate) this.noteOff(v, time + opts.gate);
      else if (P.s === 0) this.noteOff(v, time + P.a + P.dcy * 1.5, true); // percusivos: apagar solos
      return v;
    }
    noteOff(v, time = this.now(), silent) {
      if (!v || v.off) return;
      v.off = true;
      const t = Math.max(time, this.now());
      if (!silent) { v.vca.gain.cancelScheduledValues(t); v.vca.gain.setValueAtTime(Math.max(v.vca.gain.value, .0001), t); }
      v.vca.gain.setTargetAtTime(.0001, t, v.rel / 4);
      const end = t + v.rel + .2;
      for (const o of v.oscs) { try { o.stop(end); } catch (e) { /* noop */ } }
      const i = this.voices.indexOf(v); if (i >= 0) this.voices.splice(i, 1);
      setTimeout(() => { try { v.vca.disconnect(); } catch (e) { /* noop */ } }, (end - this.now()) * 1000 + 60);
    }
    releaseAll(time = this.now()) { for (const v of this.voices.slice()) this.noteOff(v, time); }
    releaseNote(midi, time = this.now()) { for (const v of this.voices.slice()) if (v.midi === midi) this.noteOff(v, time); }

    bend(semis) {
      if (!this.ready) return;
      const t = this.now();
      for (const v of [...this.voices, this.bassVoice].filter(Boolean)) for (const o of v.oscs) o.detune.setTargetAtTime((o._base || 0) + semis * 100, t, .01);
    }

    // ------------------------------------------------------------ bajo
    bassOn(midi, time = this.now(), vel = 1) {
      if (!this.ready) return;
      const ctx = this.ctx;
      if (this.bassVoice) this._bassOff(this.bassVoice, time);
      const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.setValueAtTime(mtof(midi), time);
      const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.setValueAtTime(mtof(midi), time);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2.5;
      f.frequency.setValueAtTime(1400, time); f.frequency.setTargetAtTime(220, time, .14);
      const sub = ctx.createGain(); sub.gain.value = .75; const saw = ctx.createGain(); saw.gain.value = .3;
      o1.connect(sub); o2.connect(saw); saw.connect(f);
      const g = ctx.createGain();
      g.gain.setValueAtTime(.0001, time); g.gain.exponentialRampToValueAtTime(.55 * vel, time + .006); g.gain.setTargetAtTime(.0001, time + .05, .45);
      sub.connect(g); f.connect(g); g.connect(this.bassBus);
      o1.start(time); o2.start(time); o1.stop(time + 2.2); o2.stop(time + 2.2);
      this.bassVoice = { midi, vca: g, oscs: [o1, o2] };
    }
    _bassOff(v, time) { v.vca.gain.cancelScheduledValues(time); v.vca.gain.setValueAtTime(Math.max(v.vca.gain.value, .0001), time); v.vca.gain.setTargetAtTime(.0001, time, .02); for (const o of v.oscs) { try { o.stop(time + .15); } catch (e) { /* noop */ } } }

    // ------------------------------------------------------------ batería
    kick(t, vel = 1) {
      const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(42, t + .11);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(1.1 * vel, t + .004); g.gain.exponentialRampToValueAtTime(.0001, t + .38);
      o.connect(g); g.connect(this.drumBus); o.start(t); o.stop(t + .4);
    }
    snare(t, vel = 1) {
      const ctx = this.ctx, n = ctx.createBufferSource(); n.buffer = this.noise;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = .8;
      const g = ctx.createGain(); g.gain.setValueAtTime(.7 * vel, t); g.gain.exponentialRampToValueAtTime(.0001, t + .2);
      n.connect(f); f.connect(g); g.connect(this.drumBus); n.start(t); n.stop(t + .22);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(230, t); o.frequency.exponentialRampToValueAtTime(150, t + .08);
      og.gain.setValueAtTime(.5 * vel, t); og.gain.exponentialRampToValueAtTime(.0001, t + .12); o.connect(og); og.connect(this.drumBus); o.start(t); o.stop(t + .14);
    }
    hat(t, open, vel = 1) {
      const ctx = this.ctx, n = ctx.createBufferSource(); n.buffer = this.noise;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
      const g = ctx.createGain(); const d = open ? .32 : .05;
      g.gain.setValueAtTime(.3 * vel, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
      n.connect(f); f.connect(g); g.connect(this.drumBus); n.start(t); n.stop(t + d + .02);
    }
    rim(t, vel = 1) {
      const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square'; o.frequency.value = 820;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 3;
      g.gain.setValueAtTime(.5 * vel, t); g.gain.exponentialRampToValueAtTime(.0001, t + .04);
      o.connect(f); f.connect(g); g.connect(this.drumBus); o.start(t); o.stop(t + .05);
    }
    clap(t, vel = 1) { for (let i = 0; i < 3; i++) this.snare(t + i * .012, vel * .45); }

    metronome(time, accent) {
      if (!this.ready) return;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'sine'; o.frequency.value = accent ? 1760 : 1320;
      g.gain.setValueAtTime(.0001, time); g.gain.exponentialRampToValueAtTime(.5, time + .002); g.gain.exponentialRampToValueAtTime(.0001, time + .05);
      o.connect(g); g.connect(this.metroGain); o.start(time); o.stop(time + .06);
    }
    scope(arr) { if (this.ready) this.analyser.getFloatTimeDomainData(arr); }
  }

  /* ---------------------------------------------------------- reloj (24 ticks por negra) */
  class Clock {
    constructor(engine) { this.engine = engine; this.bpm = 96; this.running = false; this.tick = 0; this.nextTime = 0; this.listeners = []; this.lookahead = .12; this._timer = null; }
    get tickSec() { return 60 / this.bpm / 24; }
    on(fn) { this.listeners.push(fn); }
    start() {
      if (this.running) return;
      this.engine.init(); this.engine.resume();
      this.running = true; this.tick = 0; this.nextTime = this.engine.now() + .05;
      this._timer = setInterval(() => this._schedule(), 25);
    }
    stop() { this.running = false; clearInterval(this._timer); }
    nowTick() { return Math.max(0, this.tick - Math.round((this.nextTime - this.engine.now()) / this.tickSec)); }
    _schedule() {
      const now = this.engine.now();
      while (this.nextTime < now + this.lookahead) {
        for (const fn of this.listeners) fn(this.tick, this.nextTime);
        this.nextTime += this.tickSec; this.tick++;
      }
    }
  }

  global.Engine = Engine; global.Clock = Clock; global.SOUNDS = SOUNDS; global.FX = FX; global.mtof = mtof;
})(window);
