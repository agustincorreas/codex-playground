// Visualizadores: analizador maestro animado (vista Play), osciloscopios de
// motor, curvas de envolvente y forma de LFO.

export class MasterVisualizer {
  constructor(canvas, analyser) {
    this.canvas = canvas; this.analyser = analyser;
    this.freq = new Uint8Array(analyser.frequencyBinCount);
    this.wave = new Float32Array(analyser.fftSize);
    this.hue = 200; this.energy = 0; this.t = 0;
    this.notes = [];
  }
  setColors(a, b) { this.colA = a; this.colB = b; }
  draw() {
    const c = this.canvas, ctx = c.getContext('2d');
    const W = c.width = c.clientWidth * devicePixelRatio, H = c.height = c.clientHeight * devicePixelRatio;
    ctx.clearRect(0, 0, W, H);
    this.analyser.getByteFrequencyData(this.freq);
    this.analyser.getFloatTimeDomainData(this.wave);
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.28;
    let sum = 0; for (let i = 0; i < 256; i++) sum += this.freq[i];
    const energy = sum / (256 * 255);
    this.energy += (energy - this.energy) * 0.2;
    this.t += 0.01 + this.energy * 0.05;
    // halo
    const grad = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R * (1.8 + this.energy));
    grad.addColorStop(0, `rgba(25,195,255,${0.15 + this.energy * 0.4})`);
    grad.addColorStop(0.6, `rgba(255,138,61,${0.05 + this.energy * 0.2})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    // espectro circular
    const bars = 96;
    for (let i = 0; i < bars; i++) {
      const bin = Math.floor(Math.pow(i / bars, 2) * 400) + 1;
      const v = this.freq[bin] / 255;
      const a = (i / bars) * Math.PI * 2 - Math.PI / 2 + this.t * 0.3;
      const len = v * R * 1.1;
      const hue = 190 + (i / bars) * 60 + v * 40;
      ctx.strokeStyle = `hsla(${hue}, 90%, ${55 + v * 25}%, ${0.35 + v * 0.65})`;
      ctx.lineWidth = Math.max(1.5, W / 400) * devicePixelRatio;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (R + 6), cy + Math.sin(a) * (R + 6));
      ctx.lineTo(cx + Math.cos(a) * (R + 6 + len), cy + Math.sin(a) * (R + 6 + len));
      ctx.stroke();
    }
    // forma de onda circular
    ctx.beginPath();
    const N = 512;
    for (let i = 0; i <= N; i++) {
      const s = this.wave[Math.floor(i / N * (this.wave.length - 1))];
      const a = (i / N) * Math.PI * 2 - Math.PI / 2;
      const r = R * (0.75 + s * 0.6);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = `rgba(255,255,255,${0.5 + this.energy * 0.5})`;
    ctx.lineWidth = 1.5 * devicePixelRatio;
    ctx.stroke();
    ctx.fillStyle = `rgba(25,195,255,${0.08 + this.energy * 0.25})`;
    ctx.fill();
    // partículas por nota
    for (const n of this.notes) {
      const a = ((n % 12) / 12) * Math.PI * 2 - Math.PI / 2 + this.t * 0.3;
      const r = R * 1.35 + (n - 60) * 1.5 * devicePixelRatio;
      ctx.fillStyle = `hsla(${(n % 12) * 30}, 90%, 65%, 0.9)`;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 4 * devicePixelRatio, 0, Math.PI * 2); ctx.fill();
    }
  }
}

export class Scope {
  constructor(canvas, color) { this.canvas = canvas; this.color = color; this.data = null; }
  draw() {
    const c = this.canvas, ctx = c.getContext('2d');
    const W = c.width = c.clientWidth * devicePixelRatio, H = c.height = c.clientHeight * devicePixelRatio;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    if (!this.data) return;
    const d = this.data;
    // buscar cruce por cero para estabilizar
    let start = 0;
    for (let i = 1; i < d.length / 2; i++) if (d[i - 1] <= 0 && d[i] > 0) { start = i; break; }
    let peak = 0; for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    const g = peak > 0.001 ? 0.45 / peak : 0;
    ctx.beginPath();
    const N = Math.min(d.length - start, 400);
    for (let i = 0; i < N; i++) {
      const x = (i / N) * W, y = H / 2 - d[start + i] * g * H;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = this.color; ctx.lineWidth = 1.5 * devicePixelRatio;
    ctx.shadowColor = this.color; ctx.shadowBlur = 6 * devicePixelRatio;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

export function drawEnvelope(canvas, a, d, s, r, curve, color, level) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.clientWidth * devicePixelRatio, H = canvas.height = canvas.clientHeight * devicePixelRatio;
  ctx.clearRect(0, 0, W, H);
  const total = a + d + r + 0.6;
  const scale = (W - 8) / Math.max(total, 0.05);
  const x0 = 4, y0 = H - 4, yTop = 6;
  const yFor = (v) => y0 - v * (y0 - yTop);
  const seg = (xa, ya, xb, yb, bend) => {
    // curva: puntos de control desplazados según 'curve' (-1 exponencial, 1 lineal)
    const k = 0.5 - 0.45 * curve;
    ctx.quadraticCurveTo(xa + (xb - xa) * (bend > 0 ? k : 1 - k), bend > 0 ? yb : ya, xb, yb);
  };
  ctx.beginPath(); ctx.moveTo(x0, y0);
  let x = x0 + a * scale; seg(x0, y0, x, yTop, 1);
  let x2 = x + d * scale; seg(x, yTop, x2, yFor(s), -1);
  let x3 = x2 + 0.6 * scale; ctx.lineTo(x3, yFor(s));
  let x4 = x3 + r * scale; seg(x3, yFor(s), x4, y0, -1);
  ctx.strokeStyle = color; ctx.lineWidth = 2 * devicePixelRatio; ctx.stroke();
  ctx.lineTo(x4, y0); ctx.lineTo(x0, y0); ctx.closePath();
  ctx.fillStyle = color + '22'; ctx.fill();
  if (level !== undefined) {
    ctx.fillStyle = color; ctx.globalAlpha = 0.9;
    ctx.fillRect(W - 6 * devicePixelRatio, yFor(level) - 2, 4 * devicePixelRatio, 4);
    ctx.globalAlpha = 1;
  }
}

export function drawLFO(canvas, shape, phase, color, live) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.clientWidth * devicePixelRatio, H = canvas.height = canvas.clientHeight * devicePixelRatio;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
  const sh = [0.3, -0.8, 0.5, 0.9, -0.2, 0.7, -0.6, 0.1];
  const f = (p) => {
    p = (p + phase) % 1;
    switch (shape) {
      case 0: return Math.sin(p * Math.PI * 2);
      case 1: return p < 0.5 ? p * 4 - 1 : 3 - p * 4;
      case 2: return 1 - p * 2;
      case 3: return p < 0.5 ? 1 : -1;
      case 4: return sh[Math.floor(p * 8) % 8];
      default: { const i = Math.floor(p * 8) % 8, t = p * 8 - Math.floor(p * 8); const c = 0.5 - 0.5 * Math.cos(t * Math.PI); return sh[i] + (sh[(i + 1) % 8] - sh[i]) * c; }
    }
  };
  ctx.beginPath();
  for (let i = 0; i <= 200; i++) { const p = i / 100; const y = H / 2 - f(p) * (H / 2 - 4); if (i === 0) ctx.moveTo(i / 200 * W, y); else ctx.lineTo(i / 200 * W, y); }
  ctx.strokeStyle = color; ctx.lineWidth = 2 * devicePixelRatio; ctx.stroke();
  if (live !== undefined) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(W - 8 * devicePixelRatio, H / 2 - live * (H / 2 - 4), 3.5 * devicePixelRatio, 0, Math.PI * 2); ctx.fill();
  }
}
