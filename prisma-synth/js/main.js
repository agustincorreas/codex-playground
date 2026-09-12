// Prisma Synth — aplicación principal: estado, vistas, modulación por
// arrastrar y soltar, presets, MIDI y visualización en tiempo real.
import { PARAMS, PARAM_INDEX, pidx, denorm, norm, formatValue, COLORS, MOD_SOURCES, SRC_INDEX, FX_TYPES, FX_INDEX, FX_SLOTS, ENGINE_TYPES, ENGINE_NAMES, isGlobalParam, isSongParam, SCALES, KEY_NAMES, CHORD_TYPES, ARP_PATTERNS, DRUM_NAMES, DRUM_PATTERNS, LOOP_BARS, MOODS, VIBES, ARP_STYLES, DRUM_ARP } from './shared/params.js';
import { SynthAudio, MidiManager, listAudioOutputs, canSelectOutput } from './audio/engine.js';
import { Knob, EnumControl, Toggle, Slider, createControl } from './ui/knob.js';
import { MasterVisualizer, Scope, drawEnvelope, drawLFO } from './ui/visualizer.js';
import { Keyboard, PadGrid, noteName } from './ui/keyboard.js';
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
    this.view = 'jam';
    this.song = Object.assign({ key: 0, mood: 'happy', scale: 'major', chord: 'triad', fat: false, vibe: 'own', octave: 3, scaleLock: true, midiMode: 'zones', arpStyle: 'own', shortTail: true }, JSON.parse(localStorage.getItem('prisma.song') || '{}'));
    this.song.scale = (MOODS.find(m => m.id === this.song.mood) || MOODS[0]).scale; this.song.chord = this.song.fat ? 'fat' : 'triad';
    this.activeChords = new Map(); // nota base → notas enviadas
    this.userPresets = JSON.parse(localStorage.getItem('prisma.userPresets') || '[]');
    this.presetIndex = 0;
    this.started = false;
    this.octave = 3;
    this.midiOk = false;
    this.midi = new MidiManager({
      noteOn: (n, v) => this.performOn(n, v, true),
      noteOff: (n) => this.performOff(n, true),
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
    if (id === 'drum.pattern' && this.song && this.song.arpStyle === 'auto' && !this._loading) this.applyArpStyle();
    if (id === 'arp.pattern') this.refreshArpDesc();
  }
  setValue(id, value) { const d = PARAMS[pidx(id)]; this.setNorm(d.index, norm(d, value)); }
  value(id) { const d = PARAMS[pidx(id)]; return denorm(d, this.norm[d.index]); }
  refresh(idx) { const cs = this.controls.get(idx); if (cs) for (const c of cs) c.update(); }
  refreshAll() { for (const cs of this.controls.values()) for (const c of cs) c.update(); this.buildMatrix(); this.refreshChips(); this.refreshArpBadge(); }
  refreshArpDesc() { if (this.arpDesc) { const p = ARP_PATTERNS[Math.round(this.value('arp.pattern'))]; this.arpDesc.textContent = p ? p.desc : ''; } }
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
    this.buildJamView();
    this.buildFooter();
    this.buildDevicesPanel();
    this.showView('jam');
    document.addEventListener('pointerdown', (e) => { const pop = $('#mod-popover'); if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.knob')) pop.hidden = true; const dp = $('#devices-panel'); if (dp && !dp.hidden && !dp.contains(e.target) && !e.target.closest('#midi-ind')) dp.hidden = true; });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.assignSource >= 0) this.setAssign(this.assignSource); });
    document.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') e.target.blur(); });
    document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && b !== document.activeElement) return; if (b) b.blur(); });
    const releaseEverything = () => { this.stopAll(); if (this.keyboard) for (const n of [...this.keyboard.held]) this.keyboard.release(n); this.audio.allOff(); };
    window.addEventListener('blur', releaseEverything);
    document.addEventListener('visibilitychange', () => { if (document.hidden) releaseEverything(); });
    this.loadPreset(1);
    this.songChanged();
    this.refreshArpDesc();
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
        h('button', { class: 'tb pro-only', title: 'Guardar como preset de usuario', onclick: () => this.savePreset() }, 'Save'),
        h('button', { class: 'tb pro-only', title: 'Exportar preset (JSON)', onclick: () => this.exportPreset() }, 'Export'),
        h('button', { class: 'tb pro-only', title: 'Importar preset (JSON)', onclick: () => $('#import-file').click() }, 'Import'),
        h('button', { class: 'tb pro-only', title: 'Cargar un archivo de audio para Granular / Sample', onclick: () => $('#sample-file').click() }, 'Load Sample'),
      ),
      h('nav', { class: 'tabs' }, ...[['jam', '🎮 Jugar'], ['synth', 'Pro · Synth'], ['fx', 'Pro · FX']].map(([v, l]) => h('button', { class: 'tab' + (v === 'jam' ? ' tab-play' : ''), dataset: { view: v }, title: v === 'jam' ? 'Modo simple para jugar' : 'Modo avanzado (diseño de sonido)', onclick: () => this.showView(v) }, l))),
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
    const jam = v === 'jam';
    document.body.classList.toggle('view-jam', jam);
    if (this.padGrid) { this.padGrid.enabled = jam; this.padGridEl.hidden = !jam; if (!jam) this.padGrid.releaseAll(); }
    if (this.keyboard) { this.keyboard.enabled = !jam; this.keyboardEl.hidden = jam; }
    if (this.kbHelp) this.kbHelp.textContent = jam ? 'Fila de arriba (Q…I): melodía · Fila del medio (A…K): acordes · Fila de abajo (Z…,): bajo · Números 1–8: batería' : 'Teclas: A W S E D F T G Y H U J K O L P · Z/X octava · Shift = ajuste fino · Doble click = reset';
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

  // ---- vista JUGAR (modo simple)
  buildJamView() {
    const root = $('#view-jam');
    root.append(
      h('div', { class: 'jam-row jam-row-1' }, this.buildSoundsPanel(), this.buildVibePanel()),
      h('div', { class: 'jam-row jam-row-2' }, this.buildMoodPanel(), this.buildDrumsPanel(), this.buildLooperPanel()),
    );
  }
  buildSoundsPanel() {
    const panel = h('section', { class: 'panel sounds', style: `--pc:${COLORS.a}` });
    this.soundEmoji = h('span', { class: 'sound-emoji' }, '🎹');
    this.soundTitle = h('h1', { class: 'sound-title' }, 'Init');
    this.soundDesc = h('p', { class: 'sound-desc' }, '');
    const tags = ['Todos', 'Pads', 'Bajos', 'Leads', 'Teclas', 'Plucks', 'Texturas', 'Míos'];
    this.soundTag = 'Todos';
    const tagRow = h('div', { class: 'tag-row' }, ...tags.map(t => h('button', { class: 'tagbtn' + (t === 'Todos' ? ' active' : ''), dataset: { tag: t }, onclick: () => { this.soundTag = t; tagRow.querySelectorAll('.tagbtn').forEach(b => b.classList.toggle('active', b.dataset.tag === t)); this.buildSoundCards(); } }, t)));
    this.soundCards = h('div', { class: 'sound-cards' });
    const cv = h('canvas', { class: 'jam-viz' }); this.playCanvas = cv;
    const color = COLORS.arp;
    panel.append(
      h('header', {}, h('h2', {}, 'Sonido'), h('span', { class: 'hint' }, 'Elegí uno y tocá las teclas')),
      h('div', { class: 'sound-head' }, h('button', { class: 'ib', onclick: () => this.loadPreset(this.presetIndex - 1) }, '‹'), this.soundEmoji, h('div', { class: 'sound-head-txt' }, this.soundTitle, this.soundDesc), h('button', { class: 'ib', onclick: () => this.loadPreset(this.presetIndex + 1) }, '›'),
        h('div', { class: 'arp-mini' }, h('div', { class: 'toggle-wrap' }, h('div', { class: 'k-label' }, 'Arpegio'), this.arpStyleSel = h('select', { id: 'arp-style', onchange: () => { this.song.arpStyle = this.arpStyleSel.value; this.applyArpStyle(); this.songChanged(); } }, ...ARP_STYLES.map(a => h('option', { value: a.id }, `${a.emoji} ${a.name}`)))), this.control('arp.hold', { color, label: 'Mantener' }))),
      tagRow,
      h('div', { class: 'sound-body' }, this.soundCards, cv),
    );
    this.buildSoundCards();
    return panel;
  }
  buildSoundCards() {
    const box = this.soundCards; if (!box) return;
    box.innerHTML = '';
    const all = this.allPresets();
    all.forEach((p, i) => {
      const isUser = i >= PRESETS.length;
      const tag = isUser ? 'Míos' : (p.tag || 'Teclas');
      if (this.soundTag !== 'Todos' && tag !== this.soundTag) return;
      const arpOn = p.params && (p.params['arp.on'] === 'On');
      const card = h('button', { class: 'sound-card' + (i === this.presetIndex ? ' active' : ''), dataset: { i }, onclick: () => this.loadPreset(i) },
        h('span', { class: 'sc-emoji' }, p.emoji || '🎵'), h('span', { class: 'sc-name' }, p.name), h('span', { class: 'sc-tag' }, tag + (arpOn ? ' · arp' : '')));
      card.style.setProperty('--hue', String((Array.from(p.name).reduce((a, c) => a + c.charCodeAt(0), 0) * 37) % 360));
      box.append(card);
    });
  }
  buildVibePanel() {
    const panel = h('section', { class: 'panel vibes', style: `--pc:${COLORS.fx}` });
    const grid = h('div', { class: 'vibe-grid' }, ...VIBES.map(v => h('button', { class: 'vibebtn' + (v.id === this.song.vibe ? ' active' : ''), dataset: { vibe: v.id }, title: v.desc, onclick: () => { this.song.vibe = v.id; grid.querySelectorAll('.vibebtn').forEach(b => b.classList.toggle('active', b.dataset.vibe === v.id)); this.applyVibe(true); this.songChanged(); } }, h('span', { class: 'vb-emoji' }, v.emoji), h('span', { class: 'vb-name' }, v.name))));
    this.vibeGrid = grid;
    panel.append(h('header', {}, h('h2', {}, 'Ambiente'), h('span', { class: 'hint' }, 'Efectos ya armados')), grid);
    return panel;
  }
  buildMoodPanel() {
    const panel = h('section', { class: 'panel moods', style: `--pc:${COLORS.arp}` });
    const grid = h('div', { class: 'mood-grid' }, ...MOODS.map(m => h('button', { class: 'moodbtn' + (m.id === this.song.mood ? ' active' : ''), dataset: { mood: m.id }, style: `--hue:${m.hue}`, onclick: () => { this.song.mood = m.id; this.song.scale = m.scale; grid.querySelectorAll('.moodbtn').forEach(b => b.classList.toggle('active', b.dataset.mood === m.id)); this.songChanged(); this.previewChord(); } }, h('span', { class: 'mb-emoji' }, m.emoji), h('span', { class: 'mb-name' }, m.name))));
    const keySel = h('select', { id: 'song-key' }, ...KEY_NAMES.map((k, i) => h('option', { value: i }, k)));
    keySel.value = this.song.key;
    keySel.addEventListener('change', () => { this.song.key = parseInt(keySel.value, 10); this.songChanged(); this.previewChord(); });
    const fat = h('button', { class: 'tb' + (this.song.fat ? ' on' : ''), title: 'Acordes de 5 notas con sub-octava', onclick: () => { this.song.fat = !this.song.fat; this.song.chord = this.song.fat ? 'fat' : 'triad'; fat.classList.toggle('on', this.song.fat); this.songChanged(); this.previewChord(); } }, 'Acordes gordos');
    const midiSeg = h('div', { class: 'seg', title: 'Cómo responde un teclado MIDI (o el piano del modo Pro)' }, ...[['zones', 'Zonas'], ['chords', 'Acordes'], ['notes', 'Notas']].map(([m, l]) => h('button', { class: 'segbtn' + (this.song.midiMode === m ? ' active' : ''), dataset: { mode: m }, onclick: () => { this.song.midiMode = m; midiSeg.querySelectorAll('.segbtn').forEach(b => b.classList.toggle('active', b.dataset.mode === m)); this.songChanged(); } }, l)));
    const midi = h('div', { class: 'midi-mode' }, h('span', { class: 'k-label' }, 'Teclado MIDI'), midiSeg, h('span', { class: 'hint' }, 'Zonas: graves = bajo · centro = acordes · agudos = melodía'));
    const octRow = h('div', { class: 'oct' }, h('button', { class: 'ib', onclick: () => { this.song.octave = Math.max(1, this.song.octave - 1); this.songChanged(); } }, '−'), h('span', { class: 'oct-label', id: 'jam-oct' }, `Oct ${this.song.octave}`), h('button', { class: 'ib', onclick: () => { this.song.octave = Math.min(6, this.song.octave + 1); this.songChanged(); } }, '+'));
    panel.append(
      h('header', {}, h('h2', {}, 'Ánimo'), h('span', { class: 'hint' }, 'Elige la escala por vos')),
      grid,
      h('div', { class: 'mood-foot' }, h('label', { class: 'k-label', for: 'song-key' }, 'Tono'), keySel, octRow, fat),
      midi,
    );
    return panel;
  }
  buildDrumsPanel() {
    const color = COLORS.fx;
    const panel = h('section', { class: 'panel drums', style: `--pc:${color}` });
    this.stepLights = h('div', { class: 'steps' }, ...Array.from({ length: 16 }, (_, i) => h('span', { class: 'step' + (i % 4 === 0 ? ' beat' : '') })));
    const pads = h('div', { class: 'drum-pads' }, ...DRUM_NAMES.map((n, i) => { const b = h('button', { class: 'drum-pad', title: `Tecla ${i + 1}` }, h('b', {}, String(i + 1)), n); b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.hitDrum(i); }); return b; }));
    this.drumPadEls = [...pads.children];
    // tempo como deslizador simple
    const tempoIdx = pidx('master.tempo');
    const tempo = h('input', { type: 'range', min: 60, max: 180, step: 1, class: 'tempo-slider', id: 'tempo-slider' });
    const tempoLabel = h('span', { class: 'tempo-label' }, '');
    tempo.addEventListener('input', () => this.setValue('master.tempo', parseInt(tempo.value, 10)));
    const tempoCtl = { idx: tempoIdx, el: h('div', { class: 'tempo-row' }, h('span', { class: 'k-label' }, 'Tempo'), tempo, tempoLabel), update: () => { const v = Math.round(this.value('master.tempo')); tempo.value = v; tempoLabel.textContent = `${v} bpm`; }, live() {} };
    this.register(tempoCtl); tempoCtl.update();
    panel.append(
      h('header', {}, this.control('drum.on', { label: 'ON', color, class: 'pw' }), h('h2', {}, 'Ritmo'), h('div', { class: 'spacer' }), this.control('drum.pattern', { label: '', color, class: 'type-select', toggle: false }), this.control('drum.kit', { label: '', color, class: 'inline', toggle: false })),
      this.stepLights,
      tempoCtl.el,
      pads,
    );
    return panel;
  }
  buildLooperPanel() {
    const color = COLORS.env;
    const panel = h('section', { class: 'panel looper', style: `--pc:${color}` });
    this.loopRec = h('button', { class: 'loop-btn rec', onclick: () => { this.start(); this.audio.loop('rec'); } }, '● Grabar');
    this.loopPlay = h('button', { class: 'loop-btn', onclick: () => this.audio.loop('play') }, '▶ Play');
    this.loopStop = h('button', { class: 'loop-btn', onclick: () => this.audio.loop('stop') }, '■ Stop');
    this.loopUndo = h('button', { class: 'tb', title: 'Quita la última capa', onclick: () => this.audio.loop('undo') }, 'Deshacer');
    this.loopClear = h('button', { class: 'tb', title: 'Borra todas las capas', onclick: () => { if (confirm('¿Borrar todas las capas del loop?')) this.audio.loop('clear'); } }, 'Borrar');
    this.loopBar = h('div', { class: 'loop-bar' }, h('div', { class: 'loop-fill' }));
    this.loopStatus = h('div', { class: 'dev-status' }, '');
    this.loopLayers = h('div', { class: 'loop-layers' });
    panel.append(
      h('header', {}, h('h2', {}, 'Looper'), h('div', { class: 'spacer' }), this.control('loop.bars', { label: 'Compases', color, toggle: false, class: 'inline' })),
      h('div', { class: 'loop-controls' }, this.loopRec, this.loopPlay, this.loopStop, this.loopUndo, this.loopClear),
      this.loopBar, this.loopStatus, this.loopLayers,
    );
    return panel;
  }
  // Estilo de arpegio del modo Jugar: apagado, el del sonido, según el ritmo o uno fijo
  applyArpStyle() {
    let id = this.song.arpStyle || 'own';
    if (this.arpStyleSel) this.arpStyleSel.value = id;
    if (id === 'auto') { const pat = DRUM_PATTERNS[Math.round(this.value('drum.pattern'))]; id = DRUM_ARP[pat ? pat.name : ''] || 'soft'; }
    if (id === 'off') { this.setValue('arp.on', 0); return; }
    const p = this.allPresets()[this.presetIndex];
    if (id === 'own') {
      const pp = (p && p.params) || {};
      for (const k of ['arp.on', 'arp.pattern', 'arp.rate', 'arp.octaves', 'arp.gate', 'arp.swing']) {
        const d = PARAMS[pidx(k)]; let v = pp[k];
        if (v === undefined) v = d.def; else if (typeof v === 'string') v = d.min + Math.max(0, d.opts.indexOf(v));
        this.setValue(k, v);
      }
      return;
    }
    const st = ARP_STYLES.find(a => a.id === id); if (!st) return;
    const pd = PARAMS[pidx('arp.pattern')], rd = PARAMS[pidx('arp.rate')];
    this.setValue('arp.pattern', Math.max(0, pd.opts.indexOf(st.pattern)));
    this.setValue('arp.rate', Math.max(0, rd.opts.indexOf(st.rate)));
    this.setValue('arp.octaves', st.octaves); this.setValue('arp.gate', st.gate); this.setValue('arp.swing', st.swing);
    this.setValue('arp.on', 1);
  }
  applyVibe(push) {
    const v = VIBES.find(x => x.id === this.song.vibe) || VIBES[0];
    if (v.fx) this.applyFxList(v.fx);
    else { const p = this.allPresets()[this.presetIndex]; this.applyFxList((p && p.fx) || []); }
    if (push) {
      this.audio.setAllParams(this.norm);
      for (let sl = 1; sl <= FX_SLOTS; sl++) this.buildFxSlot(sl);
      this.refreshAll();
    }
  }
  hitDrum(i) { this.start(); this.audio.drum(i, 1); const el = this.drumPadEls && this.drumPadEls[i]; if (el) { el.classList.add('hit'); setTimeout(() => el.classList.remove('hit'), 120); } }
  updateLooperUI(lp) {
    if (!lp || !this.loopRec) return;
    const st = lp.state;
    this.loopRec.classList.toggle('armed', st === 'armed'); this.loopRec.classList.toggle('recording', st === 'recording');
    this.loopRec.textContent = st === 'recording' ? '● GRABANDO…' : st === 'armed' ? '● ESPERANDO EL COMPÁS' : lp.layers.length ? '● SUMAR CAPA' : '● GRABAR';
    this.loopPlay.classList.toggle('on', st === 'playing' || st === 'recording');
    this.loopPlay.disabled = !lp.layers.length; this.loopStop.disabled = !lp.layers.length && st !== 'armed';
    this.loopUndo.disabled = !lp.layers.length; this.loopClear.disabled = !lp.layers.length && st === 'empty';
    const fill = this.loopBar.firstChild;
    fill.style.width = `${(st === 'recording' ? lp.recProgress : lp.pos) * 100}%`;
    fill.classList.toggle('rec', st === 'recording');
    const msgs = { empty: 'Vacío. Pulsá GRABAR y tocá: se graba durante los compases elegidos y queda en loop.', armed: 'Esperando el próximo compás para empezar a grabar…', recording: 'Grabando… tocá lo que quieras sumar.', playing: `${lp.layers.length} capa(s) sonando. Pulsá SUMAR CAPA para grabar otra encima.`, stopped: 'Loop detenido. PLAY para seguir.' };
    this.loopStatus.textContent = msgs[st] || '';
    if (this._loopLayerCount !== lp.layers.length || this._loopMuteKey !== lp.layers.map(l => l.mute ? 1 : 0).join('')) {
      this._loopLayerCount = lp.layers.length; this._loopMuteKey = lp.layers.map(l => l.mute ? 1 : 0).join('');
      this.loopLayers.innerHTML = '';
      lp.layers.forEach((l, i) => this.loopLayers.append(h('div', { class: 'loop-layer' + (l.mute ? ' muted' : '') }, h('span', {}, `Capa ${i + 1}`), h('button', { class: 'tb', onclick: () => this.audio.loop('mute', i) }, l.mute ? 'Activar' : 'Silenciar'), h('button', { class: 'pop-del', title: 'Quitar capa', onclick: () => this.audio.loop('remove', i) }, '✕'))));
    }
    const locked = lp.layers.length > 0 || st === 'recording';
    for (const c of this.controls.get(pidx('master.tempo')) || []) c.el.classList.toggle('locked', locked);
    for (const c of this.controls.get(pidx('loop.bars')) || []) c.el.classList.toggle('locked', locked);
  }

  // ---- escala, chordifier y ejecución de notas
  get scaleDef() { return SCALES.find(sc => sc.id === this.song.scale) || SCALES[0]; }
  get chordDef() { return CHORD_TYPES.find(c => c.id === this.song.chord) || CHORD_TYPES[0]; }
  songChanged() {
    localStorage.setItem('prisma.song', JSON.stringify(this.song));
    this.stopAll();
    if (this.padGrid) this.relabelPads();
    const o = $('#jam-oct'); if (o) o.textContent = `Oct ${this.song.octave}`;
    this.applyPolyRule();
  }
  // Los acordes necesitan polifonía: si el sonido es mono/legato se pasa a Poly
  // y se vuelve al modo del preset cuando se elige "Nota sola".
  applyPolyRule() {
    const needPoly = true; // el modo Jugar siempre tiene acordes disponibles
    if (needPoly) { if (this.value('master.poly') !== 0) this.setValue('master.poly', 0); }
    else {
      const p = this.allPresets()[this.presetIndex];
      let want = p && p.params ? p.params['master.poly'] : undefined;
      if (typeof want === 'string') want = Math.max(0, PARAMS[pidx('master.poly')].opts.indexOf(want));
      this.setValue('master.poly', want === undefined ? 0 : want);
    }
  }
  degreeToNote(d) {
    const st = this.scaleDef.steps, L = st.length;
    return 12 * (this.song.octave + 1) + this.song.key + 12 * Math.floor(d / L) + st[((d % L) + L) % L];
  }
  // acorde diatónico sobre el grado c: nombre y numeral
  chordInfo(c) {
    const st = this.scaleDef.steps, L = st.length, root = st[c % L];
    const t = ((st[(c + 2) % L] - root) % 12 + 12) % 12, f = ((st[(c + 4) % L] - root) % 12 + 12) % 12;
    let q = 'sus', roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][c % L] || String(c + 1);
    if (t === 4 && f === 7) q = '';
    else if (t === 3 && f === 7) { q = 'm'; roman = roman.toLowerCase(); }
    else if (t === 3 && f === 6) { q = 'dim'; roman = roman.toLowerCase() + '°'; }
    else if (t === 4 && f === 8) { q = 'aum'; roman += '+'; }
    else if (t === 4) q = ''; else if (t === 3) { q = 'm'; roman = roman.toLowerCase(); }
    return { name: `${KEY_NAMES[(this.song.key + root) % 12]}${q ? ' ' + q : ''}`, roman, quality: q };
  }
  // pads mixtos: fila de abajo = bajo, medio = acordes, arriba = melodía
  chordPadNotes(d) {
    const L = this.scaleDef.steps.length;
    const col = d % 8, row = Math.floor(d / 8);
    const c = col % L + (col >= L ? L : 0);
    const root = this.degreeToNote(c);
    if (row === 0) return [root - 12];
    if (row === 2) return [this.degreeToNote(col + L)];
    return this.chordify(root, this.song.chord);
  }
  relabelPads() {
    const L = this.scaleDef.steps.length;
    this.padGrid.relabel((d) => {
      const col = d % 8, row = Math.floor(d / 8), c = col % L;
      const hue = c * (300 / L);
      if (row === 2) { const n = this.degreeToNote(col + L); return { name: noteName(n), degree: 'melodía', isRoot: c === 0 && col < L, hue, kind: 'melody' }; }
      const info = this.chordInfo(c);
      if (row === 0) return { name: `${info.name.split(' ')[0]}`, degree: 'bajo', isRoot: c === 0 && col < L, hue, kind: 'bass' };
      return { name: info.name, degree: info.roman + (col >= L ? ' (8va)' : ''), isRoot: c === 0 && col < L, hue, kind: 'chord' };
    });
  }
  quantize(note) {
    const st = this.scaleDef.steps;
    if (st.length === 12) return note;
    const pc = ((note - this.song.key) % 12 + 12) % 12;
    let best = st[0], bd = 99;
    for (const x of st) for (const cand of [x, x - 12, x + 12]) { const dd = Math.abs(cand - pc); if (dd < bd || (dd === bd && cand > best)) { bd = dd; best = cand; } }
    return note + (best - pc);
  }
  chordify(note, chordId) {
    const ct = CHORD_TYPES.find(c => c.id === (chordId || this.song.chord)) || CHORD_TYPES[0];
    const st = this.scaleDef.steps, L = st.length;
    const pc = ((note - this.song.key) % 12 + 12) % 12;
    const deg = st.indexOf(pc);
    if (!ct.deg || L === 12 || deg < 0) return ct.semi.map(o => note + o);
    return ct.deg.map(o => { const di = deg + o; const oct = Math.floor(di / L); return note - st[deg] + st[((di % L) + L) % L] + 12 * oct; });
  }
  playSet(key, notes, vel) {
    this.start();
    if (this.activeChords.has(key)) return;
    notes = [...new Set(notes.filter(n => n >= 0 && n <= 127))];
    this.activeChords.set(key, notes);
    for (const n of notes) this.audio.noteOn(n, vel);
  }
  stopSet(key) {
    const notes = this.activeChords.get(key); if (!notes) return;
    this.activeChords.delete(key);
    for (const n of notes) this.audio.noteOff(n);
  }
  stopAll() { for (const k of [...this.activeChords.keys()]) this.stopSet(k); if (this.padGrid) this.padGrid.releaseAll(); }
  // nota "real" (piano/MIDI): se corrige a la escala y se convierte en acorde
  performOn(note, vel, quantize) {
    const key = 'n' + note;
    if (quantize && this.song.scaleLock) note = this.quantize(note);
    const mode = this.song.midiMode || 'zones';
    let notes;
    if (mode === 'chords') notes = this.chordify(note);
    else if (mode === 'zones') notes = note < 48 ? [note] : note < 72 ? this.chordify(note) : [note];
    else notes = [note];
    this.playSet(key, notes, vel);
    if (this.keyboard) this.keyboard.light(note, true);
  }
  performOff(rawNote, quantize) {
    const note = quantize && this.song.scaleLock ? this.quantize(rawNote) : rawNote;
    this.stopSet('n' + rawNote);
    if (this.keyboard) this.keyboard.light(note, false);
  }
  padOn(d, vel) { this.playSet('p' + d, this.chordPadNotes(d), vel); }
  padOff(d) { this.stopSet('p' + d); }
  previewChord() {
    const root = this.degreeToNote(0) + 12;
    this.playSet('preview', this.chordify(root, this.song.chord), 0.8);
    clearTimeout(this._prevT); this._prevT = setTimeout(() => this.stopSet('preview'), 450);
  }

  setMacroName(i, name) {
    this.meta.macroNames[i] = name || `Macro ${i + 1}`;
    for (const cs of this.controls.get(pidx(`macro${i + 1}`)) || []) if (cs.labelEl && cs.size !== 140) cs.labelEl.textContent = this.meta.macroNames[i];
    if (this.macroLabels && this.macroLabels[i].value !== name) this.macroLabels[i].value = this.meta.macroNames[i];
  }

  // ---- pie: teclado
  buildFooter() {
    const foot = $('#footer');
    const kb = h('div', { class: 'keyboard' });
    const pads = h('div', { class: 'padgrid' });
    this.keyboardEl = kb; this.padGridEl = pads;
    const bend = h('input', { type: 'range', class: 'wheel bend', min: -100, max: 100, value: 0, orient: 'vertical' });
    bend.addEventListener('input', () => this.audio.bend(bend.value / 100));
    const release = () => { bend.value = 0; this.audio.bend(0); };
    bend.addEventListener('pointerup', release); bend.addEventListener('pointercancel', release);
    const mw = h('input', { type: 'range', class: 'wheel mod', min: 0, max: 100, value: 0, orient: 'vertical' });
    mw.addEventListener('input', () => { this.liveSrc[SRC_INDEX.modwheel] = mw.value / 100; this.audio.modwheel(mw.value / 100); });
    this.modwheelEl = mw;
    const sus = h('button', { class: 'tb pro-only', onclick: () => { sus.classList.toggle('on'); this.audio.sustain(sus.classList.contains('on')); } }, 'Sustain');
    const octLabel = h('span', { class: 'oct-label' }, 'C3');
    foot.append(
      h('div', { class: 'kb-side' },
        h('div', { class: 'wheels' }, h('div', { class: 'wheel-col' }, bend, h('span', {}, 'Bend')), h('div', { class: 'wheel-col' }, mw, h('span', {}, 'Mod'))),
        h('div', { class: 'oct' }, h('button', { class: 'ib', onclick: () => this.keyboard.setOctave(this.keyboard.base - 1) }, '−'), octLabel, h('button', { class: 'ib', onclick: () => this.keyboard.setOctave(this.keyboard.base + 1) }, '+')),
        sus,
        h('button', { class: 'tb', title: 'Corta todo el sonido', onclick: () => { this.stopAll(); this.audio.panic(); if (sus.classList.contains('on')) { sus.classList.remove('on'); this.audio.sustain(false); } } }, 'Silencio'),
      ),
      h('div', { class: 'kb-area' }, kb, pads),
      this.kbHelp = h('div', { class: 'kb-help' }, ''),
    );
    this.keyboard = new Keyboard(kb, { onNoteOn: (n, v) => this.performOn(n, v, true), onNoteOff: (n) => this.performOff(n, true), octaves: 3, baseOctave: 3 });
    this.padGrid = new PadGrid(pads, { onPadOn: (d, v) => this.padOn(d, v), onPadOff: (d) => this.padOff(d), onDrum: (i) => this.hitDrum(i) });
    this.relabelPads();
    const origSet = this.keyboard.setOctave.bind(this.keyboard);
    this.keyboard.setOctave = (o) => { origSet(o); octLabel.textContent = `C${this.keyboard.base}`; };
  }

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
    this.updateLooperUI(m.loop);
    if (this.stepLights) { const kids = this.stepLights.children; for (let i = 0; i < 16; i++) kids[i].classList.toggle('on', m.drumOn && i === m.drumStep); }
  }
  refreshArpBadge() { $('#arp-ind').classList.toggle('on', this.value('arp.on') > 0.5); this.refreshArpDesc(); }
  startLoop() {
    const tick = () => {
      requestAnimationFrame(tick);
      if (this.view === 'jam' && this.viz) this.viz.draw();
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
    // valores por defecto, conservando el estado de sesión (ritmo, looper, tempo, volumen)
    PARAMS.forEach((d, i) => { if (!isSongParam(d.id)) this.norm[i] = norm(d, d.def); });
    const setId = (id, v) => {
      const d = PARAMS[PARAM_INDEX[id]]; if (!d) { console.warn('preset: param desconocido', id); return; }
      if (typeof v === 'string') { const k = d.opts ? d.opts.indexOf(v) : -1; if (k < 0) { console.warn('preset: opción desconocida', id, v); return; } v = d.min + k; }
      this.norm[d.index] = norm(d, v);
    };
    for (const [id, v] of Object.entries(p.params || {})) if (!isSongParam(id)) setId(id, v);
    this.applyFxList(p.fx || []);
    this.mods = (p.mods || []).map(([s, d, a]) => ({ src: SRC_INDEX[s], dst: PARAM_INDEX[d], amt: a })).filter(m => m.src !== undefined && m.dst !== undefined);
    this.meta = { name: p.name, category: p.category || 'User', description: p.description || '', macroNames: (p.macroNames || ['Macro 1', 'Macro 2', 'Macro 3', 'Macro 4']).slice() };
  }
  applyFxList(list) {
    for (let sl = 1; sl <= FX_SLOTS; sl++) { this.norm[pidx(`fx${sl}.type`)] = 0; this.norm[pidx(`fx${sl}.on`)] = 1; this.norm[pidx(`fx${sl}.mix`)] = 1; }
    (list || []).forEach((f, i) => {
      const slot = i + 1;
      if (slot > FX_SLOTS) return;
      const ti = FX_TYPES.findIndex(t => t.name === f.type || t.id === f.type);
      if (ti < 0) return;
      const t = FX_TYPES[ti];
      this.norm[pidx(`fx${slot}.type`)] = norm(PARAMS[pidx(`fx${slot}.type`)], ti);
      this.norm[pidx(`fx${slot}.on`)] = f.on === false ? 0 : 1;
      this.norm[pidx(`fx${slot}.mix`)] = f.mix ?? 1;
      t.params.forEach((pd, k) => {
        let v = f.params && f.params[k] !== undefined ? f.params[k] : pd.def;
        if (typeof v === 'string') v = Math.max(0, pd.opts.indexOf(v));
        this.norm[pidx(`fx${slot}.p${k}`)] = pd.curve === 'enum' ? (pd.max > 0 ? v / pd.max : 0) : norm(pd, v);
      });
    });
  }
  loadPreset(i) {
    const all = this.allPresets();
    i = ((i % all.length) + all.length) % all.length;
    this.presetIndex = i;
    this.stopAll();
    this._loading = true;
    this.presetToState(all[i]);
    if (this.song.vibe !== 'own') this.applyVibe(false);
    if (this.song.shortTail) { const d = PARAMS[pidx('env1.release')]; const r = denorm(d, this.norm[d.index]); if (r > 0.9) this.norm[d.index] = norm(d, 0.9); }
    this.audio.allOff();
    this.audio.setAllParams(this.norm); this.audio.setMods(this.mods);
    this.presetSel.value = i;
    this.buildEngineBody('a'); this.buildEngineBody('b');
    for (let s = 1; s <= FX_SLOTS; s++) this.buildFxSlot(s);
    for (let k = 0; k < 4; k++) this.setMacroName(k, this.meta.macroNames[k]);
    if (this.soundTitle) { this.soundTitle.textContent = this.meta.name; this.soundDesc.textContent = this.meta.description; this.soundEmoji.textContent = all[i].emoji || '🎵'; }
    if (this.soundCards) this.soundCards.querySelectorAll('.sound-card').forEach(c => c.classList.toggle('active', parseInt(c.dataset.i, 10) === i));
    this.activeChords.clear();
    if (this.padGrid) { this.applyPolyRule(); if (this.song.arpStyle && this.song.arpStyle !== 'own') this.applyArpStyle(); }
    this._loading = false;
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
    this.meta.name = name; if (this.soundTitle) this.soundTitle.textContent = name;
    this.fillPresetSelect(); this.buildSoundCards();
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
      this.fillPresetSelect(); this.buildSoundCards(); this.loadPreset(PRESETS.length + this.userPresets.length - 1);
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
