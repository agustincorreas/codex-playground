// Teclado en pantalla + teclado de computadora.
const KEYMAP = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17 };
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

export class Keyboard {
  constructor(el, { onNoteOn, onNoteOff, octaves = 3, baseOctave = 3 }) {
    this.el = el; this.onNoteOn = onNoteOn; this.onNoteOff = onNoteOff;
    this.octaves = octaves; this.base = baseOctave;
    this.down = new Set(); this.pointerNotes = new Map(); this.held = new Set();
    this.build();
    window.addEventListener('keydown', (e) => this.keydown(e));
    window.addEventListener('keyup', (e) => this.keyup(e));
  }
  build() {
    this.el.innerHTML = '';
    this.keys = new Map();
    const start = (this.base + 1) * 12;
    const count = this.octaves * 12 + 1;
    const whites = [];
    for (let i = 0; i < count; i++) {
      const n = start + i, pc = n % 12;
      const black = [1, 3, 6, 8, 10].includes(pc);
      const k = document.createElement('div');
      k.className = `key ${black ? 'black' : 'white'}`;
      k.dataset.note = n;
      if (pc === 0) { const l = document.createElement('span'); l.textContent = noteName(n); k.appendChild(l); }
      this.keys.set(n, k);
      if (!black) whites.push(k);
      this.el.appendChild(k);
    }
    // posicionar teclas negras
    const wc = whites.length;
    let wi = 0;
    for (const [n, k] of this.keys) {
      const pc = n % 12, black = [1, 3, 6, 8, 10].includes(pc);
      if (!black) { k.style.left = `${wi / wc * 100}%`; k.style.width = `${100 / wc}%`; wi++; }
      else { k.style.left = `${(wi - 0.3) / wc * 100}%`; k.style.width = `${100 / wc * 0.6}%`; }
    }
    const noteAt = (e) => {
      const t = document.elementFromPoint(e.clientX, e.clientY);
      return t && t.dataset && t.dataset.note ? parseInt(t.dataset.note, 10) : null;
    };
    this.el.addEventListener('pointerdown', (e) => {
      const n = noteAt(e); if (n === null) return;
      e.preventDefault(); this.el.setPointerCapture(e.pointerId);
      const vel = 0.5 + 0.5 * Math.min(1, (e.offsetY || 30) / 80);
      this.pointerNotes.set(e.pointerId, n); this.press(n, vel);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!this.pointerNotes.has(e.pointerId)) return;
      const n = noteAt(e); const prev = this.pointerNotes.get(e.pointerId);
      if (n !== null && n !== prev) { this.release(prev); this.pointerNotes.set(e.pointerId, n); this.press(n, 0.8); }
    });
    const up = (e) => { if (!this.pointerNotes.has(e.pointerId)) return; this.release(this.pointerNotes.get(e.pointerId)); this.pointerNotes.delete(e.pointerId); };
    this.el.addEventListener('pointerup', up); this.el.addEventListener('pointercancel', up);
  }
  setOctave(o) { this.base = Math.max(0, Math.min(7, o)); this.build(); }
  press(n, vel = 0.8) { if (this.held.has(n)) return; this.held.add(n); this.onNoteOn(n, vel); this.light(n, true); }
  release(n) { if (!this.held.has(n)) return; this.held.delete(n); this.onNoteOff(n); this.light(n, false); }
  light(n, on) { const k = this.keys.get(n); if (k) k.classList.toggle('active', on); }
  keydown(e) {
    if (e.repeat || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey) return;
    if (e.code === 'KeyZ') { this.setOctave(this.base - 1); return; }
    if (e.code === 'KeyX') { this.setOctave(this.base + 1); return; }
    const off = KEYMAP[e.code];
    if (off === undefined) return;
    e.preventDefault();
    const n = (this.base + 1) * 12 + off;
    this.down.add(e.code); this.press(n, 0.85);
  }
  keyup(e) {
    const off = KEYMAP[e.code];
    if (off === undefined) return;
    this.down.delete(e.code);
    this.release((this.base + 1) * 12 + off);
  }
}
