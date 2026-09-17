/* ==========================================================================
   ARMONÍA · motor de sonido (Web Audio) — modelo Orchid
   Sonidos (presets) · Bajo · Batería sintetizada · FX master · Reloj
   ========================================================================== */
(function (global) {
  'use strict';

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* Presets. oscs: t tipo · r ratio de frecuencia · d detune (cents) · g ganancia · fm {r ratio, i índice, dcy}
     unison {n, spread} · noise {g, dcy, hp} · vib {depth cents, rate, delay} · trem {depth, rate}
     formants [[hz, q, g]] · width (pan por voz) · chorus (0-1) · a/dcy/s/rel envolvente · cut/env/q filtro */
  const SOUNDS = {
    keys:    { name: 'Keys', oscs: [{ t: 'triangle', r: 1, g: .5 }, { t: 'sine', r: 2, g: .18 }, { t: 'sine', r: 3, g: .06 }, { t: 'sawtooth', r: 1, d: 3, g: .07 }],
               noise: { g: .12, dcy: .012, hp: 3000 }, a: .003, dcy: 1.6, s: .18, rel: .7, cut: 1400, env: 3200, q: .6, width: .5, chorus: .12 },
    epiano:  { name: 'E-Piano', oscs: [{ t: 'sine', r: 1, g: .55, fm: { r: 1, i: 1.6, dcy: .5 } }, { t: 'sine', r: 1, g: .25, fm: { r: 14, i: .25, dcy: .12 } }, { t: 'sine', r: 2, g: .08 }],
               noise: { g: .05, dcy: .01, hp: 2000 }, a: .002, dcy: 2.2, s: .12, rel: .8, cut: 5000, env: 2500, q: .5, trem: { depth: .18, rate: 4.8 }, width: .6, chorus: .2 },
    wurli:   { name: 'Wurli', oscs: [{ t: 'sine', r: 1, g: .5, fm: { r: 2, i: .9, dcy: .35 } }, { t: 'sawtooth', r: 1, g: .1 }, { t: 'sine', r: 3, g: .05 }],
               noise: { g: .06, dcy: .008, hp: 1500 }, a: .002, dcy: 1.4, s: .2, rel: .6, cut: 1800, env: 2200, q: .8, trem: { depth: .3, rate: 5.6 }, width: .3, chorus: .05 },
    organ:   { name: 'Organ', oscs: [{ t: 'sine', r: 1, g: .4 }, { t: 'sine', r: 2, g: .3 }, { t: 'sine', r: 3, g: .16 }, { t: 'sine', r: 4, g: .12 }, { t: 'sine', r: 6, g: .06 }, { t: 'sine', r: 8, g: .05 }],
               perc: { r: 3, g: .3, dcy: .25 }, a: .008, dcy: .1, s: 1, rel: .1, cut: 7000, env: 0, q: .5, vib: { depth: 6, rate: 6.4, delay: 0 }, width: .2, chorus: .45 },
    pad:     { name: 'Pad', oscs: [{ t: 'sawtooth', r: 1, g: .16, uni: true }, { t: 'square', r: .5, g: .12 }, { t: 'sawtooth', r: 2, d: 5, g: .04 }],
               unison: { n: 4, spread: 14 }, a: .7, dcy: 1, s: .85, rel: 2.2, cut: 700, env: 900, q: .7, vib: { depth: 5, rate: .4, delay: 0 }, width: .8, chorus: .7 },
    strings: { name: 'Strings', oscs: [{ t: 'sawtooth', r: 1, g: .16, uni: true }, { t: 'sawtooth', r: 2, d: 3, g: .05 }],
               unison: { n: 3, spread: 9 }, a: .35, dcy: .6, s: .9, rel: 1.4, cut: 1500, env: 600, q: .6, vib: { depth: 9, rate: 5.2, delay: .6 }, width: .7, chorus: .4 },
    choir:   { name: 'Choir', oscs: [{ t: 'sawtooth', r: 1, g: .22, uni: true }, { t: 'sawtooth', r: .5, g: .06 }],
               unison: { n: 3, spread: 7 }, formants: [[650, 9, 1], [1100, 12, .55], [2650, 14, .28]], a: .5, dcy: 1, s: .9, rel: 1.6, cut: 4500, env: 0, q: .5, vib: { depth: 12, rate: 4.8, delay: .9 }, width: .8, chorus: .5 },
    pluck:   { name: 'Pluck', oscs: [{ t: 'sawtooth', r: 1, g: .28 }, { t: 'square', r: 1, d: 5, g: .12 }, { t: 'triangle', r: 2, g: .06 }],
               noise: { g: .2, dcy: .015, hp: 1500 }, a: .002, dcy: .45, s: 0, rel: .35, cut: 400, env: 4200, q: 2.2, width: .5, chorus: .15 },
    guitar:  { name: 'Guitar', oscs: [{ t: 'triangle', r: 1, g: .4 }, { t: 'sawtooth', r: 1, d: -4, g: .12 }, { t: 'sine', r: 2, g: .12 }, { t: 'sine', r: 3, g: .05 }],
               noise: { g: .25, dcy: .01, hp: 2500 }, a: .002, dcy: 1.3, s: 0, rel: .5, cut: 900, env: 2800, q: 1.4, width: .5, chorus: .25 },
    brass:   { name: 'Brass', oscs: [{ t: 'sawtooth', r: 1, g: .22, uni: true }, { t: 'square', r: 1, d: 2, g: .05 }],
               unison: { n: 2, spread: 8 }, a: .06, dcy: .35, s: .75, rel: .3, cut: 500, env: 3000, q: 1.5, vib: { depth: 7, rate: 5.5, delay: .5 }, width: .4, chorus: .1 },
    bells:   { name: 'Bells', oscs: [{ t: 'sine', r: 1, g: .45, fm: { r: 3.5, i: 2.2, dcy: .9 } }, { t: 'sine', r: 2.76, g: .12 }, { t: 'sine', r: 5.4, g: .05 }],
               a: .002, dcy: 2.6, s: 0, rel: 2.2, cut: 9000, env: 0, q: .5, width: .8, chorus: .2 },
    marimba: { name: 'Marimba', oscs: [{ t: 'sine', r: 1, g: .5 }, { t: 'sine', r: 4, g: .14 }, { t: 'sine', r: 10, g: .03 }],
               noise: { g: .18, dcy: .006, hp: 1200 }, a: .001, dcy: .5, s: 0, rel: .3, cut: 6000, env: 0, q: .5, width: .6, chorus: .1 },
    clav:    { name: 'Clav', oscs: [{ t: 'square', r: 1, g: .22 }, { t: 'sawtooth', r: 1, d: 7, g: .14 }, { t: 'square', r: 2, g: .05 }],
               noise: { g: .15, dcy: .006, hp: 2500 }, a: .001, dcy: .7, s: .05, rel: .12, cut: 900, env: 5200, q: 3, width: .3, chorus: .05 },
    harp:    { name: 'Harp', oscs: [{ t: 'triangle', r: 1, g: .42 }, { t: 'sine', r: 2, g: .16 }, { t: 'sine', r: 3, g: .05 }, { t: 'sawtooth', r: 1, d: -3, g: .05 }],
               noise: { g: .1, dcy: .008, hp: 3500 }, a: .001, dcy: 2.2, s: 0, rel: 1.2, cut: 2600, env: 2400, q: .7, width: .8, chorus: .3 },
    vibes:   { name: 'Vibes', oscs: [{ t: 'sine', r: 1, g: .5 }, { t: 'sine', r: 4, g: .12, fm: { r: 1, i: .4, dcy: .3 } }, { t: 'sine', r: 10, g: .02 }],
               noise: { g: .08, dcy: .005, hp: 2000 }, a: .001, dcy: 2.4, s: 0, rel: 1.4, cut: 7000, env: 0, q: .5, trem: { depth: .35, rate: 4.2 }, width: .7, chorus: .15 },
    flute:   { name: 'Flute', oscs: [{ t: 'sine', r: 1, g: .5 }, { t: 'triangle', r: 1, d: 4, g: .18 }, { t: 'sine', r: 2, g: .06 }],
               noise: { g: .05, dcy: .12, hp: 2500 }, a: .09, dcy: .4, s: .85, rel: .3, cut: 2400, env: 800, q: .8, vib: { depth: 10, rate: 5, delay: .35 }, width: .4, chorus: .1 },
    poly80:  { name: 'Poly 80', oscs: [{ t: 'sawtooth', r: 1, g: .14, uni: true }, { t: 'square', r: 1, d: -7, g: .08 }, { t: 'sawtooth', r: .5, g: .06 }],
               unison: { n: 3, spread: 11 }, a: .02, dcy: .6, s: .6, rel: .5, cut: 1100, env: 2600, q: 1.1, width: .7, chorus: .6 },
    kalimba: { name: 'Kalimba', oscs: [{ t: 'sine', r: 1, g: .5 }, { t: 'sine', r: 5.9, g: .1 }, { t: 'sine', r: 2, g: .08 }],
               noise: { g: .2, dcy: .005, hp: 2500 }, a: .001, dcy: .8, s: 0, rel: .5, cut: 6000, env: 0, q: .5, width: .8, chorus: .2 },
    glass:   { name: 'Glass', oscs: [{ t: 'sine', r: 1, g: .38, fm: { r: 2.01, i: .7, dcy: 1.2 } }, { t: 'triangle', r: 2, d: 6, g: .12 }, { t: 'sine', r: 4, g: .05 }],
               a: .15, dcy: 2, s: .5, rel: 2.5, cut: 5000, env: 800, q: .5, vib: { depth: 3, rate: .25, delay: 0 }, width: .9, chorus: .7 },
    dream:   { name: 'Dream', oscs: [{ t: 'triangle', r: 1, g: .32, uni: true }, { t: 'sine', r: 2, g: .12 }, { t: 'sine', r: .5, g: .1 }],
               unison: { n: 3, spread: 10 }, a: .01, dcy: 2.5, s: .35, rel: 2.8, cut: 2500, env: 1500, q: .6, vib: { depth: 4, rate: .3, delay: 0 }, width: .9, chorus: .8 },
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

      // chorus estéreo del bus de acordes (dos delays modulados, uno por canal)
      this.chorusIn = ctx.createGain();
      this.chorusWet = ctx.createGain(); this.chorusWet.gain.value = .9;
      const merger = ctx.createChannelMerger(2);
      const mk = (base, rate, depth, ch) => {
        const d = ctx.createDelay(.1); d.delayTime.value = base;
        const l = ctx.createOscillator(); l.frequency.value = rate; const lg = ctx.createGain(); lg.gain.value = depth;
        l.connect(lg); lg.connect(d.delayTime); l.start();
        this.chorusIn.connect(d); d.connect(merger, 0, ch);
      };
      mk(.013, .55, .0028, 0); mk(.021, .83, .0034, 1);
      merger.connect(this.chorusWet); this.chorusWet.connect(this.mix);

      // LFOs compartidos para vibrato y trémolo
      this.vibLfo = ctx.createOscillator(); this.vibLfo.frequency.value = 5.5; this.vibLfo.start();
      this.tremLfo = ctx.createOscillator(); this.tremLfo.frequency.value = 5; this.tremLfo.start();
      document.addEventListener('visibilitychange', () => { if (!document.hidden) this.resume(); });

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
      this.filter.connect(this.master); this.dlyReturn.connect(this.master); this.revReturn.connect(this.master);
      // batería: compresor → saturación suave → master, con un poco de reverb
      this.drumComp = ctx.createDynamicsCompressor(); this.drumComp.threshold.value = -14; this.drumComp.ratio.value = 4; this.drumComp.attack.value = .003; this.drumComp.release.value = .12; this.drumComp.knee.value = 6;
      this.drumSat = ctx.createWaveShaper(); { const c = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; c[i] = Math.tanh(x * 1.6) / Math.tanh(1.6); } this.drumSat.curve = c; }
      this.drumBus.connect(this.drumComp); this.drumComp.connect(this.drumSat); this.drumSat.connect(this.master);
      this.drumRev = ctx.createGain(); this.drumRev.gain.value = .12; this.drumSat.connect(this.drumRev); this.drumRev.connect(this.conv);
      this.master.connect(this.limiter); this.limiter.connect(this.analyser); this.analyser.connect(ctx.destination);

      this.metroGain = ctx.createGain(); this.metroGain.gain.value = .3; this.metroGain.connect(this.limiter);
      this.noise = this._noiseBuffer();
      this.ready = true;
      this.applyFx(); this.setSound(this.sound);
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
    setSound(id) {
      if (SOUNDS[id]) this.sound = id;
      if (!this.ready) return;
      const P = SOUNDS[this.sound], t = this.now();
      if (P.vib) this.vibLfo.frequency.setTargetAtTime(P.vib.rate, t, .05);
      if (P.trem) this.tremLfo.frequency.setTargetAtTime(P.trem.rate, t, .05);
    }
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
      if (this.voices.length > 30) this.noteOff(this.voices[0], time, true); // límite de polifonía
      const ctx = this.ctx, P = SOUNDS[opts.preset] || SOUNDS[this.sound], f0 = mtof(midi), oscs = [], extra = [];

      // filtro con envolvente sensible a la velocidad
      const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.Q.value = P.q;
      filt.frequency.setValueAtTime(P.cut * (0.6 + vel * .5) + P.env * vel, time);
      filt.frequency.setTargetAtTime(P.cut * (0.6 + vel * .5), time + P.a, Math.max(.05, P.dcy / 3));

      // VCA (ADSR) y panorama por voz
      const vca = ctx.createGain();
      const peak = .26 * (0.3 + vel * .7), sus = peak * P.s;
      vca.gain.setValueAtTime(.0001, time);
      vca.gain.linearRampToValueAtTime(peak, time + P.a);
      vca.gain.setTargetAtTime(Math.max(sus, .0001), time + P.a, P.dcy / 3);
      const pan = ctx.createStereoPanner(); pan.pan.value = (Math.random() * 2 - 1) * (P.width || 0) * .6;

      // entrada del filtro: directa o a través de formantes (coro)
      let input = filt;
      if (P.formants) {
        input = ctx.createGain();
        for (const [hz, q, g] of P.formants) {
          const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = hz; bp.Q.value = q;
          const bg = ctx.createGain(); bg.gain.value = g * 1.6; input.connect(bp); bp.connect(bg); bg.connect(filt);
        }
      }

      // vibrato (LFO compartido, profundidad con retardo) y trémolo
      let vibGain = null;
      if (P.vib) {
        vibGain = ctx.createGain(); vibGain.gain.setValueAtTime(0, time);
        vibGain.gain.linearRampToValueAtTime(P.vib.depth, time + (P.vib.delay || 0) + .4);
        this.vibLfo.connect(vibGain);
      }
      if (P.trem) { const tg = ctx.createGain(); tg.gain.value = peak * P.trem.depth; this.tremLfo.connect(tg); tg.connect(vca.gain); extra.push(tg); }

      const mkOsc = (o, detune) => {
        const osc = ctx.createOscillator(); osc.type = o.t; osc.frequency.setValueAtTime(f0 * o.r, time);
        osc.detune.value = detune; osc._base = detune;
        if (vibGain) vibGain.connect(osc.detune);
        if (o.fm) { // modulador FM con índice decreciente
          const m = ctx.createOscillator(); m.type = 'sine'; m.frequency.setValueAtTime(f0 * o.r * o.fm.r, time);
          const mg = ctx.createGain(); const idx = o.fm.i * f0 * o.r * (0.5 + vel * .6);
          mg.gain.setValueAtTime(idx, time); mg.gain.setTargetAtTime(idx * .25, time, o.fm.dcy);
          m.connect(mg); mg.connect(osc.frequency); m.start(time); oscs.push(m);
        }
        const g = ctx.createGain(); g.gain.value = o.g; osc.connect(g); g.connect(input); osc.start(time); oscs.push(osc);
      };
      for (const o of P.oscs) {
        if (P.unison && o.uni) {
          const n = P.unison.n;
          for (let k = 0; k < n; k++) mkOsc({ ...o, g: o.g / Math.sqrt(n) }, (o.d || 0) + (n === 1 ? 0 : -P.unison.spread + (2 * P.unison.spread * k) / (n - 1)));
        } else mkOsc(o, o.d || 0);
      }
      if (P.perc) { // clic de percusión (órgano)
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f0 * P.perc.r, time);
        const g = ctx.createGain(); g.gain.setValueAtTime(P.perc.g * vel, time); g.gain.setTargetAtTime(.0001, time, P.perc.dcy / 3);
        o.connect(g); g.connect(input); o.start(time); o.stop(time + P.perc.dcy * 3); oscs.push(o);
      }
      if (P.noise) { // transitorio de ruido (martillo, púa, mazo)
        const n = ctx.createBufferSource(); n.buffer = this.noise;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = P.noise.hp;
        const g = ctx.createGain(); g.gain.setValueAtTime(P.noise.g * vel, time); g.gain.exponentialRampToValueAtTime(.0001, time + P.noise.dcy + .02);
        n.connect(hp); hp.connect(g); g.connect(filt); n.start(time); n.stop(time + P.noise.dcy + .05);
      }
      filt.connect(vca); vca.connect(pan); pan.connect(this.chordBus);
      const cs = ctx.createGain(); cs.gain.value = P.chorus || 0; pan.connect(cs); cs.connect(this.chorusIn);
      const v = { midi, vca, oscs, track: opts.track || 'live', rel: P.rel * (opts.relMul || 1), sustain: P.s, extra: [vibGain, cs, ...extra].filter(Boolean) };
      this.voices.push(v);
      if (opts.gate) this.noteOff(v, time + opts.gate);
      else if (P.s === 0) this.noteOff(v, time + P.a + P.dcy * 1.6, true);
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
      setTimeout(() => { try { v.vca.disconnect(); for (const x of v.extra || []) x.disconnect(); } catch (e) { /* noop */ } }, (end - this.now()) * 1000 + 60);
    }
    releaseAll(time = this.now(), track) { for (const v of this.voices.slice()) if (!track || v.track === track) this.noteOff(v, time); }
    releaseNote(midi, time = this.now(), track) { for (const v of this.voices.slice()) if (v.midi === midi && (!track || v.track === track)) this.noteOff(v, time); }

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
      const f = mtof(midi);
      const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.setValueAtTime(f, time);
      const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.setValueAtTime(f, time); o2.detune.value = -4;
      const o3 = ctx.createOscillator(); o3.type = 'square'; o3.frequency.setValueAtTime(f, time); o3.detune.value = 5;
      const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 3;
      fl.frequency.setValueAtTime(900 + vel * 1200, time); fl.frequency.setTargetAtTime(160 + f * .5, time, .16);
      const sub = ctx.createGain(); sub.gain.value = .7; const saw = ctx.createGain(); saw.gain.value = .28; const sq = ctx.createGain(); sq.gain.value = .12;
      o1.connect(sub); o2.connect(saw); o3.connect(sq); saw.connect(fl); sq.connect(fl);
      const drive = ctx.createWaveShaper(); const c = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; c[i] = Math.tanh(x * 2.2) / Math.tanh(2.2); } drive.curve = c;
      fl.connect(drive);
      const n = ctx.createBufferSource(); n.buffer = this.noise; const nh = ctx.createBiquadFilter(); nh.type = 'bandpass'; nh.frequency.value = 2400; nh.Q.value = 1;
      const ng = ctx.createGain(); ng.gain.setValueAtTime(.12 * vel, time); ng.gain.exponentialRampToValueAtTime(.0001, time + .03);
      n.connect(nh); nh.connect(ng); n.start(time); n.stop(time + .05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(.0001, time); g.gain.exponentialRampToValueAtTime(.55 * vel, time + .006); g.gain.setTargetAtTime(.0001, time + .05, .5);
      sub.connect(g); drive.connect(g); ng.connect(g); g.connect(this.bassBus);
      for (const o of [o1, o2, o3]) { o.start(time); o.stop(time + 2.4); }
      this.bassVoice = { midi, vca: g, oscs: [o1, o2, o3] };
    }
    _bassOff(v, time) { v.vca.gain.cancelScheduledValues(time); v.vca.gain.setValueAtTime(Math.max(v.vca.gain.value, .0001), time); v.vca.gain.setTargetAtTime(.0001, time, .02); for (const o of v.oscs) { try { o.stop(time + .15); } catch (e) { /* noop */ } } }

    // ------------------------------------------------------------ batería
    _burst(t, dur, filters, gain, curve) {
      const ctx = this.ctx, n = ctx.createBufferSource(); n.buffer = this.noise; let node = n;
      for (const [type, f, q] of filters) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; node.connect(b); node = b; }
      const g = ctx.createGain(); g.gain.setValueAtTime(gain, t);
      if (curve) curve(g.gain, t); else g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      node.connect(g); g.connect(this.drumBus); n.start(t); n.stop(t + dur + .05);
      return g;
    }
    kick(t, vel = 1) {
      const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(52, t + .09); o.frequency.exponentialRampToValueAtTime(44, t + .5);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(1.15 * vel, t + .003); g.gain.setTargetAtTime(.0001, t + .05, .13);
      const sat = ctx.createWaveShaper(); const c = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; c[i] = Math.tanh(x * 2.5) / Math.tanh(2.5); } sat.curve = c;
      o.connect(sat); sat.connect(g); g.connect(this.drumBus); o.start(t); o.stop(t + .6);
      this._burst(t, .012, [['highpass', 2500, .7]], .35 * vel);           // clic del batidor
    }
    snare(t, vel = 1) {
      const ctx = this.ctx;
      this._burst(t, .2, [['bandpass', 1900, .9]], .55 * vel);
      this._burst(t, .13, [['highpass', 4200, .7]], .4 * vel);            // bordona
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'triangle';
      o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(140, t + .07);
      og.gain.setValueAtTime(.6 * vel, t); og.gain.exponentialRampToValueAtTime(.0001, t + .14); o.connect(og); og.connect(this.drumBus); o.start(t); o.stop(t + .16);
      const o2 = ctx.createOscillator(), g2 = ctx.createGain(); o2.frequency.value = 330; g2.gain.setValueAtTime(.2 * vel, t); g2.gain.exponentialRampToValueAtTime(.0001, t + .06); o2.connect(g2); g2.connect(this.drumBus); o2.start(t); o2.stop(t + .08);
    }
    hat(t, open, vel = 1) { // seis cuadradas metálicas (estilo 808)
      const ctx = this.ctx, bp = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = 'bandpass'; bp.frequency.value = 9500; bp.Q.value = .9; hp.type = 'highpass'; hp.frequency.value = 6800;
      const d = open ? .38 : .055;
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.32 * vel, t + .002); g.gain.exponentialRampToValueAtTime(.0001, t + d);
      for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f * 1.9; o.connect(bp); o.start(t); o.stop(t + d + .02); }
      bp.connect(hp); hp.connect(g); g.connect(this.drumBus);
    }
    clap(t, vel = 1) {
      for (let i = 0; i < 3; i++) this._burst(t + i * .011, .03, [['bandpass', 1300, 1.4]], .5 * vel);
      this._burst(t + .03, .22, [['bandpass', 1500, 1]], .35 * vel);
    }
    rim(t, vel = 1) {
      const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(); o.type = 'square'; o.frequency.value = 880;
      f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 4;
      g.gain.setValueAtTime(.6 * vel, t); g.gain.exponentialRampToValueAtTime(.0001, t + .045); o.connect(f); f.connect(g); g.connect(this.drumBus); o.start(t); o.stop(t + .05);
      this._burst(t, .02, [['highpass', 3000, .7]], .2 * vel);
    }
    shaker(t, vel = 1) { this._burst(t, .07, [['bandpass', 6500, 1.2], ['highpass', 4000, .7]], .22 * vel, (p, t0) => { p.setValueAtTime(.0001, t0); p.linearRampToValueAtTime(.22 * vel, t0 + .02); p.exponentialRampToValueAtTime(.0001, t0 + .07); }); }
    tom(t, vel = 1, hi) {
      const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
      const f0 = hi ? 210 : 130; o.frequency.setValueAtTime(f0 * 1.5, t); o.frequency.exponentialRampToValueAtTime(f0, t + .12);
      g.gain.setValueAtTime(.8 * vel, t); g.gain.exponentialRampToValueAtTime(.0001, t + .3); o.connect(g); g.connect(this.drumBus); o.start(t); o.stop(t + .32);
      this._burst(t, .04, [['bandpass', 2500, 1]], .15 * vel);
    }

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
