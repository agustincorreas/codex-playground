// Prisma Synth — aplicación principal: estado, vistas, modulación por
// arrastrar y soltar, presets, MIDI y visualización en tiempo real.
import { PARAMS, PARAM_INDEX, pidx, denorm, norm, formatValue, COLORS, MOD_SOURCES, SRC_INDEX, FX_TYPES, FX_INDEX, FX_SLOTS, ENGINE_TYPES, ENGINE_NAMES, isGlobalParam } from './shared/params.js';
import { SynthAudio, MidiManager, listAudioOutputs, canSelectOutput } from './audio/engine.js';
import { Knob, EnumControl, Toggle, Slider, createControl } from './ui/knob.js';
import { MasterVisualizer, Scope, drawEnvelope, drawLFO } from './ui/visualizer.js';
import { Keyboard, noteName } from './ui/keyboard.js';
import { PRESETS } from './presets.js';

const $ = (sel, root = document) => root.querySelector(sel);
const h = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
};

// Parámetros específicos por tipo de motor (en el orden en que se muestran)
const ENGINE_PARAMS = {
  va: ['va.wave', 'va.pw', 'va.unison', 'va.detune', 'va.spread', 'va.sync', 'va.sub', 'va.subWave', 'va.noise'],
  wt: ['wt.table', 'wt.pos', 'wt.warp', 'wt.warpMode', 'wt.unison', 'wt.detune', 'wt.spread'],
  fm: ['fm.alg', 'fm.ratio2', 'fm.index2', 'fm.ratio3', 'fm.index3', 'fm.feedback', 'fm.shape'],
  gran: ['gran.source', 'gran.size', 'gran.density', 'gran.pos', 'gran.spray', 'gran.pitchRnd', 'gran.shape', 'gran.scan'],
  harm: ['harm.partials', 'harm.tilt', 'harm.oddEven', 'harm.stretch', 'harm.comb', 'harm.detune'],
  modal: ['modal.material', 'modal.modes', 'modal.decay', 'modal.damp', 'modal.pos', 'modal.exciter', 'modal.exLen', 'modal.bright'],
  smp: ['smp.source', 'smp.start', 'smp.loop', 'smp.loopLen', 'smp.tone'],
};
const BIG_PARAM = { va: 'va.detune', wt: 'wt.pos', fm: 'fm.index2', gran: 'gran.pos', harm: 'harm.partials', modal: 'modal.material', smp: 'smp.start' };

class App {
  constructor() {
    this.norm = new Float32Array(PARAMS.length);
    PARAMS.forEach((p, i) => { this.norm[i] = norm(p, p.def); });
    this.mods = [];
    this.meta = { name: 'Init', category: 'Template', description: '', macroNames: ['Macro 1', 'Macro 2', 'Macro 3', 'Macro 4'] };
    this.assignSource = -1;
    this.controls = new Map(); // idx → [control]
    this.audio = new SynthAudio();
    this.liveSrc = new Float32Array(MOD_SOURCES.length);
    this.scopes = {}; this.envCanvases = []; this.lfoCanvases = [];
    this.view = 'synth';
    this.userPresets = JSON.parse(localStorage.getItem('prisma.userPresets') || '[]');
    this.presetIndex = 0;
    this.started = false;
    this.octave = 3;
    this.midiOk = false;
    this.midi = new MidiManager({
      noteOn: (n, v) => { this.start(); this.audio.noteOn(n, v); this.keyboard && this.keyboard.light(n, true); },
      noteOff: (n) => { this.audio.noteOff(n); this.keyboard && this.keyboard.light(n, false); },
      bend: (v) => this.audio.bend(v),
      cc: (cc, v) => {
        if (cc === 1) { this.audio.modwheel(v); if (this.modwheelEl) this.modwheelEl.value = v * 100; }
        else if (cc === 64) this.audio.sustain(v > 0.5);
        else if (cc >= 20 && cc <= 23) this.setNorm(pidx(`macro${cc - 19}`), v);
        else if (cc === 74) this.setNorm(pidx('f1.cutoff'), v);
        else if (cc === 71) this.setNorm(pidx('f1.res'), v);
      },
    });
    this.midi.onChange = () => this.refreshDevices();
    this.midi.onActivity = () => this.midiBlink();
  }

  // ---- API usada por los controles
  def(idx) { return PARAMS[idx]; }
  getNorm(idx) { return this.norm[idx]; }
  defaultNorm(idx) { return norm(PARAMS[idx], PARAMS[idx].def); }
  setNorm(idx, n, opts = {}) {
    if (this.norm[idx] === n && !opts.force) return;
    this.norm[idx] = n;
    this.audio.setParam(idx, n);
    this.refresh(idx);
    const id = PARAMS[idx].id;
    if (id === 'a.type' || id === 'b.type') this.buildEngineBody(id[0]);
    if (/^fx\d\.type$/.test(id)) { this.applyFxDefaults(parseInt(id[2], 10)); this.buildFxSlot(parseInt(id[2], 10)); }
    if (id === 'arp.on') this.refreshArpBadge();
  }
  setValue(id, value) { const d = PARAMS[pidx(id)]; this.setNorm(d.index, norm(d, value)); }
  value(id) { const d = PARAMS[pidx(id)]; return denorm(d, this.norm[d.index]); }
  refresh(idx) { const cs = this.controls.get(idx); if (cs) for (const c of cs) c.update(); }
  refreshAll() { for (const cs of this.controls.values()) for (const c of cs) c.update(); this.buildMatrix(); this.refreshChips(); this.refreshArpBadge(); }
  register(ctl) { if (!this.controls.has(ctl.idx)) this.controls.set(ctl.idx, []); this.controls.get(ctl.idx).push(ctl); return ctl; }
  unregisterIn(root) {
    for (const [idx, list] of this.controls) {
      const keep = list.filter(c => !root.contains(c.el));
      if (keep.length) this.controls.set(idx, keep); else this.controls.delete(idx);
    }
  }
  modsFor(idx) { return this.mods.filter(m => m.dst === idx); }
  setMod(src, dst, amt) {
    if (PARAMS[dst].nomod) return;
    const m = this.mods.find(x => x.src === src && x.dst === dst);
    if (m) m.amt = amt; else this.mods.push({ src, dst, amt });
    this.pushMods(); this.refresh(dst); this.buildMatrix();
  }
  removeMod(src, dst) { this.mods = this.mods.filter(x => !(x.src === src && x.dst === dst)); this.pushMods(); this.refresh(dst); this.buildMatrix(); }
  pushMods() { this.audio.setMods(this.mods); this.refreshChips(); }
  showTip() {}
  setAssign(src) {
    this.assignSource = this.assignSource === src ? -1 : src;
    document.body.classList.toggle('assign-mode', this.assignSource >= 0);
    document.body.style.setProperty('--assign-color', this.assignSource >= 0 ? MOD_SOURCES[this.assignSource].color : 'transparent');
    $('#assign-banner').hidden = this.assignSource < 0;
    if (this.assignSource >= 0) $('#assign-banner-name').textContent = MOD_SOURCES[this.assignSource].name;
    for (const cs of this.controls.values()) for (const c of cs) if (c.updateMods) c.updateMods();
    this.refreshChips();
  }
  openModPopover(knob, src) {
    const pop = $('#mod-popover');
    const mods = this.modsFor(knob.idx);
    if (!mods.length) { pop.hidden = true; return; }
    pop.innerHTML = '';
    pop.appendChild(h('div', { class: 'pop-title' }, `${knob.def.name}`, h('button', { class: 'pop-close', onclick: () => { pop.hidden = true; } }, '×')));
    for (const m of mods) {
      const s = MOD_SOURCES[m.src];
      const row = h('div', { class: 'pop-row', style: `--kc:${s.color}` });
      const amtLabel = h('span', { class: 'pop-amt' }, `${Math.round(m.amt * 100)}%`);
      const range = h('input', { type: 'range', min: -100, max: 100, value: Math.round(m.amt * 100) });
      range.addEventListener('input', () => { this.setMod(m.src, knob.idx, range.value / 100); amtLabel.textContent = `${range.value}%`; });
      row.append(h('span', { class: 'chip chip-sm', style: `--kc:${s.color}` }, s.short), range, amtLabel,
        h('button', { class: 'pop-del', onclick: () => { this.removeMod(m.src, knob.idx); this.openModPopover(knob); } }, '✕'));
      pop.appendChild(row);
    }
    if (!mods.length) pop.hidden = true;
    const r = knob.el.getBoundingClientRect();
    pop.hidden = false;
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x = r.left + r.width / 2 - pw / 2, y = r.bottom + 6;
    x = Math.max(8, Math.min(window.innerWidth - pw - 8, x));
    if (y + ph > window.innerHeight - 8) y = r.top - ph - 6;
    pop.style.left = `${x}px`; pop.style.top = `${y}px`;
    if (src !== undefined) { const inp = pop.querySelectorAll('input')[mods.findIndex(m => m.src === src)]; if (inp) inp.focus(); }
  }

  // ---- construcción de UI
  build() {
    this.buildHeader();
    this.buildSynthView();
    this.buildFxView();
    this.buildArpView();
    this.buildPlayView();
    this.buildFooter();
    this.buildDevicesPanel();
    this.showView('synth');
    document.addEventListener('pointerdown', (e) => { const pop = $('#mod-popover'); if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.knob')) pop.hidden = true; const dp = $('#devices-panel'); if (dp && !dp.hidden && !dp.contains(e.target) && !e.target.closest('#midi-ind')) dp.hidden = true; });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.assignSource >= 0) this.setAssign(this.assignSource); });
    this.loadPreset(0);
    this.startLoop();
  }
  control(id, opts = {}) {
    const idx = pidx(id);
    return this.register(createControl(this, idx, opts)).el;
  }
  ctl(id, opts = {}) { return this.register(createControl(this, pidx(id), opts)); }
  chip(srcId, extra = '') {
    const si = SRC_INDEX[srcId], s = MOD_SOURCES[si];
    const c = h('span', { class: `chip ${extra}`, draggable: 'true', title: `Arrastrá sobre una perilla para modular · Click: modo asignación`, style: `--kc:${s.color}`, dataset: { src: si } }, s.short);
    c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/prisma-source', String(si)); e.dataTransfer.effectAllowed = 'link'; c.classList.add('dragging'); });
    c.addEventListener('dragend', () => c.classList.remove('dragging'));
    c.addEventListener('click', () => this.setAssign(si));
    return c;
  }
  refreshChips() {
    document.querySelectorAll('.chip[data-src]').forEach(c => {
      const si = parseInt(c.dataset.src, 10);
      c.classList.toggle('active', this.assignSource === si);
      const n = this.mods.filter(m => m.src === si).length;
      c.dataset.count = n || '';
    });
  }

  buildHeader() {
    const head = $('#header');
    const presetSel = this.presetSel = h('select', { class: 'preset-select', onchange: () => this.loadPreset(parseInt(presetSel.value, 10)) });
    this.fillPresetSelect();
    head.append(
      h('div', { class: 'logo' }, h('span', { class: 'logo-mark' }), 'PRISMA'),
      h('div', { class: 'preset-bar' },
        h('button', { class: 'ib', title: 'Preset anterior', onclick: () => this.loadPreset(this.presetIndex - 1) }, '‹'),
        presetSel,
        h('button', { class: 'ib', title: 'Preset siguiente', onclick: () => this.loadPreset(this.presetIndex + 1) }, '›'),
        h('button', { class: 'tb', title: 'Guardar como preset de usuario', onclick: () => this.savePreset() }, 'Save'),
        h('button', { class: 'tb', title: 'Exportar preset (JSON)', onclick: () => this.exportPreset() }, 'Export'),
        h('button', { class: 'tb', title: 'Importar preset (JSON)', onclick: () => $('#import-file').click() }, 'Import'),
        h('button', { class: 'tb', title: 'Cargar un archivo de audio para Granular / Sample', onclick: () => $('#sample-file').click() }, 'Load Sample'),
      ),
      h('nav', { class: 'tabs' }, ...['synth', 'fx', 'arp', 'play'].map(v => h('button', { class: 'tab', dataset: { view: v }, onclick: () => this.showView(v) }, v.toUpperCase()))),
      h('div', { class: 'status' },
        h('button', { id: 'midi-ind', class: 'ind ind-btn', title: 'Dispositivos MIDI y salida de audio', onclick: () => this.toggleDevices() }, 'MIDI ▾'),
        h('span', { id: 'arp-ind', class: 'ind', title: 'Arpegiador' }, 'ARP'),
        h('span', { id: 'voice-ind', class: 'ind' }, '0 v'),
        h('div', { class: 'meter' }, h('div', { id: 'meter-fill' })),
        this.control('master.volume', { size: 'sm', color: COLORS.master, label: 'Master' }),
        h('button', { id: 'power', class: 'power', onclick: () => this.start() }, '⏻ Start'),
      ),
    );
    $('#import-file').addEventListener('change', (e) => this.importPreset(e.target.files[0]));
    $('#sample-file').addEventListener('change', (e) => this.loadSampleFile(e.target.files[0]));
  }
  showView(v) {
    this.view = v;
    document.querySelectorAll('.view').forEach(el => { el.hidden = el.dataset.view !== v; });
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  }

  // ---- vista SYNTH
  buildSynthView() {
    const root = $('#view-synth');
    root.append(
      h('div', { class: 'row engines' }, this.buildEnginePanel('a'), this.buildEnginePanel('b')),
      h('div', { class: 'row filters' }, this.buildFilterPanel('f1'), this.buildRoutingPanel(), this.buildFilterPanel('f2'), this.buildMasterPanel()),
      h('div', { class: 'row modsrc' }, this.buildEnvPanel(), this.buildLfoPanel(), this.buildMacroPanel(), this.buildKeySourcesPanel()),
      h('div', { class: 'row matrix' }, this.buildMatrixPanel()),
    );
  }
  buildEnginePanel(X) {
    const color = COLORS[X];
    const panel = h('section', { class: `panel engine engine-${X}`, style: `--pc:${color}` });
    const scope = h('canvas', { class: 'scope' });
    this.scopes[X] = new Scope(scope, color);
    const body = h('div', { class: 'engine-body' });
    panel.append(
      h('header', {},
        this.control(`${X}.on`, { label: 'ON', color, class: 'pw' }),
        h('h2', {}, `ENGINE ${X.toUpperCase()}`),
        this.control(`${X}.type`, { label: '', color, class: 'type-select' }),
        h('div', { class: 'spacer' }),
        this.control(`${X}.filter`, { label: 'To', color, class: 'inline' }),
      ),
      h('div', { class: 'engine-top' },
        scope,
        h('div', { class: 'knob-row' },
          this.control(`${X}.level`, { color }), this.control(`${X}.pan`, { color }),
          this.control(`${X}.octave`, { color, size: 'sm' }), this.control(`${X}.semi`, { color, size: 'sm' }), this.control(`${X}.fine`, { color, size: 'sm' }),
        ),
      ),
      body,
    );
    panel.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); panel.classList.add('file-hover'); } });
    panel.addEventListener('dragleave', () => panel.classList.remove('file-hover'));
    panel.addEventListener('drop', (e) => { panel.classList.remove('file-hover'); if (e.dataTransfer.files.length) { e.preventDefault(); this.loadSampleFile(e.dataTransfer.files[0], X); } });
    this[`engineBody_${X}`] = body;
    this.buildEngineBody(X);
    return panel;
  }
  buildEngineBody(X) {
    const body = this[`engineBody_${X}`];
    if (!body) return;
    this.unregisterIn(body);
    body.innerHTML = '';
    const type = ENGINE_TYPES[Math.round(this.value(`${X}.type`))];
    const color = COLORS[X];
    const ids = ENGINE_PARAMS[type];
    const desc = {
      va: 'Oscilador analógico virtual con PolyBLEP, unison hasta 7 voces, sub y ruido.',
      wt: 'Wavetable de 8 tablas × 16 frames con mipmaps anti-alias y 4 modos de warp.',
      fm: 'FM de 3 operadores con 4 algoritmos, feedback y plegado del carrier.',
      gran: 'Granular sobre fuentes internas o tu propio sample (arrastralo aquí).',
      harm: 'Aditivo de 32 parciales: inclinación, par/impar, estiramiento y peine.',
      modal: 'Resonadores modales: cuerda → barra → membrana → campana.',
      smp: 'Reproductor de sample con loop; arrastrá un archivo de audio aquí.',
    }[type];
    body.append(h('p', { class: 'engine-desc' }, desc));
    const row = h('div', { class: 'knob-row wrap' });
    for (const id of ids) {
      const full = `${X}.${id}`;
      const d = PARAMS[pidx(full)];
      const big = id === BIG_PARAM[type];
      row.append(this.control(full, { color, size: big ? 'lg' : 'md', toggle: d.opts && d.opts.length === 2 }));
    }
    body.append(row);
  }
  buildFilterPanel(F) {
    const color = COLORS.filter;
    return h('section', { class: 'panel filter', style: `--pc:${color}` },
      h('header', {}, h('h2', {}, F === 'f1' ? 'FILTER 1' : 'FILTER 2'), this.control(`${F}.type`, { label: '', color, class: 'type-select' })),
      h('div', { class: 'knob-row' },
        this.control(`${F}.cutoff`, { color, size: 'lg' }), this.control(`${F}.res`, { color }),
        this.control(`${F}.drive`, { color, size: 'sm' }), this.control(`${F}.keytrack`, { color, size: 'sm' }),
      ),
    );
  }
  buildRoutingPanel() {
    const color = COLORS.filter;
    return h('section', { class: 'panel routing', style: `--pc:${color}` },
      h('header', {}, h('h2', {}, 'ROUTING')),
      h('div', { class: 'routing-diagram' },
        h('div', { class: 'rt-box', style: `--pc:${COLORS.a}` }, 'A'), h('div', { class: 'rt-box', style: `--pc:${COLORS.b}` }, 'B'),
        h('div', { class: 'rt-arrow' }, '→'),
        h('div', { class: 'rt-box' }, 'F1'), h('div', { class: 'rt-box' }, 'F2'),
        h('div', { class: 'rt-arrow' }, '→'),
        h('div', { class: 'rt-box' }, 'AMP'),
      ),
      this.control('filter.routing', { label: 'Mode', color, toggle: false }),
      h('p', { class: 'hint' }, 'Cada motor elige su filtro (F1, F2, ambos o bypass). En serie, F1 alimenta a F2.'),
    );
  }
  buildMasterPanel() {
    const color = COLORS.master;
    return h('section', { class: 'panel master', style: `--pc:${color}` },
      h('header', {}, h('h2', {}, 'VOICE')),
      h('div', { class: 'knob-row' },
        this.control('master.poly', { label: 'Mode', color, toggle: false }), this.control('master.voices', { color, size: 'sm' }),
        this.control('master.glide', { color }), this.control('master.bend', { color, size: 'sm' }),
        this.control('master.tempo', { color, size: 'sm' }),
      ),
    );
  }
  buildEnvPanel() {
    const color = COLORS.env;
    const panel = h('section', { class: 'panel envs', style: `--pc:${color}` }, h('header', {}, h('h2', {}, 'ENVELOPES'), h('span', { class: 'hint' }, 'Env 1 = amplitud. Arrastrá el chip a cualquier perilla.')));
    const cols = h('div', { class: 'env-cols' });
    for (let k = 1; k <= 3; k++) {
      const E = `env${k}`;
      const cv = h('canvas', { class: 'env-canvas' });
      this.envCanvases.push({ cv, k });
      cols.append(h('div', { class: 'env-col' },
        h('div', { class: 'col-head' }, this.chip(E), h('span', { class: 'col-title' }, k === 1 ? 'AMP' : '')),
        cv,
        h('div', { class: 'slider-row' },
          this.control(`${E}.attack`, { slider: true, color, label: 'A' }), this.control(`${E}.decay`, { slider: true, color, label: 'D' }),
          this.control(`${E}.sustain`, { slider: true, color, label: 'S' }), this.control(`${E}.release`, { slider: true, color, label: 'R' }),
          this.control(`${E}.curve`, { color, size: 'sm', label: 'Curve' }),
        ),
      ));
    }
    panel.append(cols);
    return panel;
  }
  buildLfoPanel() {
    const color = COLORS.lfo;
    const panel = h('section', { class: 'panel lfos', style: `--pc:${color}` }, h('header', {}, h('h2', {}, 'LFOs'), h('span', { class: 'hint' }, 'Polifónicos con retrigger; Sync sigue el tempo.')));
    const cols = h('div', { class: 'lfo-cols' });
    for (let k = 1; k <= 3; k++) {
      const L = `lfo${k}`;
      const cv = h('canvas', { class: 'lfo-canvas' });
      this.lfoCanvases.push({ cv, k });
      cols.append(h('div', { class: 'lfo-col' },
        h('div', { class: 'col-head' }, this.chip(L), this.control(`${L}.shape`, { label: '', color, class: 'inline' })),
        cv,
        h('div', { class: 'knob-row' },
          this.control(`${L}.rate`, { color }), this.control(`${L}.div`, { label: 'Div', color, toggle: false, class: 'inline' }),
          this.control(`${L}.sync`, { color, label: 'Sync' }), this.control(`${L}.retrig`, { color, label: 'Retrig' }),
          this.control(`${L}.phase`, { color, size: 'sm' }), this.control(`${L}.smooth`, { color, size: 'sm' }),
        ),
      ));
    }
    panel.append(cols);
    return panel;
  }
  buildMacroPanel() {
    const color = COLORS.macro;
    const panel = h('section', { class: 'panel macros', style: `--pc:${color}` }, h('header', {}, h('h2', {}, 'MACROS'), h('span', { class: 'hint' }, 'Nombre editable · MIDI CC 20–23')));
    const row = h('div', { class: 'macro-row' });
    this.macroLabels = [];
    for (let k = 1; k <= 4; k++) {
      const knob = this.ctl(`macro${k}`, { color, size: 'sm', label: this.meta.macroNames[k - 1] });
      const name = h('input', { class: 'macro-name', value: this.meta.macroNames[k - 1], maxlength: 12 });
      name.addEventListener('input', () => this.setMacroName(k - 1, name.value));
      this.macroLabels.push(name);
      row.append(h('div', { class: 'macro-col' }, this.chip(`macro${k}`), knob.el, name));
    }
    panel.append(row);
    return panel;
  }
  buildKeySourcesPanel() {
    const color = COLORS.key;
    return h('section', { class: 'panel keysrc', style: `--pc:${color}` },
      h('header', {}, h('h2', {}, 'PERFORMANCE')),
      h('div', { class: 'chip-list' }, this.chip('velocity', 'chip-wide'), this.chip('keytrack', 'chip-wide'), this.chip('modwheel', 'chip-wide'), this.chip('bend', 'chip-wide'), this.chip('random', 'chip-wide')),
      h('p', { class: 'hint' }, 'Arrastrá cualquier fuente sobre una perilla, o hacé click en ella para entrar en modo asignación y girar las perillas para fijar la cantidad. Click derecho en una perilla edita sus modulaciones.'),
    );
  }
  buildMatrixPanel() {
    const panel = h('section', { class: 'panel matrix-panel' }, h('header', {}, h('h2', {}, 'MOD MATRIX'), h('button', { class: 'tb', onclick: () => this.addMatrixRow() }, '+ Add')));
    this.matrixBody = h('div', { class: 'matrix-body' });
    panel.append(this.matrixBody);
    return panel;
  }
  buildMatrix() {
    const body = this.matrixBody; if (!body) return;
    body.innerHTML = '';
    if (!this.mods.length) { body.append(h('p', { class: 'hint' }, 'Sin modulaciones. Arrastrá un chip a una perilla o usá + Add.')); return; }
    const targets = PARAMS.filter(p => !p.nomod);
    const groupName = (p) => p.group === 'a' ? 'Engine A' : p.group === 'b' ? 'Engine B' : p.group === 'fx' ? 'FX' : p.group[0].toUpperCase() + p.group.slice(1);
    this.mods.forEach((m, i) => {
      const s = MOD_SOURCES[m.src];
      const srcSel = h('select', { class: 'mx-src', style: `--kc:${s.color}` }, ...MOD_SOURCES.map((x, j) => h('option', { value: j, ...(j === m.src ? { selected: '' } : {}) }, x.name)));
      srcSel.addEventListener('change', () => { m.src = parseInt(srcSel.value, 10); this.pushMods(); this.buildMatrix(); this.refresh(m.dst); });
      const dstSel = h('select', { class: 'mx-dst' });
      let lastGroup = null, og = null;
      for (const p of targets) {
        const g = groupName(p);
        if (g !== lastGroup) { og = h('optgroup', { label: g }); dstSel.append(og); lastGroup = g; }
        og.append(h('option', { value: p.index, ...(p.index === m.dst ? { selected: '' } : {}) }, this.paramLabel(p)));
      }
      dstSel.addEventListener('change', () => { const old = m.dst; m.dst = parseInt(dstSel.value, 10); this.pushMods(); this.refresh(old); this.refresh(m.dst); this.buildMatrix(); });
      const amt = h('input', { type: 'range', min: -100, max: 100, value: Math.round(m.amt * 100), style: `--kc:${s.color}` });
      const amtLabel = h('span', { class: 'mx-amt' }, `${Math.round(m.amt * 100)}%`);
      amt.addEventListener('input', () => { m.amt = amt.value / 100; amtLabel.textContent = `${amt.value}%`; this.audio.setMods(this.mods); this.refresh(m.dst); });
      body.append(h('div', { class: 'mx-row', style: `--kc:${s.color}` }, srcSel, h('span', { class: 'mx-arrow' }, '→'), dstSel, amt, amtLabel,
        h('button', { class: 'pop-del', onclick: () => { this.mods.splice(i, 1); this.pushMods(); this.refresh(m.dst); this.buildMatrix(); } }, '✕')));
    });
  }
  paramLabel(p) {
    if (p.fxParam !== undefined) {
      const t = FX_TYPES[Math.round(this.value(`fx${p.slot}.type`))];
      const name = t.params[p.fxParam] ? t.params[p.fxParam].name : p.name;
      return `FX${p.slot} ${t.name} ${name}`;
    }
    const pre = p.group === 'a' ? 'A ' : p.group === 'b' ? 'B ' : p.id.startsWith('fx') ? p.id.split('.')[0].toUpperCase() + ' ' : p.id.startsWith('f1') ? 'F1 ' : p.id.startsWith('f2') ? 'F2 ' : p.id.startsWith('env') || p.id.startsWith('lfo') ? p.id.split('.')[0].toUpperCase() + ' ' : '';
    return pre + p.name;
  }
  addMatrixRow() { this.mods.push({ src: SRC_INDEX.lfo1, dst: pidx('f1.cutoff'), amt: 0.2 }); this.pushMods(); this.refresh(pidx('f1.cutoff')); this.buildMatrix(); }

  // ---- vista FX
  buildFxView() {
    const root = $('#view-fx');
    const chain = h('div', { class: 'fx-chain' });
    this.fxSlotEls = [];
    for (let i = 1; i <= FX_SLOTS; i++) {
      const color = COLORS.fx;
      const body = h('div', { class: 'fx-body' });
      const panel = h('section', { class: 'panel fx-slot', style: `--pc:${color}` },
        h('header', {}, this.control(`fx${i}.on`, { label: 'ON', color, class: 'pw' }), h('h2', {}, `FX ${i}`), this.control(`fx${i}.type`, { label: '', color, class: 'type-select' }), h('div', { class: 'spacer' }), this.control(`fx${i}.mix`, { color, size: 'sm' })),
        body,
      );
      this.fxSlotEls[i] = body;
      chain.append(panel);
      if (i < FX_SLOTS) chain.append(h('div', { class: 'fx-arrow' }, '→'));
      this.buildFxSlot(i);
    }
    root.append(
      h('div', { class: 'row' }, chain),
      h('div', { class: 'row' }, h('section', { class: 'panel fx-info' },
        h('header', {}, h('h2', {}, 'CORRODER'), h('span', { class: 'hint' }, 'Efecto destacado')),
        h('p', {}, 'El Corroder usa la señal de entrada para modular en frecuencia un oscilador interno (Freq / Depth) cuyo volumen sigue la envolvente de la señal, y luego le aplica una compuerta granular aleatoria (Grain / Rate). Tone suaviza el resultado y Feedback lo vuelve más caótico. Probá modular Freq con un LFO desde la matriz o Mix con una macro.'),
      )),
    );
  }
  applyFxDefaults(slot) {
    const t = FX_TYPES[Math.round(this.value(`fx${slot}.type`))];
    t.params.forEach((p, k) => { const idx = pidx(`fx${slot}.p${k}`); const n = p.curve === 'enum' ? (p.max > 0 ? p.def / p.max : 0) : norm(p, p.def); this.norm[idx] = n; this.audio.setParam(idx, n); });
  }
  buildFxSlot(slot) {
    const body = this.fxSlotEls && this.fxSlotEls[slot]; if (!body) return;
    this.unregisterIn(body); body.innerHTML = '';
    const t = FX_TYPES[Math.round(this.value(`fx${slot}.type`))];
    if (!t.params.length) { body.append(h('p', { class: 'hint' }, 'Slot vacío. Elegí un efecto.')); return; }
    const row = h('div', { class: 'knob-row wrap' });
    t.params.forEach((p, k) => {
      const idx = pidx(`fx${slot}.p${k}`);
      // vista "virtual" del parámetro genérico con el rango del efecto
      const vdef = { ...PARAMS[idx], name: p.name, min: p.min, max: p.max, curve: p.curve, unit: p.unit, opts: p.opts };
      const facade = this.fxFacade(idx, vdef);
      const ctl = p.curve === 'enum' ? new EnumControl(facade, idx, { color: COLORS.fx, label: p.name }) : new Knob(facade, idx, { color: COLORS.fx, size: k === 0 ? 'lg' : 'md', label: p.name });
      this.register(ctl); row.append(ctl.el);
    });
    body.append(row);
    if (this.matrixBody) this.buildMatrix();
  }
  fxFacade(idx, vdef) {
    // Un proxy de App que presenta la definición virtual del parámetro FX
    const app = this;
    return new Proxy(app, {
      get(target, prop) {
        if (prop === 'def') return (i) => (i === idx ? vdef : target.def(i));
        if (prop === 'defaultNorm') return (i) => (i === idx ? (vdef.curve === 'enum' ? (vdef.max > 0 ? vdef.def / vdef.max : 0) : norm(vdef, vdef.def)) : target.defaultNorm(i));
        if (prop === 'setNorm') return (i, n, o) => target.setNorm(i, vdef.curve === 'enum' ? Math.round(n * vdef.max) / Math.max(1, vdef.max) : n, o);
        const v = target[prop];
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
  }

  // ---- vista ARP
  buildArpView() {
    const root = $('#view-arp');
    const color = COLORS.arp;
    root.append(h('div', { class: 'row' },
      h('section', { class: 'panel arp', style: `--pc:${color}` },
        h('header', {}, this.control('arp.on', { label: 'ON', color, class: 'pw' }), h('h2', {}, 'ARPEGGIATOR')),
        h('div', { class: 'knob-row' },
          this.control('arp.mode', { color, toggle: false }), this.control('arp.rate', { color, toggle: false }),
          this.control('arp.octaves', { color }), this.control('arp.gate', { color }), this.control('arp.swing', { color }), this.control('master.tempo', { color }),
        ),
        h('p', { class: 'hint' }, 'Con el arpegiador activo, las notas que mantengas presionadas (teclado, MIDI o pantalla) se recorren según el modo. Gate y Swing son modulables.'),
      ),
    ));
  }

  // ---- vista PLAY
  buildPlayView() {
    const root = $('#view-play');
    const cv = h('canvas', { class: 'play-viz' });
    this.playCanvas = cv;
    const macros = h('div', { class: 'play-macros' });
    this.playMacroLabels = [];
    for (let k = 1; k <= 4; k++) {
      const knob = this.ctl(`macro${k}`, { color: COLORS.macro, size: 'xl', label: '' });
      const name = h('div', { class: 'play-macro-name', contenteditable: 'true', spellcheck: 'false' }, this.meta.macroNames[k - 1]);
      name.addEventListener('input', () => this.setMacroName(k - 1, name.textContent));
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
      this.playMacroLabels.push(name);
      macros.append(h('div', { class: 'play-macro' }, knob.el, name));
    }
    this.playTitle = h('h1', { class: 'play-title' }, 'Init');
    this.playDesc = h('p', { class: 'play-desc' }, '');
    root.append(
      h('div', { class: 'play-layout' },
        h('div', { class: 'play-left' },
          h('div', { class: 'play-head' },
            h('button', { class: 'ib big', onclick: () => this.loadPreset(this.presetIndex - 1) }, '‹'),
            h('div', {}, this.playTitle, this.playDesc),
            h('button', { class: 'ib big', onclick: () => this.loadPreset(this.presetIndex + 1) }, '›'),
          ),
          macros,
          h('div', { class: 'play-quick' },
            this.control('f1.cutoff', { color: COLORS.filter, size: 'md' }), this.control('f1.res', { color: COLORS.filter, size: 'md' }),
            this.control('env1.attack', { color: COLORS.env, size: 'md' }), this.control('env1.release', { color: COLORS.env, size: 'md' }),
            this.control('master.glide', { color: COLORS.master, size: 'md' }),
          ),
        ),
        h('div', { class: 'play-right' }, cv),
      ),
    );
  }
  setMacroName(i, name) {
    this.meta.macroNames[i] = name || `Macro ${i + 1}`;
    for (const cs of this.controls.get(pidx(`macro${i + 1}`)) || []) if (cs.labelEl && cs.size !== 140) cs.labelEl.textContent = this.meta.macroNames[i];
    if (this.macroLabels && this.macroLabels[i].value !== name) this.macroLabels[i].value = this.meta.macroNames[i];
    if (this.playMacroLabels && this.playMacroLabels[i].textContent !== name) this.playMacroLabels[i].textContent = this.meta.macroNames[i];
  }

  // ---- pie: teclado
  buildFooter() {
    const foot = $('#footer');
    const kb = h('div', { class: 'keyboard' });
    const bend = h('input', { type: 'range', class: 'wheel bend', min: -100, max: 100, value: 0, orient: 'vertical' });
    bend.addEventListener('input', () => this.audio.bend(bend.value / 100));
    const release = () => { bend.value = 0; this.audio.bend(0); };
    bend.addEventListener('pointerup', release); bend.addEventListener('pointercancel', release);
    const mw = h('input', { type: 'range', class: 'wheel mod', min: 0, max: 100, value: 0, orient: 'vertical' });
    mw.addEventListener('input', () => { this.liveSrc[SRC_INDEX.modwheel] = mw.value / 100; this.audio.modwheel(mw.value / 100); });
    this.modwheelEl = mw;
    const sus = h('button', { class: 'tb', onclick: () => { sus.classList.toggle('on'); this.audio.sustain(sus.classList.contains('on')); } }, 'Sustain');
    const octLabel = h('span', { class: 'oct-label' }, 'C3');
    foot.append(
      h('div', { class: 'kb-side' },
        h('div', { class: 'wheels' }, h('div', { class: 'wheel-col' }, bend, h('span', {}, 'Bend')), h('div', { class: 'wheel-col' }, mw, h('span', {}, 'Mod'))),
        h('div', { class: 'oct' }, h('button', { class: 'ib', onclick: () => this.keyboard.setOctave(this.keyboard.base - 1) }, '−'), octLabel, h('button', { class: 'ib', onclick: () => this.keyboard.setOctave(this.keyboard.base + 1) }, '+')),
        sus,
        h('button', { class: 'tb', title: 'Silenciar todas las voces', onclick: () => this.audio.panic() }, 'Panic'),
      ),
      kb,
      h('div', { class: 'kb-help' }, 'Teclas: A W S E D F T G Y H U J K O L P · Z/X octava · Shift = ajuste fino · Doble click = reset'),
    );
    this.keyboard = new Keyboard(kb, { onNoteOn: (n, v) => this.noteOn(n, v), onNoteOff: (n) => this.noteOff(n), octaves: 3, baseOctave: 3 });
    const origSet = this.keyboard.setOctave.bind(this.keyboard);
    this.keyboard.setOctave = (o) => { origSet(o); octLabel.textContent = `C${this.keyboard.base}`; };
  }
  noteOn(n, v) { this.start(); this.audio.noteOn(n, v); }
  noteOff(n) { this.audio.noteOff(n); }

  // ---- audio
  async start() {
    if (this.started) { this.audio.resume(); return; }
    this.started = true;
    const btn = $('#power'); btn.textContent = '… cargando'; btn.disabled = true;
    try {
      await this.audio.init();
      this.audio.setAllParams(this.norm);
      this.audio.setMods(this.mods);
      this.audio.onMeter = (m) => this.onMeter(m);
      this.viz = new MasterVisualizer(this.playCanvas, this.audio.analyser);
      btn.textContent = '● Audio ON'; btn.classList.add('on');
      await this.connectMidi(true);
      this.refreshDevices();
    } catch (e) {
      console.error(e); btn.textContent = 'Error de audio'; this.started = false;
      alert('No se pudo iniciar el audio: ' + e.message + '\n\nSi abriste el archivo directamente (file://), serví la carpeta con un servidor local (ver README).');
    }
    btn.disabled = false;
  }
  onMeter(m) {
    this.liveSrc.set(m.src);
    this.scopes.a.data = m.scopeA; this.scopes.b.data = m.scopeB;
    $('#voice-ind').textContent = `${m.voices} v`;
    $('#meter-fill').style.width = `${Math.min(100, m.peak * 100)}%`;
    $('#meter-fill').classList.toggle('hot', m.peak > 0.95);
    if (this.viz) this.viz.notes = m.notes;
    this.lastMeter = m;
  }
  refreshArpBadge() { $('#arp-ind').classList.toggle('on', this.value('arp.on') > 0.5); }
  startLoop() {
    const tick = () => {
      requestAnimationFrame(tick);
      if (this.view === 'play' && this.viz) this.viz.draw();
      if (this.view === 'synth') {
        this.scopes.a.draw(); this.scopes.b.draw();
        for (const { cv, k } of this.envCanvases) drawEnvelope(cv, this.value(`env${k}.attack`), this.value(`env${k}.decay`), this.value(`env${k}.sustain`), this.value(`env${k}.release`), this.value(`env${k}.curve`), COLORS.env, this.liveSrc[k - 1]);
        for (const { cv, k } of this.lfoCanvases) drawLFO(cv, Math.round(this.value(`lfo${k}.shape`)), this.value(`lfo${k}.phase`), COLORS.lfo, this.liveSrc[2 + k]);
      }
      // puntos "en vivo" de perillas moduladas (solo las visibles)
      if (this.mods.length) {
        const viewEl = $(`#view-${this.view}`);
        for (const m of this.mods) {
          const cs = this.controls.get(m.dst); if (!cs) continue;
          for (const c of cs) if (c.live && viewEl.contains(c.el)) c.live(this.liveSrc);
        }
      }
    };
    requestAnimationFrame(tick);
  }

  // ---- dispositivos (MIDI in / audio out)
  buildDevicesPanel() {
    const panel = h('div', { id: 'devices-panel', class: 'popover devices', hidden: '' });
    this.midiSel = h('select', { id: 'midi-in-select' });
    this.midiSel.addEventListener('change', () => { this.midi.select(this.midiSel.value); localStorage.setItem('prisma.midiIn', this.midiSel.value); });
    this.midiStatus = h('div', { class: 'dev-status' }, 'MIDI no conectado.');
    this.midiConnectBtn = h('button', { class: 'tb', onclick: () => this.connectMidi(false) }, 'Conectar MIDI');
    this.audioSel = h('select', { id: 'audio-out-select' });
    this.audioSel.addEventListener('change', async () => {
      try {
        await this.audio.ctx.setSinkId(this.audioSel.value === 'default' ? '' : this.audioSel.value);
        this.audioStatus.textContent = 'Salida cambiada.';
      } catch (e) { this.audioStatus.textContent = 'No se pudo cambiar la salida: ' + e.message; }
    });
    this.audioStatus = h('div', { class: 'dev-status' }, '');
    const refreshBtn = h('button', { class: 'tb', onclick: () => this.refreshDevices(true) }, 'Actualizar');
    panel.append(
      h('div', { class: 'pop-title' }, 'Dispositivos', h('button', { class: 'pop-close', onclick: () => { panel.hidden = true; } }, '×')),
      h('div', { class: 'dev-section' },
        h('div', { class: 'dev-label' }, 'Entrada MIDI', h('span', { id: 'midi-activity', class: 'midi-dot' })),
        h('div', { class: 'dev-row' }, this.midiSel, this.midiConnectBtn),
        this.midiStatus,
        h('p', { class: 'hint' }, 'Notas, pitch bend, CC1 mod wheel, CC64 sustain, CC20–23 macros, CC74 cutoff, CC71 resonancia.'),
      ),
      h('div', { class: 'dev-section' },
        h('div', { class: 'dev-label' }, 'Salida de audio'),
        h('div', { class: 'dev-row' }, this.audioSel, refreshBtn),
        this.audioStatus,
      ),
    );
    document.body.append(panel);
    this.devicesPanel = panel;
    this.refreshDevices();
  }
  toggleDevices() {
    const p = this.devicesPanel;
    if (!p.hidden) { p.hidden = true; return; }
    this.refreshDevices();
    p.hidden = false;
    const r = $('#midi-ind').getBoundingClientRect();
    p.style.top = `${r.bottom + 6}px`;
    p.style.left = `${Math.max(8, Math.min(window.innerWidth - p.offsetWidth - 8, r.left + r.width / 2 - p.offsetWidth / 2))}px`;
    if (!this.midi.access) this.connectMidi(true);
  }
  async connectMidi(silent) {
    const ok = await this.midi.connect();
    this.midiOk = ok;
    $('#midi-ind').classList.toggle('on', ok);
    if (ok) {
      const saved = localStorage.getItem('prisma.midiIn');
      if (saved && this.midi.inputs().some(i => i.id === saved)) this.midi.select(saved);
    } else if (!silent) alert(this.midi.error);
    this.refreshDevices();
  }
  async refreshDevices(requestLabels) {
    if (!this.midiSel) return;
    const inputs = this.midi.inputs();
    this.midiSel.innerHTML = '';
    this.midiSel.append(h('option', { value: 'all' }, inputs.length ? 'Todos los dispositivos' : '(sin dispositivos MIDI)'));
    for (const i of inputs) this.midiSel.append(h('option', { value: i.id }, `${i.name}${i.manufacturer ? ' · ' + i.manufacturer : ''}`));
    this.midiSel.value = inputs.some(i => i.id === this.midi.selectedId) ? this.midi.selectedId : 'all';
    this.midiSel.disabled = !this.midi.access;
    this.midiConnectBtn.hidden = !!this.midi.access;
    if (this.midi.access) this.midiStatus.textContent = inputs.length ? `${inputs.length} entrada(s) MIDI detectada(s). Conectá o desconectá dispositivos y la lista se actualiza sola.` : 'MIDI activo pero sin dispositivos. Conectá tu teclado por USB; aparecerá automáticamente.';
    else this.midiStatus.textContent = this.midi.error || 'Pulsá "Conectar MIDI" y aceptá el permiso del navegador.';
    // salida de audio
    const ctx = this.audio.ctx;
    this.audioSel.innerHTML = ''; this.audioStatus.textContent = '';
    if (!canSelectOutput(ctx)) {
      this.audioSel.append(h('option', { value: 'default' }, 'Salida predeterminada del sistema'));
      this.audioSel.disabled = true;
      this.audioStatus.textContent = ctx ? 'Este navegador no permite elegir la salida (usá la configuración del sistema).' : 'Pulsá Start para iniciar el audio.';
      return;
    }
    this.audioSel.disabled = false;
    let outs = [];
    try {
      if (requestLabels && navigator.mediaDevices.getUserMedia) {
        // los nombres de dispositivos solo se muestran tras un permiso de medios
        try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach(t => t.stop()); } catch (e) { /* sin permiso: se listan sin nombre */ }
      }
      outs = await listAudioOutputs();
    } catch (e) { outs = []; }
    this.audioSel.append(h('option', { value: 'default' }, 'Salida predeterminada del sistema'));
    for (const o of outs) if (o.id && o.id !== 'default') this.audioSel.append(h('option', { value: o.id }, o.name));
    const cur = ctx.sinkId || 'default';
    this.audioSel.value = [...this.audioSel.options].some(o => o.value === cur) ? cur : 'default';
    if (!this.audioStatus.textContent) this.audioStatus.textContent = outs.some(o => /^Salida \d+$/.test(o.name)) ? 'Pulsá "Actualizar" y aceptá el permiso para ver los nombres de las salidas.' : '';
  }
  midiBlink() {
    const d = $('#midi-activity'); const ind = $('#midi-ind');
    if (d) { d.classList.add('on'); clearTimeout(this._blinkT); this._blinkT = setTimeout(() => d.classList.remove('on'), 120); }
    if (ind) { ind.classList.add('blink'); clearTimeout(this._blinkT2); this._blinkT2 = setTimeout(() => ind.classList.remove('blink'), 120); }
  }

  // ---- presets
  allPresets() { return [...PRESETS, ...this.userPresets]; }
  fillPresetSelect() {
    const sel = this.presetSel; sel.innerHTML = '';
    const all = this.allPresets();
    const groups = {};
    all.forEach((p, i) => { const g = i >= PRESETS.length ? 'User' : p.category; (groups[g] = groups[g] || []).push([p, i]); });
    for (const [g, list] of Object.entries(groups)) {
      const og = h('optgroup', { label: g });
      for (const [p, i] of list) og.append(h('option', { value: i }, p.name));
      sel.append(og);
    }
    sel.value = this.presetIndex;
  }
  presetToState(p) {
    // valores por defecto
    PARAMS.forEach((d, i) => { this.norm[i] = norm(d, d.def); });
    const setId = (id, v) => {
      const d = PARAMS[PARAM_INDEX[id]]; if (!d) { console.warn('preset: param desconocido', id); return; }
      if (typeof v === 'string') { const k = d.opts ? d.opts.indexOf(v) : -1; if (k < 0) { console.warn('preset: opción desconocida', id, v); return; } v = d.min + k; }
      this.norm[d.index] = norm(d, v);
    };
    for (const [id, v] of Object.entries(p.params || {})) setId(id, v);
    (p.fx || []).forEach((f, i) => {
      const slot = i + 1, ti = FX_INDEX[f.type.toLowerCase().replace(/\s+/g, '')] ?? FX_TYPES.findIndex(t => t.name === f.type);
      if (ti < 0) return;
      setId(`fx${slot}.type`, ti); setId(`fx${slot}.on`, f.on === false ? 0 : 1); setId(`fx${slot}.mix`, f.mix ?? 1);
      const t = FX_TYPES[ti];
      t.params.forEach((pd, k) => {
        let v = f.params && f.params[k] !== undefined ? f.params[k] : pd.def;
        if (typeof v === 'string') v = Math.max(0, pd.opts.indexOf(v));
        this.norm[pidx(`fx${slot}.p${k}`)] = pd.curve === 'enum' ? (pd.max > 0 ? v / pd.max : 0) : norm(pd, v);
      });
    });
    this.mods = (p.mods || []).map(([s, d, a]) => ({ src: SRC_INDEX[s], dst: PARAM_INDEX[d], amt: a })).filter(m => m.src !== undefined && m.dst !== undefined);
    this.meta = { name: p.name, category: p.category || 'User', description: p.description || '', macroNames: (p.macroNames || ['Macro 1', 'Macro 2', 'Macro 3', 'Macro 4']).slice() };
  }
  loadPreset(i) {
    const all = this.allPresets();
    i = ((i % all.length) + all.length) % all.length;
    this.presetIndex = i;
    this.presetToState(all[i]);
    this.audio.allOff();
    this.audio.setAllParams(this.norm); this.audio.setMods(this.mods);
    this.presetSel.value = i;
    this.buildEngineBody('a'); this.buildEngineBody('b');
    for (let s = 1; s <= FX_SLOTS; s++) this.buildFxSlot(s);
    for (let k = 0; k < 4; k++) this.setMacroName(k, this.meta.macroNames[k]);
    this.playTitle.textContent = this.meta.name; this.playDesc.textContent = this.meta.description;
    this.refreshAll();
  }
  stateToPreset(name) {
    const params = {};
    PARAMS.forEach((d, i) => { if (Math.abs(this.norm[i] - norm(d, d.def)) > 1e-6 && !d.id.startsWith('fx')) params[d.id] = denorm(d, this.norm[i]); });
    const fx = [];
    for (let s = 1; s <= FX_SLOTS; s++) {
      const t = FX_TYPES[Math.round(this.value(`fx${s}.type`))];
      fx.push({ type: t.name, on: this.value(`fx${s}.on`) > 0.5, mix: this.value(`fx${s}.mix`), params: t.params.map((pd, k) => { const n = this.norm[pidx(`fx${s}.p${k}`)]; return pd.curve === 'enum' ? Math.round(n * pd.max) : denorm(pd, n); }) });
    }
    return { name, category: 'User', description: this.meta.description, macroNames: this.meta.macroNames.slice(), params, fx, mods: this.mods.map(m => [MOD_SOURCES[m.src].id, PARAMS[m.dst].id, m.amt]) };
  }
  savePreset() {
    const name = prompt('Nombre del preset:', this.meta.name === 'Init' ? 'Mi sonido' : this.meta.name);
    if (!name) return;
    const p = this.stateToPreset(name);
    const existing = this.userPresets.findIndex(x => x.name === name);
    if (existing >= 0) this.userPresets[existing] = p; else this.userPresets.push(p);
    localStorage.setItem('prisma.userPresets', JSON.stringify(this.userPresets));
    this.presetIndex = PRESETS.length + (existing >= 0 ? existing : this.userPresets.length - 1);
    this.meta.name = name; this.playTitle.textContent = name;
    this.fillPresetSelect();
  }
  exportPreset() {
    const p = this.stateToPreset(this.meta.name);
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${p.name.replace(/[^\w-]+/g, '_')}.prisma.json` });
    document.body.append(a); a.click(); a.remove();
  }
  async importPreset(file) {
    if (!file) return;
    try {
      const p = JSON.parse(await file.text());
      if (!p.name) p.name = file.name.replace(/\.json$/, '');
      this.userPresets.push(p);
      localStorage.setItem('prisma.userPresets', JSON.stringify(this.userPresets));
      this.fillPresetSelect(); this.loadPreset(PRESETS.length + this.userPresets.length - 1);
    } catch (e) { alert('No se pudo importar: ' + e.message); }
  }
  async loadSampleFile(file, X) {
    if (!file) return;
    await this.start();
    try {
      const info = await this.audio.loadSample(await file.arrayBuffer());
      const target = X || (ENGINE_TYPES[Math.round(this.value('a.type'))] === 'gran' || ENGINE_TYPES[Math.round(this.value('a.type'))] === 'smp' ? 'a' : 'b');
      const type = ENGINE_TYPES[Math.round(this.value(`${target}.type`))];
      if (type !== 'gran' && type !== 'smp') this.setValue(`${target}.type`, ENGINE_TYPES.indexOf('gran'));
      const t2 = ENGINE_TYPES[Math.round(this.value(`${target}.type`))];
      this.setValue(`${target}.${t2}.source`, 4);
      this.setValue(`${target}.on`, 1);
      console.info(`Sample cargado (${info.duration.toFixed(2)} s) en motor ${target.toUpperCase()}`);
    } catch (e) { alert('No se pudo decodificar el audio: ' + e.message); }
  }
}

const app = new App();
window.prisma = app;
app.build();
