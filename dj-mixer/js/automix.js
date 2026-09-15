// Automix: encadena la cola con sync + crossfade automático cuando la pista está por terminar.
import { toast } from './utils.js';

export class AutoMix {
  constructor({ decks, library, mixer, onLoad }) {
    Object.assign(this, { decks, library, mixer, onLoad });
    this.enabled = false; this.transition = null; this.lead = 24; this.fadeSec = 16; this.armed = false;
  }
  async toggle() { this.enabled ? this.stop() : await this.start(); return this.enabled; }
  async start() {
    const { A, B } = this.decks;
    if (!this.library.queue.length && !A.loaded && !B.loaded) { toast('Agregá pistas a la cola Automix (botón ☰ en la biblioteca).', 'warn'); return; }
    this.enabled = true;
    if (!A.playing && !B.playing) {
      const cur = A.loaded ? A : B.loaded ? B : A;
      if (!cur.loaded) { const next = this.library.shiftQueue(); if (!next) { this.enabled = false; return; } await this.onLoad(next, cur); }
      this.mixer.xf.set(cur.id === 'A' ? -1 : 1);
      cur.play();
    }
    toast('Automix activado');
  }
  stop() { this.enabled = false; this.transition = null; this.armed = false; toast('Automix desactivado'); }
  tick() {
    if (!this.enabled) return;
    const { A, B } = this.decks;
    if (this.transition) return this._fade();
    const cur = A.playing ? A : B.playing ? B : null;
    if (!cur) return;
    const other = cur === A ? B : A;
    const remain = cur.duration - cur.position;
    if (!isFinite(remain) || remain > this.lead || this.armed) return;
    this.armed = true;
    (async () => {
      let next = this.library.shiftQueue();
      if (!next && other.loaded && !other.playing && other.track !== cur.track) next = other.track;
      if (!next) { this.armed = false; this.enabled = false; toast('Cola Automix vacía: fin del set', 'warn'); return; }
      if (other.track !== next) { const ok = await this.onLoad(next, other); if (!ok) { this.armed = false; return; } }
      if (!this.enabled) return;
      other.seek(other.cuePoint || 0);
      if (cur.bpm && other.bpm) other.syncTo(cur);
      other.play();
      this.transition = { from: cur, to: other, t0: performance.now(), dur: Math.min(this.fadeSec, Math.max(4, remain - 2)) * 1000 };
    })();
  }
  _fade() {
    const tr = this.transition; const k = Math.min(1, (performance.now() - tr.t0) / tr.dur);
    const target = tr.to.id === 'A' ? -1 : 1;
    this.mixer.xf.set(-target + 2 * target * k);
    if (k >= 1) { tr.from.pause(); tr.from.setRate(1); this.transition = null; this.armed = false; }
  }
}
