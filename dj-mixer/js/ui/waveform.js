// Formas de onda: scroll (3 bandas coloreadas, beatgrid, loops, hot cues) y overview.
const BAND = { low: [255, 78, 66], mid: [72, 222, 132], high: [86, 170, 255] };
export const HOTCUE_COLORS = ['#ff4e42', '#ffb020', '#48de84', '#56aaff', '#c77dff', '#ff6ad5', '#2ee6d6', '#f5f5f5'];

function binColor(l, m, h, alpha = 1) {
  const s = l + m + h || 1;
  const r = (l * BAND.low[0] + m * BAND.mid[0] + h * BAND.high[0]) / s;
  const g = (l * BAND.low[1] + m * BAND.mid[1] + h * BAND.high[1]) / s;
  const b = (l * BAND.low[2] + m * BAND.mid[2] + h * BAND.high[2]) / s;
  return `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
}
function fit(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
  return false;
}

export class ScrollingWave {
  constructor(canvas, deck, color) { this.canvas = canvas; this.deck = deck; this.color = color; this.zoom = 8; this.ctx = canvas.getContext('2d'); }
  draw() {
    const cv = this.canvas, g = this.ctx; fit(cv);
    const W = cv.width, H = cv.height, mid = H / 2, deck = this.deck;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#0d0e12'; g.fillRect(0, 0, W, H);
    if (!deck.loaded) { g.fillStyle = '#3a3d47'; g.font = `${12 * (W / cv.clientWidth)}px system-ui`; g.textAlign = 'center'; g.fillText(`DECK ${deck.id} — arrastrá una pista`, W / 2, mid + 4); return; }
    const pos = deck.position, dur = deck.duration || 1;
    const pxPerSec = W / this.zoom, t0 = pos - W / 2 / pxPerSec, t1 = pos + W / 2 / pxPerSec;
    const A = deck.analysis;
    if (A) {
      const bps = A.binsPerSec, bpp = bps / pxPerSec;
      for (let x = 0; x < W; x++) {
        const t = t0 + x / pxPerSec; if (t < 0 || t >= dur) continue;
        const b0 = Math.floor(t * bps), b1 = Math.max(b0 + 1, Math.floor(t * bps + bpp));
        let l = 0, m = 0, h = 0;
        for (let b = b0; b < b1 && b < A.bins; b++) { if (A.low[b] > l) l = A.low[b]; if (A.mid[b] > m) m = A.mid[b]; if (A.high[b] > h) h = A.high[b]; }
        const amp = Math.min(1, Math.sqrt(l * l + m * m + h * h)) * (H * 0.46);
        if (amp < 0.5) continue;
        g.fillStyle = binColor(l, m, h, t < pos ? 0.55 : 1);
        g.fillRect(x, mid - amp, 1, amp * 2);
      }
    } else {
      // deck de streaming: barra de progreso
      g.fillStyle = '#1b1d24'; g.fillRect(0, mid - H * 0.25, W, H * 0.5);
      const xs = Math.max(0, (0 - t0) * pxPerSec), xe = Math.min(W, (dur - t0) * pxPerSec);
      g.fillStyle = this.color + '55'; g.fillRect(xs, mid - H * 0.25, Math.max(0, Math.min(W / 2, xe) - xs), H * 0.5);
      g.fillStyle = '#6a6f80'; g.font = `${11 * (W / cv.clientWidth)}px system-ui`; g.textAlign = 'left';
      g.fillText(`${(deck.kind || '').toUpperCase()} · sin forma de onda (streaming)`, 10, H - 8);
    }
    // beatgrid
    if (deck.bpm) {
      const bl = deck.beatLen, k0 = Math.ceil((t0 - deck.beatOffset) / bl), k1 = Math.floor((t1 - deck.beatOffset) / bl);
      for (let k = Math.max(0, k0); k <= k1; k++) {
        const x = (deck.beatOffset + k * bl - t0) * pxPerSec; const bar = k % 4 === 0;
        g.fillStyle = bar ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)';
        g.fillRect(x, 0, bar ? 2 : 1, bar ? H : H * 0.18); if (!bar) g.fillRect(x, H * 0.82, 1, H * 0.18);
      }
    }
    // loop
    if (deck.loop) {
      const xs = (deck.loop.start - t0) * pxPerSec, xe = (deck.loop.end - t0) * pxPerSec;
      g.fillStyle = 'rgba(72,222,132,0.16)'; g.fillRect(xs, 0, xe - xs, H);
      g.fillStyle = '#48de84'; g.fillRect(xs, 0, 2, H); g.fillRect(xe - 2, 0, 2, H);
    }
    // hot cues y cue
    const marker = (t, color, label) => {
      const x = (t - t0) * pxPerSec; if (x < -20 || x > W + 20) return;
      g.fillStyle = color; g.fillRect(x, 0, 2, H);
      if (label) { g.fillRect(x, 0, 18, 16); g.fillStyle = '#000'; g.font = `bold ${11 * (W / cv.clientWidth)}px system-ui`; g.textAlign = 'center'; g.fillText(label, x + 9, 12); }
    };
    deck.hotcues.forEach((hc, i) => hc && marker(hc.pos, HOTCUE_COLORS[i], String(i + 1)));
    if (deck.cuePoint > 0) marker(deck.cuePoint, '#ff9a3c', null);
    // playhead
    g.fillStyle = this.color; g.fillRect(W / 2 - 1, 0, 2, H);
  }
}

export class OverviewWave {
  constructor(canvas, deck, color) { this.canvas = canvas; this.deck = deck; this.color = color; this.ctx = canvas.getContext('2d'); this.img = null; this.imgFor = null; }
  rebuild() {
    const cv = this.canvas, A = this.deck.analysis; const W = cv.width, H = cv.height;
    const off = document.createElement('canvas'); off.width = W; off.height = H; const g = off.getContext('2d');
    g.fillStyle = '#0d0e12'; g.fillRect(0, 0, W, H);
    if (A) {
      const per = A.bins / W;
      for (let x = 0; x < W; x++) {
        const b0 = Math.floor(x * per), b1 = Math.max(b0 + 1, Math.floor((x + 1) * per));
        let l = 0, m = 0, h = 0;
        for (let b = b0; b < b1 && b < A.bins; b++) { if (A.low[b] > l) l = A.low[b]; if (A.mid[b] > m) m = A.mid[b]; if (A.high[b] > h) h = A.high[b]; }
        const amp = Math.min(1, Math.sqrt(l * l + m * m + h * h)) * H * 0.48;
        g.fillStyle = binColor(l, m, h); g.fillRect(x, H / 2 - amp, 1, amp * 2);
      }
    } else { g.fillStyle = '#23262e'; g.fillRect(0, H * 0.3, W, H * 0.4); }
    this.img = off; this.imgFor = this.deck.track;
  }
  draw() {
    const cv = this.canvas, g = this.ctx; const resized = fit(cv);
    const W = cv.width, H = cv.height, deck = this.deck;
    if (!deck.loaded) { g.fillStyle = '#0d0e12'; g.fillRect(0, 0, W, H); this.img = null; return; }
    if (!this.img || resized || this.imgFor !== deck.track) this.rebuild();
    g.drawImage(this.img, 0, 0);
    const dur = deck.duration || 1, px = (t) => t / dur * W;
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, 0, px(deck.position), H);
    if (deck.loop) { g.fillStyle = 'rgba(72,222,132,0.25)'; g.fillRect(px(deck.loop.start), 0, px(deck.loop.end) - px(deck.loop.start), H); }
    deck.hotcues.forEach((hc, i) => { if (hc) { g.fillStyle = HOTCUE_COLORS[i]; g.fillRect(px(hc.pos), 0, 2, H); } });
    if (deck.cuePoint > 0) { g.fillStyle = '#ff9a3c'; g.fillRect(px(deck.cuePoint), 0, 2, H); }
    g.fillStyle = this.color; g.fillRect(px(deck.position) - 1, 0, 2, H);
  }
}
