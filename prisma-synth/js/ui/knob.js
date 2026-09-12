// Controles: perilla circular SVG con anillos de modulación (drag & drop de
// fuentes, modo asignación), selector enum y toggle.
import { MOD_SOURCES, formatValue, denorm } from '../shared/params.js';

const SVG = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = tag === 'svg' || tag === 'path' || tag === 'circle' || tag === 'g' || tag === 'text' ? document.createElementNS(SVG, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'text') e.textContent = v; else if (k === 'class') e.setAttribute('class', v); else e.setAttribute(k, v); }
  if (parent) parent.appendChild(e);
  return e;
};
const START = -135, SWEEP = 270; // grados
function arcPath(cx, cy, r, a0, a1) {
  if (a1 < a0) [a0, a1] = [a1, a0];
  if (a1 - a0 < 0.01) return '';
  const p = (a) => { const t = (a - 90) * Math.PI / 180; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; };
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export class Knob {
  constructor(app, idx, opts = {}) {
    this.app = app; this.idx = idx; this.def = app.def(idx);
    this.color = opts.color || '#8ab4ff';
    this.size = opts.size === 'lg' ? 96 : opts.size === 'xl' ? 140 : opts.size === 'sm' ? 44 : 56;
    this.bipolar = opts.bipolar ?? (this.def.min < 0 && this.def.max > 0);
    const root = this.el = el('div', { class: `knob knob-${opts.size || 'md'}`, 'data-param': this.def.id });
    root.style.setProperty('--kc', this.color);
    const S = this.size, c = S / 2;
    const svg = el('svg', { viewBox: `0 0 ${S} ${S}`, width: S, height: S }, root);
    this.rTrack = c - 5; this.rMod = c - 1.5;
    el('path', { class: 'k-track', d: arcPath(c, c, this.rTrack, START, START + SWEEP) }, svg);
    this.modGroup = el('g', { class: 'k-mods' }, svg);
    this.valArc = el('path', { class: 'k-val', d: '' }, svg);
    el('circle', { class: 'k-body', cx: c, cy: c, r: c - 11 }, svg);
    this.pointer = el('path', { class: 'k-ptr', d: `M ${c} ${c - (c - 12)} L ${c} ${c - (c - 12) + 7}` }, svg);
    this.liveDot = el('circle', { class: 'k-live', cx: c, cy: 4, r: 2.2 }, svg);
    this.liveDot.style.display = 'none';
    this.labelEl = el('div', { class: 'k-label', text: opts.label ?? this.def.name }, root);
    if (opts.label === '') this.labelEl.style.display = 'none';
    this.valueEl = el('div', { class: 'k-value', text: '' }, root);
    this.bindEvents();
    this.update();
  }
  get norm() { return this.app.getNorm(this.idx); }
  angleFor(n) { return START + n * SWEEP; }
  update() {
    const S = this.size, c = S / 2, n = this.norm;
    const a = this.angleFor(n);
    this.pointer.setAttribute('transform', `rotate(${a} ${c} ${c})`);
    const from = this.bipolar ? this.angleFor(0.5) : START;
    this.valArc.setAttribute('d', arcPath(c, c, this.rTrack, Math.min(from, a), Math.max(from, a)));
    this.valueEl.textContent = formatValue(this.def, denorm(this.def, n));
    this.updateMods();
  }
  updateMods() {
    const mods = this.app.modsFor(this.idx);
    const S = this.size, c = S / 2;
    while (this.modGroup.firstChild) this.modGroup.removeChild(this.modGroup.firstChild);
    const assign = this.app.assignSource;
    this.el.classList.toggle('has-mods', mods.length > 0);
    this.el.classList.toggle('assign-target', assign >= 0);
    const n = this.norm;
    mods.forEach((m, i) => {
      const src = MOD_SOURCES[m.src];
      const r = this.rMod - i * 2.6;
      const a0 = this.angleFor(n);
      const lo = src.bipolar ? Math.max(0, Math.min(1, n - Math.abs(m.amt))) : n;
      const hi = Math.max(0, Math.min(1, n + m.amt));
      const path = el('path', { class: 'k-mod', d: arcPath(c, c, r, this.angleFor(src.bipolar ? Math.min(lo, hi) : Math.min(n, hi)), this.angleFor(src.bipolar ? Math.max(lo, hi) : Math.max(n, hi))) }, this.modGroup);
      path.style.stroke = src.color;
      if (assign === m.src) path.classList.add('k-mod-active');
      void a0;
    });
    if (assign >= 0 && !mods.some(m => m.src === assign)) {
      // anillo fantasma que indica que se puede asignar
      const ghost = el('path', { class: 'k-mod k-mod-ghost', d: arcPath(c, c, this.rMod, START, START + SWEEP) }, this.modGroup);
      ghost.style.stroke = MOD_SOURCES[assign].color;
    }
  }
  // valor modulado en vivo (se llama a ~30 fps con las fuentes actuales)
  live(sources) {
    const mods = this.app.modsFor(this.idx);
    if (!mods.length) { this.liveDot.style.display = 'none'; return; }
    let n = this.norm;
    for (const m of mods) n += m.amt * sources[m.src];
    n = Math.max(0, Math.min(1, n));
    const S = this.size, c = S / 2;
    this.liveDot.style.display = '';
    this.liveDot.setAttribute('transform', `rotate(${this.angleFor(n)} ${c} ${c})`);
    this.liveDot.setAttribute('cy', c - this.rMod);
    this.liveDot.setAttribute('cx', c);
    this.liveDot.style.fill = MOD_SOURCES[mods[0].src].color;
  }
  bindEvents() {
    const root = this.el;
    let startY = 0, startN = 0, dragging = false, assignSrc = -1, startAmt = 0;
    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      root.setPointerCapture(e.pointerId);
      dragging = true; startY = e.clientY;
      assignSrc = this.app.assignSource;
      if (assignSrc >= 0) { const m = this.app.modsFor(this.idx).find(x => x.src === assignSrc); startAmt = m ? m.amt : 0; }
      else startN = this.norm;
      root.classList.add('dragging');
      this.app.showTip(this, true);
    });
    root.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = startY - e.clientY;
      const scale = (e.shiftKey ? 0.0008 : 0.005);
      if (assignSrc >= 0) {
        const amt = Math.max(-1, Math.min(1, startAmt + dy * scale));
        this.app.setMod(assignSrc, this.idx, Math.round(amt * 200) / 200);
      } else {
        this.app.setNorm(this.idx, Math.max(0, Math.min(1, startN + dy * scale)));
      }
      this.app.showTip(this, true);
    });
    const end = (e) => { if (!dragging) return; dragging = false; root.classList.remove('dragging'); this.app.showTip(this, false); };
    root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
    root.addEventListener('dblclick', () => {
      if (this.app.assignSource >= 0) this.app.removeMod(this.app.assignSource, this.idx);
      else this.app.setNorm(this.idx, this.app.defaultNorm(this.idx));
    });
    root.addEventListener('wheel', (e) => {
      e.preventDefault();
      const d = (e.deltaY > 0 ? -1 : 1) * (e.shiftKey ? 0.002 : 0.02);
      if (this.app.assignSource >= 0) {
        const m = this.app.modsFor(this.idx).find(x => x.src === this.app.assignSource);
        this.app.setMod(this.app.assignSource, this.idx, Math.max(-1, Math.min(1, (m ? m.amt : 0) + d)));
      } else this.app.setNorm(this.idx, Math.max(0, Math.min(1, this.norm + d)));
    }, { passive: false });
    root.addEventListener('contextmenu', (e) => { e.preventDefault(); this.app.openModPopover(this); });
    // drop de fuentes de modulación
    root.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/prisma-source')) { e.preventDefault(); root.classList.add('drop-hover'); } });
    root.addEventListener('dragleave', () => root.classList.remove('drop-hover'));
    root.addEventListener('drop', (e) => {
      e.preventDefault(); root.classList.remove('drop-hover');
      const src = e.dataTransfer.getData('text/prisma-source');
      if (src === '') return;
      const si = parseInt(src, 10);
      if (!this.app.modsFor(this.idx).some(m => m.src === si)) this.app.setMod(si, this.idx, 0.3);
      this.app.openModPopover(this, si);
    });
  }
}

export class EnumControl {
  constructor(app, idx, opts = {}) {
    this.app = app; this.idx = idx; this.def = app.def(idx);
    const root = this.el = document.createElement('div');
    root.className = `enum-ctl ${opts.class || ''}`;
    root.dataset.param = this.def.id;
    if (opts.color) root.style.setProperty('--kc', opts.color);
    if (opts.label !== '') { const l = document.createElement('div'); l.className = 'k-label'; l.textContent = opts.label || this.def.name; root.appendChild(l); }
    const sel = this.sel = document.createElement('select');
    this.def.opts.forEach((o, i) => { const op = document.createElement('option'); op.value = i; op.textContent = o; sel.appendChild(op); });
    sel.addEventListener('change', () => this.app.setNorm(this.idx, this.def.opts.length > 1 ? sel.selectedIndex / (this.def.opts.length - 1) : 0));
    root.appendChild(sel);
    this.update();
  }
  update() { this.sel.selectedIndex = Math.round(denorm(this.def, this.app.getNorm(this.idx)) - this.def.min); }
  live() {}
}

export class Toggle {
  constructor(app, idx, opts = {}) {
    this.app = app; this.idx = idx; this.def = app.def(idx);
    const b = this.btn = document.createElement('button');
    b.className = `toggle ${opts.class || ''}`;
    b.dataset.param = this.def.id;
    if (opts.color) b.style.setProperty('--kc', opts.color);
    b.addEventListener('click', () => this.app.setNorm(this.idx, this.app.getNorm(this.idx) > 0.5 ? 0 : 1));
    const isPower = (opts.class || '').includes('pw');
    this.label = opts.label || this.def.name;
    if (isPower) { b.textContent = this.label; this.el = b; }
    else {
      const w = this.el = document.createElement('div');
      w.className = 'toggle-wrap'; w.dataset.param = this.def.id;
      const l = document.createElement('div'); l.className = 'k-label'; l.textContent = this.label;
      w.append(l, b);
    }
    this.update();
  }
  update() {
    const on = this.app.getNorm(this.idx) > 0.5;
    this.btn.classList.toggle('on', on);
    if (this.el !== this.btn) this.btn.textContent = this.def.opts[on ? 1 : 0];
  }
  live() {}
}

export class Slider {
  // deslizador vertical (para ADSR)
  constructor(app, idx, opts = {}) {
    this.app = app; this.idx = idx; this.def = app.def(idx);
    const root = this.el = document.createElement('div');
    root.className = 'vslider'; root.dataset.param = this.def.id;
    if (opts.color) root.style.setProperty('--kc', opts.color);
    this.track = document.createElement('div'); this.track.className = 'vs-track';
    this.fill = document.createElement('div'); this.fill.className = 'vs-fill';
    this.track.appendChild(this.fill); root.appendChild(this.track);
    const l = document.createElement('div'); l.className = 'k-label'; l.textContent = opts.label || this.def.name; root.appendChild(l);
    this.valueEl = document.createElement('div'); this.valueEl.className = 'k-value'; root.appendChild(this.valueEl);
    let dragging = false, startY = 0, startN = 0;
    root.addEventListener('pointerdown', (e) => { e.preventDefault(); root.setPointerCapture(e.pointerId); dragging = true; startY = e.clientY; startN = this.app.getNorm(this.idx); });
    root.addEventListener('pointermove', (e) => { if (!dragging) return; const h = this.track.clientHeight || 80; this.app.setNorm(this.idx, Math.max(0, Math.min(1, startN + (startY - e.clientY) / h))); });
    const end = () => { dragging = false; };
    root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
    root.addEventListener('dblclick', () => this.app.setNorm(this.idx, this.app.defaultNorm(this.idx)));
    root.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/prisma-source')) { e.preventDefault(); root.classList.add('drop-hover'); } });
    root.addEventListener('dragleave', () => root.classList.remove('drop-hover'));
    root.addEventListener('drop', (e) => { e.preventDefault(); root.classList.remove('drop-hover'); const s = e.dataTransfer.getData('text/prisma-source'); if (s !== '') { const si = parseInt(s, 10); if (!this.app.modsFor(this.idx).some(m => m.src === si)) this.app.setMod(si, this.idx, 0.3); } });
    this.update();
  }
  update() {
    const n = this.app.getNorm(this.idx);
    this.fill.style.height = `${n * 100}%`;
    this.valueEl.textContent = formatValue(this.def, denorm(this.def, n));
    this.el.classList.toggle('has-mods', this.app.modsFor(this.idx).length > 0);
  }
  live() {}
}

export function createControl(app, idx, opts = {}) {
  const def = app.def(idx);
  if (def.curve === 'enum') {
    if (def.opts.length === 2 && opts.toggle !== false) return new Toggle(app, idx, opts);
    return new EnumControl(app, idx, opts);
  }
  if (opts.slider) return new Slider(app, idx, opts);
  return new Knob(app, idx, opts);
}
