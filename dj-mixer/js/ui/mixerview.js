import { el } from '../utils.js';
import { knob, fader, button } from './components.js';
import { crossfadeGains } from '../audio/engine.js';

export class MixerView {
  constructor(engine, channels, root) {
    this.engine = engine; this.channels = channels; this.root = root; this.controls = {};
    const strips = {};
    for (const id of ['A', 'B']) {
      const ch = channels[id]; const a = (n) => `mix.${id}.${n}`;
      const trim = knob({ label: 'TRIM', min: -12, max: 12, def: 0, action: a('trim'), fmt: v => `${v.toFixed(1)} dB`, cls: 'expert-only', onChange: v => ch.setTrim(v) });
      const hi = knob({ label: 'HI', action: a('high'), onChange: v => ch.setEq('high', v) });
      const mid = knob({ label: 'MID', action: a('mid'), onChange: v => ch.setEq('mid', v) });
      const low = knob({ label: 'LOW', action: a('low'), onChange: v => ch.setEq('low', v) });
      const filter = knob({ label: 'FILTER', action: a('filter'), cls: 'expert-only filter', onChange: v => ch.setFilter(v) });
      const cue = button({ label: '🎧', cls: 'cue-btn sm', action: a('cue'), title: 'Escuchar en auriculares (cue)', onPress: () => { ch.setCue(!ch.v.cue); cue.set(ch.v.cue); } });
      const vu = el('div', { class: 'vu v' }, el('i'), el('b'));
      const fd = fader({ min: 0, max: 1, def: 1, vertical: true, action: a('fader'), cls: 'ch-fader', onChange: v => ch.setFader(v) });
      this.controls[id] = { trim, hi, mid, low, filter, cue, fader: fd, vu };
      strips[id] = el('div', { class: `strip strip-${id}` }, el('div', { class: 'strip-id' }, id), trim.el, hi.el, mid.el, low.el, filter.el, cue.el,
        el('div', { class: 'fader-row' }, vu, fd.el));
    }
    this.xf = fader({ min: -1, max: 1, def: 0, vertical: false, bipolar: false, detent: true, action: 'mix.xfader', cls: 'xfader', jump: false, onChange: v => this.applyXf(v) });
    this.master = knob({ label: 'MASTER', min: 0, max: 1.25, def: 1, bipolar: false, action: 'mix.master', size: 34, fmt: v => `${Math.round(v * 100)}%`, onChange: v => engine.setMasterGain(v) });
    this.masterVu = el('div', { class: 'vu h' }, el('i'), el('b'));
    root.append(
      el('div', { class: 'strips' }, strips.A, el('div', { class: 'strip-center' }, el('div', { class: 'row-label' }, 'MASTER'), this.masterVu, this.master.el), strips.B),
      el('div', { class: 'xf-row' }, el('span', { class: 'xf-label a' }, 'A'), this.xf.el, el('span', { class: 'xf-label b' }, 'B')),
    );
    this.applyXf(0);
  }
  applyXf(v) { const [ga, gb] = crossfadeGains(v, this.curve || 'smooth'); this.channels.A.setXf(ga); this.channels.B.setXf(gb); }
  _paint(vuEl, m) {
    const rms = Math.min(1, m.rms * 2.2), peak = Math.min(1, m.peak);
    vuEl.firstChild.style.setProperty('--lvl', `${rms * 100}%`);
    vuEl.lastChild.style.setProperty('--pk', `${peak * 100}%`);
    vuEl.classList.toggle('clip', m.peak > 0.99);
  }
  update() {
    for (const id of ['A', 'B']) this._paint(this.controls[id].vu, this.channels[id].meter());
    this._paint(this.masterVu, this.engine.meter());
  }
}
