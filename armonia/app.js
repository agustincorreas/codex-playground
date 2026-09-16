/* ==========================================================================
   ARMONÍA · interfaz estilo Orchid: tipo + modificadores, voicing en cascada,
   modos de performance, beats, looper, MIDI in/out
   ========================================================================== */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const engine = new Engine();
  const clock = new Clock(engine);

  /* ------------------------------------------------------------ listas */
  const LISTS = {
    sound: Object.keys(SOUNDS).map((k) => [k, SOUNDS[k].name]),
    perform: [['chord', 'Chord'], ['strum', 'Strum'], ['strum2', 'Strum 2 Oct'], ['slop', 'Slop'], ['arp', 'Arpeggiate'], ['arp2', 'Arp 2 Oct'], ['patA', 'Pattern A'], ['patB', 'Pattern B'], ['patC', 'Pattern C'], ['harp', 'Harp']],
    fx: Object.keys(FX).map((k) => [k, FX[k].name]),
    key: Theory.SHARP.map((n, i) => [i, n]),
    loopBars: [[1, '1 bar'], [2, '2 bars'], [4, '4 bars'], [8, '8 bars']],
    beat: [['off', 'Off'], ['hiphop', 'Hip hop'], ['boombap', 'Boom bap'], ['lofi', 'Lo-fi'], ['disco', 'Disco'], ['house', 'House'], ['bossa', 'Bossa nova'], ['electro', 'Electronic'], ['trap', 'Trap'], ['funk', 'Funk']],
    option: [['keymode', 'Key mode'], ['minor', 'Minor key'], ['latch', 'Latch'], ['arp16', 'Arp 1/16'], ['swing', 'Swing'], ['metro', 'Metro']],
  };
  const CLOCKED = new Set(['arp', 'arp2', 'patA', 'patB', 'patC']);
  // patrones de 16 pasos: número = índice de nota del acorde, 'A' = acorde completo, 'B' = bajo, '.' = silencio
  const PATTERNS = {
    patA: ['0', '.', '1', '.', '2', '.', '1', '.', '0', '.', '1', '.', '2', '.', '3', '.'],
    patB: ['AB', '.', '.', 'A', '.', '.', 'A', '.', 'B', '.', 'A', '.', '.', '.', 'A', '.'],
    patC: ['AB', '.', '.', 'A', '.', '.', 'AB', '.', '.', 'A', '.', '.', 'AB', '.', 'A', '.'],
  };
  // beats: K kick · S snare · H hat · O open hat · R rim · C clap
  const BEATS = {
    hiphop:  { sw: .28, K: 'x..x..x...x.x...', S: '....x.......x...', H: 'x.x.x.x.x.x.x.x.' },
    boombap: { sw: .22, K: 'x.....x.x.....x.', S: '....x.......x...', H: 'x.x.xxx.x.x.x.x.' },
    lofi:    { sw: .34, K: 'x......x..x.....', S: '....x.......x...', H: '..x...x...x...x.', O: '......x.........' },
    disco:   { sw: 0,   K: 'x...x...x...x...', S: '....x.......x...', H: 'x.x.x.x.x.x.x.x.', O: '..x...x...x...x.' },
    house:   { sw: 0,   K: 'x...x...x...x...', C: '....x.......x...', O: '..x...x...x...x.', H: 'x...x...x...x...' },
    bossa:   { sw: 0,   K: 'x..x..x.x..x..x.', R: 'x..x..x...x..x..', H: 'x.x.x.x.x.x.x.x.' },
    electro: { sw: 0,   K: 'x..x....x.x.....', S: '....x.......x...', H: 'xxxxxxxxxxxxxxxx', O: '......x.......x.' },
    trap:    { sw: .1,  K: 'x......x..x.....', S: '....x.......x...', H: 'x.xxx.x.xxx.x.xx' },
    funk:    { sw: .12, K: 'x.x...x..x..x...', S: '....x..x....x...', H: 'x.x.x.x.x.x.x.x.', O: '.......x........' },
  };

  /* ------------------------------------------------------------ estado */
  const S = {
    root: 0, key: 0, keyIndex: null, type: 'maj', mods: { 6: false, m7: false, M7: false, 9: false }, voicing: 0, octave: 0,
    sound: 'keys', perform: 'chord', fx: 'room', fxAmt: .6, bass: 'auto', bassLevel: .8, loopBars: 2, bpm: 96, beat: 'off',
    keymode: false, minor: false, latch: false, arp16: true, swing: 0, metro: false, volume: .8,
  };
  let current = null, chordActive = false, powered = false;
  const held = new Set();
  const arp = { idx: 0 };
  const midiNotes = new Map();

  /* ------------------------------------------------------------ MIDI */
  const midi = { out: null, in: null, active: [new Set(), new Set()] };
  const CH = { chord: 0, bass: 1 };
  const midiTime = (t) => (t == null ? undefined : performance.now() + Math.max(0, (t - engine.now()) * 1000));
  function noteOn(ch, n, vel = 100, t) { if (!midi.out) return; midi.out.send([0x90 | ch, n & 127, vel], midiTime(t)); midi.active[ch].add(n); }
  function noteOff(ch, n, t) { if (!midi.out) return; midi.out.send([0x80 | ch, n & 127, 0], midiTime(t)); midi.active[ch].delete(n); }
  function allOff(ch, t) { for (const n of [...midi.active[ch]]) noteOff(ch, n, t); }
  function midiBend(semis) { if (!midi.out) return; const v = clamp(Math.round(8192 + (semis / 2) * 8191), 0, 16383); for (const ch of [0, 1]) midi.out.send([0xe0 | ch, v & 127, (v >> 7) & 127]); }

  let midiFlashT = null;
  function midiStatus(cls, text) { const el = $('#midiStatus'); el.className = 'midi-status ' + cls; el.lastChild.textContent = text; }
  function midiActivity() { const el = $('#midiStatus'); el.classList.add('act'); clearTimeout(midiFlashT); midiFlashT = setTimeout(() => el.classList.remove('act'), 120); }
  function onMidiMessage(e) {
    const [st, d1, d2] = e.data, type = st & 0xf0;
    midiActivity();
    if (type === 0x90 && d2 > 0) { const i = Theory.mod(d1 - S.key, 12); midiNotes.set(d1, i); keyDown(i, d2 / 127); }
    else if (type === 0x80 || (type === 0x90 && d2 === 0)) { const i = midiNotes.get(d1); if (i == null) return; midiNotes.delete(d1); if (![...midiNotes.values()].includes(i)) keyUp(i); }
    else if (type === 0xb0) {
      if (d1 === 1) setVoicing(Math.round((d2 / 127) * 8) - 4);
      else if (d1 === 64) setOption('latch', d2 >= 64);
      else if (d1 === 7) setKnob('volume', d2 / 127);
      else if (d1 === 123 || d1 === 120) { midiNotes.clear(); held.clear(); releaseChord(); keyEls.forEach((b) => b.classList.remove('on')); }
    } else if (type === 0xe0) { const v = ((d2 << 7) | d1) - 8192; engine.bend((v / 8192) * 2); }
  }
  function bindInput(input) { if (midi.in) midi.in.onmidimessage = null; midi.in = input || null; if (input) input.onmidimessage = onMidiMessage; }
  function setupMidi() {
    const inSel = $('#midiIn'), outSel = $('#midiOut');
    if (!navigator.requestMIDIAccess) { midiStatus('err', 'sin Web MIDI · usá Chrome o Edge'); return; }
    if (!window.isSecureContext) { midiStatus('err', 'MIDI necesita https o archivo local'); return; }
    navigator.requestMIDIAccess({ sysex: false }).then((acc) => {
      const fill = () => {
        const keepIn = inSel.value, keepOut = outSel.value;
        inSel.innerHTML = '<option value="">— sin entrada —</option>';
        for (const i of acc.inputs.values()) inSel.insertAdjacentHTML('beforeend', `<option value="${i.id}">${i.name}</option>`);
        outSel.innerHTML = '<option value="">— sin salida —</option>';
        for (const o of acc.outputs.values()) outSel.insertAdjacentHTML('beforeend', `<option value="${o.id}">${o.name}</option>`);
        if (keepIn && acc.inputs.get(keepIn)) inSel.value = keepIn; else { const f = acc.inputs.values().next().value; inSel.value = f ? f.id : ''; }
        bindInput(acc.inputs.get(inSel.value));
        outSel.value = keepOut && acc.outputs.get(keepOut) ? keepOut : ''; midi.out = acc.outputs.get(outSel.value) || null;
        const n = acc.inputs.size;
        midiStatus(n ? 'ok' : '', n ? `${n} in · ${acc.outputs.size} out` : 'sin dispositivos');
      };
      fill(); acc.onstatechange = fill;
      inSel.addEventListener('change', () => bindInput(acc.inputs.get(inSel.value)));
      outSel.addEventListener('change', () => { midi.out = acc.outputs.get(outSel.value) || null; });
    }).catch(() => midiStatus('err', 'permiso MIDI denegado · revisá el candado'));
  }
  window.__armoniaMidi = (bytes) => onMidiMessage({ data: bytes });

  /* ------------------------------------------------------------ encendido */
  function ensureAudio() {
    if (powered) { engine.resume(); return; }
    powered = true;
    engine.init(); engine.resume(); clock.start();
    engine.setSound(S.sound); engine.setTempo(S.bpm); engine.setFx(S.fx, S.fxAmt);
    engine.setLevel('master', S.volume); engine.setLevel('bass', S.bassLevel);
    $('#power').classList.add('on'); $('#power').lastChild.textContent = 'ON';
    requestAnimationFrame(drawScope);
  }
  $('#power').addEventListener('click', ensureAudio);

  /* ------------------------------------------------------------ parámetros */
  const H = {
    sound: (v) => { engine.setSound(v); $('#sSound').textContent = label('sound', v); },
    perform: (v) => { $('#sPerform').textContent = label('perform', v); if (chordActive) retrigger(); },
    fx: (v) => { engine.setFx(v, S.fxAmt); $('#sFx').textContent = label('fx', v); },
    fxAmt: (v) => engine.setFx(S.fx, v),
    key: (v) => { buildKeyboardLabels(); renderKey(); refreshChord(); },
    octave: () => refreshChord(),
    loopBars: (v) => renderLoop(),
    beat: (v) => { $('#sBeat').textContent = label('beat', v); },
    bpm: (v) => { clock.bpm = v; engine.setTempo(v); $('#sBpm').textContent = v; },
    volume: (v) => engine.setLevel('master', v),
    bassLevel: (v) => engine.setLevel('bass', v),
    latch: (v) => { if (!v && held.size === 0 && chordActive) releaseChord(); },
    keymode: () => { $('#cgrid').classList.toggle('keymode', S.keymode); renderKey(); refreshChord(); },
    minor: () => { renderKey(); refreshChord(); },
  };
  function renderKey() { const k = $('#sKey'); k.textContent = label('key', S.key) + (S.keymode ? (S.minor ? ' minor' : ' major') : ''); k.classList.toggle('hot', S.keymode); }
  const label = (list, v) => (LISTS[list].find((o) => String(o[0]) === String(v)) || [v, v])[1];
  function set(path, v) { S[path] = v; if (H[path]) H[path](v); }

  /* ------------------------------------------------------------ widgets */
  const RING = (r) => { const C = 2 * Math.PI * r; return { C, svg: `<svg viewBox="0 0 ${r * 2 + 6} ${r * 2 + 6}"><circle class="track" cx="${r + 3}" cy="${r + 3}" r="${r}" stroke-dasharray="${C * .75} ${C}"/><circle class="arc" cx="${r + 3}" cy="${r + 3}" r="${r}"/></svg>` }; };
  function fmt(path, v) {
    if (path === 'bpm') return v + '';
    if (path === 'octave' || path === 'voicing') return v > 0 ? '+' + v : '' + v;
    return Math.round(v * 100) + '';
  }
  function buildKnob(el) {
    const path = el.dataset.knob, min = +(el.dataset.min || 0), max = +(el.dataset.max || 1), step = +(el.dataset.step || 0);
    let v = +el.dataset.value; const def = v;
    const small = el.dataset.small, r = small ? 20 : el.classList.contains('mini') ? 13 : 25, ring = RING(r);
    el.insertAdjacentHTML('afterbegin', `<div class="knob ${small ? 'small' : ''}">${ring.svg}<div class="cap"></div></div><span class="val"></span><label>${el.dataset.label || ''}</label>`);
    const knob = $(':scope > .knob', el), cap = $('.cap', knob), arc = $('.arc', knob), val = $(':scope > .val', el);
    const render = () => { const f = (v - min) / (max - min); cap.style.setProperty('--angle', (-135 + f * 270) + 'deg'); arc.setAttribute('stroke-dasharray', `${ring.C * .75 * f} ${ring.C}`); val.textContent = fmt(path, v); };
    const apply = (nv) => { nv = clamp(nv, min, max); if (step) nv = Math.round(nv / step) * step; if (nv === v) return; v = nv; render(); set(path, v); };
    let sy = 0, sv = 0;
    knob.addEventListener('pointerdown', (e) => { knob.setPointerCapture(e.pointerId); sy = e.clientY; sv = v; e.preventDefault(); });
    knob.addEventListener('pointermove', (e) => { if (!knob.hasPointerCapture(e.pointerId)) return; apply(sv + ((sy - e.clientY) / (e.shiftKey ? 1200 : 150)) * (max - min)); });
    knob.addEventListener('dblclick', () => apply(def));
    knob.addEventListener('wheel', (e) => { e.preventDefault(); apply(v + (e.deltaY < 0 ? 1 : -1) * (step || (max - min) / 40)); }, { passive: false });
    el._set = (nv) => { v = clamp(nv, min, max); render(); set(path, v); };
    render(); set(path, v);
  }
  function buildEnc(el) {
    const name = el.dataset.enc, list = LISTS[name], listOnly = el.dataset.list, noVal = el.dataset.noval;
    let idx = Math.max(0, list.findIndex((o) => String(o[0]) === String(S[name])));
    const ring = RING(25);
    el.insertAdjacentHTML('afterbegin', `${listOnly ? '' : `<div class="knob">${ring.svg}<div class="cap"></div></div>`}${noVal ? '' : '<div class="enc-val"><button type="button" class="prev">‹</button><b></b><button type="button" class="next">›</button></div>'}${el.dataset.label ? `<label>${el.dataset.label}</label>` : ''}`);
    const knob = $(':scope > .knob', el), b = $(':scope > .enc-val b', el);
    const render = () => {
      if (b) b.textContent = list[idx][1];
      if (name === 'option') $$('#options button').forEach((x) => x.classList.toggle('sel', x.dataset.opt === list[idx][0]));
      if (knob) { const f = idx / (list.length - 1); $('.cap', knob).style.setProperty('--angle', (-135 + f * 270) + 'deg'); $('.arc', knob).setAttribute('stroke-dasharray', `${ring.C * .75 * f} ${ring.C}`); }
    };
    const apply = (i) => { i = ((i % list.length) + list.length) % list.length; if (i === idx) return; idx = i; render(); if (name !== 'option') set(name, list[idx][0]); };
    if (b) { $(':scope > .enc-val .prev', el).addEventListener('click', () => apply(idx - 1)); $(':scope > .enc-val .next', el).addEventListener('click', () => apply(idx + 1)); }
    if (knob) {
      let sy = 0, si = 0;
      knob.addEventListener('pointerdown', (e) => { knob.setPointerCapture(e.pointerId); sy = e.clientY; si = idx; e.preventDefault(); });
      knob.addEventListener('pointermove', (e) => { if (!knob.hasPointerCapture(e.pointerId)) return; apply(clamp(si + Math.round((sy - e.clientY) / 22), 0, list.length - 1)); });
      knob.addEventListener('pointerup', (e) => { if (name === 'option' && Math.abs(e.clientY - sy) < 4) $(`#options button[data-opt="${list[idx][0]}"]`).click(); }); // push = conmutar
      knob.addEventListener('wheel', (e) => { e.preventDefault(); apply(clamp(idx + (e.deltaY < 0 ? 1 : -1), 0, list.length - 1)); }, { passive: false });
    }
    el._set = (val) => { const i = list.findIndex((o) => String(o[0]) === String(val)); if (i >= 0) { idx = i; render(); set(name, list[idx][0]); } };
    render(); set(name, list[idx][0]);
  }
  function buildDial(el) {
    el.insertAdjacentHTML('afterbegin', `<div class="knob big"><div class="cap"></div></div><span class="val">0</span><label>${el.dataset.label}</label>`);
    const knob = $(':scope > .knob', el), cap = $('.cap', knob), val = $(':scope > .val', el);
    const render = () => { cap.style.setProperty('--angle', (S.voicing * 30) + 'deg'); val.textContent = fmt('voicing', S.voicing); $('#sVoice').textContent = fmt('voicing', S.voicing); };
    let sy = 0, sv = 0;
    knob.addEventListener('pointerdown', (e) => { knob.setPointerCapture(e.pointerId); sy = e.clientY; sv = S.voicing; e.preventDefault(); });
    knob.addEventListener('pointermove', (e) => { if (!knob.hasPointerCapture(e.pointerId)) return; setVoicing(sv + Math.round((sy - e.clientY) / 14)); });
    knob.addEventListener('wheel', (e) => { e.preventDefault(); setVoicing(S.voicing + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
    knob.addEventListener('dblclick', () => setVoicing(0));
    el._render = render; render();
  }
  function setKnob(path, v) { const el = $(`[data-knob="${path}"]`); if (el && el._set) el._set(v); else set(path, v); }
  function setEnc(name, v) { const el = $(`[data-enc="${name}"]`); if (el && el._set) el._set(v); else set(name, v); }

  // opciones (toggles)
  function buildOptions() {
    const box = $('#options');
    for (const [k, l] of LISTS.option) box.insertAdjacentHTML('beforeend', `<button class="tog" type="button" data-opt="${k}"><i></i>${l}</button>`);
    $$('button', box).forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.opt;
      if (k === 'swing') setOption('swing', S.swing === 0 ? .25 : S.swing === .25 ? .5 : 0);
      else setOption(k, !S[k]);
    }));
    renderOptions();
  }
  function setOption(k, v) { set(k, v); renderOptions(); }
  function renderOptions() {
    $$('#options button').forEach((b) => {
      const k = b.dataset.opt, on = k === 'swing' ? S.swing > 0 : !!S[k];
      b.classList.toggle('on', on);
      if (k === 'swing') b.lastChild.textContent = S.swing ? `Swing ${Math.round(S.swing * 100)}` : 'Swing';
    });
  }

  /* ------------------------------------------------------------ botones de acorde */
  function bindChordButtons() {
    $$('#cgrid .cbtn').forEach((b) => b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); ensureAudio();
      if (b.dataset.type) { if (S.keymode) return; S.type = b.dataset.type; }
      else S.mods[b.dataset.mod] = !S.mods[b.dataset.mod];
      renderChordButtons(); refreshChord();
    }));
    renderChordButtons();
  }
  function renderChordButtons() {
    const type = S.keymode && current ? current.type : S.type, mods = S.keymode && current ? current.mods : S.mods;
    $$('#cgrid .cbtn').forEach((b) => b.classList.toggle('on', b.dataset.type ? b.dataset.type === type : !!mods[b.dataset.mod]));
  }

  /* ------------------------------------------------------------ teclado */
  const kb = $('#keyboard'), keyEls = [];
  const KEY_LAYOUT = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]; // semitonos desde la tecla Key
  const BLACK = new Set([1, 3, 6, 8, 10]);
  function buildKeyboard() {
    kb.innerHTML = ''; keyEls.length = 0;
    const w = 100 / 8; let wi = 0;
    for (const i of KEY_LAYOUT) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.i = i;
      if (!BLACK.has(i)) { b.className = 'w'; b.style.left = `calc(${wi * w}% + 2px)`; b.style.width = `calc(${w}% - 4px)`; wi++; }
      else { b.className = 'b'; b.style.left = `calc(${wi * w}% - ${w * .3}%)`; b.style.width = `${w * .6}%`; }
      kb.appendChild(b); keyEls[i] = b;
    }
    buildKeyboardLabels();
  }
  function buildKeyboardLabels() { keyEls.forEach((b, i) => { b.textContent = Theory.SHARP[(S.key + i) % 12]; }); }
  let pointerKey = null;
  kb.addEventListener('pointerdown', (e) => { const b = e.target.closest('button'); if (!b) return; kb.setPointerCapture(e.pointerId); e.preventDefault(); pointerKey = +b.dataset.i; keyDown(pointerKey); });
  kb.addEventListener('pointermove', (e) => {
    if (pointerKey == null || !kb.hasPointerCapture(e.pointerId)) return;
    const el = document.elementFromPoint(e.clientX, e.clientY), b = el && el.closest('#keyboard button');
    if (b && +b.dataset.i !== pointerKey) { keyUp(pointerKey); pointerKey = +b.dataset.i; keyDown(pointerKey); }
  });
  const endPointer = () => { if (pointerKey != null) { keyUp(pointerKey); pointerKey = null; } };
  kb.addEventListener('pointerup', endPointer); kb.addEventListener('pointercancel', endPointer);

  /* ------------------------------------------------------------ acordes */
  const chordFor = () => Theory.buildChord({ root: S.root, type: S.type, mods: S.mods, voicing: S.voicing, octave: S.octave, keyMode: S.keymode, key: S.key, minor: S.minor });
  function keyDown(i, vel = .85) {
    ensureAudio();
    keyEls[i].classList.add('on');
    if (S.bass === 'solo') { bassSolo(36 + S.key + i, vel); return; }   // el teclado toca el bajo
    held.add(i); S.keyIndex = i; S.root = (S.key + i) % 12;
    triggerChord(chordFor(), { vel });
  }
  function keyUp(i) {
    keyEls[i].classList.remove('on');
    if (S.bass === 'solo') return;
    held.delete(i);
    if (held.size || S.latch) return;
    releaseChord();
  }
  function bassSolo(note, vel, time, fromLoop) {
    const t = time ?? engine.now();
    engine.bassOn(note, t, vel); allOff(CH.bass, t); noteOn(CH.bass, note, Math.round(vel * 127), t);
    if (!fromLoop) loopRecord({ type: 'bass', note, vel });
  }
  function harpNotes(notes) { const out = []; for (let o = 0; o < 3; o++) for (const n of notes) if (n + 12 * o <= 108) out.push(n + 12 * o); return out; }
  function performNotes(chord) {
    if (S.perform === 'strum2') return [...chord.notes, ...chord.notes.map((n) => n + 12).filter((n) => n <= 108)];
    if (S.perform === 'harp') return harpNotes(chord.notes);
    return chord.notes.slice();
  }
  function stagger() {
    const beat = 60 / S.bpm;
    if (S.perform === 'strum' || S.perform === 'strum2') return beat / 18;
    if (S.perform === 'harp') return beat / 4;
    return 0;
  }
  function triggerChord(chord, opts = {}) {
    const t = opts.time ?? engine.now();
    engine.releaseAll(t); allOff(CH.chord, t);
    current = chord; chordActive = true; arp.idx = 0; arp.dir = 1;
    const vel = opts.vel ?? .85;
    if (!CLOCKED.has(S.perform)) {
      const notes = performNotes(chord), st = stagger();
      notes.forEach((n, i) => {
        let ti = t + i * st, vi = vel;
        if (S.perform === 'slop') { ti += Math.random() * .07; vi *= .7 + Math.random() * .3; }
        engine.noteOn(n, vi, ti, { relMul: S.perform === 'harp' ? 2.2 : 1 }); noteOn(CH.chord, n, Math.round(vi * 127), ti);
      });
    }
    if (S.bass === 'auto') playBass(t);
    if (!opts.fromLoop) loopRecord({ type: 'on', chord, keyIndex: S.keyIndex, perform: S.perform });
    render();
  }
  function releaseChord(fromLoop, time) {
    const t = time ?? engine.now();
    engine.releaseAll(t); allOff(CH.chord, t);
    chordActive = false;
    if (!fromLoop) loopRecord({ type: 'off' });
    render();
  }
  /** Cambio de tipo / modificador / octava con el acorde sonando: sólo se re-disparan las notas que cambian. */
  function refreshChord() {
    if (S.keyIndex == null) { render(); return; }
    const old = current ? current.notes : [];
    current = chordFor();
    if (chordActive && !CLOCKED.has(S.perform)) {
      const t = engine.now();
      for (const n of old) if (!current.notes.includes(n)) { engine.releaseNote(n, t); noteOff(CH.chord, n, t); }
      for (const n of current.notes) if (!old.includes(n)) { engine.noteOn(n, .8, t); noteOn(CH.chord, n, 100, t); }
    }
    render(); renderChordButtons();
  }
  function retrigger() { if (current) triggerChord(current, { fromLoop: true }); }
  /** Voicing Dial: cascada de inversiones; la nota que se mueve se re-dispara (arpegio dinámico). */
  function setVoicing(v) {
    v = clamp(v, -8, 8); if (v === S.voicing) return;
    S.voicing = v; const d = $('[data-dial="voicing"]'); if (d && d._render) d._render();
    refreshChord();
  }
  function playBass(t, vel = 1) {
    if (!current) return;
    const n = Theory.bassNote(current, false);
    engine.bassOn(n, t, vel); allOff(CH.bass, t); noteOn(CH.bass, n, Math.round(vel * 120), t);
  }
  const BASS_MODES = ['off', 'auto', 'solo'];
  function setBassMode(m) {
    S.bass = m;
    const b = $('#bassOn'); b.classList.toggle('on', m !== 'off'); b.classList.toggle('solo', m === 'solo');
    b.lastChild.textContent = m === 'auto' ? 'on' : m;
    $('#sBass').textContent = m === 'auto' ? 'On' : m === 'solo' ? 'Solo' : 'Off'; $('#sBass').classList.toggle('hot', m === 'solo');
    if (m === 'solo') { held.clear(); keyEls.forEach((k) => k.classList.remove('on')); }
  }
  $('#bassOn').addEventListener('click', () => setBassMode(BASS_MODES[(BASS_MODES.indexOf(S.bass) + 1) % 3]));

  /* ------------------------------------------------------------ pantalla */
  function render() {
    renderChordButtons();
    $('#screen').classList.toggle('idle', !chordActive);
    if (!current) { $('#oName').textContent = '—'; $('#oNotes').textContent = 'tocá una tecla'; return; }
    $('#oName').textContent = current.name;
    $('#oNotes').textContent = current.notes.map((n) => Theory.midiName(n, current.useFlats)).join(' ');
  }
  const scope = $('#scope'), sctx = scope.getContext('2d'), buf = new Float32Array(1024);
  function drawScope() {
    engine.scope(buf);
    const W = scope.width, Hh = scope.height;
    sctx.clearRect(0, 0, W, Hh); sctx.strokeStyle = '#f2b636'; sctx.lineWidth = 1.2; sctx.beginPath();
    for (let i = 0; i < W; i++) { const s = buf[Math.floor((i / W) * buf.length)]; const y = Hh / 2 - s * Hh * .9; i ? sctx.lineTo(i, y) : sctx.moveTo(i, y); }
    sctx.stroke();
    renderLoop(true);
    requestAnimationFrame(drawScope);
  }

  /* ------------------------------------------------------------ transporte + looper */
  const transport = { playing: false, startTick: 0 };
  const loop = { state: 'idle', events: [], startTick: 0, hasContent: false, layer: 0 };
  const loopLen = () => S.loopBars * 96;
  function setPlaying(p) {
    ensureAudio();
    transport.playing = p; $('#play').classList.toggle('on', p);
    if (p) { transport.startTick = clock.nowTick(); if (loop.hasContent && loop.state === 'idle') { loop.state = 'play'; loop.startTick = transport.startTick; } }
    else { if (loop.state !== 'idle' && loop.state !== 'armed') loop.state = 'idle'; if (held.size === 0) releaseChord(true); }
    renderLoop();
  }
  $('#play').addEventListener('click', () => setPlaying(!transport.playing));
  $('#rec').addEventListener('click', () => {
    ensureAudio();
    if (loop.state === 'idle') loop.state = 'armed';
    else if (loop.state === 'armed') loop.state = 'idle';
    else if (loop.state === 'rec' || loop.state === 'overdub') loop.state = 'play';
    else if (loop.state === 'play') { loop.state = 'overdub'; loop.layer++; }
    renderLoop();
  });
  $('#loopUndo').addEventListener('click', () => {
    if (!loop.events.length) return;
    const last = Math.max(...loop.events.map((e) => e.layer));
    loop.events = loop.events.filter((e) => e.layer !== last);          // quita la última capa grabada
    if (loop.state === 'overdub') loop.layer++;
    if (!loop.events.length) { loop.hasContent = false; loop.state = 'idle'; if (held.size === 0) releaseChord(true); }
    renderLoop();
  });
  $('#loopPlay').addEventListener('click', () => {
    if (!loop.hasContent) return;
    if (loop.state === 'play' || loop.state === 'overdub') { loop.state = 'idle'; if (held.size === 0) releaseChord(true); }
    else { if (!transport.playing) setPlaying(true); loop.state = 'play'; loop.startTick = clock.nowTick(); }
    renderLoop();
  });
  $('#loopClear').addEventListener('click', () => { loop.events = []; loop.hasContent = false; loop.state = 'idle'; loop.layer = 0; renderLoop(); });
  function renderLoop(onlyPos) {
    const s = $('#sLoop');
    if (!onlyPos) {
      const r = $('#rec'); r.classList.toggle('arm', loop.state === 'armed'); r.classList.toggle('on', loop.state === 'rec' || loop.state === 'overdub');
      $('#loopPlay').classList.toggle('on', loop.state === 'play' || loop.state === 'overdub'); $('#loopPlay').disabled = !loop.hasContent; $('#loopUndo').disabled = !loop.hasContent;
    }
    if (loop.state === 'idle') { s.textContent = loop.hasContent ? `${S.loopBars} bars` : '—'; s.classList.remove('hot'); return; }
    if (loop.state === 'armed') { s.textContent = 'armed'; s.classList.add('hot'); return; }
    const pos = ((clock.nowTick() - loop.startTick) % loopLen()) / 96;
    const layers = new Set(loop.events.map((e) => e.layer)).size;
    s.textContent = `${loop.state === 'rec' ? 'REC' : loop.state === 'overdub' ? 'DUB' : 'PLAY'} ${Math.floor(pos) + 1}.${Math.floor((pos % 1) * 4) + 1}${layers > 1 ? ' ×' + layers : ''}`;
    s.classList.toggle('hot', loop.state !== 'play');
  }
  function loopRecord(ev) {
    if (loop.state === 'armed') {
      if (ev.type === 'off') return;
      if (!transport.playing) setPlaying(true);
      loop.state = 'rec'; loop.startTick = clock.nowTick(); loop.events = []; loop.layer = 1; renderLoop();
    }
    if (loop.state !== 'rec' && loop.state !== 'overdub') return;
    const now = clock.nowTick(), rel = (now - loop.startTick) % loopLen();
    loop.events.push({ tick: (Math.round(rel / 6) * 6) % loopLen(), absTick: now, layer: loop.layer, ...ev });
    if (!loop.hasContent) { loop.hasContent = true; renderLoop(); }
  }

  /* ------------------------------------------------------------ reloj: arp, patrones, beats, bajo, loop */
  const swingOffset = (tick) => (tick % 12 === 6 ? S.swing * clock.tickSec * 6 * .9 : 0);
  clock.on((tick, time) => {
    const beat = tick % 24 === 0, step16 = tick % 6 === 0, step = Math.floor(tick / 6) % 16;
    const ts = time + swingOffset(tick);
    // looper
    if (loop.state === 'rec' && tick - loop.startTick >= loopLen()) { loop.state = 'play'; renderLoop(); }
    if (loop.state === 'play' || loop.state === 'overdub') {
      const pos = (((tick - loop.startTick) % loopLen()) + loopLen()) % loopLen();
      for (const e of loop.events) {
        if (e.tick !== pos || Math.abs(e.absTick - tick) < 12) continue;
        if (e.type === 'on' && held.size === 0) { S.keyIndex = e.keyIndex; triggerChord(e.chord, { fromLoop: true, time }); flashKey(e.keyIndex); }
        else if (e.type === 'off' && held.size === 0 && !S.latch) releaseChord(true, time);
        else if (e.type === 'bass') bassSolo(e.note, e.vel, time, true);
      }
    }
    // metrónomo y beats
    if (transport.playing) {
      if (S.metro && beat) engine.metronome(time, (tick - transport.startTick) % 96 === 0);
      const B = BEATS[S.beat];
      if (B && step16) {
        const sw = S.swing || B.sw, tb = time + (tick % 12 === 6 ? sw * clock.tickSec * 6 * .9 : 0);
        if (B.K && B.K[step] === 'x') engine.kick(tb);
        if (B.S && B.S[step] === 'x') engine.snare(tb);
        if (B.C && B.C[step] === 'x') engine.clap(tb);
        if (B.H && B.H[step] === 'x') engine.hat(tb, false, step % 4 === 0 ? 1 : .6);
        if (B.O && B.O[step] === 'x') engine.hat(tb, true, .8);
        if (B.R && B.R[step] === 'x') engine.rim(tb);
      }
      // bajo con groove: reengancha en el 1 y el 3 cuando hay beat
      if (chordActive && S.bass === 'auto' && B && (tick % 96 === 0 || tick % 96 === 48) && !S.perform.startsWith('pat')) playBass(time, tick % 96 === 0 ? 1 : .8);
    }
    // performance por reloj
    if (chordActive && current && CLOCKED.has(S.perform)) {
      const notes = S.perform === 'arp2' ? [...current.notes, ...current.notes.map((n) => n + 12)] : current.notes;
      if (S.perform === 'arp' || S.perform === 'arp2') {
        const rate = S.arp16 ? 6 : 12;
        if (tick % rate === 0) {
          const n = notes[arp.idx % notes.length]; arp.idx++;
          const gate = clock.tickSec * rate * .75;
          engine.noteOn(n, .8, ts, { gate }); noteOn(CH.chord, n, 100, ts); noteOff(CH.chord, n, ts + gate);
        }
      } else if (step16) {
        const tok = PATTERNS[S.perform][step];
        if (tok !== '.') {
          const gate = clock.tickSec * 6 * 1.6;
          const hit = (n, v) => { engine.noteOn(n, v, ts, { gate }); noteOn(CH.chord, n, Math.round(v * 127), ts); noteOff(CH.chord, n, ts + gate); };
          if (tok.includes('A')) current.notes.forEach((n) => hit(n, step % 4 === 0 ? .85 : .65));
          if (/\d/.test(tok)) hit(notes[+tok.match(/\d/)[0] % notes.length], .8);
          if (tok.includes('B') && S.bass === 'auto') playBass(ts, step === 0 ? 1 : .8);
        }
      }
    }
  });
  function flashKey(i) { const b = keyEls[i]; if (!b) return; b.classList.add('on'); setTimeout(() => { if (!held.has(i)) b.classList.remove('on'); }, 140); }

  /* ------------------------------------------------------------ teclado de computadora */
  const KEYMAP = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12 };
  const TYPE_KEYS = { Digit1: 'maj', Digit2: 'min', Digit3: 'sus', Digit4: 'dim' }, MOD_KEYS = { Digit5: '6', Digit6: 'm7', Digit7: 'M7', Digit8: '9' };
  const downKeys = new Set();
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.target.tagName === 'SELECT' || e.metaKey || e.ctrlKey) return;
    if (e.code in KEYMAP) { downKeys.add(e.code); keyDown(KEYMAP[e.code]); e.preventDefault(); }
    else if (e.code in TYPE_KEYS) { S.type = TYPE_KEYS[e.code]; renderChordButtons(); refreshChord(); }
    else if (e.code in MOD_KEYS) { S.mods[MOD_KEYS[e.code]] = !S.mods[MOD_KEYS[e.code]]; renderChordButtons(); refreshChord(); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); setVoicing(S.voicing + 1); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); setVoicing(S.voicing - 1); }
    else if (e.code === 'ArrowUp') { e.preventDefault(); setKnob('octave', clamp(S.octave + 1, -2, 2)); }
    else if (e.code === 'ArrowDown') { e.preventDefault(); setKnob('octave', clamp(S.octave - 1, -2, 2)); }
    else if (e.code === 'Space') { e.preventDefault(); setPlaying(!transport.playing); }
    else if (e.code === 'KeyB') $('#bassOn').click();
  });
  document.addEventListener('keyup', (e) => { if (e.code in KEYMAP && downKeys.has(e.code)) { downKeys.delete(e.code); keyUp(KEYMAP[e.code]); } });
  window.addEventListener('blur', () => { for (const c of [...downKeys]) { downKeys.delete(c); keyUp(KEYMAP[c]); } });

  /* ------------------------------------------------------------ init */
  buildKeyboard(); bindChordButtons(); buildOptions();
  $$('[data-knob]').forEach(buildKnob);
  $$('[data-enc]').forEach(buildEnc);
  $$('[data-dial]').forEach(buildDial);
  setBassMode(S.bass);
  renderKey(); render(); renderLoop(); setupMidi();
})();
