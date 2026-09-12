/* ==========================================================================
   ARMONÍA · interfaz, patch bay, looper, MIDI
   ========================================================================== */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const engine = new Engine();
  const clock = new Clock(engine);

  /* ------------------------------------------------------------ estado */
  const S = {
    key: 0, mode: 'major', func: 'diatonic', ext: 0, sus: 0, inversion: 0, voicing: 'close', octave: 0,
    hold: false, chrom: false, metro: false, loopBars: 2, bpm: 96,
    keys: { wave: 'sawtooth', on: true }, bass: { mode: 'trig', on: true }, arp: { mode: 'up', rate: 12, oct: 1, on: true },
    pad: { on: true }, fx: { dlyDiv: 0.75 }, mod: { lfoShape: 'sine' }, amt: {},
  };
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), S);

  const KEY_COLORS = [
    ['#bfe6d2', '#5fbc94'], ['#f8cdb6', '#ec9a6c'], ['#f6e7a8', '#d9b93a'], ['#d9cdf2', '#9a83d6'],
    ['#c5ddf5', '#6aa0dc'], ['#f4c7d4', '#df7f9c'], ['#cfe8c4', '#7dbb69'],
  ];
  const FUNC_LABEL = { diatonic: 'diatónico', dominant: 'dominantes', dim: 'disminuidos' };
  const VOICING_LABEL = { close: 'cerrado', drop2: 'drop 2', open: 'abierto', wide: 'amplio' };

  let current = null;          // acorde actual
  let currentKeyIndex = null;  // tecla del chord builder
  let chordActive = false;
  const held = new Set();
  const arp = { notes: [], idx: 0, dir: 1 };
  let powered = false;

  /* ------------------------------------------------------------ MIDI out */
  const midi = { out: null, active: [new Set(), new Set(), new Set(), new Set()] };
  const CH = { keys: 0, bass: 1, arp: 2, pad: 3 };
  function midiTime(t) { return t == null ? undefined : performance.now() + Math.max(0, (t - engine.now()) * 1000); }
  function noteOn(ch, n, vel = 100, t) { if (!midi.out) return; midi.out.send([0x90 | ch, n & 127, vel], midiTime(t)); midi.active[ch].add(n); }
  function noteOff(ch, n, t) { if (!midi.out) return; midi.out.send([0x80 | ch, n & 127, 0], midiTime(t)); midi.active[ch].delete(n); }
  function allOff(ch, t) { for (const n of [...midi.active[ch]]) noteOff(ch, n, t); }
  function midiBend(semis) {
    if (!midi.out) return;
    const v = clamp(Math.round(8192 + (semis / 2) * 8191), 0, 16383);
    for (let ch = 0; ch < 4; ch++) midi.out.send([0xe0 | ch, v & 127, (v >> 7) & 127]);
  }
  if (navigator.requestMIDIAccess) {
    navigator.requestMIDIAccess().then((acc) => {
      const sel = $('#midiOut');
      const fill = () => {
        sel.innerHTML = '<option value="">— sin salida —</option>';
        for (const o of acc.outputs.values()) sel.insertAdjacentHTML('beforeend', `<option value="${o.id}">${o.name}</option>`);
      };
      fill(); acc.onstatechange = fill;
      sel.addEventListener('change', () => { midi.out = acc.outputs.get(sel.value) || null; });
    }).catch(() => {});
  } else { $('.midi-out').style.opacity = .5; }

  /* ------------------------------------------------------------ encendido */
  function ensureAudio() {
    if (powered) { engine.resume(); return; }
    powered = true;
    engine.init(); engine.resume(); clock.start();
    $('#power').classList.add('on'); $('#power').lastChild.textContent = 'ON';
    engine.setDelayTime((60 / S.bpm) * S.fx.dlyDiv);
    // parches "normalizados" de fábrica (se pueden quitar)
    patch('env', 'cutoff'); patch('lfo', 'padDet');
    requestAnimationFrame(drawScope);
  }
  $('#power').addEventListener('click', ensureAudio);

  /* ------------------------------------------------------------ parámetros */
  const H = {
    'keys.level': (v) => engine.setLevel('keys', v), 'bass.level': (v) => engine.setLevel('bass', v),
    'arp.level': (v) => engine.setLevel('arp', v), 'pad.level': (v) => engine.setLevel('pad', v),
    'fx.drive': (v) => engine.setDrive(v), 'fx.cutoff': (v) => engine.setCutoff(v), 'fx.res': (v) => engine.setRes(v),
    'fx.dlyDiv': (v) => engine.setDelayTime((60 / S.bpm) * v), 'fx.dlyFb': (v) => engine.setDelayFb(v), 'fx.dlyMix': (v) => engine.setDelayMix(v),
    'fx.revSize': (v) => engine.setReverbSize(v), 'fx.revMix': (v) => engine.setReverbMix(v), 'fx.master': (v) => engine.setMaster(v),
    'mod.lfoRate': (v) => engine.setLfoRate(v), 'mod.lfoShape': (v) => engine.setLfoShape(v), 'mod.envDecay': (v) => engine.setEnvDecay(v),
    bpm: (v) => { clock.bpm = v; engine.setDelayTime((60 / v) * S.fx.dlyDiv); $('#oBpm').textContent = v + ' bpm'; },
    mode: () => { buildKeyboardLabels(); buildTonal(); refreshChord(); },
    func: () => refreshChord(), ext: () => refreshChord(), sus: () => refreshChord(), inversion: () => refreshChord(),
    voicing: () => refreshChord(), octave: () => refreshChord(),
    hold: (v) => { if (!v && held.size === 0 && chordActive) releaseChord(); },
    'pad.on': (v) => { if (!v) engine.releaseModule('pad'); else if (chordActive && current) for (const n of current.notes) engine.padOn(n); },
    'arp.on': (v) => { if (!v) allOff(CH.arp); },
  };
  function set(path, v) {
    const parts = path.split('.');
    if (parts.length === 2) {
      (S[parts[0]] = S[parts[0]] || {})[parts[1]] = v;
      if (engine.params[parts[0]] && parts[1] in engine.params[parts[0]]) engine.params[parts[0]][parts[1]] = v;
    } else S[path] = v;
    if (H[path]) H[path](v);
  }

  /* ------------------------------------------------------------ widgets */
  function fmtVal(el, v) {
    const labels = el.dataset.labels ? el.dataset.labels.split(',') : null;
    if (labels) return ({ tri: 'tríada' }[labels[Math.round(v)]] || labels[Math.round(v)] || '');
    if (el.dataset.unit) return v + el.dataset.unit;
    return Math.round(v * 100) + '';
  }
  function knobAngle(el, v) { const min = +el.dataset.min || 0, max = +(el.dataset.max || 1); return -135 + ((v - min) / (max - min)) * 270; }

  function buildKnob(el) {
    const path = el.dataset.knob, min = +(el.dataset.min || 0), max = +(el.dataset.max || 1), step = +(el.dataset.step || 0);
    let v = el.dataset.value != null ? +el.dataset.value : (get(path) ?? min);
    const def = v;
    const big = el.dataset.big;
    const r = big ? 34 : 26, C = 2 * Math.PI * r;
    el.innerHTML = `<div class="knob ${big ? 'big' : ''}"><svg viewBox="0 0 ${r * 2 + 6} ${r * 2 + 6}"><circle class="track" cx="${r + 3}" cy="${r + 3}" r="${r}" stroke-dasharray="${C * 0.75} ${C}"/><circle class="arc" cx="${r + 3}" cy="${r + 3}" r="${r}"/></svg><div class="cap"></div></div><span class="val"></span><label>${el.dataset.label || ''}</label>`;
    const knob = $('.knob', el), cap = $('.cap', el), arc = $('.arc', el), val = $('.val', el);
    if (el.dataset.labels && step) {
      const labels = el.dataset.labels.split(','), ticks = document.createElement('div'); ticks.className = 'ticks';
      labels.forEach((l, i) => {
        const a = (-135 + (i / (labels.length - 1)) * 270 - 90) * Math.PI / 180, R = big ? 50 : 40;
        ticks.insertAdjacentHTML('beforeend', `<span style="margin-left:${Math.cos(a) * R}px;margin-top:${Math.sin(a) * R}px">${l}</span>`);
      });
      knob.appendChild(ticks);
    }
    const render = () => {
      cap.style.setProperty('--angle', knobAngle(el, v) + 'deg');
      const f = (v - min) / (max - min);
      arc.setAttribute('stroke-dasharray', `${C * 0.75 * f} ${C}`);
      val.textContent = fmtVal(el, v);
    };
    const apply = (nv) => { nv = clamp(nv, min, max); if (step) nv = Math.round(nv / step) * step; if (nv === v) return; v = nv; render(); set(path, v); };
    let sy = 0, sv = 0;
    knob.addEventListener('pointerdown', (e) => { knob.setPointerCapture(e.pointerId); sy = e.clientY; sv = v; e.preventDefault(); });
    knob.addEventListener('pointermove', (e) => { if (!knob.hasPointerCapture(e.pointerId)) return; const k = e.shiftKey ? 1200 : 160; apply(sv + ((sy - e.clientY) / k) * (max - min)); });
    knob.addEventListener('dblclick', () => apply(def));
    knob.addEventListener('wheel', (e) => { e.preventDefault(); apply(v + (e.deltaY < 0 ? 1 : -1) * (step || (max - min) / 40)); }, { passive: false });
    render(); set(path, v);
    if (el.dataset.jack) addJack(el, el.dataset.jack, el.dataset.jackLabel);
  }
  function parseOpt(s) { return /^-?\d+(\.\d+)?$/.test(s) ? +s : s; }
  function buildSeg(el) {
    const path = el.dataset.seg, opts = el.dataset.options.split(',').map((o) => { const [l, v] = o.split('|'); return { l, v: parseOpt(v) }; });
    const cur = get(path) ?? opts[0].v;
    el.innerHTML = `<div class="seg ${el.dataset.mini ? 'mini' : ''}">${opts.map((o) => `<button type="button" data-v="${o.v}" class="${o.v === cur ? 'on' : ''}">${o.l}</button>`).join('')}</div>${el.dataset.label ? `<label>${el.dataset.label}</label>` : ''}`;
    $$('button', el).forEach((b) => b.addEventListener('click', () => { $$('button', el).forEach((x) => x.classList.remove('on')); b.classList.add('on'); set(path, parseOpt(b.dataset.v)); }));
    set(path, cur);
    if (el.dataset.jack) addJack(el, el.dataset.jack, el.dataset.jackLabel);
  }
  function buildSwitch(el) {
    const path = el.dataset.switch, opts = el.dataset.options.split(',').map((o) => { const [l, v] = o.split('|'); return { l, v }; });
    let cur = get(path) ?? opts[0].v;
    el.innerHTML = `<div class="switch"><span>${opts[0].l}</span><div class="rail"></div><span>${opts[1].l}</span></div><label>${el.dataset.label}</label>`;
    const sw = $('.switch', el), spans = $$('span', sw);
    const render = () => { sw.classList.toggle('b', cur === opts[1].v); spans[0].classList.toggle('on', cur === opts[0].v); spans[1].classList.toggle('on', cur === opts[1].v); };
    sw.addEventListener('click', () => { cur = cur === opts[0].v ? opts[1].v : opts[0].v; render(); set(path, cur); });
    render();
  }
  function buildToggle(el) {
    const path = el.dataset.toggle; let cur = !!(get(path) ?? false);
    el.innerHTML = `<button type="button" class="toggle ${el.dataset.led ? 'only-led' : ''}"><span class="led"></span>${el.dataset.led ? '' : el.dataset.label}</button>`;
    const b = $('button', el);
    const render = () => b.classList.toggle('on', cur);
    b.addEventListener('click', () => { cur = !cur; render(); set(path, cur); });
    render();
  }
  function buildSlider(el) {
    const path = el.dataset.slider, min = +el.dataset.min, max = +el.dataset.max, step = +(el.dataset.step || 1);
    let v = +el.dataset.value;
    el.innerHTML = `<div class="rail"><div class="thumb"></div><div class="marks">${[max, 0, min].map((m) => `<span>${m > 0 ? '+' + m : m}</span>`).join('')}</div></div><span class="val"></span><label>${el.dataset.label}</label>`;
    const rail = $('.rail', el), thumb = $('.thumb', el), val = $('.val', el);
    const render = () => { const f = (v - min) / (max - min); thumb.style.top = `calc(${1 - f} * (100% - 20px) + 3px)`; val.textContent = v > 0 ? '+' + v : v; };
    const fromEvent = (e) => { const r = rail.getBoundingClientRect(); const f = 1 - clamp((e.clientY - r.top - 7) / (r.height - 14), 0, 1); const nv = Math.round((min + f * (max - min)) / step) * step; if (nv !== v) { v = nv; render(); set(path, v); } };
    rail.addEventListener('pointerdown', (e) => { rail.setPointerCapture(e.pointerId); fromEvent(e); });
    rail.addEventListener('pointermove', (e) => { if (rail.hasPointerCapture(e.pointerId)) fromEvent(e); });
    render(); set(path, v);
  }
  function buildAmt(container, dst) {
    const k = document.createElement('div'); k.className = 'amt'; k.title = 'cantidad de modulación';
    let v = S.amt[dst] ?? 0.5; S.amt[dst] = v;
    const render = () => k.style.setProperty('--angle', (-135 + v * 270) + 'deg');
    let sy = 0, sv = 0;
    k.addEventListener('pointerdown', (e) => { k.setPointerCapture(e.pointerId); sy = e.clientY; sv = v; e.stopPropagation(); e.preventDefault(); });
    k.addEventListener('pointermove', (e) => { if (!k.hasPointerCapture(e.pointerId)) return; v = clamp(sv + (sy - e.clientY) / 120, 0, 1); S.amt[dst] = v; render(); engine.setAmount(dst, v); });
    k.addEventListener('dblclick', () => { v = 0.5; S.amt[dst] = v; render(); engine.setAmount(dst, v); });
    render(); container.appendChild(k);
  }
  function addJack(el, spec, label) {
    const [type, id] = spec.split(':');
    const wrap = document.createElement('div'); wrap.className = 'jackwrap';
    if (label) wrap.insertAdjacentHTML('beforeend', `<span class="jlab">${label}</span>`);
    const j = document.createElement('span'); j.className = 'jack'; j.dataset.jack = spec; j.title = type === 'dst' ? 'destino: ' + id : id;
    wrap.appendChild(j);
    if (type === 'dst') buildAmt(wrap, id);
    el.appendChild(wrap);
  }

  /* ------------------------------------------------------------ patch bay */
  const cables = []; let pending = null;
  const panel = $('#panel'), svg = $('#cables');
  function jackCenter(el) {
    const r = el.getBoundingClientRect(), p = panel.getBoundingClientRect();
    return { x: r.left - p.left - panel.clientLeft + r.width / 2, y: r.top - p.top - panel.clientTop + r.height / 2 };
  }
  function cablePath(a, b) {
    const d = Math.hypot(b.x - a.x, b.y - a.y), sag = 18 + Math.min(d * 0.1, 48);
    return `M${a.x},${a.y} C${a.x},${a.y + sag} ${b.x},${b.y + sag} ${b.x},${b.y}`;
  }
  function drawCables() {
    for (const c of cables) {
      const a = jackCenter(c.srcEl), b = jackCenter(c.dstEl), d = cablePath(a, b);
      c.shadow.setAttribute('d', d); c.path.setAttribute('d', d);
      c.pa.setAttribute('cx', a.x); c.pa.setAttribute('cy', a.y); c.pb.setAttribute('cx', b.x); c.pb.setAttribute('cy', b.y);
    }
  }
  function patch(srcId, dstId) {
    ensureAudio();
    const cable = engine.connect(srcId, dstId, S.amt[dstId] ?? 0.5);
    if (!cable) return;
    const srcEl = $(`.jack[data-jack="src:${srcId}"]`), dstEl = $(`.jack[data-jack="dst:${dstId}"]`);
    const ns = 'http://www.w3.org/2000/svg';
    const shadow = document.createElementNS(ns, 'path'); shadow.setAttribute('class', 'shadow');
    shadow.setAttribute('stroke', 'rgba(40,30,10,.18)'); shadow.setAttribute('stroke-width', '6'); shadow.setAttribute('fill', 'none'); shadow.setAttribute('transform', 'translate(1,3)');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('stroke', cable.color); path.setAttribute('stroke-width', '5'); path.setAttribute('fill', 'none'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('opacity', '.85');
    const plug = () => { const c = document.createElementNS(ns, 'circle'); c.setAttribute('r', '5'); c.setAttribute('fill', cable.color); c.setAttribute('stroke', '#2a292d'); c.setAttribute('stroke-width', '1.5'); return c; };
    const pa = plug(), pb = plug();
    svg.append(shadow, path, pa, pb);
    const c = { cable, srcEl, dstEl, shadow, path, pa, pb };
    cables.push(c); srcEl.classList.add('used'); dstEl.classList.add('used');
    path.addEventListener('click', () => unpatch(c));
    path.addEventListener('mouseenter', () => path.setAttribute('opacity', '1'));
    path.addEventListener('mouseleave', () => path.setAttribute('opacity', '.85'));
    drawCables();
  }
  function unpatch(c) {
    engine.disconnect(c.cable);
    for (const n of [c.shadow, c.path, c.pa, c.pb]) n.remove();
    cables.splice(cables.indexOf(c), 1);
    const still = (el) => cables.some((x) => x.srcEl === el || x.dstEl === el);
    if (!still(c.srcEl)) c.srcEl.classList.remove('used');
    if (!still(c.dstEl)) c.dstEl.classList.remove('used');
  }
  document.addEventListener('click', (e) => {
    const j = e.target.closest('.jack'); if (!j) return;
    const [type, id] = j.dataset.jack.split(':');
    if (!pending) { pending = { type, id, el: j }; j.classList.add('pending'); return; }
    if (pending.el === j) { j.classList.remove('pending'); pending = null; return; }
    if (pending.type === type) { pending.el.classList.remove('pending'); pending = { type, id, el: j }; j.classList.add('pending'); return; }
    const src = type === 'src' ? id : pending.id, dst = type === 'dst' ? id : pending.id;
    pending.el.classList.remove('pending'); pending = null;
    const existing = cables.find((c) => c.cable.src === src && c.cable.dst === dst);
    if (existing) unpatch(existing); else patch(src, dst);
  });
  window.addEventListener('resize', drawCables);
  if (window.ResizeObserver) new ResizeObserver(drawCables).observe(panel);

  /* ------------------------------------------------------------ tonal selector */
  function buildTonal() {
    const c = $('#tonalKeys'); c.innerHTML = '';
    const whites = [0, 2, 4, 5, 7, 9, 11], blacks = [1, 3, 6, 8, 10], w = 100 / 7;
    whites.forEach((pc, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'w' + (pc === S.key ? ' on' : '');
      b.style.left = `calc(${i * w}% + 1px)`; b.style.width = `calc(${w}% - 2px)`; b.textContent = Theory.SHARP[pc];
      b.addEventListener('click', () => { set('key', pc); buildTonal(); refreshChord(); });
      c.appendChild(b);
    });
    blacks.forEach((pc) => {
      const idx = [1, 2, 4, 5, 6][blacks.indexOf(pc)];
      const b = document.createElement('button'); b.type = 'button'; b.className = 'b' + (pc === S.key ? ' on' : '');
      b.style.left = `calc(${idx * w}% - ${w * 0.3}%)`; b.style.width = `${w * 0.6}%`;
      b.textContent = Theory.FLAT[pc];
      b.addEventListener('click', () => { set('key', pc); buildTonal(); refreshChord(); });
      c.appendChild(b);
    });
  }

  /* ------------------------------------------------------------ chord builder */
  const kb = $('#keyboard'); const keyEls = [];
  function buildKeyboard() {
    kb.innerHTML = ''; keyEls.length = 0;
    const w = 100 / 7; let wi = 0;
    Theory.LAYOUT.forEach((slot, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.i = i;
      if (!slot.black) {
        b.className = 'w'; b.style.left = `calc(${wi * w}% + 2px)`; b.style.width = `calc(${w}% - 4px)`;
        b.style.setProperty('--kc', KEY_COLORS[slot.deg][0]); b.style.setProperty('--kc-d', KEY_COLORS[slot.deg][1]);
        b.innerHTML = `<span class="roman"></span><span class="lip"></span>`; wi++;
      } else {
        b.className = 'b'; b.style.left = `calc(${wi * w}% - ${w * 0.29}%)`; b.style.width = `${w * 0.58}%`;
        b.innerHTML = `<span class="roman"></span>`;
      }
      kb.appendChild(b); keyEls[i] = b;
    });
    buildKeyboardLabels();
  }
  function buildKeyboardLabels() {
    const labels = Theory.degreeLabels(S.mode);
    keyEls.forEach((b, i) => { $('.roman', b).textContent = labels[i]; });
  }
  let pointerKey = null;
  kb.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    kb.setPointerCapture(e.pointerId); e.preventDefault();
    pointerKey = +b.dataset.i; keyDown(pointerKey);
  });
  kb.addEventListener('pointermove', (e) => {
    if (pointerKey == null || !kb.hasPointerCapture(e.pointerId)) return;
    const el = document.elementFromPoint(e.clientX, e.clientY), b = el && el.closest('#keyboard button');
    if (b && +b.dataset.i !== pointerKey) { keyUp(pointerKey); pointerKey = +b.dataset.i; keyDown(pointerKey); }
  });
  const endPointer = () => { if (pointerKey != null) { keyUp(pointerKey); pointerKey = null; } };
  kb.addEventListener('pointerup', endPointer); kb.addEventListener('pointercancel', endPointer);

  function chordFor(keyIndex) {
    return Theory.buildChord({ key: S.key, mode: S.mode, keyIndex, func: S.func, ext: S.ext, sus: S.sus, inversion: S.inversion, voicing: S.voicing, octave: S.octave });
  }
  function keyDown(i) {
    ensureAudio();
    held.add(i); currentKeyIndex = i; keyEls[i].classList.add('on');
    triggerChord(chordFor(i));
  }
  function keyUp(i) {
    held.delete(i); keyEls[i].classList.remove('on');
    if (held.size || S.hold) return;
    releaseChord();
  }
  function triggerChord(chord, opts = {}) {
    const t = opts.time ?? engine.now();
    engine.releaseModule('keys', t); engine.releaseModule('pad', t);
    allOff(CH.keys, t); allOff(CH.pad, t);
    current = chord; chordActive = true;
    for (const n of chord.notes) { engine.keysOn(n, 0.85, t); engine.padOn(n, t); noteOn(CH.keys, n, 100, t); noteOn(CH.pad, n, 80, t); }
    engine.triggerEnv(); engine.sampleRandom();
    if (S.bass.mode === 'trig') playBass(false, t, opts.fromLoop);
    setArpNotes(chord); arp.idx = 0; arp.dir = 1;
    if (!opts.fromLoop) loopRecord({ type: 'on', chord, keyIndex: currentKeyIndex });
    renderChord();
  }
  function releaseChord(fromLoop, time) {
    const t = time ?? engine.now();
    engine.releaseModule('keys', t); engine.releaseModule('pad', t);
    allOff(CH.keys, t); allOff(CH.pad, t); allOff(CH.arp, t);
    chordActive = false;
    if (!fromLoop) loopRecord({ type: 'off' });
    $('#oled').classList.add('idle');
  }
  function refreshChord() {
    if (currentKeyIndex == null) { renderChord(); return; }
    current = chordFor(currentKeyIndex);
    if (chordActive) {
      const t = engine.now();
      engine.releaseModule('pad', t); allOff(CH.pad, t);
      for (const n of current.notes) { engine.padOn(n, t); noteOn(CH.pad, n, 80, t); }
      setArpNotes(current);
    }
    renderChord();
  }
  function setArpNotes(chord) {
    const base = chord.notes.slice(); const out = [];
    for (let o = 0; o < S.arp.oct; o++) for (const n of base) if (n + 12 * o <= 108) out.push(n + 12 * o);
    arp.notes = out; if (arp.idx >= out.length) arp.idx = 0;
  }
  function nextArpNote() {
    const N = arp.notes.length; if (!N) return null;
    let n;
    switch (S.arp.mode) {
      case 'down': n = arp.notes[N - 1 - (arp.idx % N)]; arp.idx++; break;
      case 'updown': {
        if (N === 1) { n = arp.notes[0]; break; }
        n = arp.notes[arp.idx]; arp.idx += arp.dir;
        if (arp.idx >= N) { arp.idx = N - 2; arp.dir = -1; } else if (arp.idx < 0) { arp.idx = 1; arp.dir = 1; }
        break;
      }
      case 'random': n = arp.notes[Math.floor(Math.random() * N)]; break;
      default: n = arp.notes[arp.idx % N]; arp.idx++;
    }
    return n;
  }

  /* ------------------------------------------------------------ bajo */
  function playBass(alt, time, fromLoop) {
    if (!current) return;
    const n = Theory.bassNote(current, alt), t = time ?? engine.now();
    engine.bassOn(n, t); allOff(CH.bass, t); noteOn(CH.bass, n, 110, t);
    if (!fromLoop) loopRecord({ type: 'bass', alt });
    flashPad(alt);
  }
  function flashPad(alt) { const p = $(alt ? '#bassAlt' : '#bassRoot'); p.classList.add('on'); setTimeout(() => p.classList.remove('on'), 120); }
  $('#bassRoot').addEventListener('pointerdown', () => { ensureAudio(); playBass(false); });
  $('#bassAlt').addEventListener('pointerdown', () => { ensureAudio(); playBass(true); });

  /* ------------------------------------------------------------ strum + bend */
  const strum = $('#strum'); let lastStr = -1;
  function renderStrum() {
    strum.innerHTML = '';
    if (!current) { strum.innerHTML = '<span class="empty">strum</span>'; return; }
    const N = current.notes.length;
    current.notes.forEach((n, i) => {
      const s = document.createElement('i'); s.className = 'str'; s.style.left = `${((i + 0.5) / N) * 100}%`; s.dataset.n = Theory.midiName(n, current.useFlats);
      strum.appendChild(s);
    });
  }
  function strumAt(e) {
    if (!current) return;
    const r = strum.getBoundingClientRect(), f = clamp((e.clientX - r.left) / r.width, 0, 0.999);
    engine.setStrum(f);
    const idx = Math.floor(f * current.notes.length);
    if (idx === lastStr) return;
    lastStr = idx;
    const n = current.notes[idx], t = engine.now();
    engine.arpNote(n, t, 0.5); noteOn(CH.arp, n, 90, t); setTimeout(() => noteOff(CH.arp, n), 400);
    const el = $$('.str', strum)[idx]; if (el) { el.classList.add('hit'); setTimeout(() => el.classList.remove('hit'), 160); }
  }
  strum.addEventListener('pointerdown', (e) => { ensureAudio(); strum.setPointerCapture(e.pointerId); lastStr = -1; strumAt(e); });
  strum.addEventListener('pointermove', (e) => { if (strum.hasPointerCapture(e.pointerId)) strumAt(e); });
  strum.addEventListener('pointerup', () => { lastStr = -1; });

  const bend = $('#bend'), thumb = $('.bend-thumb', bend);
  function bendAt(e) {
    const r = bend.getBoundingClientRect(); let v = clamp(((e.clientX - r.left) / r.width - 0.5) * 2, -1, 1);
    let semis = v * 2; if (S.chrom) semis = Math.round(semis);
    thumb.style.left = `calc(${(semis / 4 + 0.5) * 100}% - 9px)`;
    engine.bend(semis); midiBend(semis);
  }
  bend.addEventListener('pointerdown', (e) => { ensureAudio(); bend.setPointerCapture(e.pointerId); bend.classList.add('drag'); bendAt(e); });
  bend.addEventListener('pointermove', (e) => { if (bend.hasPointerCapture(e.pointerId)) bendAt(e); });
  const bendEnd = () => { bend.classList.remove('drag'); thumb.style.left = 'calc(50% - 9px)'; engine.bend(0); midiBend(0); };
  bend.addEventListener('pointerup', bendEnd); bend.addEventListener('pointercancel', bendEnd);

  /* ------------------------------------------------------------ display */
  const mini = $('#miniPiano');
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].forEach((pc) => { const i = document.createElement('i'); if ([1, 3, 6, 8, 10].includes(pc)) i.className = 'b'; i.dataset.pc = pc; mini.appendChild(i); });
  function renderChord() {
    $('#oKey').textContent = Theory.keyName(S.key, S.mode) + (S.mode === 'major' ? ' mayor' : ' menor');
    $('#oFunc').textContent = FUNC_LABEL[S.func];
    $('#oled').classList.toggle('idle', !chordActive);
    const els = $$('i', mini);
    if (!current) { $('#oName').textContent = '—'; $('#oRoman').textContent = ''; $('#oFn').textContent = 'tocá una tecla del chord builder'; $('#oNotes').textContent = ''; els.forEach((i) => (i.className = i.className.replace(/ on| root/g, ''))); renderStrum(); return; }
    $('#oName').textContent = current.name; $('#oRoman').textContent = current.roman;
    const vx = [VOICING_LABEL[S.voicing], S.inversion ? `${S.inversion}ª inv.` : null, S.octave ? `oct ${S.octave > 0 ? '+' : ''}${S.octave}` : null].filter(Boolean).join(' · ');
    $('#oFn').textContent = current.fn + '  ·  ' + vx;
    $('#oNotes').textContent = current.notes.map((n) => Theory.midiName(n, current.useFlats)).join('  ');
    els.forEach((i) => { const pc = +i.dataset.pc; i.classList.toggle('on', current.pcs.includes(pc)); i.classList.toggle('root', pc === current.rootPc); });
    renderStrum();
  }
  const scope = $('#scope'), sctx = scope.getContext('2d'), buf = new Float32Array(1024);
  function drawScope() {
    engine.scope(buf);
    const W = scope.width, Hh = scope.height;
    sctx.clearRect(0, 0, W, Hh); sctx.strokeStyle = '#7be0b3'; sctx.lineWidth = 1.2; sctx.beginPath();
    for (let i = 0; i < W; i++) { const s = buf[Math.floor((i / W) * buf.length)]; const y = Hh / 2 - s * Hh * 0.9; i ? sctx.lineTo(i, y) : sctx.moveTo(i, y); }
    sctx.stroke();
    updateLoopBar();
    requestAnimationFrame(drawScope);
  }

  /* ------------------------------------------------------------ transporte + looper */
  const transport = { playing: false, startTick: 0 };
  const loop = { state: 'idle', events: [], startTick: 0, hasContent: false };
  const loopLen = () => S.loopBars * 96;
  const nowTick = () => Math.max(0, clock.tick - Math.round((clock.nextTime - engine.now()) / clock.tickSec));
  function setPlaying(p) {
    ensureAudio();
    transport.playing = p; $('#play').classList.toggle('on', p);
    if (p) { transport.startTick = nowTick(); if (loop.hasContent && loop.state === 'idle') { loop.state = 'play'; loop.startTick = transport.startTick; } }
    else { if (loop.state !== 'idle' && loop.state !== 'armed') loop.state = 'idle'; if (held.size === 0) releaseChord(true); }
    renderLoopButtons();
  }
  $('#play').addEventListener('click', () => setPlaying(!transport.playing));
  $('#rec').addEventListener('click', () => {
    ensureAudio();
    if (loop.state === 'idle') { loop.state = 'armed'; }
    else if (loop.state === 'armed') loop.state = 'idle';
    else if (loop.state === 'rec' || loop.state === 'overdub') loop.state = 'play';
    else if (loop.state === 'play') loop.state = 'overdub';
    renderLoopButtons();
  });
  $('#loopPlay').addEventListener('click', () => {
    if (!loop.hasContent) return;
    if (loop.state === 'play' || loop.state === 'overdub') { loop.state = 'idle'; releaseChord(true); }
    else { if (!transport.playing) setPlaying(true); loop.state = 'play'; loop.startTick = nowTick(); }
    renderLoopButtons();
  });
  $('#loopClear').addEventListener('click', () => { loop.events = []; loop.hasContent = false; loop.state = 'idle'; renderLoopButtons(); });
  function renderLoopButtons() {
    const r = $('#rec'); r.classList.toggle('arm', loop.state === 'armed'); r.classList.toggle('on', loop.state === 'rec' || loop.state === 'overdub');
    r.lastChild.textContent = loop.state === 'overdub' ? 'Overdub' : 'Rec';
    $('#loopPlay').classList.toggle('on', loop.state === 'play' || loop.state === 'overdub');
    $('#loopPlay').style.opacity = loop.hasContent ? 1 : .5;
  }
  function loopRecord(ev) {
    if (loop.state === 'armed') {
      if (ev.type !== 'on') return;
      if (!transport.playing) setPlaying(true);
      loop.state = 'rec'; loop.startTick = nowTick(); loop.events = []; renderLoopButtons();
    }
    if (loop.state !== 'rec' && loop.state !== 'overdub') return;
    const rel = (nowTick() - loop.startTick) % loopLen();
    const q = Math.round(rel / 6) * 6 % loopLen();
    loop.events.push({ tick: q, absTick: nowTick(), ...ev });
    loop.hasContent = true;
  }
  function updateLoopBar() {
    const bar = $('#loopPos');
    if (!powered || loop.state === 'idle' || loop.state === 'armed') { bar.style.width = '0%'; return; }
    const pos = ((nowTick() - loop.startTick) % loopLen()) / loopLen();
    bar.style.width = pos * 100 + '%';
  }

  /* ------------------------------------------------------------ reloj: arp, bajo, metrónomo, loop */
  clock.on((tick, time) => {
    const beat = tick % 24 === 0;
    if (beat) engine.pulseClock(time, tick % 96 === 0);
    // looper
    if (loop.state === 'rec' && tick - loop.startTick >= loopLen()) { loop.state = 'play'; renderLoopButtons(); }
    if (loop.state === 'play' || loop.state === 'overdub') {
      const pos = ((tick - loop.startTick) % loopLen() + loopLen()) % loopLen();
      for (const e of loop.events) {
        if (e.tick !== pos || Math.abs(e.absTick - tick) < 12) continue;
        if (e.type === 'on') { if (held.size === 0) { currentKeyIndex = e.keyIndex; triggerChord(e.chord, { fromLoop: true, time }); flashKey(e.keyIndex); } }
        else if (e.type === 'off') { if (held.size === 0 && !S.hold) releaseChord(true, time); }
        else if (e.type === 'bass' && current) { const n = Theory.bassNote(current, e.alt); engine.bassOn(n, time); allOff(CH.bass, time); noteOn(CH.bass, n, 110, time); flashPad(e.alt); }
      }
    }
    // metrónomo
    if (transport.playing && S.metro && beat) engine.metronome(time, (tick - transport.startTick) % 96 === 0);
    // bajo por reloj
    if (chordActive && current) {
      if (S.bass.mode === 'q' && beat) { const n = Theory.bassNote(current, false); engine.bassOn(n, time); allOff(CH.bass, time); noteOn(CH.bass, n, 110, time); }
      if (S.bass.mode === 'e' && tick % 12 === 0) { const alt = tick % 24 !== 0; const n = Theory.bassNote(current, alt); engine.bassOn(n, time); allOff(CH.bass, time); noteOn(CH.bass, n, alt ? 90 : 110, time); }
    }
    // arpegiador
    if (chordActive && S.arp.on && tick % S.arp.rate === 0) {
      const n = nextArpNote();
      if (n != null) {
        const step = clock.tickSec * S.arp.rate, gate = step * (0.1 + (engine.params.arp.gate || 0.5) * 0.9);
        engine.arpNote(n, time, gate); noteOn(CH.arp, n, 96, time); noteOff(CH.arp, n, time + gate);
      }
    }
  });
  function flashKey(i) { const b = keyEls[i]; if (!b) return; b.classList.add('on'); setTimeout(() => { if (!held.has(i)) b.classList.remove('on'); }, 140); }

  /* ------------------------------------------------------------ teclado de computadora */
  const KEYMAP = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11 };
  const downKeys = new Set();
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.target.tagName === 'SELECT' || e.metaKey || e.ctrlKey) return;
    if (e.code in KEYMAP) { downKeys.add(e.code); keyDown(KEYMAP[e.code]); e.preventDefault(); }
    else if (e.code === 'KeyZ') { ensureAudio(); playBass(false); }
    else if (e.code === 'KeyX') { ensureAudio(); playBass(true); }
    else if (e.code === 'Space') { e.preventDefault(); setPlaying(!transport.playing); }
    else if (/^Digit[1-5]$/.test(e.code)) { setKnob('ext', +e.code[5] - 1); }
    else if (e.code === 'ArrowUp') { setKnob('octave', clamp(S.octave + 1, -2, 2)); }
    else if (e.code === 'ArrowDown') { setKnob('octave', clamp(S.octave - 1, -2, 2)); }
  });
  document.addEventListener('keyup', (e) => { if (e.code in KEYMAP && downKeys.has(e.code)) { downKeys.delete(e.code); keyUp(KEYMAP[e.code]); } });
  function setKnob(path, v) {
    // sincroniza el widget con un valor externo
    const el = $(`[data-knob="${path}"], [data-slider="${path}"]`); if (!el) { set(path, v); return; }
    if (el.dataset.knob) {
      const min = +(el.dataset.min || 0), max = +(el.dataset.max || 1), big = el.dataset.big, r = big ? 34 : 26, C = 2 * Math.PI * r;
      $('.cap', el).style.setProperty('--angle', knobAngle(el, v) + 'deg');
      $('.arc', el).setAttribute('stroke-dasharray', `${C * 0.75 * ((v - min) / (max - min))} ${C}`);
      $('.val', el).textContent = fmtVal(el, v);
    } else {
      const min = +el.dataset.min, max = +el.dataset.max, f = (v - min) / (max - min);
      $('.thumb', el).style.top = `calc(${1 - f} * (100% - 20px) + 3px)`; $('.val', el).textContent = v > 0 ? '+' + v : v;
    }
    set(path, v);
  }

  /* ------------------------------------------------------------ init */
  buildKeyboard(); buildTonal();
  $$('[data-knob]').forEach(buildKnob);
  $$('[data-seg]').forEach(buildSeg);
  $$('[data-switch]').forEach(buildSwitch);
  $$('[data-toggle]').forEach(buildToggle);
  $$('[data-slider]').forEach(buildSlider);
  $$('[data-amt]').forEach((el) => buildAmt(el, el.dataset.amt));
  renderChord(); renderLoopButtons();
  window.addEventListener('blur', () => { for (const c of [...downKeys]) { downKeys.delete(c); keyUp(KEYMAP[c]); } });
})();
