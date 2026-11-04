/* ==========================================================================
   THE SOUND OF MONEY · motor de sonido (Web Audio, sin dependencias)
   Buses: orquesta (SPY) · solista (la acción enfocada) · coro (las demás) · percusión
   FX: reverb larga generada, delay con filtro, compresor suave, analizador para el visual.
   ========================================================================== */
(function (g) {
  'use strict';
  const C = g.Campana;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* Presets. oscs: t tipo · r ratio · d detune (cents) · g ganancia · fm {r ratio, i índice, dcy}
     uni {n, spread} · noise {g, dcy, hp} · vib {depth cents, rate} · a/dcy/s/rel envolvente ·
     cut/env/q filtro · width (pan por voz) · color (para el visual) */
  const PRESETS = {
    pad:     { nombre: 'Pad',           oscs: [{ t: 'sawtooth', r: 1, g: .13, uni: true }, { t: 'triangle', r: .5, g: .1 }, { t: 'sine', r: 2, d: 6, g: .04 }],
               uni: { n: 4, spread: 12 }, a: 1.2, dcy: 1, s: .9, rel: 3, cut: 650, env: 700, q: .6, vib: { depth: 4, rate: .25 }, width: .9, color: '#9fb8ff' },
    cuerdas: { nombre: 'Cuerdas',       oscs: [{ t: 'sawtooth', r: 1, g: .15, uni: true }, { t: 'sawtooth', r: 2, d: 4, g: .04 }],
               uni: { n: 3, spread: 9 }, a: .9, dcy: .6, s: .9, rel: 2.5, cut: 1300, env: 500, q: .6, vib: { depth: 8, rate: 5 }, width: .7, color: '#c7d4ff' },
    bajo:    { nombre: 'Bajo',          oscs: [{ t: 'sine', r: 1, g: .55 }, { t: 'triangle', r: 1, g: .2 }, { t: 'sawtooth', r: 2, g: .05 }],
               a: .02, dcy: .6, s: .5, rel: .5, cut: 380, env: 500, q: .9, width: 0, color: '#6c7cff' },
    arpa:    { nombre: 'Arpa',          oscs: [{ t: 'triangle', r: 1, g: .45 }, { t: 'sine', r: 2, g: .15 }, { t: 'sine', r: 3, g: .05 }],
               noise: { g: .15, dcy: .01, hp: 2500 }, a: .003, dcy: 1.4, s: 0, rel: .9, cut: 2200, env: 3000, q: .8, width: .6, color: '#5ad1ff' },
    pulso:   { nombre: 'Pulso digital', oscs: [{ t: 'sawtooth', r: 1, g: .28 }, { t: 'square', r: 1, d: 6, g: .1 }, { t: 'triangle', r: 2, g: .06 }],
               noise: { g: .2, dcy: .012, hp: 1800 }, a: .002, dcy: .5, s: 0, rel: .4, cut: 500, env: 4200, q: 2.2, width: .5, color: '#7cf0e3' },
    cristal: { nombre: 'Cristal',       oscs: [{ t: 'sine', r: 1, g: .5, fm: { r: 3.01, i: 1.4, dcy: .5 } }, { t: 'sine', r: 2, g: .1 }, { t: 'sine', r: 5.02, g: .03 }],
               a: .003, dcy: 1.6, s: 0, rel: 1.6, cut: 7000, env: 0, q: .5, width: .8, color: '#c9a3ff' },
    coro:    { nombre: 'Coro',          oscs: [{ t: 'sawtooth', r: 1, g: .2, uni: true }, { t: 'sawtooth', r: .5, g: .05 }],
               uni: { n: 3, spread: 8 }, formants: [[650, 9, 1], [1100, 12, .55], [2650, 14, .28]], a: .35, dcy: 1, s: .85, rel: 1.4, cut: 4500, env: 0, q: .5, vib: { depth: 10, rate: 4.6 }, width: .8, color: '#ff9ad5' },
    bronce:  { nombre: 'Bronce',        oscs: [{ t: 'sawtooth', r: 1, g: .22, uni: true }, { t: 'square', r: 1, d: 3, g: .05 }],
               uni: { n: 2, spread: 7 }, a: .09, dcy: .4, s: .7, rel: .5, cut: 450, env: 2600, q: 1.4, vib: { depth: 6, rate: 5.2 }, width: .4, color: '#ffb067' },
    epiano:  { nombre: 'Piano eléctrico', oscs: [{ t: 'sine', r: 1, g: .55, fm: { r: 1, i: 1.5, dcy: .5 } }, { t: 'sine', r: 1, g: .22, fm: { r: 14, i: .22, dcy: .1 } }, { t: 'sine', r: 2, g: .07 }],
               noise: { g: .04, dcy: .01, hp: 2000 }, a: .002, dcy: 2, s: .1, rel: .7, cut: 5000, env: 2000, q: .5, trem: { depth: .18, rate: 4.6 }, width: .6, color: '#ffd56b' },
    chip:    { nombre: 'Chip',          oscs: [{ t: 'square', r: 1, g: .22 }, { t: 'square', r: 2, d: 8, g: .06 }],
               a: .002, dcy: .25, s: .15, rel: .12, cut: 3500, env: 2500, q: 1.2, width: .5, color: '#9dff8a' },
    marimba: { nombre: 'Marimba',       oscs: [{ t: 'sine', r: 1, g: .5 }, { t: 'sine', r: 4, g: .14 }, { t: 'sine', r: 10, g: .03 }],
               noise: { g: .18, dcy: .006, hp: 1200 }, a: .001, dcy: .55, s: 0, rel: .35, cut: 6000, env: 0, q: .5, width: .6, color: '#ffcf9f' },
    metal:   { nombre: 'Metal',         oscs: [{ t: 'triangle', r: 1, g: .4, fm: { r: 2.5, i: 2, dcy: .25 } }, { t: 'sawtooth', r: 1, d: -5, g: .1 }, { t: 'sine', r: 3, g: .05 }],
               noise: { g: .25, dcy: .015, hp: 2500 }, a: .002, dcy: .9, s: 0, rel: .5, cut: 900, env: 3200, q: 1.5, width: .5, color: '#ff8f7a' },
    gong:    { nombre: 'Gong',          oscs: [{ t: 'sine', r: 1, g: .45, fm: { r: 1.41, i: 2.6, dcy: 1.8 } }, { t: 'sine', r: 2.76, g: .1 }, { t: 'sine', r: 1.5, g: .06 }],
               a: .01, dcy: 3.5, s: 0, rel: 3, cut: 3500, env: 0, q: .5, width: .8, color: '#d7b98a' },
    organo:  { nombre: 'Órgano',        oscs: [{ t: 'sine', r: 1, g: .38 }, { t: 'sine', r: 2, g: .28 }, { t: 'sine', r: 3, g: .14 }, { t: 'sine', r: 4, g: .1 }, { t: 'sine', r: 6, g: .05 }],
               a: .01, dcy: .1, s: 1, rel: .15, cut: 6000, env: 0, q: .5, vib: { depth: 5, rate: 6.2 }, width: .3, color: '#b5c7d8' },
    campana: { nombre: 'Campana',       oscs: [{ t: 'sine', r: 1, g: .45, fm: { r: 3.5, i: 2.4, dcy: 1 } }, { t: 'sine', r: 2.76, g: .12 }, { t: 'sine', r: 5.4, g: .05 }],
               a: .002, dcy: 3, s: 0, rel: 2.5, cut: 9000, env: 0, q: .5, width: .8, color: '#fff2c4' },
    brillo:  { nombre: 'Brillo',        oscs: [{ t: 'sine', r: 1, g: .3 }, { t: 'sine', r: 2, g: .12 }, { t: 'triangle', r: 4, g: .04 }],
               a: .4, dcy: 1, s: .6, rel: 2.2, cut: 5000, env: 0, q: .5, vib: { depth: 3, rate: .4 }, width: .9, color: '#ffffff' },
  };

  class Motor {
    constructor() {
      this.ctx = null; this.listo = false;
      this.niveles = { orquesta: .8, solista: .85, coro: .5, percusion: .55, master: .85 };
    }

    init() {
      if (this.listo) return;
      const AC = g.AudioContext || g.webkitAudioContext;
      const ctx = (this.ctx = new AC({ latencyHint: 'playback' }));

      this.buses = {};
      this.mix = ctx.createGain();
      this.revSend = ctx.createGain();
      this.dlySend = ctx.createGain();
      for (const k of ['orquesta', 'solista', 'coro', 'percusion']) {
        const bus = ctx.createGain(); bus.gain.value = this.niveles[k];
        const rev = ctx.createGain(); rev.gain.value = { orquesta: .55, solista: .4, coro: .7, percusion: .25 }[k];
        const dly = ctx.createGain(); dly.gain.value = { orquesta: .05, solista: .3, coro: .2, percusion: .08 }[k];
        bus.connect(this.mix); bus.connect(rev); rev.connect(this.revSend); bus.connect(dly); dly.connect(this.dlySend);
        this.buses[k] = bus;
      }

      // reverb larga y luminosa
      this.conv = ctx.createConvolver(); this.conv.buffer = this._impulso(5.5, 2.4);
      this.revReturn = ctx.createGain(); this.revReturn.gain.value = .9;
      this.revSend.connect(this.conv); this.conv.connect(this.revReturn);

      // delay con filtro y modulación leve (cinta)
      this.delay = ctx.createDelay(2); this.delay.delayTime.value = .41;
      this.dlyFb = ctx.createGain(); this.dlyFb.gain.value = .38;
      this.dlyTone = ctx.createBiquadFilter(); this.dlyTone.type = 'lowpass'; this.dlyTone.frequency.value = 2400;
      this.dlyReturn = ctx.createGain(); this.dlyReturn.gain.value = .7;
      this.dlySend.connect(this.delay); this.delay.connect(this.dlyTone); this.dlyTone.connect(this.dlyFb); this.dlyFb.connect(this.delay);
      this.dlyTone.connect(this.dlyReturn); this.dlyTone.connect(this.revSend);
      const wob = ctx.createOscillator(); wob.frequency.value = .6; const wobAmt = ctx.createGain(); wobAmt.gain.value = .0025;
      wob.connect(wobAmt); wobAmt.connect(this.delay.delayTime); wob.start();

      // LFOs compartidos
      this.vibLfo = ctx.createOscillator(); this.vibLfo.frequency.value = 5; this.vibLfo.start();
      this.lentoLfo = ctx.createOscillator(); this.lentoLfo.frequency.value = .3; this.lentoLfo.start();
      this.tremLfo = ctx.createOscillator(); this.tremLfo.frequency.value = 4.6; this.tremLfo.start();

      // master
      this.master = ctx.createGain(); this.master.gain.value = this.niveles.master;
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14; this.comp.knee.value = 18; this.comp.ratio.value = 3.5; this.comp.attack.value = .01; this.comp.release.value = .3;
      this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024; this.analyser.smoothingTimeConstant = .8;
      this.mix.connect(this.master); this.revReturn.connect(this.master); this.dlyReturn.connect(this.master);
      this.master.connect(this.comp); this.comp.connect(this.analyser); this.analyser.connect(ctx.destination);

      this.ruido = this._ruido();
      this.fft = new Uint8Array(this.analyser.frequencyBinCount);
      this.listo = true;
      document.addEventListener('visibilitychange', () => { if (!document.hidden) this.resume(); });
    }

    resume() { if (this.ctx && this.ctx.state !== 'running') return this.ctx.resume(); return Promise.resolve(); }
    suspender() { if (this.ctx && this.ctx.state === 'running') return this.ctx.suspend(); return Promise.resolve(); }
    ahora() { return this.ctx ? this.ctx.currentTime : 0; }

    setNivel(k, v) {
      this.niveles[k] = v; if (!this.listo) return;
      const n = k === 'master' ? this.master : this.buses[k];
      if (n) n.gain.setTargetAtTime(v, this.ahora(), .03);
    }

    /** Niveles para el visual: {graves, medios, agudos, total} entre 0 y 1. */
    nivel() {
      if (!this.listo) return { graves: 0, medios: 0, agudos: 0, total: 0 };
      this.analyser.getByteFrequencyData(this.fft);
      const f = this.fft, n = f.length;
      const prom = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += f[i]; return s / (b - a) / 255; };
      const graves = prom(1, 12), medios = prom(12, 80), agudos = prom(80, n >> 1);
      return { graves, medios, agudos, total: (graves * .5 + medios * .35 + agudos * .15) };
    }

    _ruido() {
      const len = this.ctx.sampleRate * 2, b = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return b;
    }
    _impulso(seg, caida) {
      const sr = this.ctx.sampleRate, len = Math.floor(sr * seg), b = this.ctx.createBuffer(2, len, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = b.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          const t = i / sr;
          const env = Math.pow(1 - i / len, caida) * (t < .02 ? t / .02 : 1);
          d[i] = (Math.random() * 2 - 1) * env * (0.6 + 0.4 * Math.sin(t * (ch ? 3.1 : 2.3)));
        }
      }
      return b;
    }

    /**
     * Toca una nota. o = { preset, midi, t, dur, vel (0-1), bus, pan (-1..1), brillo (0-1), vib (0-1), detune }
     */
    nota(o) {
      if (!this.listo) return;
      const P = PRESETS[o.preset] || PRESETS.pulso, ctx = this.ctx;
      const t = Math.max(o.t || this.ahora(), this.ahora() + .005);
      const vel = clamp(o.vel == null ? .7 : o.vel, 0, 1), dur = Math.max(.05, o.dur || .5);
      const f0 = C.mtof(o.midi) * Math.pow(2, (o.detune || 0) / 1200);
      const bus = this.buses[o.bus] || this.buses.solista;
      const brillo = o.brillo == null ? .5 : clamp(o.brillo, 0, 1);

      const voz = ctx.createGain(); voz.gain.value = 0;
      const filtro = ctx.createBiquadFilter(); filtro.type = 'lowpass'; filtro.Q.value = P.q;
      const cut = (P.cut + P.env * (.3 + .7 * vel)) * (0.55 + 0.9 * brillo);
      filtro.frequency.setValueAtTime(clamp(cut, 80, 16000), t);
      if (P.env) filtro.frequency.exponentialRampToValueAtTime(clamp(P.cut * (0.6 + brillo) + 60, 60, 16000), t + Math.max(P.dcy, .08));
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      let salida = filtro;
      if (P.formants) {
        const sum = ctx.createGain();
        for (const [hz, q, gf] of P.formants) {
          const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = hz; bp.Q.value = q;
          const gg = ctx.createGain(); gg.gain.value = gf * 1.4; filtro.connect(bp); bp.connect(gg); gg.connect(sum);
        }
        salida = sum;
      }
      salida.connect(voz);
      if (pan) { pan.pan.value = clamp(o.pan || 0, -1, 1); voz.connect(pan); pan.connect(bus); } else voz.connect(bus);

      // envolvente
      const a = Math.max(.002, P.a * (o.ataque || 1)), rel = P.rel * (o.cola || 1);
      const pico = .22 * vel * (o.ganancia || 1);
      voz.gain.setValueAtTime(0, t);
      voz.gain.linearRampToValueAtTime(pico, t + a);
      voz.gain.setTargetAtTime(pico * P.s, t + a, Math.max(.03, P.dcy / 3));
      const tFin = t + dur;
      voz.gain.setTargetAtTime(0, tFin, rel / 4);
      const tStop = tFin + rel + .1;

      // trémolo (por nota)
      if (P.trem) { const tg = ctx.createGain(); tg.gain.value = P.trem.depth * .22 * vel; this.tremLfo.connect(tg); tg.connect(voz.gain); }

      const nodos = [];
      const osciladores = [];
      for (const d of P.oscs) {
        const copias = d.uni && P.uni ? P.uni.n : 1;
        for (let k = 0; k < copias; k++) {
          const osc = ctx.createOscillator(); osc.type = d.t;
          osc.frequency.value = f0 * d.r;
          const spread = copias > 1 ? ((k / (copias - 1)) - .5) * 2 * P.uni.spread : 0;
          osc.detune.value = (d.d || 0) + spread;
          const gg = ctx.createGain(); gg.gain.value = d.g / Math.sqrt(copias);
          if (d.fm) {
            const m = ctx.createOscillator(); m.frequency.value = f0 * d.r * d.fm.r;
            const mg = ctx.createGain(); const idx = f0 * d.r * d.fm.i * (0.5 + brillo);
            mg.gain.setValueAtTime(idx, t); mg.gain.setTargetAtTime(idx * .08, t + .01, d.fm.dcy);
            m.connect(mg); mg.connect(osc.frequency); m.start(t); m.stop(tStop); nodos.push(m);
          }
          if (P.vib && (o.vib == null || o.vib > 0)) {
            const vg = ctx.createGain(); vg.gain.value = (P.vib.depth * (o.vib == null ? 1 : o.vib)) * f0 * d.r / 1200 * .7;
            (P.vib.rate < 1 ? this.lentoLfo : this.vibLfo).connect(vg); vg.connect(osc.frequency); nodos.push(vg);
          }
          if (pan && P.width && copias > 1) {
            const pp = ctx.createStereoPanner(); pp.pan.value = clamp((o.pan || 0) + ((k / (copias - 1)) - .5) * P.width, -1, 1);
            osc.connect(gg); gg.connect(pp); pp.connect(filtro);
          } else { osc.connect(gg); gg.connect(filtro); }
          osc.start(t); osc.stop(tStop); osciladores.push(osc);
        }
      }
      if (P.noise) {
        const src = ctx.createBufferSource(); src.buffer = this.ruido; src.loop = true;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = P.noise.hp;
        const ng = ctx.createGain(); ng.gain.setValueAtTime(P.noise.g * vel, t); ng.gain.setTargetAtTime(0, t + .002, P.noise.dcy);
        src.connect(hp); hp.connect(ng); ng.connect(filtro); src.start(t); src.stop(t + P.noise.dcy * 8 + .05);
      }
      osciladores[0].onended = () => { try { voz.disconnect(); if (pan) pan.disconnect(); } catch (e) { /* ya desconectado */ } };
      return { t, dur, midi: o.midi };
    }

    /** Percusión suave y soñada: 'bombo' · 'hat' · 'shaker' · 'platillo' · 'latido' */
    percusion(tipo, t, vel = .7, pan = 0) {
      if (!this.listo) return;
      const ctx = this.ctx; t = Math.max(t || this.ahora(), this.ahora() + .005); vel = clamp(vel, 0, 1);
      const bus = this.buses.percusion;
      const out = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      if (out.pan) out.pan.value = pan; out.connect(bus);
      const envNoise = (dur, hp, lp, g, ataque = .001) => {
        const src = ctx.createBufferSource(); src.buffer = this.ruido; src.loop = true;
        const h = ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp;
        const l = ctx.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = lp;
        const gg = ctx.createGain(); gg.gain.setValueAtTime(0, t); gg.gain.linearRampToValueAtTime(g, t + ataque); gg.gain.exponentialRampToValueAtTime(.0001, t + ataque + dur);
        src.connect(h); h.connect(l); l.connect(gg); gg.connect(out); src.start(t); src.stop(t + ataque + dur + .05);
      };
      switch (tipo) {
        case 'bombo': case 'latido': {
          const o = ctx.createOscillator(); o.type = 'sine';
          const f = tipo === 'latido' ? 52 : 60;
          o.frequency.setValueAtTime(f * 2.6, t); o.frequency.exponentialRampToValueAtTime(f, t + .09);
          const gg = ctx.createGain(); gg.gain.setValueAtTime(.0001, t); gg.gain.exponentialRampToValueAtTime(.9 * vel, t + .008); gg.gain.exponentialRampToValueAtTime(.0001, t + (tipo === 'latido' ? .55 : .32));
          const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
          o.connect(gg); gg.connect(lp); lp.connect(out); o.start(t); o.stop(t + .6);
          break;
        }
        case 'hat': envNoise(.05 + .05 * vel, 6000, 12000, .12 * vel); break;
        case 'shaker': envNoise(.08, 3000, 9000, .07 * vel, .015); break;
        case 'platillo': envNoise(1.6, 2500, 9000, .16 * vel, .35); break;
        case 'golpe': envNoise(.7, 200, 1800, .3 * vel, .005); break;
      }
    }
  }

  g.Campana.Motor = Motor;
  g.Campana.PRESETS = PRESETS;
})(window);
