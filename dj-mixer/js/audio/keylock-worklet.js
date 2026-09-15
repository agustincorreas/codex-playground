// Keylock (pitch shifter granular de dos taps). pitch = 1/rate para conservar tonalidad.
class KeylockProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'pitch', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }];
  }
  constructor() {
    super();
    this.grain = Math.round(sampleRate * 0.045);
    this.len = 1 << Math.ceil(Math.log2(this.grain * 4));
    this.mask = this.len - 1;
    this.bufs = [];
    this.w = 0;
    this.phase = 0.5;
  }
  read(buf, pos) {
    const i = Math.floor(pos), f = pos - i;
    return buf[i & this.mask] * (1 - f) + buf[(i + 1) & this.mask] * f;
  }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0];
    if (!input || !input.length) return true;
    const nCh = input.length, N = input[0].length, grain = this.grain, half = grain / 2;
    while (this.bufs.length < nCh) this.bufs.push(new Float32Array(this.len));
    const pitch = params.pitch[0];
    const bypass = Math.abs(pitch - 1) < 1e-4;
    const inc = bypass ? 0 : (1 - pitch) / grain;
    if (bypass) this.phase = 0.5;
    let w = this.w, phase = this.phase;
    for (let n = 0; n < N; n++) {
      for (let c = 0; c < nCh; c++) this.bufs[c][w] = input[c][n];
      if (bypass) {
        for (let c = 0; c < nCh; c++) output[c][n] = this.read(this.bufs[c], w - half + this.len);
      } else {
        const p1 = phase + 0.5 - (phase >= 0.5 ? 1 : 0);
        const d0 = phase * grain, d1 = p1 * grain;
        const g0 = Math.sin(Math.PI * phase), g1 = Math.sin(Math.PI * p1);
        for (let c = 0; c < nCh; c++) {
          const b = this.bufs[c];
          output[c][n] = this.read(b, w - d0 + this.len) * g0 + this.read(b, w - d1 + this.len) * g1;
        }
        phase += inc;
        if (phase >= 1) phase -= 1; else if (phase < 0) phase += 1;
      }
      w = (w + 1) & this.mask;
    }
    this.w = w; this.phase = phase;
    return true;
  }
}
registerProcessor('keylock', KeylockProcessor);
