// Envoltorio del AudioContext: carga el worklet, envía parámetros/notas y
// recibe medición (fuentes de modulación, osciloscopios) para la UI.
import { PARAMS, FX_TYPES, LFO_DIV_BEATS, ARP_DIV_BEATS } from '../shared/params.js';

export class SynthAudio {
  constructor() {
    this.ctx = null; this.node = null; this.analyser = null; this.ready = false;
    this.onMeter = null; this.queue = [];
  }
  async init() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    try {
      const inline = document.getElementById('worklet-src');
      if (inline) {
        // versión de un solo archivo: el worklet viaja embebido. Blob funciona
        // en http(s); data: es el respaldo para file:// (origen opaco).
        const src = inline.textContent;
        try { await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: 'application/javascript' }))); }
        catch (e) { await ctx.audioWorklet.addModule('data:application/javascript;charset=utf-8,' + encodeURIComponent(src)); }
      } else {
        const url = new URL('./synth-processor.js', import.meta.url);
        try { await ctx.audioWorklet.addModule(url.href); }
        catch (e) {
          const src = await (await fetch(url.href)).text();
          await ctx.audioWorklet.addModule('data:application/javascript;charset=utf-8,' + encodeURIComponent(src));
        }
      }
      const defs = PARAMS.map(p => ({ id: p.id, min: p.min, max: p.max, def: p.def, curve: p.curve }));
      const fxTypes = FX_TYPES.map(f => ({ id: f.id, params: f.params.map(p => ({ min: p.min, max: p.max, curve: p.curve })) }));
      this.node = new AudioWorkletNode(ctx, 'prisma-synth', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: { defs, fxTypes, lfoDivBeats: LFO_DIV_BEATS, arpDivBeats: ARP_DIV_BEATS },
      });
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048; this.analyser.smoothingTimeConstant = 0.75;
      this.node.connect(this.analyser); this.analyser.connect(ctx.destination);
      this.node.port.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'meter' && this.onMeter) this.onMeter(m);
        if (m.type === 'ready') { this.ready = true; for (const q of this.queue) this.node.port.postMessage(q); this.queue = []; }
      };
      this.ctx = ctx;
    } catch (e) {
      ctx.close().catch(() => {});
      this.node = null; this.analyser = null;
      throw e;
    }
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  }
  async resume() { if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume(); }
  post(m, transfer) {
    if (!this.node) return;
    if (!this.ready) { this.queue.push(m); return; }
    this.node.port.postMessage(m, transfer || []);
  }
  setParam(idx, value) { this.post({ type: 'param', idx, value }); }
  setAllParams(values) { this.post({ type: 'params', values: Float32Array.from(values) }); }
  setMods(slots) { this.post({ type: 'mods', slots: slots.map(s => ({ src: s.src, dst: s.dst, amt: s.amt })) }); }
  noteOn(note, vel = 0.8) { this.post({ type: 'note', on: true, note, vel }); }
  noteOff(note) { this.post({ type: 'note', on: false, note }); }
  modwheel(v) { this.post({ type: 'modwheel', value: v }); }
  bend(v) { this.post({ type: 'bend', value: v }); }
  sustain(on) { this.post({ type: 'sustain', on }); }
  allOff() { this.post({ type: 'allOff' }); }
  panic() { this.post({ type: 'panic' }); }
  async loadSample(arrayBuffer) {
    const buf = await this.ctx.decodeAudioData(arrayBuffer);
    const n = Math.min(buf.length, this.ctx.sampleRate * 20);
    const mono = new Float32Array(n);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels;
    }
    // normalizar
    let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(mono[i]));
    if (mx > 0) for (let i = 0; i < n; i++) mono[i] /= mx;
    this.post({ type: 'sample', data: mono, root: 261.63 }, [mono.buffer]);
    return { duration: n / this.ctx.sampleRate };
  }
}

// ---- Web MIDI
export async function initMidi(handlers) {
  if (!navigator.requestMIDIAccess) return null;
  try {
    const access = await navigator.requestMIDIAccess();
    const attach = () => {
      for (const input of access.inputs.values()) {
        input.onmidimessage = (e) => {
          const [st, d1, d2] = e.data;
          const cmd = st & 0xf0;
          if (cmd === 0x90 && d2 > 0) handlers.noteOn(d1, d2 / 127);
          else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) handlers.noteOff(d1);
          else if (cmd === 0xb0) handlers.cc(d1, d2 / 127);
          else if (cmd === 0xe0) handlers.bend(((d2 << 7) | d1) / 8192 - 1);
        };
      }
    };
    attach();
    access.onstatechange = attach;
    return access;
  } catch (e) { return null; }
}
