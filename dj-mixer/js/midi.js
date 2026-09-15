// Web MIDI: mapeo por "learn", persistido en localStorage, con feedback de LEDs para botones.
import { store } from './store.js';

export class Midi extends EventTarget {
  constructor(actions) {
    super();
    this.actions = actions; // { id: { label, type: 'button'|'abs'|'rel', press?, release?, set?, turn?, led? } }
    this.map = store.get('midimap', {}); // actionId → { key }
    this.learning = null; this.access = null; this.inputs = []; this.outputs = [];
    this.lastMessage = null;
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  get supported() { return !!navigator.requestMIDIAccess; }
  async init() {
    if (!this.supported) throw new Error('Web MIDI no disponible (usá Chrome/Edge, en https o localhost).');
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    const bind = () => {
      this.inputs = [...this.access.inputs.values()]; this.outputs = [...this.access.outputs.values()];
      for (const i of this.inputs) i.onmidimessage = (e) => this.onMessage(e);
      this.emit('devices', this.inputs.map(i => i.name));
    };
    this.access.onstatechange = bind; bind();
    return this.inputs;
  }
  get reverse() { const r = {}; for (const [a, m] of Object.entries(this.map)) if (m?.key) (r[m.key] ||= []).push(a); return r; }
  onMessage(e) {
    const [status, d1, d2] = e.data; const type = status & 0xf0, ch = status & 0x0f;
    let key, value, isNote = false;
    if (type === 0x90 || type === 0x80) { key = `note:${ch}:${d1}`; value = type === 0x90 && d2 > 0 ? 1 : 0; isNote = true; }
    else if (type === 0xb0) { key = `cc:${ch}:${d1}`; value = d2; }
    else if (type === 0xe0) { key = `pb:${ch}`; value = ((d2 << 7) | d1) / 127; }
    else return;
    this.lastMessage = { key, value, at: Date.now() };
    if (this.learning) {
      if (isNote && value === 0) return; // esperar el "press"
      this.map[this.learning] = { key };
      store.set('midimap', this.map);
      const id = this.learning; this.learning = null;
      this.emit('learned', { id, key }); this.emit('change');
      return;
    }
    for (const id of this.reverse[key] || []) {
      const a = this.actions[id]; if (!a) continue;
      if (a.type === 'button') {
        const on = isNote ? value === 1 : value > 63;
        if (on) a.press?.(); else a.release?.();
      } else if (a.type === 'abs') {
        a.set?.(isNote ? value : (key.startsWith('pb') ? value : value / 127));
      } else if (a.type === 'rel') {
        const delta = isNote ? 0 : (value < 64 ? value : value - 128);
        a.turn?.(delta / 24);
      }
      if (a.led) this.updateLed(id);
    }
  }
  learn(id) { this.learning = id; this.emit('learning', id); }
  cancelLearn() { this.learning = null; this.emit('learning', null); }
  clear(id) { delete this.map[id]; store.set('midimap', this.map); this.emit('change'); }
  clearAll() { this.map = {}; store.set('midimap', this.map); this.emit('change'); }
  export() { return JSON.stringify(this.map, null, 2); }
  import(json) { const m = JSON.parse(json); if (typeof m !== 'object') throw new Error('mapa inválido'); this.map = m; store.set('midimap', m); this.emit('change'); }
  updateLed(id) {
    const m = this.map[id]; const a = this.actions[id];
    if (!m || !a?.led || !this.outputs.length) return;
    const parts = m.key.split(':'); if (parts[0] !== 'note') return;
    const ch = +parts[1], note = +parts[2], on = !!a.led();
    for (const o of this.outputs) { try { o.send([0x90 | ch, note, on ? 127 : 0]); } catch { /* ignore */ } }
  }
  refreshLeds() { for (const id of Object.keys(this.map)) this.updateLed(id); }
}
