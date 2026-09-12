// Prisma Synth — procesador de audio (AudioWorklet).
// Todo el DSP vive aquí: voces polifónicas con dos motores de síntesis por voz
// (Analog, Wavetable, FM, Granular, Harmonic, Modal, Sample), dos filtros,
// tres envolventes, tres LFOs, matriz de modulación, arpegiador y cadena de
// efectos (Corroder, Distortion, Multi Filter, Chorus, Phaser, Delay, Reverb,
// EQ, Compressor).
//
// El archivo también se puede importar desde Node (tests) porque el registro
// del procesador está protegido con `typeof AudioWorkletProcessor`.

const TWO_PI = Math.PI * 2;
const BLOCK = 128;
const MAX_VOICES = 16;

// ---------------------------------------------------------------- utilidades
const SINE_N = 4096;
const SINE = new Float32Array(SINE_N + 1);
for (let i = 0; i <= SINE_N; i++) SINE[i] = Math.sin((i / SINE_N) * TWO_PI);
// fase en ciclos (cualquier valor), con interpolación lineal
function sinC(ph) {
  ph -= Math.floor(ph);
  const x = ph * SINE_N;
  const i = x | 0;
  const f = x - i;
  return SINE[i] + f * (SINE[i + 1] - SINE[i]);
}
// generador pseudoaleatorio rápido (xorshift32)
let rngState = 0x9e3779b9;
function rnd() {
  let x = rngState;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  rngState = x >>> 0;
  return rngState / 4294967296;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function softclip(x) {
  // saturación suave y barata
  if (x > 3) return 1;
  if (x < -3) return -1;
  return x * (27 + x * x) / (27 + 9 * x * x);
}
function midiToHz(n) { return 440 * Math.pow(2, (n - 69) / 12); }
function polyblep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

// FFT compleja radix-2 in-place (re, im Float64Array, n potencia de 2)
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (TWO_PI / len) * (inverse ? -1 : 1);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// ------------------------------------------------------------- wavetables
// Cada tabla: 16 frames de 2048 muestras definidos en el dominio del tiempo.
// Se calcula el espectro de cada frame una vez, y se generan versiones
// limitadas en banda (niveles mip) bajo demanda con IFFT.
const WT_SIZE = 2048;
const WT_FRAMES = 16;
const MIP_LIMITS = [1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1];

function additive(harmAmp, phaseFn) {
  // harmAmp(k) → amplitud del armónico k (1-based); devuelve Float32Array
  const out = new Float32Array(WT_SIZE);
  const re = new Float64Array(WT_SIZE), im = new Float64Array(WT_SIZE);
  for (let k = 1; k < WT_SIZE / 2; k++) {
    const a = harmAmp(k);
    if (!a) continue;
    const ph = phaseFn ? phaseFn(k) : -Math.PI / 2;
    re[k] = Math.cos(ph) * a * (WT_SIZE / 2);
    im[k] = Math.sin(ph) * a * (WT_SIZE / 2);
    re[WT_SIZE - k] = re[k]; im[WT_SIZE - k] = -im[k];
  }
  fft(re, im, true);
  let mx = 0;
  for (let i = 0; i < WT_SIZE; i++) mx = Math.max(mx, Math.abs(re[i]));
  for (let i = 0; i < WT_SIZE; i++) out[i] = re[i] / (mx || 1);
  return out;
}
function timeDomain(fn) {
  const out = new Float32Array(WT_SIZE);
  let mx = 0;
  for (let i = 0; i < WT_SIZE; i++) { out[i] = fn(i / WT_SIZE); mx = Math.max(mx, Math.abs(out[i])); }
  for (let i = 0; i < WT_SIZE; i++) out[i] /= (mx || 1);
  return out;
}

const WT_DEFS = [
  // Basic: seno → triángulo → sierra → cuadrada
  (f) => {
    const t = f / (WT_FRAMES - 1) * 3;
    return additive(k => {
      const sine = k === 1 ? 1 : 0;
      const tri = (k % 2) ? 1 / (k * k) * (((k - 1) / 2) % 2 ? -1 : 1) : 0;
      const saw = 1 / k;
      const sq = (k % 2) ? 1 / k : 0;
      if (t < 1) return lerp(sine, tri, t);
      if (t < 2) return lerp(tri, saw, t - 1);
      return lerp(saw, sq, t - 2);
    });
  },
  // Harmonics: número creciente de armónicos con igual amplitud
  (f) => { const n = 1 + f * 2; return additive(k => (k <= n ? 1 / Math.sqrt(k) : 0)); },
  // PWM
  (f) => { const pw = 0.5 - f / (WT_FRAMES - 1) * 0.47; return timeDomain(t => (t < pw ? 1 : -1) - (2 * pw - 1)); },
  // Formant: pulsos resonantes (vocales)
  (f) => {
    const F1 = 300 + 500 * Math.sin(f / WT_FRAMES * Math.PI), F2 = 900 + 1300 * (f / WT_FRAMES);
    return additive(k => {
      const hz = k * 110;
      const r1 = Math.exp(-Math.pow((hz - F1) / 120, 2));
      const r2 = Math.exp(-Math.pow((hz - F2) / 200, 2)) * 0.7;
      return (r1 + r2 + 0.02) / Math.sqrt(k);
    });
  },
  // Bell: parciales inarmónicos (aproximados a enteros en una tabla cíclica)
  (f) => {
    const parts = [1, 2, 3, 4, 5, 7, 9, 11, 13, 17];
    return additive(k => {
      const i = parts.indexOf(k);
      if (i < 0) return 0;
      return Math.pow(0.7, i) * (0.5 + 0.5 * Math.cos(i * 0.6 + f * 0.5));
    });
  },
  // Digital: seno plegado y cuantizado
  (f) => {
    const amt = 1 + f * 0.6, bits = 16 - f * 0.9;
    const q = Math.pow(2, bits);
    return timeDomain(t => {
      let y = Math.sin(TWO_PI * t) * amt;
      y = Math.sin(y * Math.PI * 0.5 * amt);
      return Math.round(y * q) / q;
    });
  },
  // Organ: combinaciones de drawbars
  (f) => {
    const bars = [1, 2, 3, 4, 6, 8, 10, 12, 16];
    return additive(k => {
      const i = bars.indexOf(k);
      if (i < 0) return 0;
      return 0.4 + 0.6 * Math.max(0, Math.sin(f * 0.9 + i * 1.7));
    });
  },
  // Vox: sierra suavizada con formante móvil y ruido armónico
  (f) => additive(k => {
    const hz = k * 130;
    const F = 400 + 1800 * (0.5 + 0.5 * Math.sin(f * 0.45));
    const res = Math.exp(-Math.pow((hz - F) / 300, 2)) * 2;
    return (1 + res) / (k * (1 + k * 0.03));
  }, k => -Math.PI / 2 + Math.sin(k * 1.3) * 0.5),
];

class WavetableBank {
  constructor() {
    this.spectra = []; // [table][frame] → {re, im}
    this.cache = [];   // [table][frame][mip] → Float32Array(WT_SIZE+1)
    for (let t = 0; t < WT_DEFS.length; t++) {
      this.spectra[t] = []; this.cache[t] = [];
      for (let f = 0; f < WT_FRAMES; f++) {
        const td = WT_DEFS[t](f);
        const re = new Float64Array(WT_SIZE), im = new Float64Array(WT_SIZE);
        for (let i = 0; i < WT_SIZE; i++) re[i] = td[i];
        fft(re, im, false);
        this.spectra[t][f] = { re, im };
        this.cache[t][f] = new Array(MIP_LIMITS.length).fill(null);
      }
    }
  }
  frame(table, frameIdx, mip) {
    const c = this.cache[table][frameIdx];
    if (c[mip]) return c[mip];
    const lim = MIP_LIMITS[mip];
    const s = this.spectra[table][frameIdx];
    const re = new Float64Array(WT_SIZE), im = new Float64Array(WT_SIZE);
    for (let k = 1; k <= lim && k < WT_SIZE / 2; k++) {
      re[k] = s.re[k]; im[k] = s.im[k];
      re[WT_SIZE - k] = s.re[WT_SIZE - k]; im[WT_SIZE - k] = s.im[WT_SIZE - k];
    }
    fft(re, im, true);
    const out = new Float32Array(WT_SIZE + 1);
    for (let i = 0; i < WT_SIZE; i++) out[i] = re[i];
    out[WT_SIZE] = out[0];
    c[mip] = out;
    return out;
  }
  static mipFor(freq, sr) {
    const maxH = (sr * 0.5) / Math.max(freq, 1);
    for (let m = 0; m < MIP_LIMITS.length; m++) if (MIP_LIMITS[m] <= maxH) return m;
    return MIP_LIMITS.length - 1;
  }
}

// ------------------------------------------------- fuentes de sample internas
// Genera 2 segundos de audio (mono) con nota raíz C4 para Granular y Sample.
function generateSources(sr) {
  const len = Math.floor(sr * 2);
  const root = 261.63;
  const mk = () => new Float32Array(len);
  const norm = (b) => { let m = 0; for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b[i])); if (m > 0) for (let i = 0; i < b.length; i++) b[i] /= m; return b; };

  // Choir: sierras desafinadas + formantes de vocal 'ah' + vibrato
  const choir = mk();
  {
    const det = [-7, -3, 0, 4, 8];
    const ph = det.map(() => rnd());
    const bp = [[700, 8], [1200, 10], [2600, 12]].map(([f, q]) => new SVF(sr, f, q));
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const vib = 1 + 0.004 * Math.sin(TWO_PI * 5.2 * t);
      let s = 0;
      for (let v = 0; v < det.length; v++) {
        const f = root * Math.pow(2, det[v] / 1200) * vib;
        ph[v] += f / sr; if (ph[v] >= 1) ph[v] -= 1;
        s += (2 * ph[v] - 1) * 0.3;
      }
      let y = 0;
      for (const b of bp) y += b.bandpass(s);
      const env = Math.min(1, t * 8) * Math.min(1, (2 - t) * 4);
      choir[i] = (y * 0.6 + s * 0.15) * env;
    }
    norm(choir);
  }
  // Bell: parciales inarmónicos con decaimientos distintos
  const bell = mk();
  {
    const ratios = [1, 2.0, 2.76, 3.9, 5.4, 6.8, 8.2, 10.1];
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let s = 0;
      for (let k = 0; k < ratios.length; k++) {
        s += Math.sin(TWO_PI * root * ratios[k] * t) * Math.exp(-t * (1.2 + k * 0.9)) / (1 + k * 0.5);
      }
      bell[i] = s;
    }
    norm(bell);
  }
  // Piano-ish: Karplus-Strong con dos cuerdas ligeramente desafinadas
  const piano = mk();
  {
    for (const detune of [0, 1.5]) {
      const f = root * Math.pow(2, detune / 1200);
      const N = Math.round(sr / f);
      const buf = new Float32Array(N);
      for (let i = 0; i < N; i++) buf[i] = (rnd() * 2 - 1) * (i < N * 0.7 ? 1 : 0.3);
      let idx = 0, prev = 0;
      for (let i = 0; i < len; i++) {
        const cur = buf[idx];
        const next = buf[(idx + 1) % N];
        const y = 0.5 * (cur + next) * 0.996;
        buf[idx] = lerp(y, prev, 0.1);
        prev = y;
        idx = (idx + 1) % N;
        piano[i] += cur * 0.5;
      }
    }
    norm(piano);
  }
  // Texture: ruido filtrado con resonancia que se mueve + chispas
  const texture = mk();
  {
    const f1 = new SVF(sr, 800, 6), f2 = new SVF(sr, 2400, 8);
    let spark = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const n = rnd() * 2 - 1;
      f1.setCoeffs(400 + 1200 * (0.5 + 0.5 * Math.sin(TWO_PI * 0.4 * t)), 0.85);
      f2.setCoeffs(1500 + 3000 * (0.5 + 0.5 * Math.sin(TWO_PI * 0.23 * t + 1)), 0.9);
      if (rnd() < 0.0004) spark = 1;
      spark *= 0.999;
      texture[i] = f1.bandpass(n) * 0.7 + f2.bandpass(n) * 0.5 + spark * n * 0.6;
    }
    norm(texture);
  }
  return { buffers: [choir, bell, piano, texture, null], root };
}

// ------------------------------------------------------------------ filtros
// SVF trapezoidal (Andrew Simper) con salidas LP/BP/HP/Notch.
class SVF {
  constructor(sr, fc = 1000, res = 0) {
    this.sr = sr; this.ic1 = 0; this.ic2 = 0;
    this.setCoeffs(fc, res);
  }
  setCoeffs(fc, res) {
    fc = clamp(fc, 10, this.sr * 0.45);
    const g = Math.tan(Math.PI * fc / this.sr);
    const k = 2 - 1.98 * clamp(res, 0, 1);
    this.g = g; this.k = k;
    this.a1 = 1 / (1 + g * (g + k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  reset() { this.ic1 = 0; this.ic2 = 0; }
  // devuelve [lp, bp, hp] en this.lp/bp/hp
  tick(x) {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2; this.bp = v1; this.hp = x - this.k * v1 - v2;
  }
  lowpass(x) { this.tick(x); return this.lp; }
  bandpass(x) { this.tick(x); return this.bp; }
  highpass(x) { this.tick(x); return this.hp; }
}

const VOWELS = [ // F1, F2, F3 (Hz) A E I O U
  [800, 1150, 2900], [400, 1600, 2700], [350, 1700, 2700], [450, 800, 2830], [325, 700, 2530],
];

// Filtro de voz: tipos LP12 LP24 HP12 HP24 BP Notch Comb Formant, estéreo.
class VoiceFilter {
  constructor(sr) {
    this.sr = sr;
    this.s = [new SVF(sr), new SVF(sr), new SVF(sr), new SVF(sr)]; // L1 L2 R1 R2
    this.form = [new SVF(sr), new SVF(sr), new SVF(sr), new SVF(sr), new SVF(sr), new SVF(sr)];
    this.combLen = Math.ceil(sr / 20) + 2;
    this.combL = new Float32Array(this.combLen); this.combR = new Float32Array(this.combLen);
    this.combIdx = 0;
    this.type = 0; this.drive = 0;
  }
  reset() {
    for (const s of this.s) s.reset();
    for (const s of this.form) s.reset();
    this.combL.fill(0); this.combR.fill(0);
  }
  set(type, cutoff, res, drive) {
    this.type = type; this.drive = drive; this.res = res;
    this.cutoff = clamp(cutoff, 20, 20000);
    if (type <= 5) {
      const r = type === 1 || type === 3 ? res * 0.85 : res;
      for (const s of this.s) s.setCoeffs(this.cutoff, r);
    } else if (type === 7) {
      // formante: cutoff → morph entre vocales
      const pos = clamp(Math.log(this.cutoff / 20) / Math.log(1000), 0, 0.9999) * (VOWELS.length - 1);
      const i = pos | 0, f = pos - i;
      const q = 0.6 + res * 0.38;
      for (let k = 0; k < 3; k++) {
        const hz = lerp(VOWELS[i][k], VOWELS[Math.min(i + 1, VOWELS.length - 1)][k], f);
        this.form[k].setCoeffs(hz, q); this.form[k + 3].setCoeffs(hz, q);
      }
    } else {
      this.combDelay = clamp(this.sr / this.cutoff, 2, this.combLen - 2);
      this.combFb = res * 0.97;
    }
  }
  // procesa bloque in-place en L y R
  process(L, R, n) {
    const t = this.type;
    const pre = 1 + this.drive * 6;
    const post = this.drive > 0 ? 1 / (1 + this.drive * 1.5) : 1;
    if (t <= 5) {
      const [l1, l2, r1, r2] = this.s;
      for (let i = 0; i < n; i++) {
        let x = L[i], y = R[i];
        if (this.drive > 0) { x = softclip(x * pre) * post; y = softclip(y * pre) * post; }
        l1.tick(x); r1.tick(y);
        switch (t) {
          case 0: x = l1.lp; y = r1.lp; break;
          case 1: l2.tick(l1.lp); r2.tick(r1.lp); x = l2.lp; y = r2.lp; break;
          case 2: x = l1.hp; y = r1.hp; break;
          case 3: l2.tick(l1.hp); r2.tick(r1.hp); x = l2.hp; y = r2.hp; break;
          case 4: x = l1.bp * 1.5; y = r1.bp * 1.5; break;
          default: x = l1.lp + l1.hp; y = r1.lp + r1.hp; break;
        }
        L[i] = x; R[i] = y;
      }
    } else if (t === 7) {
      const f = this.form;
      for (let i = 0; i < n; i++) {
        let x = L[i], y = R[i];
        if (this.drive > 0) { x = softclip(x * pre) * post; y = softclip(y * pre) * post; }
        L[i] = (f[0].bandpass(x) + f[1].bandpass(x) * 0.7 + f[2].bandpass(x) * 0.4) * 1.6;
        R[i] = (f[3].bandpass(y) + f[4].bandpass(y) * 0.7 + f[5].bandpass(y) * 0.4) * 1.6;
      }
    } else {
      const len = this.combLen, d = this.combDelay, fb = this.combFb;
      for (let i = 0; i < n; i++) {
        let x = L[i], y = R[i];
        if (this.drive > 0) { x = softclip(x * pre) * post; y = softclip(y * pre) * post; }
        let rp = this.combIdx - d; if (rp < 0) rp += len;
        const ri = rp | 0, rf = rp - ri, ri2 = (ri + 1) % len;
        const dl = this.combL[ri] + rf * (this.combL[ri2] - this.combL[ri]);
        const dr = this.combR[ri] + rf * (this.combR[ri2] - this.combR[ri]);
        const ol = x + fb * dl, or = y + fb * dr;
        this.combL[this.combIdx] = ol; this.combR[this.combIdx] = or;
        this.combIdx = (this.combIdx + 1) % len;
        L[i] = ol * 0.6; R[i] = or * 0.6;
      }
    }
  }
}

// --------------------------------------------------------------- envolvente
// ADSR exponencial calculado por bloque, con avance analítico y detección de
// cambio de etapa dentro del bloque.
class ADSR {
  constructor(sr) { this.sr = sr; this.stage = 0; this.v = 0; this.a = 0.01; this.d = 0.3; this.s = 0.7; this.r = 0.3; this.curve = 0; }
  gate(on, retrig = true) {
    if (on) { if (retrig || this.stage === 0 || this.stage === 4) this.stage = 1; }
    else if (this.stage !== 0) this.stage = 4;
  }
  get active() { return this.stage !== 0; }
  kill() { this.stage = 0; this.v = 0; }
  set(a, d, s, r, curve) { this.a = a; this.d = d; this.s = s; this.r = r; this.curve = curve; }
  // avanza n muestras y devuelve el valor al final
  advance(n) {
    let rem = n;
    while (rem > 0 && this.stage !== 0) {
      let target, tau, done = false, steps = rem;
      if (this.stage === 1) {
        const over = 0.08 + 1.2 * (this.curve + 1) * 0.5; // curva: -1 muy exponencial, +1 casi lineal
        target = 1 + over;
        tau = this.a * this.sr / Math.log((1 + over) / over);
        // muestras hasta llegar a 1
        if (this.v < 1) {
          const need = Math.ceil(tau * Math.log((target - this.v) / (target - 1)));
          if (need <= rem) { steps = need; done = true; }
        } else { done = true; steps = 0; }
      } else if (this.stage === 2) {
        const under = 0.02 + 0.3 * (1 - this.curve) * 0.5;
        target = this.s - under;
        tau = this.d * this.sr / 4;
        if (this.v > this.s + 1e-4) {
          const need = Math.ceil(tau * Math.log((this.v - target) / (this.s - target)));
          if (need <= rem) { steps = need; done = true; }
        } else { done = true; steps = 0; }
      } else if (this.stage === 3) {
        this.v = this.s; rem = 0; break;
      } else {
        const under = 0.02 + 0.3 * (1 - this.curve) * 0.5;
        target = -under;
        tau = this.r * this.sr / 4;
        if (this.v > 1e-4) {
          const need = Math.ceil(tau * Math.log((this.v - target) / (1e-4 - target)));
          if (need <= rem) { steps = need; done = true; }
        } else { done = true; steps = 0; }
      }
      if (steps > 0) this.v = target + (this.v - target) * Math.exp(-steps / Math.max(tau, 1));
      rem -= steps;
      if (done) {
        if (this.stage === 1) { this.v = 1; this.stage = 2; }
        else if (this.stage === 2) { this.v = this.s; this.stage = 3; }
        else { this.v = 0; this.stage = 0; }
      }
    }
    return this.v;
  }
}

// --------------------------------------------------------------------- LFO
class LFO {
  constructor(sr) { this.sr = sr; this.ph = 0; this.value = 0; this.shVal = 0; this.shNext = 0; this.lastCycle = -1; this.smooth = 0; this.out = 0; }
  reset(phase) { this.ph = phase; this.lastCycle = -1; this.shVal = rnd() * 2 - 1; this.shNext = rnd() * 2 - 1; }
  // avanza n muestras; devuelve valor -1..1 al inicio del bloque
  advance(shape, rateHz, phaseOff, smooth, n) {
    const p = this.ph + phaseOff - Math.floor(this.ph + phaseOff);
    const cyc = Math.floor(this.ph);
    if (cyc !== this.lastCycle) { this.lastCycle = cyc; this.shVal = this.shNext; this.shNext = rnd() * 2 - 1; }
    let v;
    switch (shape) {
      case 0: v = sinC(p); break;
      case 1: v = p < 0.5 ? p * 4 - 1 : 3 - p * 4; break;
      case 2: v = 1 - p * 2; break;
      case 3: v = p < 0.5 ? 1 : -1; break;
      case 4: v = this.shVal; break;
      default: { const t = 0.5 - 0.5 * Math.cos(p * Math.PI); v = this.shVal + (this.shNext - this.shVal) * t; break; }
    }
    this.ph += rateHz * n / this.sr;
    if (this.ph > 1e6) this.ph -= 1e6;
    const k = smooth > 0 ? Math.exp(-n / (this.sr * smooth * 0.5 + 1)) : 0;
    this.out = this.out * k + v * (1 - k);
    return this.out;
  }
}

// ------------------------------------------------------------------ motores
// Cada motor se instancia por voz y por slot (A/B). render() escribe estéreo
// en L/R (n muestras) para la frecuencia base `freq`, leyendo parámetros ya
// modulados desde `p` (Float32Array indexada por índice de parámetro).

function unisonSetup(N, detuneCents, spread, out) {
  // out.ratio[u], out.gl[u], out.gr[u]
  const g = 1 / Math.sqrt(N);
  for (let u = 0; u < N; u++) {
    const c = N > 1 ? (2 * u / (N - 1) - 1) : 0;
    out.ratio[u] = Math.pow(2, detuneCents * c / 1200);
    const pan = c * spread;
    out.gl[u] = g * Math.cos((pan + 1) * Math.PI / 4);
    out.gr[u] = g * Math.sin((pan + 1) * Math.PI / 4);
  }
}
function fold(x) { // plegado de onda: triangular en |x|>1
  x = (x + 1) * 0.25;
  x -= Math.floor(x);
  return Math.abs(x * 4 - 2) - 1;
}

class VAEngine {
  constructor(core, X) {
    this.sr = core.sr;
    const i = (s) => core.idx(`${X}.va.${s}`);
    this.iWave = i('wave'); this.iPw = i('pw'); this.iUni = i('unison'); this.iDet = i('detune');
    this.iSpread = i('spread'); this.iSub = i('sub'); this.iSubW = i('subWave'); this.iNoise = i('noise'); this.iSync = i('sync');
    this.ph = new Float64Array(7); this.subPh = 0;
    this.uni = { ratio: new Float64Array(7), gl: new Float32Array(7), gr: new Float32Array(7) };
  }
  noteOn() { for (let u = 0; u < 7; u++) this.ph[u] = rnd() * (u ? 1 : 0.0); this.subPh = 0; }
  render(L, R, n, freq, p) {
    const wave = p[this.iWave] | 0, pw = p[this.iPw], N = clamp(p[this.iUni] | 0, 1, 7);
    const sub = p[this.iSub], subW = p[this.iSubW] | 0, noise = p[this.iNoise], sync = p[this.iSync];
    unisonSetup(N, p[this.iDet], p[this.iSpread], this.uni);
    const sr = this.sr;
    L.fill(0); R.fill(0);
    for (let u = 0; u < N; u++) {
      const inc = freq * this.uni.ratio[u] / sr;
      if (inc >= 0.5) continue;
      let ph = this.ph[u];
      const gl = this.uni.gl[u], gr = this.uni.gr[u];
      const sinc = inc * sync;
      for (let i = 0; i < n; i++) {
        let t = ph, s;
        if (sync > 1.001) { t = ph * sync; t -= Math.floor(t); }
        switch (wave) {
          case 0: s = sinC(t); break;
          case 1: s = t < 0.5 ? t * 4 - 1 : 3 - t * 4; break;
          case 2: s = 2 * t - 1 - polyblep(t, sinc); break;
          default: {
            let t2 = t + 1 - pw; t2 -= Math.floor(t2);
            s = (t < pw ? 1 : -1) + polyblep(t, sinc) - polyblep(t2, sinc);
            break;
          }
        }
        L[i] += s * gl; R[i] += s * gr;
        ph += inc; if (ph >= 1) ph -= 1;
      }
      this.ph[u] = ph;
    }
    if (sub > 0 || noise > 0) {
      const sinc = freq * 0.5 / sr;
      for (let i = 0; i < n; i++) {
        let s = 0;
        if (sub > 0) {
          s = (subW ? (this.subPh < 0.5 ? 1 : -1) * 0.7 : sinC(this.subPh)) * sub;
          this.subPh += sinc; if (this.subPh >= 1) this.subPh -= 1;
        }
        if (noise > 0) s += (rnd() * 2 - 1) * noise * 0.5;
        L[i] += s * 0.7; R[i] += s * 0.7;
      }
    }
  }
}

class WTEngine {
  constructor(core, X) {
    this.sr = core.sr; this.bank = core.wt;
    const i = (s) => core.idx(`${X}.wt.${s}`);
    this.iTable = i('table'); this.iPos = i('pos'); this.iWarp = i('warp'); this.iMode = i('warpMode');
    this.iUni = i('unison'); this.iDet = i('detune'); this.iSpread = i('spread');
    this.ph = new Float64Array(7);
    this.uni = { ratio: new Float64Array(7), gl: new Float32Array(7), gr: new Float32Array(7) };
  }
  noteOn() { for (let u = 0; u < 7; u++) this.ph[u] = u ? rnd() : 0; }
  render(L, R, n, freq, p) {
    const table = clamp(p[this.iTable] | 0, 0, WT_DEFS.length - 1);
    const pos = clamp(p[this.iPos], 0, 1) * (WT_FRAMES - 1);
    const f0 = pos | 0, f1 = Math.min(f0 + 1, WT_FRAMES - 1), ff = pos - f0;
    const warp = p[this.iWarp], mode = p[this.iMode] | 0;
    const N = clamp(p[this.iUni] | 0, 1, 7);
    unisonSetup(N, p[this.iDet], p[this.iSpread], this.uni);
    const mip = WavetableBank.mipFor(freq * this.uni.ratio[N - 1] * (mode === 1 ? 1 + warp * 7 : 1), this.sr);
    const A = this.bank.frame(table, f0, mip), B = this.bank.frame(table, f1, mip);
    const bend = 0.5 - warp * 0.45, foldAmt = 1 + warp * 4, syncR = 1 + warp * 7;
    L.fill(0); R.fill(0);
    for (let u = 0; u < N; u++) {
      const inc = freq * this.uni.ratio[u] / this.sr;
      let ph = this.ph[u];
      const gl = this.uni.gl[u], gr = this.uni.gr[u];
      for (let i = 0; i < n; i++) {
        let t = ph;
        if (warp > 0.001) {
          if (mode === 0) t = t < bend ? t * 0.5 / bend : 0.5 + (t - bend) * 0.5 / (1 - bend);
          else if (mode === 1) { t = t * syncR; t -= Math.floor(t); }
          else if (mode === 3) { const m = t < 0.5 ? t * 2 : (1 - t) * 2; t = t + (m - t) * warp; }
        }
        const x = t * WT_SIZE, xi = x | 0, xf = x - xi;
        let s = (A[xi] + xf * (A[xi + 1] - A[xi])) * (1 - ff) + (B[xi] + xf * (B[xi + 1] - B[xi])) * ff;
        if (mode === 2 && warp > 0.001) s = fold(s * foldAmt);
        L[i] += s * gl; R[i] += s * gr;
        ph += inc; if (ph >= 1) ph -= 1;
      }
      this.ph[u] = ph;
    }
  }
}

class FMEngine {
  constructor(core, X) {
    this.sr = core.sr;
    const i = (s) => core.idx(`${X}.fm.${s}`);
    this.iAlg = i('alg'); this.iR2 = i('ratio2'); this.iI2 = i('index2'); this.iR3 = i('ratio3'); this.iI3 = i('index3');
    this.iFb = i('feedback'); this.iShape = i('shape');
    this.ph1 = 0; this.ph2 = 0; this.ph3 = 0; this.fb1 = 0; this.fb2 = 0;
  }
  noteOn() { this.ph1 = 0; this.ph2 = 0; this.ph3 = 0; this.fb1 = 0; this.fb2 = 0; }
  render(L, R, n, freq, p) {
    const alg = p[this.iAlg] | 0, K = 0.159;
    const I2 = p[this.iI2] * K, I3 = p[this.iI3] * K, fb = p[this.iFb] * 0.35, shape = p[this.iShape];
    const inc1 = freq / this.sr, inc2 = inc1 * p[this.iR2], inc3 = inc1 * p[this.iR3];
    let ph1 = this.ph1, ph2 = this.ph2, ph3 = this.ph3, fb1 = this.fb1, fb2 = this.fb2;
    const foldAmt = 1 + shape * 3;
    for (let i = 0; i < n; i++) {
      const o3 = sinC(ph3 + fb * (fb1 + fb2) * 0.5);
      fb2 = fb1; fb1 = o3;
      let out;
      if (alg === 0) { const o2 = sinC(ph2 + I3 * o3); out = sinC(ph1 + I2 * o2); }
      else if (alg === 1) { const o2 = sinC(ph2); out = sinC(ph1 + I2 * o2 + I3 * o3); }
      else if (alg === 2) { const o2 = sinC(ph2 + I3 * o3); out = (sinC(ph1 + I2 * o2) + o2) * 0.6; }
      else { out = (sinC(ph1) + sinC(ph2) * Math.min(1, I2 * 2) + o3 * Math.min(1, I3 * 2)) * 0.5; }
      if (shape > 0.001) out = fold(out * foldAmt);
      L[i] = out; R[i] = out;
      ph1 += inc1; ph2 += inc2; ph3 += inc3;
      if (ph1 >= 1) ph1 -= 1; if (ph2 >= 1) ph2 -= 1; if (ph3 >= 1) ph3 -= 1;
    }
    this.ph1 = ph1; this.ph2 = ph2; this.ph3 = ph3; this.fb1 = fb1; this.fb2 = fb2;
  }
}

const MAX_GRAINS = 48;
class GranularEngine {
  constructor(core, X) {
    this.sr = core.sr; this.core = core;
    const i = (s) => core.idx(`${X}.gran.${s}`);
    this.iSrc = i('source'); this.iSize = i('size'); this.iDens = i('density'); this.iPos = i('pos');
    this.iSpray = i('spray'); this.iPr = i('pitchRnd'); this.iShape = i('shape'); this.iScan = i('scan');
    this.gPos = new Float64Array(MAX_GRAINS); this.gInc = new Float64Array(MAX_GRAINS);
    this.gLen = new Int32Array(MAX_GRAINS); this.gAge = new Int32Array(MAX_GRAINS);
    this.gL = new Float32Array(MAX_GRAINS); this.gR = new Float32Array(MAX_GRAINS);
    this.active = new Uint8Array(MAX_GRAINS);
    this.acc = 0; this.elapsed = 0;
  }
  noteOn() { this.active.fill(0); this.acc = 1; this.elapsed = 0; }
  render(L, R, n, freq, p) {
    const src = this.core.sourceBuffer(p[this.iSrc] | 0);
    L.fill(0); R.fill(0);
    if (!src) return;
    const buf = src.buffer, root = src.root, len = buf.length;
    const size = p[this.iSize] * 0.001 * this.sr, dens = p[this.iDens], pos = p[this.iPos];
    const spray = p[this.iSpray], pr = p[this.iPr], shape = p[this.iShape], scan = p[this.iScan];
    const basePos = (pos + scan * this.elapsed / len) % 1;
    const norm = 1 / Math.sqrt(Math.max(1, dens * size / this.sr));
    const ramp = Math.max(0.02, shape * 0.5);
    // spawn
    this.acc += dens * n / this.sr;
    while (this.acc >= 1) {
      this.acc -= 1;
      let g = -1;
      for (let k = 0; k < MAX_GRAINS; k++) if (!this.active[k]) { g = k; break; }
      if (g < 0) break;
      let start = ((basePos + (rnd() * 2 - 1) * spray * 0.5) % 1 + 1) % 1;
      const glen = Math.max(32, size * (0.8 + rnd() * 0.4)) | 0;
      this.gPos[g] = start * Math.max(1, len - glen - 1);
      this.gInc[g] = (freq / root) * Math.pow(2, (rnd() * 2 - 1) * pr / 12);
      this.gLen[g] = glen; this.gAge[g] = 0;
      const pan = (rnd() - 0.5) * spray;
      this.gL[g] = Math.cos((pan + 1) * Math.PI / 4) * norm; this.gR[g] = Math.sin((pan + 1) * Math.PI / 4) * norm;
      this.active[g] = 1;
    }
    for (let g = 0; g < MAX_GRAINS; g++) {
      if (!this.active[g]) continue;
      let pos_ = this.gPos[g], age = this.gAge[g];
      const inc = this.gInc[g], glen = this.gLen[g], gl = this.gL[g], gr = this.gR[g];
      for (let i = 0; i < n; i++) {
        if (age >= glen || pos_ >= len - 2) { this.active[g] = 0; break; }
        const t = age / glen;
        let w = 1;
        if (t < ramp) w = 0.5 - 0.5 * Math.cos(Math.PI * t / ramp);
        else if (t > 1 - ramp) w = 0.5 - 0.5 * Math.cos(Math.PI * (1 - t) / ramp);
        const pi = pos_ | 0, pf = pos_ - pi;
        const s = (buf[pi] + pf * (buf[pi + 1] - buf[pi])) * w;
        L[i] += s * gl; R[i] += s * gr;
        pos_ += inc; age++;
      }
      this.gPos[g] = pos_; this.gAge[g] = age;
    }
    this.elapsed += n;
  }
}

const MAX_PARTIALS = 32;
class HarmonicEngine {
  constructor(core, X) {
    this.sr = core.sr;
    const i = (s) => core.idx(`${X}.harm.${s}`);
    this.iN = i('partials'); this.iTilt = i('tilt'); this.iOE = i('oddEven'); this.iStr = i('stretch'); this.iComb = i('comb'); this.iDet = i('detune');
    this.ph = new Float64Array(MAX_PARTIALS); this.amp = new Float32Array(MAX_PARTIALS); this.tgt = new Float32Array(MAX_PARTIALS);
    this.rndK = new Float32Array(MAX_PARTIALS);
  }
  noteOn() { for (let k = 0; k < MAX_PARTIALS; k++) { this.ph[k] = rnd(); this.rndK[k] = rnd() * 2 - 1; } this.amp.fill(0); }
  render(L, R, n, freq, p) {
    const np = p[this.iN], tilt = p[this.iTilt], oe = p[this.iOE], str = p[this.iStr] * 0.005, comb = p[this.iComb], det = p[this.iDet];
    const period = 2 + 14 * comb;
    const nyq = this.sr * 0.5;
    let sum = 0;
    for (let k = 0; k < MAX_PARTIALS; k++) {
      const h = k + 1;
      let a = h <= np ? 1 : Math.max(0, 1 - (h - np));
      if (a > 0) {
        a *= 1 / Math.pow(h, tilt);
        if (h > 1) a *= (h % 2) ? 1 - Math.max(0, oe) : 1 - Math.max(0, -oe);
        if (comb > 0) a *= (1 - comb) + comb * (0.5 - 0.5 * Math.cos(TWO_PI * h / period));
      }
      this.tgt[k] = a; sum += a * a;
    }
    const g = 0.6 / Math.sqrt(Math.max(sum, 1e-6));
    L.fill(0);
    for (let k = 0; k < MAX_PARTIALS; k++) {
      const h = k + 1;
      const f = freq * h * Math.sqrt(1 + str * h * h) * Math.pow(2, det * this.rndK[k] * 0.03);
      let a = this.amp[k];
      const tg = f < nyq ? this.tgt[k] * g : 0;
      if (a === 0 && tg === 0) continue;
      const da = (tg - a) / n, inc = f / this.sr;
      let ph = this.ph[k];
      for (let i = 0; i < n; i++) { L[i] += sinC(ph) * a; ph += inc; a += da; }
      ph -= Math.floor(ph);
      this.ph[k] = ph; this.amp[k] = tg;
    }
    R.set(L);
  }
}

const MAX_MODES = 16;
const MODAL_GAIN = 1.2;
const MODAL_RATIOS = [
  Array.from({ length: 16 }, (_, i) => i + 1),                                   // cuerda
  [1, 2.756, 5.404, 8.933, 13.34, 18.64, 24.82, 31.87, 39.81, 48.63, 58.33, 68.9, 80.4, 92.7, 105.9, 120],  // barra
  [1, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501, 3.6, 3.652, 4.06, 4.154, 4.23, 4.601, 4.832, 4.879], // membrana
  [1, 2.0, 2.4, 3.0, 3.6, 4.2, 4.8, 5.4, 6.0, 6.7, 7.4, 8.1, 8.8, 9.6, 10.4, 11.2], // campana
];
class ModalEngine {
  constructor(core, X) {
    this.sr = core.sr;
    const i = (s) => core.idx(`${X}.modal.${s}`);
    this.iMat = i('material'); this.iModes = i('modes'); this.iDecay = i('decay'); this.iDamp = i('damp');
    this.iPos = i('pos'); this.iEx = i('exciter'); this.iExLen = i('exLen'); this.iBright = i('bright');
    this.y1 = new Float64Array(MAX_MODES); this.y2 = new Float64Array(MAX_MODES);
    this.exAge = 0; this.lp = 0; this.gate = false;
  }
  noteOn() { this.y1.fill(0); this.y2.fill(0); this.exAge = 0; this.lp = 0; this.gate = true; }
  render(L, R, n, freq, p, voice) {
    const mat = clamp(p[this.iMat], 0, 0.9999) * 3, mi = mat | 0, mf = mat - mi;
    const modes = clamp(p[this.iModes] | 0, 1, MAX_MODES), decay = p[this.iDecay], damp = p[this.iDamp];
    const pos = p[this.iPos], ex = p[this.iEx] | 0, bright = p[this.iBright];
    const exLen = (ex === 0 ? Math.min(p[this.iExLen], 4) : p[this.iExLen]) * 0.001 * this.sr;
    const gate = voice ? voice.gate : this.gate;
    const nyq = this.sr * 0.48;
    const lpk = 1 - Math.pow(0.02, 1 - bright * 0.98); // coeficiente de brillo (LP 1 polo)
    // ganancia de entrada: respuesta a impulso ≈ g/sin(w); una ráfaga de ruido de
    // exLen muestras acumula ~sqrt(exLen) de energía → compensar
    const exNorm = (ex === 2 ? 0.02 : 1.0 / Math.sqrt(Math.max(exLen, 8))) * MODAL_GAIN;
    // coeficientes por modo
    const A = this.coefA || (this.coefA = new Float64Array(MAX_MODES));
    const B = this.coefB || (this.coefB = new Float64Array(MAX_MODES));
    const G = this.coefG || (this.coefG = new Float64Array(MAX_MODES));
    for (let k = 0; k < modes; k++) {
      const ratio = lerp(MODAL_RATIOS[mi][k], MODAL_RATIOS[Math.min(mi + 1, 3)][k], mf);
      const f = freq * ratio;
      if (f >= nyq) { G[k] = 0; continue; }
      const dk = decay * (1 - damp * 0.92 * k / Math.max(1, modes - 1));
      const Rr = Math.exp(-6.91 / (Math.max(dk, 0.01) * this.sr));
      const w = TWO_PI * f / this.sr;
      A[k] = 2 * Rr * Math.cos(w); B[k] = -Rr * Rr;
      const amp = Math.abs(Math.sin(Math.PI * (k + 1) * pos)) / (1 + k * 0.15);
      G[k] = amp * Math.sin(w) * exNorm;
    }
    for (let i = 0; i < n; i++) {
      let x = 0;
      const age = this.exAge;
      if (ex === 2) { if (gate) x = (rnd() * 2 - 1) * 0.35; }
      else if (age < exLen) {
        const env = ex === 0 ? Math.exp(-age / (exLen * 0.3)) : 1 - age / exLen;
        x = (rnd() * 2 - 1) * env;
      }
      this.exAge = age + 1;
      this.lp += (x - this.lp) * lpk; x = this.lp;
      let y = 0;
      for (let k = 0; k < modes; k++) {
        const g = G[k]; if (g === 0) continue;
        const v = x * g + A[k] * this.y1[k] + B[k] * this.y2[k];
        this.y2[k] = this.y1[k]; this.y1[k] = v;
        y += v;
      }
      L[i] = y; R[i] = y;
    }
  }
}

class SampleEngine {
  constructor(core, X) {
    this.sr = core.sr; this.core = core;
    const i = (s) => core.idx(`${X}.smp.${s}`);
    this.iSrc = i('source'); this.iStart = i('start'); this.iLoop = i('loop'); this.iLoopLen = i('loopLen'); this.iTone = i('tone');
    this.pos = 0; this.lp = 0; this.done = false;
  }
  noteOn() { this.pos = -1; this.lp = 0; this.done = false; }
  render(L, R, n, freq, p) {
    const src = this.core.sourceBuffer(p[this.iSrc] | 0);
    L.fill(0); R.fill(0);
    if (!src || this.done) return;
    const buf = src.buffer, len = buf.length;
    const start = p[this.iStart] * (len - 2);
    if (this.pos < 0) this.pos = start;
    const loop = p[this.iLoop] > 0.5, loopEnd = Math.min(len - 2, start + p[this.iLoopLen] * len);
    const inc = freq / src.root;
    const tone = p[this.iTone];
    const k = tone >= 19000 ? 1 : 1 - Math.exp(-TWO_PI * tone / this.sr);
    let pos = this.pos;
    for (let i = 0; i < n; i++) {
      if (pos >= loopEnd - 1 || pos >= len - 2) {
        if (loop && loopEnd - start > 64) pos = start + (pos - loopEnd);
        else { this.done = true; break; }
        if (pos < start || pos >= loopEnd) pos = start;
      }
      const pi = pos | 0, pf = pos - pi;
      let s = buf[pi] + pf * (buf[pi + 1] - buf[pi]);
      if (k < 1) { this.lp += (s - this.lp) * k; s = this.lp; }
      L[i] = s; R[i] = s;
      pos += inc;
    }
    this.pos = pos;
  }
}

const ENGINE_CLASSES = [VAEngine, WTEngine, FMEngine, GranularEngine, HarmonicEngine, ModalEngine, SampleEngine];

// --------------------------------------------------------------------- voz
class Voice {
  constructor(core, id) {
    this.core = core; this.id = id; const sr = core.sr;
    this.note = 60; this.vel = 1; this.gate = false; this.active = false; this.age = 0; this.random = 0;
    this.pitch = 60; this.targetPitch = 60;
    this.engines = { a: ENGINE_CLASSES.map(C => new C(core, 'a')), b: ENGINE_CLASSES.map(C => new C(core, 'b')) };
    this.filt = [new VoiceFilter(sr), new VoiceFilter(sr)];
    this.env = [new ADSR(sr), new ADSR(sr), new ADSR(sr)];
    this.lfo = [new LFO(sr), new LFO(sr), new LFO(sr)];
    this.p = new Float32Array(core.defs.length);
    this.src = new Float32Array(core.nSrc);
    this.aL = new Float32Array(BLOCK); this.aR = new Float32Array(BLOCK);
    this.bL = new Float32Array(BLOCK); this.bR = new Float32Array(BLOCK);
    this.f1L = new Float32Array(BLOCK); this.f1R = new Float32Array(BLOCK);
    this.f2L = new Float32Array(BLOCK); this.f2R = new Float32Array(BLOCK);
    this.oL = new Float32Array(BLOCK); this.oR = new Float32Array(BLOCK);
    this.ampPrev = 0;
    const I = core.I;
    this.I = I;
  }
  noteOn(note, vel, legato) {
    const c = this.core, I = c.I, g = c.gval;
    this.note = note; this.vel = vel; this.gate = true; this.age = 0;
    this.targetPitch = note;
    if (g[I.glide] <= 0.001 || c.lastPitch === null) this.pitch = note;
    else if (!legato) this.pitch = c.lastPitch;
    this.active = true;
    if (!legato) {
      this.random = rnd();
      this.typeA = g[I.aType] | 0; this.typeB = g[I.bType] | 0;
      this.engines.a[this.typeA].noteOn(); this.engines.b[this.typeB].noteOn();
      for (let k = 0; k < 3; k++) {
        if (g[I.lfoRetrig[k]] > 0.5) this.lfo[k].reset(0);
        this.env[k].gate(true, true);
      }
      this.filt[0].reset(); this.filt[1].reset();
      this.ampPrev = 0;
    } else {
      for (let k = 0; k < 3; k++) this.env[k].gate(true, false);
    }
  }
  noteOff() { this.gate = false; for (const e of this.env) e.gate(false); }
  kill() { this.active = false; this.gate = false; for (const e of this.env) e.kill(); }

  process(outL, outR) {
    const c = this.core, I = c.I, p = this.p, n = BLOCK;
    // 1) fuentes de modulación al inicio del bloque
    const s = this.src;
    s[0] = this.env[0].v; s[1] = this.env[1].v; s[2] = this.env[2].v;
    s[3] = this.lfo[0].out; s[4] = this.lfo[1].out; s[5] = this.lfo[2].out;
    s[6] = c.gval[I.macro[0]]; s[7] = c.gval[I.macro[1]]; s[8] = c.gval[I.macro[2]]; s[9] = c.gval[I.macro[3]];
    s[10] = this.vel; s[11] = clamp((this.note - 60) / 48, -1, 1); s[12] = c.modwheel; s[13] = c.bend; s[14] = this.random;
    // 2) parámetros modulados
    p.set(c.gval);
    c.applyMods(p, s, c.voiceTargets);
    // 3) afinación
    const glide = p[I.glide];
    if (glide > 0.001) {
      const k = 1 - Math.exp(-n / (glide * c.sr * 0.3));
      this.pitch += (this.targetPitch - this.pitch) * k;
    } else this.pitch = this.targetPitch;
    const bendSemi = c.bend * p[I.bendRange];
    const fA = midiToHz(this.pitch + p[I.aOct] * 12 + p[I.aSemi] + p[I.aFine] / 100 + bendSemi);
    const fB = midiToHz(this.pitch + p[I.bOct] * 12 + p[I.bSemi] + p[I.bFine] / 100 + bendSemi);
    // 4) motores
    const aOn = p[I.aOn] > 0.5, bOn = p[I.bOn] > 0.5;
    if (aOn) this.engines.a[this.typeA].render(this.aL, this.aR, n, fA, p, this); else { this.aL.fill(0); this.aR.fill(0); }
    if (bOn) this.engines.b[this.typeB].render(this.bL, this.bR, n, fB, p, this); else { this.bL.fill(0); this.bR.fill(0); }
    // 5) nivel y paneo
    const applyLevel = (L, R, lvl, pan) => {
      const gl = lvl * Math.cos((pan + 1) * Math.PI / 4) * 1.4, gr = lvl * Math.sin((pan + 1) * Math.PI / 4) * 1.4;
      for (let i = 0; i < n; i++) { L[i] *= gl; R[i] *= gr; }
    };
    if (aOn) applyLevel(this.aL, this.aR, p[I.aLevel], p[I.aPan]);
    if (bOn) applyLevel(this.bL, this.bR, p[I.bLevel], p[I.bPan]);
    // scope para la UI
    c.scopeAdd(this.aL, this.bL);
    // 6) ruteo de filtros
    const f1L = this.f1L, f1R = this.f1R, f2L = this.f2L, f2R = this.f2R, oL = this.oL, oR = this.oR;
    f1L.fill(0); f1R.fill(0); f2L.fill(0); f2R.fill(0); oL.fill(0); oR.fill(0);
    const route = (L, R, mode) => {
      if (mode === 0 || mode === 2) for (let i = 0; i < n; i++) { f1L[i] += L[i]; f1R[i] += R[i]; }
      if (mode === 1 || mode === 2) for (let i = 0; i < n; i++) { f2L[i] += L[i]; f2R[i] += R[i]; }
      if (mode === 3) for (let i = 0; i < n; i++) { oL[i] += L[i]; oR[i] += R[i]; }
    };
    if (aOn) route(this.aL, this.aR, p[I.aRoute] | 0);
    if (bOn) route(this.bL, this.bR, p[I.bRoute] | 0);
    const kt = Math.pow(2, (this.note - 60) / 12);
    for (let f = 0; f < 2; f++) {
      const cut = p[I.fCut[f]] * Math.pow(kt, p[I.fKey[f]]);
      this.filt[f].set(p[I.fType[f]] | 0, cut, p[I.fRes[f]], p[I.fDrive[f]]);
    }
    const series = p[I.fRouting] > 0.5;
    this.filt[0].process(f1L, f1R, n);
    if (series) for (let i = 0; i < n; i++) { f2L[i] += f1L[i]; f2R[i] += f1R[i]; }
    this.filt[1].process(f2L, f2R, n);
    if (series) for (let i = 0; i < n; i++) { oL[i] += f2L[i]; oR[i] += f2R[i]; }
    else for (let i = 0; i < n; i++) { oL[i] += f1L[i] + f2L[i]; oR[i] += f1R[i] + f2R[i]; }
    // 7) amplificador
    for (let k = 0; k < 3; k++) {
      const b = I.env[k];
      this.env[k].set(p[b], p[b + 1], p[b + 2], p[b + 3], p[b + 4]);
    }
    const a0 = this.ampPrev;
    const a1 = this.env[0].advance(n);
    this.env[1].advance(n); this.env[2].advance(n);
    this.ampPrev = a1;
    const vg = (0.2 + 0.8 * this.vel) * 0.5;
    const da = (a1 - a0) / n;
    let amp = a0 * vg;
    const dda = da * vg;
    for (let i = 0; i < n; i++) { outL[i] += oL[i] * amp; outR[i] += oR[i] * amp; amp += dda; }
    // 8) LFOs para el siguiente bloque
    for (let k = 0; k < 3; k++) {
      const b = I.lfo[k];
      const rate = p[b + 2] > 0.5 ? c.divHz(p[b + 3] | 0) : p[b + 1];
      this.lfo[k].advance(p[b] | 0, rate, p[b + 4], p[b + 6], n);
    }
    this.age += n;
    if (!this.env[0].active) this.active = false;
  }
}

// ----------------------------------------------------------------- efectos
// Todos reciben (L, R, n, v) donde v[0..5] son los parámetros ya convertidos
// a su rango real (según FX_TYPES), y mezclan según `mix` internamente.
class DelayLine {
  constructor(len) { this.buf = new Float32Array(len); this.len = len; this.w = 0; }
  write(x) { this.buf[this.w] = x; this.w = (this.w + 1) % this.len; }
  read(d) { // d en muestras (float), relativo a la última escritura
    let rp = this.w - 1 - d; while (rp < 0) rp += this.len;
    const ri = rp | 0, rf = rp - ri, ri2 = (ri + 1) % this.len;
    return this.buf[ri] + rf * (this.buf[ri2] - this.buf[ri]);
  }
}

class CorroderFX {
  constructor(sr) { this.sr = sr; this.ph = [0, 0]; this.env = [0, 0]; this.lp = [0, 0]; this.fb = [0, 0]; this.g = [1, 1]; this.gTgt = [1, 1]; this.gCount = 0; }
  process(L, R, n, v, mix) {
    const [freq, depth, grain, rate, tone, fb] = v;
    const inc = freq / this.sr, k = 1 - Math.exp(-TWO_PI * tone / this.sr);
    const rel = Math.exp(-1 / (0.05 * this.sr));
    const grainSamples = Math.max(1, this.sr / rate) | 0;
    const dry = 1 - mix;
    for (let i = 0; i < n; i++) {
      if (--this.gCount <= 0) { this.gCount = grainSamples; this.gTgt[0] = rnd(); this.gTgt[1] = rnd(); }
      for (let ch = 0; ch < 2; ch++) {
        const buf = ch ? R : L;
        const x = buf[i];
        const ax = Math.abs(x);
        this.env[ch] = ax > this.env[ch] ? ax : this.env[ch] * rel;
        this.ph[ch] += inc; if (this.ph[ch] >= 1) this.ph[ch] -= 1;
        let y = sinC(this.ph[ch] + depth * 3 * (x + fb * this.fb[ch]));
        y *= Math.min(1, this.env[ch] * 1.5);
        this.g[ch] += (this.gTgt[ch] - this.g[ch]) * 0.05;
        y *= 1 - grain + grain * this.g[ch] * 1.5;
        this.lp[ch] += (y - this.lp[ch]) * k; y = this.lp[ch];
        this.fb[ch] = y;
        buf[i] = x * dry + y * mix;
      }
    }
  }
}

class DistortionFX {
  constructor(sr) { this.sr = sr; this.lp = [0, 0]; this.hp = [0, 0]; this.hpx = [0, 0]; this.hold = [0, 0]; this.cnt = 0; }
  process(L, R, n, v, mix) {
    const [drive, type, tone, bias, lowcut, out] = v;
    const t = Math.round(type);
    const pre = 1 + drive * 30;
    const k = 1 - Math.exp(-TWO_PI * tone / this.sr);
    const hk = Math.exp(-TWO_PI * lowcut / this.sr);
    const bits = 16 - drive * 13, q = Math.pow(2, bits) * 0.5;
    const dec = Math.max(1, Math.round(1 + drive * 24));
    const og = out * 1.4 / Math.sqrt(1 + drive * 2);
    const dry = 1 - mix;
    for (let i = 0; i < n; i++) {
      if (t === 3 && ++this.cnt >= dec) this.cnt = 0;
      for (let ch = 0; ch < 2; ch++) {
        const buf = ch ? R : L;
        const x0 = buf[i];
        let x = x0 * pre + bias * 0.5;
        switch (t) {
          case 0: x = softclip(x); break;
          case 1: x = clamp(x, -1, 1); break;
          case 2: x = fold(x * 0.5); break;
          default:
            if (this.cnt === 0) this.hold[ch] = Math.round(clamp(x, -1, 1) * q) / q;
            x = this.hold[ch];
        }
        // lowcut 1 polo + tone LP
        const hp = x - this.hpx[ch] + hk * this.hp[ch];
        this.hpx[ch] = x; this.hp[ch] = hp; x = hp;
        this.lp[ch] += (x - this.lp[ch]) * k;
        buf[i] = x0 * dry + this.lp[ch] * og * mix;
      }
    }
  }
}

class FilterFX {
  constructor(sr) { this.sr = sr; this.s = [new SVF(sr), new SVF(sr), new SVF(sr), new SVF(sr)]; this.env = 0; }
  process(L, R, n, v, mix) {
    const [cutoff, res, type, drive, slope, follow] = v;
    const t = Math.round(type), s2 = slope > 0.5;
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    this.env = peak > this.env ? peak : this.env * 0.9;
    const fc = clamp(cutoff * Math.pow(2, follow * 4 * Math.min(1, this.env * 2)), 20, 20000);
    for (const f of this.s) f.setCoeffs(fc, res * (s2 ? 0.85 : 1));
    const pre = 1 + drive * 6, post = 1 / (1 + drive * 1.5);
    const dry = 1 - mix;
    for (let i = 0; i < n; i++) {
      for (let ch = 0; ch < 2; ch++) {
        const buf = ch ? R : L;
        const x0 = buf[i];
        let x = drive > 0 ? softclip(x0 * pre) * post : x0;
        const f1 = this.s[ch * 2], f2 = this.s[ch * 2 + 1];
        f1.tick(x);
        let y = t === 0 ? f1.lp : t === 1 ? f1.hp : t === 2 ? f1.bp * 1.5 : f1.lp + f1.hp;
        if (s2) { f2.tick(y); y = t === 0 ? f2.lp : t === 1 ? f2.hp : t === 2 ? f2.bp * 1.5 : f2.lp + f2.hp; }
        buf[i] = x0 * dry + y * mix;
      }
    }
  }
}

class ChorusFX {
  constructor(sr) { this.sr = sr; this.dl = [new DelayLine(sr * 0.1 | 0), new DelayLine(sr * 0.1 | 0)]; this.ph = 0; this.fbs = [0, 0]; }
  process(L, R, n, v, mix) {
    const [rate, depth, delayMs, fb, spread, voices] = v;
    const nv = Math.round(voices) + 1;
    const base = delayMs * 0.001 * this.sr, dep = depth * base * 0.6;
    const inc = rate / this.sr;
    const dry = 1 - mix;
    for (let i = 0; i < n; i++) {
      this.ph += inc; if (this.ph >= 1) this.ph -= 1;
      for (let ch = 0; ch < 2; ch++) {
        const buf = ch ? R : L;
        const x = buf[i];
        const dl = this.dl[ch];
        dl.write(x + this.fbs[ch] * fb);
        let y = 0;
        for (let k = 0; k < nv; k++) {
          const p = this.ph + ch * 0.25 * spread + k / nv;
          const d = base + dep * sinC(p);
          y += dl.read(Math.max(1, d));
        }
        y /= nv;
        this.fbs[ch] = y;
        buf[i] = x * dry + (x * 0.7 + y) * mix * 0.8;
      }
    }
  }
}

class PhaserFX {
  constructor(sr) { this.sr = sr; this.z = [new Float32Array(8), new Float32Array(8)]; this.ph = 0; this.fb = [0, 0]; }
  process(L, R, n, v, mix) {
    const [rate, depth, center, fb, stages, spread] = v;
    const ns = (Math.round(stages) + 1) * 2;
    const inc = rate / this.sr;
    const dry = 1 - mix;
    for (let i = 0; i < n; i++) {
      this.ph += inc; if (this.ph >= 1) this.ph -= 1;
      for (let ch = 0; ch < 2; ch++) {
        const buf = ch ? R : L;
        const x = buf[i];
        const lfo = sinC(this.ph + ch * spread * 0.5);
        const f = clamp(center * Math.pow(2, lfo * depth * 2.5), 40, this.sr * 0.45);
        const tn = Math.tan(Math.PI * f / this.sr);
        const a = (1 - tn) / (1 + tn);
        let y = x + this.fb[ch] * fb;
        const z = this.z[ch];
        for (let s = 0; s < ns; s++) {
          const out = a * y + z[s];      // allpass 1er orden: y = a·x + x1 − a·y1
          z[s] = y - a * out;
          y = out;
        }
        this.fb[ch] = y;
        buf[i] = x * dry + (x + y) * 0.5 * mix;
      }
    }
  }
}

class DelayFX {
  constructor(sr) { this.sr = sr; this.dl = [new DelayLine(sr * 2.2 | 0), new DelayLine(sr * 2.2 | 0)]; this.cur = -1; this.lp = [0, 0]; this.hp = [0, 0]; this.hpx = [0, 0]; }
  process(L, R, n, v, mix, core) {
    let [timeMs, fb, damp, pp, sync, lowcut] = v;
    const sIdx = Math.round(sync);
    if (sIdx > 0) {
      const beats = [0, 0.25, 0.5, 0.75, 1, 1.5, 2][sIdx];
      timeMs = beats * 60000 / core.tempo;
    }
    const target = clamp(timeMs * 0.001 * this.sr, 1, this.sr * 2.1);
    if (this.cur < 0) this.cur = target;
    const k = 1 - Math.exp(-TWO_PI * damp / this.sr), hk = Math.exp(-TWO_PI * lowcut / this.sr);
    const dry = 1 - mix;
    for (let i = 0; i < n; i++) {
      this.cur += (target - this.cur) * 0.0005;
      const dL = this.dl[0].read(this.cur), dR = this.dl[1].read(this.cur);
      const x0 = L[i], x1 = R[i];
      // ping-pong: cruzar la realimentación
      let fL = dL * (1 - pp) + dR * pp, fR = dR * (1 - pp) + dL * pp;
      // filtros en el lazo
      this.lp[0] += (fL - this.lp[0]) * k; this.lp[1] += (fR - this.lp[1]) * k;
      let hL = this.lp[0] - this.hpx[0] + hk * this.hp[0]; this.hpx[0] = this.lp[0]; this.hp[0] = hL;
      let hR = this.lp[1] - this.hpx[1] + hk * this.hp[1]; this.hpx[1] = this.lp[1]; this.hp[1] = hR;
      this.dl[0].write(x0 * (1 - pp * 0.5) + hL * fb);
      this.dl[1].write(x1 * (1 - pp * 0.5) + x0 * pp * 0.5 * 0 + hR * fb);
      L[i] = x0 * dry + (x0 + dL) * mix;
      R[i] = x1 * dry + (x1 + dR) * mix;
    }
  }
}

class ReverbFX {
  constructor(sr) {
    this.sr = sr;
    const sc = sr / 44100;
    const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
    const aps = [556, 441, 341, 225];
    this.comb = [0, 1].map(ch => combs.map(l => ({ buf: new Float32Array(Math.round(l * sc) + (ch ? 23 : 0)), i: 0, f: 0 })));
    this.ap = [0, 1].map(ch => aps.map(l => ({ buf: new Float32Array(Math.round(l * sc) + (ch ? 23 : 0)), i: 0 })));
    this.pre = [new DelayLine(sr * 0.25 | 0), new DelayLine(sr * 0.25 | 0)];
    this.hp = [0, 0]; this.hpx = [0, 0];
    this.shim = new DelayLine(sr * 0.5 | 0); this.shimPh = 0; this.shimOut = 0;
  }
  process(L, R, n, v, mix, core) {
    const [size, damp, preMs, width, lowcut, shimmer] = v;
    const fbk = 0.72 + size * 0.26, dmp = damp * 0.45;
    const pre = preMs * 0.001 * this.sr;
    const hk = Math.exp(-TWO_PI * lowcut / this.sr);
    const dry = 1 - mix;
    const shimLen = 4096, shimInc = 2 - 1; // lectura al doble de velocidad: pitch +1 oct
    for (let i = 0; i < n; i++) {
      const xl = L[i], xr = R[i];
      this.pre[0].write(xl); this.pre[1].write(xr);
      let inp = (this.pre[0].read(pre) + this.pre[1].read(pre)) * 0.5 * 0.4;
      if (shimmer > 0) inp += this.shimOut * shimmer * 0.5;
      // low cut en la entrada
      const h = inp - this.hpx[0] + hk * this.hp[0]; this.hpx[0] = inp; this.hp[0] = h; inp = h;
      const out = [0, 0];
      for (let ch = 0; ch < 2; ch++) {
        let acc = 0;
        for (const c of this.comb[ch]) {
          const y = c.buf[c.i];
          c.f = y * (1 - dmp) + c.f * dmp;
          c.buf[c.i] = inp + c.f * fbk;
          c.i = (c.i + 1) % c.buf.length;
          acc += y;
        }
        for (const a of this.ap[ch]) {
          const bufout = a.buf[a.i];
          const y = -acc + bufout;
          a.buf[a.i] = acc + bufout * 0.5;
          a.i = (a.i + 1) % a.buf.length;
          acc = y;
        }
        out[ch] = acc * 0.25;
      }
      // shimmer: octava arriba (lectura acelerada con crossfade de 2 cabezas)
      if (shimmer > 0) {
        const m = (out[0] + out[1]) * 0.5;
        this.shim.write(m);
        this.shimPh += shimInc; if (this.shimPh >= shimLen) this.shimPh -= shimLen;
        const p1 = this.shimPh, p2 = (this.shimPh + shimLen / 2) % shimLen;
        const w1 = 0.5 - 0.5 * Math.cos(TWO_PI * p1 / shimLen), w2 = 1 - w1;
        this.shimOut = this.shim.read(shimLen - p1) * w1 + this.shim.read(shimLen - p2) * w2;
      }
      const wl = out[0] * (0.5 + width * 0.5) + out[1] * (0.5 - width * 0.5);
      const wr = out[1] * (0.5 + width * 0.5) + out[0] * (0.5 - width * 0.5);
      L[i] = xl * dry + (xl + wl) * mix;
      R[i] = xr * dry + (xr + wr) * mix;
    }
  }
}

class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = [0, 0]; this.z2 = [0, 0]; }
  set(b0, b1, b2, a0, a1, a2) { this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0; }
  tick(x, ch) {
    const y = this.b0 * x + this.z1[ch];
    this.z1[ch] = this.b1 * x - this.a1 * y + this.z2[ch];
    this.z2[ch] = this.b2 * x - this.a2 * y;
    return y;
  }
  lowShelf(sr, f, dB) {
    const A = Math.pow(10, dB / 40), w = TWO_PI * f / sr, cw = Math.cos(w), sw = Math.sin(w);
    const b = sw / 2 * Math.sqrt((A + 1 / A) * (1 / 0.9 - 1) + 2);
    this.set(A * ((A + 1) - (A - 1) * cw + 2 * Math.sqrt(A) * b), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - 2 * Math.sqrt(A) * b),
      (A + 1) + (A - 1) * cw + 2 * Math.sqrt(A) * b, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - 2 * Math.sqrt(A) * b);
  }
  highShelf(sr, f, dB) {
    const A = Math.pow(10, dB / 40), w = TWO_PI * f / sr, cw = Math.cos(w), sw = Math.sin(w);
    const b = sw / 2 * Math.sqrt((A + 1 / A) * (1 / 0.9 - 1) + 2);
    this.set(A * ((A + 1) + (A - 1) * cw + 2 * Math.sqrt(A) * b), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - 2 * Math.sqrt(A) * b),
      (A + 1) - (A - 1) * cw + 2 * Math.sqrt(A) * b, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - 2 * Math.sqrt(A) * b);
  }
  peak(sr, f, dB, Q) {
    const A = Math.pow(10, dB / 40), w = TWO_PI * f / sr, cw = Math.cos(w), al = Math.sin(w) / (2 * Q);
    this.set(1 + al * A, -2 * cw, 1 - al * A, 1 + al / A, -2 * cw, 1 - al / A);
  }
}
class EQFX {
  constructor(sr) { this.sr = sr; this.lo = new Biquad(); this.mid = new Biquad(); this.hi = new Biquad(); }
  process(L, R, n, v, mix) {
    const [lg, lf, mg, mf, hg, hf] = v;
    this.lo.lowShelf(this.sr, lf, lg); this.mid.peak(this.sr, mf, mg, 1); this.hi.highShelf(this.sr, hf, hg);
    const dry = 1 - mix;
    for (let i = 0; i < n; i++) {
      for (let ch = 0; ch < 2; ch++) {
        const buf = ch ? R : L, x = buf[i];
        const y = this.hi.tick(this.mid.tick(this.lo.tick(x, ch), ch), ch);
        buf[i] = x * dry + y * mix;
      }
    }
  }
}

class CompressorFX {
  constructor(sr) { this.sr = sr; this.env = 0; }
  process(L, R, n, v, mix) {
    const [thr, ratio, attMs, relMs, makeup, knee] = v;
    const att = Math.exp(-1 / (attMs * 0.001 * this.sr)), rel = Math.exp(-1 / (relMs * 0.001 * this.sr));
    const mk = Math.pow(10, makeup / 20), kw = 1 + knee * 12;
    const dry = 1 - mix;
    for (let i = 0; i < n; i++) {
      const x = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      const dB = 20 * Math.log10(x + 1e-6);
      let over = dB - thr;
      let gr;
      if (over < -kw / 2) gr = 0;
      else if (over > kw / 2) gr = over * (1 - 1 / ratio);
      else { const t = over + kw / 2; gr = (1 - 1 / ratio) * t * t / (2 * kw); }
      const g = Math.pow(10, -gr / 20);
      this.env = g < this.env ? att * this.env + (1 - att) * g : rel * this.env + (1 - rel) * g;
      const gain = this.env * mk;
      L[i] = L[i] * dry + L[i] * gain * mix;
      R[i] = R[i] * dry + R[i] * gain * mix;
    }
  }
}
const FX_CLASSES = [null, CorroderFX, DistortionFX, FilterFX, ChorusFX, PhaserFX, DelayFX, ReverbFX, EQFX, CompressorFX];

// ------------------------------------------------------------ caja de ritmos
// 8 instrumentos sintetizados: kick, snare, clap, hat cerrado, hat abierto,
// tom, rim, shaker. Cada kit ajusta afinación, decaimientos y brillo.
const DRUM_KIT_DEFS = [
  { // Clásica 808
    kick: { f0: 160, f1: 46, pd: 0.05, ad: 0.55, click: 0.25, drive: 0.35 }, snare: { f: 185, td: 0.12, nd: 0.2, hp: 1800, tone: 0.6 },
    clap: { d: 0.16, bp: 1100 }, chat: { d: 0.045, hp: 7500 }, ohat: { d: 0.35, hp: 7000 }, tom: { f0: 190, f1: 95, d: 0.4 }, rim: { f: 1700, d: 0.03 }, shaker: { d: 0.09, bp: 6500 },
  },
  { // Acústica
    kick: { f0: 130, f1: 58, pd: 0.03, ad: 0.28, click: 0.6, drive: 0.15 }, snare: { f: 210, td: 0.16, nd: 0.26, hp: 1200, tone: 0.9 },
    clap: { d: 0.2, bp: 1400 }, chat: { d: 0.07, hp: 6000 }, ohat: { d: 0.45, hp: 5500 }, tom: { f0: 240, f1: 120, d: 0.5 }, rim: { f: 2100, d: 0.05 }, shaker: { d: 0.12, bp: 5000 },
  },
  { // Techno
    kick: { f0: 210, f1: 50, pd: 0.045, ad: 0.4, click: 0.4, drive: 0.9 }, snare: { f: 240, td: 0.08, nd: 0.14, hp: 2500, tone: 0.4 },
    clap: { d: 0.12, bp: 1600 }, chat: { d: 0.03, hp: 9000 }, ohat: { d: 0.25, hp: 8500 }, tom: { f0: 160, f1: 70, d: 0.3 }, rim: { f: 2600, d: 0.02 }, shaker: { d: 0.06, bp: 8000 },
  },
  { // Lo-fi
    kick: { f0: 95, f1: 42, pd: 0.09, ad: 0.45, click: 0.1, drive: 0.5 }, snare: { f: 165, td: 0.2, nd: 0.22, hp: 900, tone: 0.7 },
    clap: { d: 0.25, bp: 800 }, chat: { d: 0.05, hp: 4000 }, ohat: { d: 0.3, hp: 3800 }, tom: { f0: 150, f1: 80, d: 0.45 }, rim: { f: 1300, d: 0.05 }, shaker: { d: 0.1, bp: 3500 },
  },
];
const DRUM_PANS = [0, 0.05, -0.15, 0.25, 0.3, -0.3, 0.2, -0.25];

class DrumVoice {
  constructor(sr) { this.sr = sr; this.active = false; this.t = 0; this.ph = 0; this.ph2 = 0; this.vel = 1; this.svf = new SVF(sr); this.lp = 0; }
  trigger(vel) { this.active = true; this.t = 0; this.ph = 0; this.ph2 = 0; this.vel = vel; this.svf.reset(); this.lp = 0; }
}
class DrumMachine {
  constructor(sr) {
    this.sr = sr;
    this.voices = Array.from({ length: 8 }, () => new DrumVoice(sr));
    this.tmp = new Float32Array(BLOCK);
  }
  hit(inst, vel) {
    if (inst < 0 || inst > 7) return;
    if (inst === 3) this.voices[4].active = false; // el hat cerrado apaga al abierto
    this.voices[inst].trigger(vel);
  }
  // renderiza y suma en L/R; kit 0..3, tone/decay 0..1 globales, level 0..1
  render(L, R, n, kit, tone, decay, level) {
    const K = DRUM_KIT_DEFS[clamp(kit | 0, 0, 3)];
    const dk = 0.5 + decay; // 0.5..1.5
    const bright = Math.pow(2, (tone - 0.5) * 2); // 0.5..2
    const sr = this.sr;
    for (let inst = 0; inst < 8; inst++) {
      const v = this.voices[inst];
      if (!v.active) continue;
      const tmp = this.tmp;
      const pan = DRUM_PANS[inst];
      const gl = Math.cos((pan + 1) * Math.PI / 4) * level * v.vel, gr = Math.sin((pan + 1) * Math.PI / 4) * level * v.vel;
      let alive = true;
      for (let i = 0; i < n; i++) {
        const t = v.t / sr;
        let s = 0;
        switch (inst) {
          case 0: { // kick
            const k = K.kick;
            const f = k.f1 + (k.f0 - k.f1) * Math.exp(-t / k.pd);
            v.ph += f / sr;
            const env = Math.exp(-t / (k.ad * dk));
            s = sinC(v.ph) * env;
            s = softclip(s * (1 + k.drive * 5)) / (1 + k.drive * 1.2);
            if (t < 0.004) s += (rnd() * 2 - 1) * k.click * bright * Math.exp(-t / 0.0012);
            if (env < 0.001) alive = false;
            break;
          }
          case 1: { // snare
            const k = K.snare;
            v.ph += k.f / sr; v.ph2 += k.f * 1.6 / sr;
            const toneS = (sinC(v.ph) + 0.6 * sinC(v.ph2)) * Math.exp(-t / (k.td * dk)) * 0.5 * k.tone;
            if (i === 0 || v.t === 0) v.svf.setCoeffs(clamp(k.hp * bright, 300, 12000), 0.2);
            const noise = v.svf.highpass(rnd() * 2 - 1) * Math.exp(-t / (k.nd * dk));
            s = (toneS + noise * 0.9) * 0.9;
            if (t > k.nd * dk * 6) alive = false;
            break;
          }
          case 2: { // clap: 3 ráfagas + cola
            const k = K.clap;
            if (v.t === 0) v.svf.setCoeffs(clamp(k.bp * bright, 300, 8000), 0.55);
            let env = 0;
            for (let b = 0; b < 3; b++) { const tb = t - b * 0.011; if (tb >= 0) env = Math.max(env, Math.exp(-tb / 0.006)); }
            if (t > 0.03) env = Math.max(env, Math.exp(-(t - 0.03) / (k.d * dk)) * 0.8);
            s = v.svf.bandpass(rnd() * 2 - 1) * env * 2.2;
            if (t > k.d * dk * 6) alive = false;
            break;
          }
          case 3: case 4: { // hats
            const k = inst === 3 ? K.chat : K.ohat;
            if (v.t === 0) v.svf.setCoeffs(clamp(k.hp * bright, 1000, 16000), 0.15);
            const env = Math.exp(-t / (k.d * dk));
            // ruido "metálico": suma de cuadradas rápidas + ruido blanco
            v.ph += 2837 / sr; v.ph2 += 4311 / sr;
            const metal = ((v.ph % 1) < 0.5 ? 1 : -1) * ((v.ph2 % 1) < 0.5 ? 1 : -1) * 0.3;
            s = v.svf.highpass((rnd() * 2 - 1) * 0.8 + metal) * env * 0.7;
            if (env < 0.001) alive = false;
            break;
          }
          case 5: { // tom
            const k = K.tom;
            const f = k.f1 + (k.f0 - k.f1) * Math.exp(-t / 0.08);
            v.ph += f / sr;
            const env = Math.exp(-t / (k.d * dk));
            s = (sinC(v.ph) + 0.15 * (rnd() * 2 - 1) * Math.exp(-t / 0.01)) * env * 0.9;
            if (env < 0.001) alive = false;
            break;
          }
          case 6: { // rim
            const k = K.rim;
            v.ph += k.f / sr; v.ph2 += k.f * 0.62 / sr;
            s = (sinC(v.ph) * 0.6 + sinC(v.ph2) * 0.4) * Math.exp(-t / (k.d * dk)) + (rnd() * 2 - 1) * Math.exp(-t / 0.003) * 0.5;
            if (t > k.d * dk * 8) alive = false;
            break;
          }
          default: { // shaker
            const k = K.shaker;
            if (v.t === 0) v.svf.setCoeffs(clamp(k.bp * bright, 800, 14000), 0.5);
            const env = Math.min(1, t / 0.006) * Math.exp(-t / (k.d * dk));
            s = v.svf.bandpass(rnd() * 2 - 1) * env * 1.6;
            if (t > k.d * dk * 6) alive = false;
          }
        }
        tmp[i] = s;
        v.t++;
        if (!alive) { v.active = false; for (let j = i + 1; j < n; j++) tmp[j] = 0; break; }
      }
      for (let i = 0; i < n; i++) { L[i] += tmp[i] * gl; R[i] += tmp[i] * gr; }
    }
  }
}

// ------------------------------------------------------------------ looper
// Looper de audio por capas, sincronizado al tempo. Graba la salida del sinte
// (post-FX) durante exactamente `bars` compases y suma las capas reproducidas.
const MAX_LAYERS = 8;
class Looper {
  constructor(sr) {
    this.sr = sr; this.len = 0; this.origin = 0; this.layers = []; this.playing = false;
    this.armed = false; this.recording = false; this.recL = null; this.recR = null; this.recPos = 0; this.playArmed = false;
    this.outL = new Float32Array(BLOCK); this.outR = new Float32Array(BLOCK);
    this.lenSeconds = 0;
  }
  get state() {
    if (this.recording) return 'recording';
    if (this.armed) return 'armed';
    if (!this.layers.length) return 'empty';
    return this.playing ? 'playing' : 'stopped';
  }
  command(cmd, arg) {
    switch (cmd) {
      case 'rec':
        if (this.recording) { this.commit(); break; }
        if (this.layers.length >= MAX_LAYERS) break;
        this.armed = !this.armed;
        break;
      case 'play': if (this.layers.length) { this.playArmed = !this.playing; if (this.playing) this.playing = false; } break;
      case 'stop': this.playing = false; this.playArmed = false; this.armed = false; if (this.recording) this.recording = false; break;
      case 'clear': this.layers = []; this.len = 0; this.playing = false; this.armed = false; this.recording = false; this.playArmed = false; break;
      case 'undo': this.layers.pop(); if (!this.layers.length) { this.len = 0; this.playing = false; } break;
      case 'mute': if (this.layers[arg]) this.layers[arg].mute = !this.layers[arg].mute; break;
      case 'remove': if (this.layers[arg]) { this.layers.splice(arg, 1); if (!this.layers.length) { this.len = 0; this.playing = false; } } break;
      case 'gain': if (this.layers[arg.layer]) this.layers[arg.layer].gain = arg.gain; break;
    }
  }
  commit() {
    this.recording = false;
    if (this.recL) { this.layers.push({ L: this.recL, R: this.recR, gain: 1, mute: false }); this.recL = null; this.recR = null; }
    this.playing = true;
  }
  // inL/inR: señal a grabar; suma la reproducción en outL/outR (n muestras)
  process(inL, inR, outL, outR, n, clock, barLen, bars, drumsOn, level) {
    const wantLen = Math.max(1, Math.round(barLen * bars));
    for (let i = 0; i < n; i++) {
      const t = clock + i;
      // arranque de grabación
      if (this.armed && !this.recording) {
        const boundary = this.len ? ((t - this.origin) % this.len === 0) : (drumsOn ? (t % barLen === 0) : true);
        if (boundary) {
          if (!this.len) { this.len = wantLen; this.origin = t; this.playing = true; }
          this.armed = false; this.recording = true; this.recPos = 0;
          this.recL = new Float32Array(this.len); this.recR = new Float32Array(this.len);
        }
      }
      if (this.playArmed && this.len) {
        const boundary = drumsOn ? (t % barLen === 0) : true;
        if (boundary) { this.playArmed = false; this.playing = true; this.origin = t; }
      }
      if (this.recording) {
        this.recL[this.recPos] = inL[i]; this.recR[this.recPos] = inR[i];
        this.recPos++;
        if (this.recPos >= this.len) this.commit();
      }
      if (this.playing && this.len) {
        let pos = (t - this.origin) % this.len; if (pos < 0) pos += this.len;
        let l = 0, r = 0;
        for (let k = 0; k < this.layers.length; k++) { const ly = this.layers[k]; if (ly.mute) continue; l += ly.L[pos] * ly.gain; r += ly.R[pos] * ly.gain; }
        outL[i] += l * level; outR[i] += r * level;
      }
    }
  }
  status(clock) {
    let pos = 0;
    if (this.len) { pos = ((clock - this.origin) % this.len + this.len) % this.len / this.len; }
    return { state: this.state, pos, layers: this.layers.map(l => ({ mute: l.mute, gain: l.gain })), recProgress: this.recording ? this.recPos / this.len : 0, bars: this.len ? Math.round(this.len / (this.lastBarLen || 1)) : 0 };
  }
}

// ------------------------------------------------------------------- núcleo
class SynthCore {
  constructor(sr, defs, fxTypes, lfoDivBeats, arpDivBeats, extra = {}) {
    this.sr = sr; this.defs = defs; this.fxTypes = fxTypes; this.extra = extra;
    this.lfoDivBeats = lfoDivBeats; this.arpDivBeats = arpDivBeats;
    this.nSrc = 15;
    this.index = Object.create(null);
    defs.forEach((d, i) => { this.index[d.id] = i; });
    const N = defs.length;
    this.targetNorm = new Float32Array(N); this.baseNorm = new Float32Array(N); this.gval = new Float32Array(N); this.gp = new Float32Array(N);
    this.stepped = new Uint8Array(N);
    defs.forEach((d, i) => {
      const n = this.norm(d, d.def);
      this.targetNorm[i] = n; this.baseNorm[i] = n; this.gval[i] = this.denorm(d, n);
      this.stepped[i] = (d.curve === 'enum' || d.curve === 'int') ? 1 : 0;
    });
    const I = this.I = {
      glide: this.idx('master.glide'), poly: this.idx('master.poly'), voices: this.idx('master.voices'), bendRange: this.idx('master.bend'),
      volume: this.idx('master.volume'), tempo: this.idx('master.tempo'),
      aType: this.idx('a.type'), bType: this.idx('b.type'), aOn: this.idx('a.on'), bOn: this.idx('b.on'),
      aLevel: this.idx('a.level'), bLevel: this.idx('b.level'), aPan: this.idx('a.pan'), bPan: this.idx('b.pan'),
      aOct: this.idx('a.octave'), bOct: this.idx('b.octave'), aSemi: this.idx('a.semi'), bSemi: this.idx('b.semi'),
      aFine: this.idx('a.fine'), bFine: this.idx('b.fine'), aRoute: this.idx('a.filter'), bRoute: this.idx('b.filter'),
      fType: [this.idx('f1.type'), this.idx('f2.type')], fCut: [this.idx('f1.cutoff'), this.idx('f2.cutoff')],
      fRes: [this.idx('f1.res'), this.idx('f2.res')], fDrive: [this.idx('f1.drive'), this.idx('f2.drive')],
      fKey: [this.idx('f1.keytrack'), this.idx('f2.keytrack')], fRouting: this.idx('filter.routing'),
      env: [1, 2, 3].map(k => this.idx(`env${k}.attack`)),
      lfo: [1, 2, 3].map(k => this.idx(`lfo${k}.shape`)),
      lfoRetrig: [1, 2, 3].map(k => this.idx(`lfo${k}.retrig`)),
      macro: [1, 2, 3, 4].map(k => this.idx(`macro${k}`)),
      arpOn: this.idx('arp.on'), arpPattern: this.idx('arp.pattern'), arpHold: this.idx('arp.hold'), arpRate: this.idx('arp.rate'), arpOct: this.idx('arp.octaves'),
      arpGate: this.idx('arp.gate'), arpSwing: this.idx('arp.swing'),
      drumOn: this.idx('drum.on'), drumKit: this.idx('drum.kit'), drumPattern: this.idx('drum.pattern'), drumLevel: this.idx('drum.level'),
      drumSwing: this.idx('drum.swing'), drumTone: this.idx('drum.tone'), drumDecay: this.idx('drum.decay'),
      loopBars: this.idx('loop.bars'), loopLevel: this.idx('loop.level'),
      fx: [1, 2, 3, 4].map(k => ({ type: this.idx(`fx${k}.type`), on: this.idx(`fx${k}.on`), mix: this.idx(`fx${k}.mix`), p: this.idx(`fx${k}.p0`) })),
    };
    this.wt = new WavetableBank();
    this.sources = generateSources(sr);
    this.loaded = null;
    this.voices = [];
    for (let i = 0; i < MAX_VOICES; i++) this.voices.push(new Voice(this, i));
    this.modSlots = []; this.voiceTargets = []; this.globalTargets = [];
    this.modwheel = 0; this.bend = 0; this.tempo = 120;
    this.lastPitch = null; this.heldNotes = []; this.lastVoice = null;
    this.gLfo = [new LFO(sr), new LFO(sr), new LFO(sr)];
    this.gsrc = new Float32Array(this.nSrc);
    this.fx = [0, 1, 2, 3].map(() => ({ type: 0, inst: null }));
    this.fxVals = new Float32Array(6);
    this.mixL = new Float32Array(BLOCK); this.mixR = new Float32Array(BLOCK);
    this.scopeLen = 1024;
    this.scopeA = new Float32Array(this.scopeLen); this.scopeB = new Float32Array(this.scopeLen); this.scopePos = 0;
    this.arp = { held: [], physical: new Set(), step: 0, counter: 0, cur: [], gateCounter: 0, wasOn: false, lastRnd: 0 };
    this.drums = new DrumMachine(sr); this.drumPatterns = []; this.lastDrumStep = -1; this.drumStep = 0;
    this.looper = new Looper(sr);
    this.clock = 0;
    this.loopBars = [1, 2, 4, 8];
    this.preL = new Float32Array(BLOCK); this.preR = new Float32Array(BLOCK);
    this.meterCounter = 0; this.peak = 0;
    this.port = null;
    this.sustain = false; this.sustained = [];
    if (extra.drumPatterns) this.drumPatterns = extra.drumPatterns;
    if (extra.loopBars) this.loopBars = extra.loopBars;
  }
  idx(id) { const i = this.index[id]; if (i === undefined) throw new Error('param ' + id); return i; }
  denorm(def, n) {
    n = n < 0 ? 0 : n > 1 ? 1 : n;
    if (def.curve === 'exp') return def.min * Math.pow(def.max / def.min, n);
    if (def.curve === 'enum' || def.curve === 'int') return Math.round(def.min + n * (def.max - def.min));
    return def.min + n * (def.max - def.min);
  }
  norm(def, v) {
    let n = def.curve === 'exp' ? Math.log(v / def.min) / Math.log(def.max / def.min) : (v - def.min) / (def.max - def.min);
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }
  setParam(i, n) {
    this.targetNorm[i] = n;
    if (this.stepped[i]) { this.baseNorm[i] = n; this.gval[i] = this.denorm(this.defs[i], n); }
  }
  setAllParams(arr) { for (let i = 0; i < arr.length && i < this.defs.length; i++) { this.targetNorm[i] = arr[i]; this.baseNorm[i] = arr[i]; this.gval[i] = this.denorm(this.defs[i], arr[i]); } }
  setMods(slots) {
    this.modSlots = slots;
    const vt = new Map(), gt = new Map();
    for (const s of slots) {
      if (!(s.dst >= 0) || !(s.src >= 0) || !s.amt) continue;
      const id = this.defs[s.dst].id;
      const isGlobal = id.startsWith('fx') || id.startsWith('master') || id.startsWith('arp');
      const m = isGlobal ? gt : vt;
      if (!m.has(s.dst)) m.set(s.dst, []);
      m.get(s.dst).push([s.src, s.amt]);
    }
    this.voiceTargets = [...vt].map(([idx, list]) => ({ idx, list }));
    this.globalTargets = [...gt].map(([idx, list]) => ({ idx, list }));
  }
  applyMods(p, s, targets) {
    for (let t = 0; t < targets.length; t++) {
      const { idx, list } = targets[t];
      let n = this.baseNorm[idx];
      for (let k = 0; k < list.length; k++) n += list[k][1] * s[list[k][0]];
      p[idx] = this.denorm(this.defs[idx], n);
    }
  }
  divHz(div) { return 1 / (this.lfoDivBeats[div] * 60 / this.tempo); }
  sourceBuffer(i) {
    if (i >= 4) return this.loaded || { buffer: this.sources.buffers[0], root: this.sources.root };
    return { buffer: this.sources.buffers[i], root: this.sources.root };
  }
  scopeAdd(aL, bL) {
    const pos = this.scopePos;
    for (let i = 0; i < BLOCK; i++) { this.scopeA[pos + i] += aL[i]; this.scopeB[pos + i] += bL[i]; }
  }

  // ---- notas
  noteOn(note, vel) {
    if (this.gval[this.I.arpOn] > 0.5) {
      const a = this.arp, hold = this.gval[this.I.arpHold] > 0.5;
      if (hold && a.physical.size === 0) a.held = []; // nueva frase con latch
      a.physical.add(note);
      if (!a.held.some(h => h.note === note)) a.held.push({ note, vel });
      return;
    }
    this.triggerVoice(note, vel);
  }
  noteOff(note) {
    if (this.gval[this.I.arpOn] > 0.5) {
      const a = this.arp;
      a.physical.delete(note);
      if (this.gval[this.I.arpHold] < 0.5) a.held = a.held.filter(h => h.note !== note);
      return;
    }
    if (this.sustain) { if (!this.sustained.includes(note)) this.sustained.push(note); return; }
    this.releaseVoice(note);
  }
  setSustain(on) {
    this.sustain = on;
    if (!on) { for (const n of this.sustained) this.releaseVoice(n); this.sustained = []; }
  }
  triggerVoice(note, vel) {
    const mode = this.gval[this.I.poly] | 0;
    let v;
    if (mode === 0) {
      v = this.alloc();
      v.noteOn(note, vel, false);
    } else {
      v = this.voices[0];
      const legato = mode === 2 && v.active && v.gate;
      this.heldNotes = this.heldNotes.filter(h => h.note !== note);
      this.heldNotes.push({ note, vel });
      v.noteOn(note, vel, legato);
    }
    this.lastPitch = note; this.lastVoice = v;
  }
  releaseVoice(note) {
    const mode = this.gval[this.I.poly] | 0;
    if (mode === 0) {
      for (const v of this.voices) if (v.active && v.gate && v.note === note) v.noteOff();
    } else {
      this.heldNotes = this.heldNotes.filter(h => h.note !== note);
      const v = this.voices[0];
      if (v.note !== note || !v.gate) return;
      if (this.heldNotes.length) {
        const h = this.heldNotes[this.heldNotes.length - 1];
        v.noteOn(h.note, h.vel, mode === 2);
        this.lastPitch = h.note;
      } else v.noteOff();
    }
  }
  alloc() {
    const max = clamp(this.gval[this.I.voices] | 0, 1, MAX_VOICES);
    let best = null;
    for (let i = 0; i < max; i++) { const v = this.voices[i]; if (!v.active) return v; }
    // robar: primero voces en release con menor nivel, si no la más antigua
    for (let i = 0; i < max; i++) {
      const v = this.voices[i];
      if (!v.gate && (!best || v.env[0].v < best.env[0].v)) best = v;
    }
    if (!best) for (let i = 0; i < max; i++) { const v = this.voices[i]; if (!best || v.age > best.age) best = v; }
    return best;
  }
  allNotesOff() {
    for (const v of this.voices) if (v.active) v.noteOff();
    this.heldNotes = []; this.arp.held = []; this.arp.physical.clear(); this.sustained = [];
  }
  panic() { for (const v of this.voices) v.kill(); this.heldNotes = []; this.arp.held = []; this.arp.physical.clear(); }

  // ---- arpegiador con patrones
  arpTick(n) {
    const a = this.arp, I = this.I, g = this.gval;
    const on = g[I.arpOn] > 0.5;
    const releaseCur = () => { for (const nn of a.cur) this.releaseVoice(nn); a.cur = []; };
    if (!on) {
      if (a.wasOn) { releaseCur(); a.held = []; a.physical.clear(); a.wasOn = false; }
      return;
    }
    a.wasOn = true;
    if (a.cur.length) { a.gateCounter -= n; if (a.gateCounter <= 0) releaseCur(); }
    if (a.held.length === 0) { a.step = 0; a.counter = 0; return; }
    a.counter -= n;
    if (a.counter > 0) return;
    const stepLen = this.arpDivBeats[g[I.arpRate] | 0] * 60 / this.tempo * this.sr;
    const swing = g[I.arpSwing];
    a.counter += stepLen * ((a.step % 2) ? 1 - swing : 1 + swing);
    const pattern = g[I.arpPattern] | 0, oct = g[I.arpOct] | 0;
    const base = pattern === 4 ? a.held.slice() : a.held.slice().sort((x, y) => x.note - y.note);
    const seq = [];
    for (let o = 0; o < oct; o++) for (const h of base) seq.push({ note: h.note + 12 * o, vel: h.vel });
    const L = seq.length, st = a.step;
    let idx = st % L, shift = 0, rest = false, gate = 1, all = false, accent = 1;
    switch (pattern) {
      case 1: idx = (L - 1) - (st % L); break;                                             // abajo
      case 2: { const cyc = Math.max(1, 2 * L - 2); const k = st % cyc; idx = k < L ? k : cyc - k; break; } // rebote
      case 3: { let r = (rnd() * L) | 0; if (L > 1 && r === a.lastRnd) r = (r + 1) % L; a.lastRnd = r; idx = r; break; }
      case 5: idx = (Math.floor(st / 3) + st % 3) % L; break;                               // escalera
      case 6: idx = Math.floor(st / 4 * 3 + (st % 4 > 1 ? st % 4 - 1 : 0)) % L; rest = st % 4 === 1; gate = st % 4 === 0 ? 1.2 : 0.7; break; // galope
      case 7: idx = Math.floor(st / 2) % L; shift = st % 2 ? 12 : 0; break;                 // octavas
      case 8: idx = st % 4 < 2 ? 0 : (Math.floor(st / 4) * 2 + st % 4 - 1) % L; accent = st % 4 === 0 ? 1 : 0.8; break; // pulso
      case 9: { const pat = [0, 0, -1, 0, 0, -1, 0, -1]; const v = pat[st % 8]; idx = v === -1 ? L - 1 : 0; gate = 0.55; accent = v === -1 ? 1 : 0.75; break; } // trance
      case 10: all = true; rest = st % 2 === 1; gate = 0.6; break;                          // acorde rítmico
      case 11: idx = (L - 1) - (st % L); shift = Math.floor(st / L) % 2 ? -12 : 0; break;   // cascada
    }
    releaseCur();
    if (!rest) {
      const notes = all ? seq : [seq[idx]];
      for (const h of notes) {
        const nn = h.note + shift;
        if (nn < 0 || nn > 127) continue;
        this.triggerVoice(nn, Math.min(1, h.vel * accent));
        a.cur.push(nn);
      }
      a.gateCounter = Math.max(1, g[I.arpGate] * stepLen * gate);
    }
    a.step++;
  }

  // ---- caja de ritmos (secuenciador de 16 pasos sobre el reloj de transporte)
  drumTick(n) {
    const I = this.I, g = this.gp;
    const on = g[I.drumOn] > 0.5;
    const step16 = 0.25 * 60 / this.tempo * this.sr;
    const swingDelay = g[I.drumSwing] * 0.5 * step16;
    const pat = this.drumPatterns[g[I.drumPattern] | 0];
    const k0 = Math.floor((this.clock - swingDelay) / step16) - 1, k1 = Math.floor((this.clock + n) / step16) + 1;
    for (let k = Math.max(0, k0); k <= k1; k++) {
      const t = k * step16 + (k % 2 ? swingDelay : 0);
      if (t < this.clock || t >= this.clock + n) continue;
      const step = k % 16;
      this.drumStep = step;
      if (!on || !pat) continue;
      for (let inst = 0; inst < 8; inst++) {
        const c = pat.rows[inst][step];
        if (c === 'x') this.drums.hit(inst, 1); else if (c === 'o') this.drums.hit(inst, 0.55);
      }
    }
  }

  // ---- proceso de bloque
  process(outL, outR) {
    const N = this.defs.length, I = this.I, n = BLOCK;
    // suavizado de parámetros
    for (let i = 0; i < N; i++) {
      if (this.stepped[i]) continue;
      const t = this.targetNorm[i], b = this.baseNorm[i];
      if (t !== b) {
        const d = t - b;
        this.baseNorm[i] = Math.abs(d) < 1e-5 ? t : b + d * 0.25;
        this.gval[i] = this.denorm(this.defs[i], this.baseNorm[i]);
      }
    }
    this.tempo = this.gval[I.tempo];
    // fuentes globales
    const gs = this.gsrc, lv = this.lastVoice;
    gs[0] = lv ? lv.env[0].v : 0; gs[1] = lv ? lv.env[1].v : 0; gs[2] = lv ? lv.env[2].v : 0;
    gs[3] = this.gLfo[0].out; gs[4] = this.gLfo[1].out; gs[5] = this.gLfo[2].out;
    gs[6] = this.gval[I.macro[0]]; gs[7] = this.gval[I.macro[1]]; gs[8] = this.gval[I.macro[2]]; gs[9] = this.gval[I.macro[3]];
    gs[10] = lv ? lv.vel : 0; gs[11] = lv ? clamp((lv.note - 60) / 48, -1, 1) : 0; gs[12] = this.modwheel; gs[13] = this.bend; gs[14] = lv ? lv.random : 0;
    const gp = this.gp;
    gp.set(this.gval);
    this.applyMods(gp, gs, this.globalTargets);
    // arpegiador
    this.arpTick(n);
    // voces
    const L = this.mixL, R = this.mixR;
    L.fill(0); R.fill(0);
    const sp = this.scopePos;
    this.scopeA.fill(0, sp, sp + n); this.scopeB.fill(0, sp, sp + n);
    let active = 0;
    for (const v of this.voices) if (v.active) { v.process(L, R); active++; }
    this.activeVoices = active;
    this.scopePos = (sp + n) % this.scopeLen;
    // LFOs globales (para FX y visualización)
    for (let k = 0; k < 3; k++) {
      const b = I.lfo[k];
      const rate = gp[b + 2] > 0.5 ? this.divHz(gp[b + 3] | 0) : gp[b + 1];
      this.gLfo[k].advance(gp[b] | 0, rate, gp[b + 4], gp[b + 6], n);
    }
    // efectos
    for (let s = 0; s < 4; s++) {
      const slot = this.fx[s], fi = I.fx[s];
      const type = gp[fi.type] | 0;
      if (type !== slot.type) { slot.type = type; slot.inst = FX_CLASSES[type] ? new FX_CLASSES[type](this.sr) : null; }
      if (!slot.inst || gp[fi.on] < 0.5) continue;
      const desc = this.fxTypes[type].params;
      for (let k = 0; k < 6; k++) this.fxVals[k] = k < desc.length ? this.denorm(desc[k], gp[fi.p + k]) : 0;
      slot.inst.process(L, R, n, this.fxVals, gp[fi.mix], this);
    }
    // looper: graba el sinte post-FX y suma las capas
    const barLen = 4 * 60 / this.tempo * this.sr;
    this.looper.lastBarLen = barLen;
    this.preL.set(L); this.preR.set(R);
    this.looper.process(this.preL, this.preR, L, R, n, this.clock, Math.round(barLen), this.loopBars[gp[I.loopBars] | 0], gp[I.drumOn] > 0.5, gp[I.loopLevel]);
    // caja de ritmos
    this.drumTick(n);
    this.drums.render(L, R, n, gp[I.drumKit], gp[I.drumTone], gp[I.drumDecay], gp[I.drumLevel] * gp[I.drumLevel]);
    this.clock += n;
    // master
    const vol = gp[I.volume] * gp[I.volume] * 1.5;
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const l = softclip(L[i] * vol), r = softclip(R[i] * vol);
      outL[i] = l; outR[i] = r;
      const a = Math.abs(l) > Math.abs(r) ? Math.abs(l) : Math.abs(r);
      if (a > peak) peak = a;
    }
    this.peak = Math.max(peak, this.peak * 0.9);
    // medición hacia la UI (~30 Hz)
    this.meterCounter += n;
    if (this.port && this.meterCounter >= this.sr / 30) {
      this.meterCounter = 0;
      const sa = new Float32Array(512), sb = new Float32Array(512);
      let rp = (this.scopePos - 512 + this.scopeLen) % this.scopeLen;
      for (let i = 0; i < 512; i++) { sa[i] = this.scopeA[rp]; sb[i] = this.scopeB[rp]; rp = (rp + 1) % this.scopeLen; }
      this.port.postMessage({ type: 'meter', src: Float32Array.from(gs), scopeA: sa, scopeB: sb, voices: active, peak: this.peak,
        arpNotes: this.arp.cur.slice(), notes: this.voices.filter(v => v.active && v.gate).map(v => v.note),
        loop: this.looper.status(this.clock), drumStep: this.drumStep, drumOn: gp[I.drumOn] > 0.5 }, [sa.buffer, sb.buffer]);
    }
  }

  handleMessage(m) {
    switch (m.type) {
      case 'param': this.setParam(m.idx, m.value); break;
      case 'params': this.setAllParams(m.values); break;
      case 'mods': this.setMods(m.slots); break;
      case 'note': if (m.on) this.noteOn(m.note, m.vel ?? 0.8); else this.noteOff(m.note); break;
      case 'modwheel': this.modwheel = m.value; break;
      case 'bend': this.bend = m.value; break;
      case 'sustain': this.setSustain(!!m.on); break;
      case 'sample': this.loaded = { buffer: m.data, root: m.root || 261.63 }; break;
      case 'allOff': this.allNotesOff(); break;
      case 'loop': this.looper.command(m.cmd, m.arg); break;
      case 'drum': this.drums.hit(m.inst, m.vel ?? 1); break;
      case 'resetClock': this.clock = 0; this.drumStep = 0; break;
      case 'panic': this.panic(); break;
    }
  }
}

if (typeof AudioWorkletProcessor !== 'undefined') {
  class PrismaProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const o = options.processorOptions;
      this.core = new SynthCore(sampleRate, o.defs, o.fxTypes, o.lfoDivBeats, o.arpDivBeats, { drumPatterns: o.drumPatterns, loopBars: o.loopBars });
      this.core.port = this.port;
      this.port.onmessage = (e) => this.core.handleMessage(e.data);
      this.port.postMessage({ type: 'ready' });
    }
    process(inputs, outputs) {
      const out = outputs[0];
      if (!out || !out[0]) return true;
      this.core.process(out[0], out[1] || out[0]);
      return true;
    }
  }
  registerProcessor('prisma-synth', PrismaProcessor);
}

export { SynthCore, generateSources, WavetableBank, ADSR, SVF, LFO, DrumMachine, Looper, BLOCK };
