import { dbToGain, clamp } from '../utils.js';

const monoize = (node) => { node.channelCount = 1; node.channelCountMode = 'explicit'; node.channelInterpretation = 'speakers'; return node; };

export class Engine {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const c = this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = c.createGain();
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -1.5; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002; this.limiter.release.value = 0.15;
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 2048;
    this.master.connect(this.limiter); this.limiter.connect(this.analyser);
    this.outTap = c.createGain(); this.analyser.connect(this.outTap);
    this.outTap.connect(c.destination);
    // Cue (auriculares): bus → MediaStream → <audio> con setSinkId
    this.cueBus = c.createGain();
    this.cueDest = c.createMediaStreamDestination();
    this.cueBus.connect(this.cueDest);
    this.cueAudio = new Audio(); this.cueAudio.srcObject = this.cueDest.stream; this.cueAudio.volume = 1;
    this.cueDevice = null; this.split = false; this.splitNodes = null;
    // grabación
    this.recDest = c.createMediaStreamDestination(); this.analyser.connect(this.recDest);
    this.recorder = null; this.recChunks = [];
    this._meterBuf = new Float32Array(2048);
    this.hasKeylock = false;
    this.keylockReady = c.audioWorklet
      ? c.audioWorklet.addModule(new URL('./keylock-worklet.js', import.meta.url)).then(() => (this.hasKeylock = true)).catch(() => (this.hasKeylock = false))
      : Promise.resolve(false);
  }
  resume() { if (this.ctx.state !== 'running') return this.ctx.resume(); return Promise.resolve(); }
  get now() { return this.ctx.currentTime; }
  setMasterGain(v) { this.master.gain.setTargetAtTime(v, this.now, 0.01); }
  meter(analyser = this.analyser) {
    const b = this._meterBuf; analyser.getFloatTimeDomainData(b);
    let sum = 0, peak = 0;
    for (let i = 0; i < b.length; i++) { const v = b[i]; sum += v * v; const a = v < 0 ? -v : v; if (a > peak) peak = a; }
    return { rms: Math.sqrt(sum / b.length), peak };
  }
  async setMasterOutput(deviceId) {
    if (typeof this.ctx.setSinkId !== 'function') throw new Error('Este navegador no permite elegir la salida master (usá Chrome/Edge).');
    await this.ctx.setSinkId(deviceId || '');
  }
  async setCueOutput(deviceId) {
    this.cueDevice = deviceId || null;
    if (!deviceId) { this.cueAudio.pause(); return; }
    if (typeof this.cueAudio.setSinkId !== 'function') throw new Error('setSinkId no disponible en este navegador.');
    await this.cueAudio.setSinkId(deviceId);
    await this.cueAudio.play();
  }
  // Split cue: canal izquierdo = cue, canal derecho = master (para usar con cable Y).
  setSplitCue(on) {
    if (on === this.split) return;
    const c = this.ctx;
    if (on) {
      const merger = c.createChannelMerger(2);
      const mMono = monoize(c.createGain()), cMono = monoize(c.createGain());
      this.analyser.disconnect(this.outTap);
      this.analyser.connect(mMono); mMono.connect(merger, 0, 1);
      this.cueBus.connect(cMono); cMono.connect(merger, 0, 0);
      merger.connect(this.outTap);
      this.splitNodes = { merger, mMono, cMono };
    } else if (this.splitNodes) {
      const { merger, mMono, cMono } = this.splitNodes;
      this.analyser.disconnect(mMono); this.cueBus.disconnect(cMono); merger.disconnect();
      this.analyser.connect(this.outTap);
      this.splitNodes = null;
    }
    this.split = on;
  }
  startRecording() {
    if (this.recorder) return;
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
    this.recorder = new MediaRecorder(this.recDest.stream, mime ? { mimeType: mime, audioBitsPerSecond: 256000 } : undefined);
    this.recChunks = [];
    this.recorder.ondataavailable = e => e.data.size && this.recChunks.push(e.data);
    this.recorder.start(1000);
    this.recStart = Date.now();
  }
  stopRecording() {
    return new Promise(resolve => {
      const r = this.recorder; if (!r) return resolve(null);
      r.onstop = () => { const blob = new Blob(this.recChunks, { type: r.mimeType }); this.recorder = null; resolve(blob); };
      r.stop();
    });
  }
  get recording() { return !!this.recorder; }
}

// Canal de mezcla: trim → EQ 3 bandas → filtro → fader → crossfader → master (+ cue post-EQ/pre-fader)
export class Channel {
  constructor(engine, id) {
    this.engine = engine; this.id = id;
    const c = engine.ctx;
    this.input = c.createGain();
    this.trim = c.createGain();
    this.low = c.createBiquadFilter(); this.low.type = 'lowshelf'; this.low.frequency.value = 250;
    this.mid = c.createBiquadFilter(); this.mid.type = 'peaking'; this.mid.frequency.value = 1200; this.mid.Q.value = 0.8;
    this.high = c.createBiquadFilter(); this.high.type = 'highshelf'; this.high.frequency.value = 4500;
    this.hp = c.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 10; this.hp.Q.value = 1;
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000; this.lp.Q.value = 1;
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 2048;
    this.fader = c.createGain(); this.xf = c.createGain(); this.cueGain = c.createGain(); this.cueGain.gain.value = 0;
    [this.input, this.trim, this.low, this.mid, this.high, this.hp, this.lp, this.analyser, this.fader, this.xf, engine.master]
      .reduce((a, b) => (a.connect(b), b));
    this.analyser.connect(this.cueGain); this.cueGain.connect(engine.cueBus);
    this.v = { trim: 0, low: 0, mid: 0, high: 0, filter: 0, fader: 1, xf: 1, cue: false };
    this.onVolume = null; // para decks de streaming (YouTube/Spotify) que no pasan por el grafo
  }
  _t() { return this.engine.now; }
  setTrim(db) { this.v.trim = db; this.trim.gain.setTargetAtTime(dbToGain(db), this._t(), 0.01); this._vol(); }
  // knob -1..1 → -26 dB (kill) .. +8 dB
  setEq(band, k) { this.v[band] = k; const db = k < 0 ? k * 26 : k * 8; this[band].gain.setTargetAtTime(db, this._t(), 0.01); }
  setFilter(k) {
    this.v.filter = k; const t = this._t();
    const lpf = k < 0 ? 20000 * Math.pow(70 / 20000, -k) : 20000;
    const hpf = k > 0 ? 10 * Math.pow(9000 / 10, k) : 10;
    this.lp.frequency.setTargetAtTime(lpf, t, 0.01); this.hp.frequency.setTargetAtTime(hpf, t, 0.01);
    const q = 0.7 + Math.abs(k) * 2.3; this.lp.Q.value = q; this.hp.Q.value = q;
  }
  setFader(v) { this.v.fader = clamp(v, 0, 1); this.fader.gain.setTargetAtTime(this.v.fader * this.v.fader, this._t(), 0.008); this._vol(); }
  setXf(g) { this.v.xf = g; this.xf.gain.setTargetAtTime(g, this._t(), 0.008); this._vol(); }
  setCue(on) { this.v.cue = !!on; this.cueGain.gain.setTargetAtTime(on ? 1 : 0, this._t(), 0.01); }
  get linearVolume() { return clamp(dbToGain(this.v.trim) * this.v.fader * this.v.fader * this.v.xf, 0, 1); }
  _vol() { this.onVolume?.(this.linearVolume); }
  meter() { return this.engine.meter(this.analyser); }
}

// Curva equal-power del crossfader. x en [-1, 1].
export function crossfadeGains(x, curve = 'smooth') {
  const t = (clamp(x, -1, 1) + 1) / 2;
  if (curve === 'sharp') return [t < 0.98 ? 1 : (1 - t) / 0.02, t > 0.02 ? 1 : t / 0.02];
  return [Math.cos(t * Math.PI / 2), Math.sin(t * Math.PI / 2)];
}
