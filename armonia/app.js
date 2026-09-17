/* ==========================================================================
   ARMONÍA · interfaz estilo Orchid
   tipo + modificadores · Key Mode · voicing en cascada · modos de performance
   cambios de acorde cuantizados · beats · looper por capas · ayuda · MIDI
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
    option: [['quantize', 'Quantize'], ['latch', 'Latch'], ['arp16', 'Arp 1/16'], ['swing', 'Swing'], ['metro', 'Metro']],
  };
  const CLOCKED = new Set(['arp', 'arp2', 'patA', 'patB', 'patC']);
  const PATTERNS = {
    patA: ['0', '.', '1', '.', '2', '.', '1', '.', '0', '.', '1', '.', '2', '.', '3', '.'],
    patB: ['AB', '.', '.', 'A', '.', '.', 'A', '.', 'B', '.', 'A', '.', '.', '.', 'A', '.'],
    patC: ['AB', '.', '.', 'A', '.', '.', 'AB', '.', '.', 'A', '.', '.', 'AB', '.', 'A', '.'],
  };
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

  /* ------------------------------------------------------------ ayuda */
  const HELP = {
    screen: ['Pantalla', 'Muestra el acorde que suena y sus notas, el estado de cada sección y la barra del loop.', 'Un nombre en amarillo con flecha es un acorde esperando el próximo tiempo (Quantize).'],
    sound: ['Sound', 'Elige el timbre del acorde: Keys, E-Piano, Organ, Pad, Strings, Pluck, Brass o Bells.', 'El bajo tiene su propio motor; no cambia con Sound.'],
    perform: ['Perform', 'Cómo se toca el acorde: todo junto (Chord), rasgueado (Strum), con timing humano (Slop), arpegiado al tempo (Arpeggiate), con patrones rítmicos (Pattern) o en cascada de tres octavas (Harp).', 'Arpeggiate y Pattern siguen el BPM. Al cambiar de acorde el patrón continúa sin cortarse gracias a Quantize.'],
    fx: ['FX', 'Efecto master: Dry, Room, Hall, Echo, Tape, Chorus o Lo-fi.', 'La perilla AMT regula cuánto efecto se aplica.'],
    fxAmt: ['FX amount', 'Cantidad del efecto elegido, de seco (0) a máximo (100).', ''],
    key: ['Key', 'Transpone el teclado: la tecla de la izquierda pasa a ser esta nota.', 'Con Key Mode activo, además define la tonalidad de la que salen los acordes.'],
    keymode: ['Key Mode', 'Off: vos elegís el tipo con los botones Major/Minor/Sus/Dim. Major o Minor: cualquier tecla genera automáticamente el acorde que pertenece a esa tonalidad, y los botones de tipo se eligen solos (quedan en amarillo, informativos).', '"Minor" acá es la tonalidad completa (por ejemplo La menor); el botón Minor de abajo es el tipo de un solo acorde. Con Key Mode activo ese botón no se usa.'],
    chord: ['Chord Type y Modifiers', 'Fila de arriba: el tipo del acorde (uno solo). Fila de abajo: modificadores 6, m7, M7 y 9, combinables para agregar color.', 'En Key Mode la fila de arriba es automática; m7 y M7 se convierten en "la séptima que corresponde a la tonalidad".'],
    voicing: ['Voicing Dial', 'Gira nota a nota: cada paso sube la nota más grave una octava (o baja la más aguda), cambiando el color del acorde en cascada.', 'Con el acorde sonando, las notas que se mueven se vuelven a disparar: un arpegio dinámico en tiempo real.'],
    octave: ['Octave', 'Desplaza todo el acorde hasta dos octavas hacia arriba o abajo.', ''],
    bass: ['Bass', 'Nivel del bajo. El bajo sigue la fundamental del acorde y, con un beat sonando, remarca los tiempos 1 y 3.', ''],
    bassMode: ['Bass mode', 'Off: sin bajo. On: bajo automático en la fundamental. Solo: el teclado deja de cambiar acordes y toca el bajo nota a nota, mientras el acorde en latch o en loop sigue sonando.', 'Las notas del bajo en Solo también se graban en el looper.'],
    loop: ['Loop', 'Largo del loop en compases (1, 2, 4 u 8). Elegilo antes de grabar.', ''],
    rec: ['Rec', 'Arma la grabación: el loop arranca exacto con la primera nota que toques, cuantizada al tempo. Al completar los compases pasa solo a reproducirse. Volver a apretar Rec durante la reproducción abre una capa de Overdub.', 'La barra de la pantalla muestra en rojo la grabación, en amarillo el overdub y en blanco la reproducción.'],
    loopPlay: ['Loop play', 'Reproduce o detiene el loop grabado.', ''],
    undo: ['Undo', 'Quita la última capa grabada con Overdub, sin tocar las anteriores.', ''],
    clear: ['Clear', 'Borra el loop completo.', ''],
    bpm: ['BPM', 'Tempo de todo: arpegios, patrones, strum, delay, beats y loop.', ''],
    beat: ['Beat', 'Batería sintetizada: Hip hop, Boom bap, Lo-fi, Disco, House, Bossa nova, Electronic, Trap o Funk. Arranca con Play.', 'Si un beat suena, los cambios de acorde se alinean a su grid (Quantize).'],
    play: ['Play', 'Transporte: arranca y detiene el beat, el metrónomo y el loop.', 'Con Rec armado, la primera nota tocada también pone Play.'],
    options: ['Options', 'Quantize alinea los cambios de acorde a la semicorchea más próxima cuando hay beat, loop, arpegio o patrón, para que nada quede cortado. Latch mantiene el acorde al soltar la tecla. Arp 1/16 hace el arpegio el doble de rápido. Swing balancea las semicorcheas (0, 25 o 50 %). Metro enciende el metrónomo con Play.', ''],
    volume: ['Volume', 'Volumen general.', ''],
    keyboard: ['Teclado', 'Una octava: cada tecla es la fundamental del acorde. Podés deslizar el dedo entre teclas. En Bass Solo, toca el bajo.', 'Atajos: A W S E D F T G Y H U J K. Un teclado MIDI conectado hace lo mismo.'],
    midi: ['MIDI', 'Entrada: cualquier nota del controlador es la fundamental; rueda de modulación = voicing; pedal de sustain = latch. Salida: acorde en canal 1, bajo en canal 2.', 'Funciona en Chrome y Edge abriendo el archivo local; aceptá el permiso MIDI.'],
  };

  /* ------------------------------------------------------------ estado */
  const S = {
    root: 0, key: 0, keyIndex: null, type: 'maj', mods: { 6: false, m7: false, M7: false, 9: false }, voicing: 0, octave: 0,
    keyModeState: 'off', keymode: false, minor: false,
    sound: 'keys', perform: 'chord', fx: 'room', fxAmt: .6, bass: 'auto', bassLevel: .8, loopBars: 2, bpm: 96, beat: 'off',
    quantize: true, latch: false, arp16: true, swing: 0, metro: false, volume: .8,
  };
  let current = null, chordActive = false, powered = false, pending = null;
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
      else if (d1 === 123 || d1 === 120) { midiNotes.clear(); held.clear(); pending = null; releaseChord(); keyEls.forEach((b) => b.classList.remove('on')); }
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
    requestAnimationFrame(frame);
  }
  $('#power').addEventListener('click', ensureAudio);

  /* ------------------------------------------------------------ parámetros */
  const label = (list, v) => (LISTS[list].find((o) => String(o[0]) === String(v)) || [v, v])[1];
  const H = {
    sound: (v) => { engine.setSound(v); $('#sSound').textContent = label('sound', v); },
    perform: (v) => { $('#sPerform').textContent = label('perform', v); if (chordActive) retrigger(); },
    fx: (v) => { engine.setFx(v, S.fxAmt); $('#sFx').textContent = label('fx', v); },
    fxAmt: (v) => engine.setFx(S.fx, v),
    key: () => { buildKeyboardLabels(); renderKey(); refreshChord(); },
    octave: () => refreshChord(),
    loopBars: () => { buildLoopSegs(); renderLoop(); },
    beat: (v) => { $('#sBeat').textContent = label('beat', v); },
    bpm: (v) => { clock.bpm = v; engine.setTempo(v); $('#sBpm').textContent = v; },
    volume: (v) => engine.setLevel('master', v),
    bassLevel: (v) => engine.setLevel('bass', v),
    latch: (v) => { if (!v && held.size === 0 && chordActive) releaseChord(); },
  };
  function set(path, v) { S[path] = v; if (H[path]) H[path](v); }

  /* ------------------------------------------------------------ widgets */
  const RING = (r) => { const C = 2 * Math.PI * r; return { C, svg: `<svg viewBox="0 0 ${r * 2 + 6} ${r * 2 + 6}"><circle class="track" cx="${r + 3}" cy="${r + 3}" r="${r}" stroke-dasharray="${C * .75} ${C}"/><circle class="arc" cx="${r + 3}" cy="${r + 3}" r="${r}"/></svg>` }; };
  const fmt = (path, v) => (path === 'bpm' ? v + '' : path === 'octave' || path === 'voicing' ? (v > 0 ? '+' + v : '' + v) : Math.round(v * 100) + '');
  function buildKnob(el) {
    const path = el.dataset.knob, min = +(el.dataset.min || 0), max = +(el.dataset.max || 1), step = +(el.dataset.step || 0);
    let v = +el.dataset.value; const def = v;
    const small = el.dataset.small, r = small ? 20 : el.classList.contains('mini') ? 13 : 25, ring = RING(r);
    el.insertAdjacentHTML('afterbegin', `<div class="knob ${small ? 'small' : ''}">${ring.svg}<div class="cap"></div></div><span class="val"></span><label>${el.dataset.label || ''}</label>`);
    const knob = $(':scope > .knob', el), cap = $('.cap', knob), arc = $('.arc', knob), val = $(':scope > .val', el);
    const render = () => { const f = (v - min) / (max - min); cap.style.setProperty('--angle', (-135 + f * 270) + 'deg'); arc.setAttribute('stroke-dasharray', `${ring.C * .75 * f} ${ring.C}`); val.textContent = fmt(path, v); };
    const apply = (nv) => { nv = clamp(nv, min, max); if (step) nv = Math.round(nv / step) * step; if (nv === v) return; v = nv; render(); set(path, v); };
    let sy = 0, sv = 0;
    knob.addEventListener('pointerdown', (e) => { if (helpOn) return; knob.setPointerCapture(e.pointerId); sy = e.clientY; sv = v; e.preventDefault(); });
    knob.addEventListener('pointermove', (e) => { if (!knob.hasPointerCapture(e.pointerId)) return; apply(sv + ((sy - e.clientY) / (e.shiftKey ? 1200 : 150)) * (max - min)); });
    knob.addEventListener('dblclick', () => apply(def));
    knob.addEventListener('wheel', (e) => { e.preventDefault(); apply(v + (e.deltaY < 0 ? 1 : -1) * (step || (max - min) / 40)); }, { passive: false });
    el._set = (nv) => { v = clamp(nv, min, max); render(); set(path, v); };
    render(); set(path, v);
  }
  function buildEnc(el) {
    const name = el.dataset.enc, list = LISTS[name], listOnly = el.dataset.list;
    let idx = Math.max(0, list.findIndex((o) => String(o[0]) === String(S[name])));
    const ring = RING(25);
    el.insertAdjacentHTML('afterbegin', `${listOnly ? '' : `<div class="knob">${ring.svg}<div class="cap"></div></div>`}<div class="enc-val"><button type="button" class="prev">‹</button><b></b><button type="button" class="next">›</button></div>${el.dataset.label ? `<label>${el.dataset.label}</label>` : ''}`);
    const knob = $(':scope > .knob', el), b = $(':scope > .enc-val b', el);
    const render = () => { b.textContent = list[idx][1]; if (knob) { const f = idx / (list.length - 1); $('.cap', knob).style.setProperty('--angle', (-135 + f * 270) + 'deg'); $('.arc', knob).setAttribute('stroke-dasharray', `${ring.C * .75 * f} ${ring.C}`); } };
    const apply = (i) => { i = ((i % list.length) + list.length) % list.length; if (i === idx) return; idx = i; render(); set(name, list[idx][0]); };
    $(':scope > .enc-val .prev', el).addEventListener('click', () => { if (!helpOn) apply(idx - 1); });
    $(':scope > .enc-val .next', el).addEventListener('click', () => { if (!helpOn) apply(idx + 1); });
    if (knob) {
      let sy = 0, si = 0;
      knob.addEventListener('pointerdown', (e) => { if (helpOn) return; knob.setPointerCapture(e.pointerId); sy = e.clientY; si = idx; e.preventDefault(); });
      knob.addEventListener('pointermove', (e) => { if (!knob.hasPointerCapture(e.pointerId)) return; apply(clamp(si + Math.round((sy - e.clientY) / 22), 0, list.length - 1)); });
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
    knob.addEventListener('pointerdown', (e) => { if (helpOn) return; knob.setPointerCapture(e.pointerId); sy = e.clientY; sv = S.voicing; e.preventDefault(); });
    knob.addEventListener('pointermove', (e) => { if (!knob.hasPointerCapture(e.pointerId)) return; setVoicing(sv + Math.round((sy - e.clientY) / 14)); });
    knob.addEventListener('wheel', (e) => { e.preventDefault(); setVoicing(S.voicing + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
    knob.addEventListener('dblclick', () => setVoicing(0));
    el._render = render; render();
  }
  function setKnob(path, v) { const el = $(`[data-knob="${path}"]`); if (el && el._set) el._set(v); else set(path, v); }

  // opciones
  function buildOptions() {
    const box = $('#options');
    for (const [k, l] of LISTS.option) box.insertAdjacentHTML('beforeend', `<button class="tog" type="button" data-opt="${k}"><i></i>${l}</button>`);
    $$('button', box).forEach((b) => b.addEventListener('click', () => {
      if (helpOn) return;
      const k = b.dataset.opt;
      if (k === 'swing') setOption('swing', S.swing === 0 ? .25 : S.swing === .25 ? .5 : 0); else setOption(k, !S[k]);
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

  // key mode: off → major → minor
  const KEY_MODES = ['off', 'major', 'minor'];
  function setKeyMode(m) {
    S.keyModeState = m; S.keymode = m !== 'off'; S.minor = m === 'minor';
    const b = $('#keyMode'); b.classList.toggle('on', S.keymode); b.classList.toggle('minor', S.minor);
    b.lastChild.textContent = m === 'off' ? 'key mode' : m;
    $('#cgrid').classList.toggle('keymode', S.keymode);
    renderKey(); refreshChord();
  }
  $('#keyMode').addEventListener('click', () => { if (!helpOn) setKeyMode(KEY_MODES[(KEY_MODES.indexOf(S.keyModeState) + 1) % 3]); });
  function renderKey() { const k = $('#sKey'); k.textContent = label('key', S.key) + (S.keymode ? (S.minor ? ' minor' : ' major') : ''); k.classList.toggle('hot', S.keymode); }

  /* ------------------------------------------------------------ botones de acorde */
  function bindChordButtons() {
    $$('#cgrid .cbtn').forEach((b) => b.addEventListener('pointerdown', (e) => {
      if (helpOn) return;
      e.preventDefault(); ensureAudio();
      if (b.dataset.type) { if (S.keymode) return; S.type = b.dataset.type; }
      else S.mods[b.dataset.mod] = !S.mods[b.dataset.mod];
      refreshChord();
    }));
  }
  function renderChordButtons() {
    const type = S.keymode && current ? current.type : S.type, mods = S.keymode && current ? current.mods : S.mods;
    $$('#cgrid .cbtn').forEach((b) => b.classList.toggle('on', b.dataset.type ? b.dataset.type === type : !!mods[b.dataset.mod]));
  }

  /* ------------------------------------------------------------ teclado */
  const kb = $('#keyboard'), keyEls = [];
  const BLACK = new Set([1, 3, 6, 8, 10]);
  function buildKeyboard() {
    kb.innerHTML = ''; keyEls.length = 0;
    const w = 100 / 8; let wi = 0;
    for (let i = 0; i <= 12; i++) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.i = i;
      if (!BLACK.has(i)) { b.className = 'w'; b.style.left = `calc(${wi * w}% + 2px)`; b.style.width = `calc(${w}% - 4px)`; wi++; }
      else { b.className = 'b'; b.style.left = `calc(${wi * w}% - ${w * .3}%)`; b.style.width = `${w * .6}%`; }
      kb.appendChild(b); keyEls[i] = b;
    }
    buildKeyboardLabels();
  }
  function buildKeyboardLabels() { keyEls.forEach((b, i) => { b.textContent = Theory.SHARP[(S.key + i) % 12]; }); }
  let pointerKey = null;
  kb.addEventListener('pointerdown', (e) => { if (helpOn) return; const b = e.target.closest('button'); if (!b) return; kb.setPointerCapture(e.pointerId); e.preventDefault(); pointerKey = +b.dataset.i; keyDown(pointerKey); });
  kb.addEventListener('pointermove', (e) => {
    if (pointerKey == null || !kb.hasPointerCapture(e.pointerId)) return;
    const el = document.elementFromPoint(e.clientX, e.clientY), b = el && el.closest('#keyboard button');
    if (b && +b.dataset.i !== pointerKey) { keyUp(pointerKey); pointerKey = +b.dataset.i; keyDown(pointerKey); }
  });
  const endPointer = () => { if (pointerKey != null) { keyUp(pointerKey); pointerKey = null; } };
  kb.addEventListener('pointerup', endPointer); kb.addEventListener('pointercancel', endPointer);

  /* ------------------------------------------------------------ acordes */
  const chordFor = () => Theory.buildChord({ root: S.root, type: S.type, mods: S.mods, voicing: S.voicing, octave: S.octave, keyMode: S.keymode, key: S.key, minor: S.minor });
  /** ¿Hay un grid al que alinear el cambio? (beat, loop, arpegio o patrón) */
  const gridActive = () => S.quantize && (CLOCKED.has(S.perform) || (transport.playing && S.beat !== 'off') || loop.state === 'play' || loop.state === 'overdub' || loop.state === 'rec');
  function keyDown(i, vel = .85) {
    ensureAudio();
    keyEls[i].classList.add('on');
    if (S.bass === 'solo') { bassSolo(36 + S.key + i, vel); return; }
    held.add(i); S.keyIndex = i; S.root = (S.key + i) % 12;
    const chord = chordFor();
    if (gridActive()) { pending = { chord, vel, keyIndex: i }; renderPending(); }   // espera la próxima semicorchea
    else triggerChord(chord, { vel });
  }
  function keyUp(i) {
    keyEls[i].classList.remove('on');
    if (S.bass === 'solo') return;
    held.delete(i);
    if (pending && pending.keyIndex === i && !S.latch && held.size === 0) { pending.released = true; return; }
    if (held.size || S.latch) return;
    releaseChord();
  }
  function bassSolo(note, vel, time, fromLoop) {
    const t = time ?? engine.now();
    engine.bassOn(note, t, vel); allOff(CH.bass, t); noteOn(CH.bass, note, Math.round(vel * 127), t);
    if (!fromLoop) loopRecord({ type: 'bass', note, vel });
  }
  const harpNotes = (notes) => { const out = []; for (let o = 0; o < 3; o++) for (const n of notes) if (n + 12 * o <= 108) out.push(n + 12 * o); return out; };
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
    current = chord; chordActive = true;
    if (!opts.keepArp) arp.idx = 0;
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
    if (!opts.fromLoop) loopRecord({ type: 'on', chord, keyIndex: S.keyIndex, perform: S.perform }, opts.tick);
    render();
  }
  function releaseChord(fromLoop, time, tick) {
    const t = time ?? engine.now();
    engine.releaseAll(t); allOff(CH.chord, t);
    chordActive = false;
    if (!fromLoop) loopRecord({ type: 'off' }, tick);
    render();
  }
  function refreshChord() {
    if (S.keyIndex == null) { render(); return; }
    const old = current ? current.notes : [];
    current = chordFor();
    if (pending) pending.chord = current;
    if (chordActive && !CLOCKED.has(S.perform)) {
      const t = engine.now();
      for (const n of old) if (!current.notes.includes(n)) { engine.releaseNote(n, t); noteOff(CH.chord, n, t); }
      for (const n of current.notes) if (!old.includes(n)) { engine.noteOn(n, .8, t); noteOn(CH.chord, n, 100, t); }
    }
    render();
  }
  function retrigger() { if (current) triggerChord(current, { fromLoop: true, keepArp: true }); }
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
    if (m === 'solo') { held.clear(); pending = null; keyEls.forEach((k) => k.classList.remove('on')); }
  }
  $('#bassOn').addEventListener('click', () => { if (!helpOn) setBassMode(BASS_MODES[(BASS_MODES.indexOf(S.bass) + 1) % 3]); });

  /* ------------------------------------------------------------ pantalla */
  function render() {
    renderChordButtons();
    $('#screen').classList.toggle('idle', !chordActive && !pending);
    const name = $('#oName'); name.classList.remove('pend');
    if (!current) { name.textContent = '—'; $('#oNotes').textContent = 'tocá una tecla'; return; }
    name.textContent = current.name;
    $('#oNotes').textContent = current.notes.map((n) => Theory.midiName(n, current.useFlats)).join(' ');
  }
  function renderPending() { if (!pending) return; const name = $('#oName'); name.textContent = '→ ' + pending.chord.name; name.classList.add('pend'); }
  const scope = $('#scope'), sctx = scope.getContext('2d'), buf = new Float32Array(1024);
  function frame() {
    engine.scope(buf);
    const W = scope.width, Hh = scope.height;
    sctx.clearRect(0, 0, W, Hh); sctx.strokeStyle = '#f2b636'; sctx.lineWidth = 1.2; sctx.beginPath();
    for (let i = 0; i < W; i++) { const s = buf[Math.floor((i / W) * buf.length)]; const y = Hh / 2 - s * Hh * .9; i ? sctx.lineTo(i, y) : sctx.moveTo(i, y); }
    sctx.stroke();
    renderLoop(true);
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------ transporte + looper */
  const transport = { playing: false, startTick: 0 };
  const loop = { state: 'idle', events: [], startTick: 0, hasContent: false, layer: 0 };
  const loopLen = () => S.loopBars * 96;
  function setPlaying(p, atTick) {
    ensureAudio();
    transport.playing = p; $('#play').classList.toggle('on', p);
    if (p) {
      transport.startTick = atTick ?? Math.ceil(clock.nowTick() / 6) * 6;
      if (loop.hasContent && loop.state === 'idle') { loop.state = 'play'; loop.startTick = transport.startTick; }
    } else {
      if (loop.state !== 'idle' && loop.state !== 'armed') loop.state = 'idle';
      pending = null;
      if (held.size === 0) releaseChord(true);
    }
    renderLoop();
  }
  $('#play').addEventListener('click', () => { if (!helpOn) setPlaying(!transport.playing); });
  $('#rec').addEventListener('click', () => {
    if (helpOn) return;
    ensureAudio();
    if (loop.state === 'idle') loop.state = 'armed';
    else if (loop.state === 'armed') loop.state = 'idle';
    else if (loop.state === 'rec' || loop.state === 'overdub') loop.state = 'play';
    else if (loop.state === 'play') { loop.state = 'overdub'; loop.layer++; }
    renderLoop();
  });
  $('#loopPlay').addEventListener('click', () => {
    if (helpOn || !loop.hasContent) return;
    if (loop.state === 'play' || loop.state === 'overdub') { loop.state = 'idle'; if (held.size === 0) releaseChord(true); }
    else { if (!transport.playing) setPlaying(true); loop.state = 'play'; loop.startTick = transport.playing ? loop.startTick : transport.startTick; }
    renderLoop();
  });
  $('#loopUndo').addEventListener('click', () => {
    if (helpOn || !loop.events.length) return;
    const last = Math.max(...loop.events.map((e) => e.layer));
    loop.events = loop.events.filter((e) => e.layer !== last);
    if (loop.state === 'overdub') loop.layer++;
    if (!loop.events.length) { loop.hasContent = false; loop.state = 'idle'; if (held.size === 0) releaseChord(true); }
    renderLoop();
  });
  $('#loopClear').addEventListener('click', () => { if (helpOn) return; loop.events = []; loop.hasContent = false; loop.state = 'idle'; loop.layer = 0; renderLoop(); });
  function buildLoopSegs() { $('#loopSegs').innerHTML = '<i></i>'.repeat(S.loopBars); }
  let lastBar = -1;
  function renderLoop(onlyPos) {
    const s = $('#sLoop'), bar = $('#loopbar'), cur = $('#loopCursor'), lbl = $('#loopLbl');
    if (!onlyPos) {
      const r = $('#rec'); r.classList.toggle('arm', loop.state === 'armed'); r.classList.toggle('on', loop.state === 'rec' || loop.state === 'overdub');
      $('#loopPlay').classList.toggle('on', loop.state === 'play' || loop.state === 'overdub'); $('#loopPlay').disabled = !loop.hasContent; $('#loopUndo').disabled = !loop.hasContent;
      bar.className = 'loopbar ' + (loop.state === 'rec' ? 'rec' : loop.state === 'overdub' ? 'dub' : loop.state === 'play' ? 'play' : loop.state);
    }
    const layers = new Set(loop.events.map((e) => e.layer)).size;
    if (loop.state === 'idle') { s.textContent = loop.hasContent ? `${S.loopBars} bars${layers > 1 ? ' ×' + layers : ''}` : '—'; s.classList.remove('hot'); cur.style.width = '0'; lbl.textContent = loop.hasContent ? 'loop listo · play' : `${S.loopBars} bars · rec para grabar`; return; }
    if (loop.state === 'armed') { s.textContent = 'armed'; s.classList.add('hot'); cur.style.width = '0'; lbl.textContent = 'armado · arranca con la primera nota'; return; }
    const rel = ((clock.nowTick() - loop.startTick) % loopLen() + loopLen()) % loopLen(), pos = rel / loopLen(), barN = Math.floor(rel / 96);
    cur.style.width = (pos * 100) + '%';
    if (barN !== lastBar) { lastBar = barN; if (barN === 0) { bar.classList.add('flash'); setTimeout(() => bar.classList.remove('flash'), 120); } }
    const st = loop.state === 'rec' ? 'REC' : loop.state === 'overdub' ? 'DUB' : 'PLAY';
    s.textContent = `${st} ${barN + 1}.${Math.floor((rel % 96) / 24) + 1}${layers > 1 ? ' ×' + layers : ''}`;
    s.classList.toggle('hot', loop.state !== 'play');
    lbl.textContent = loop.state === 'rec' ? `grabando · compás ${barN + 1} de ${S.loopBars}` : loop.state === 'overdub' ? `overdub · capa ${loop.layer}` : `loop · ${barN + 1}/${S.loopBars}${layers > 1 ? ' · ' + layers + ' capas' : ''}`;
  }
  /** Registra un evento en el loop; `tick` exacto cuando viene del reloj, si no se redondea a la semicorchea. */
  function loopRecord(ev, tick) {
    const at = tick ?? Math.round(clock.nowTick() / 6) * 6;
    if (loop.state === 'armed') {
      if (ev.type === 'off') return;
      loop.state = 'rec'; loop.startTick = at; loop.events = []; loop.layer = 1;
      if (!transport.playing) setPlaying(true, at); // el beat arranca alineado con el loop
      renderLoop();
    }
    if (loop.state !== 'rec' && loop.state !== 'overdub') return;
    loop.events.push({ tick: ((at - loop.startTick) % loopLen() + loopLen()) % loopLen(), absTick: at, layer: loop.layer, ...ev });
    if (!loop.hasContent) { loop.hasContent = true; renderLoop(); }
  }

  /* ------------------------------------------------------------ reloj */
  const swingOffset = (tick) => (tick % 12 === 6 ? S.swing * clock.tickSec * 6 * .9 : 0);
  clock.on((tick, time) => {
    const step16 = tick % 6 === 0;
    const rel = transport.playing ? tick - transport.startTick : tick;     // grid relativo al transporte
    const beat = rel % 24 === 0, step = ((Math.floor(rel / 6) % 16) + 16) % 16;
    const ts = time + swingOffset(rel);
    // acorde pendiente: cae en la próxima semicorchea
    if (pending && step16) {
      const p = pending; pending = null;
      S.keyIndex = p.keyIndex;
      triggerChord(p.chord, { vel: p.vel, time, tick, keepArp: true });
      if (p.released) releaseChord(false, time + clock.tickSec * 6, tick + 6);
    }
    // looper
    if (loop.state === 'rec' && tick - loop.startTick >= loopLen()) { loop.state = 'play'; renderLoop(); }
    if (loop.state === 'play' || loop.state === 'overdub') {
      const pos = (((tick - loop.startTick) % loopLen()) + loopLen()) % loopLen();
      for (const e of loop.events) {
        if (e.tick !== pos || Math.abs(e.absTick - tick) < 12) continue;
        if (e.type === 'on' && held.size === 0 && !pending) { S.keyIndex = e.keyIndex; triggerChord(e.chord, { fromLoop: true, time, keepArp: true }); flashKey(e.keyIndex); }
        else if (e.type === 'off' && held.size === 0 && !S.latch) releaseChord(true, time);
        else if (e.type === 'bass') bassSolo(e.note, e.vel, time, true);
      }
    }
    // metrónomo y beats
    if (transport.playing && rel >= 0) {
      if (S.metro && beat) engine.metronome(time, rel % 96 === 0);
      const B = BEATS[S.beat];
      if (B && step16) {
        const sw = S.swing || B.sw, tb = time + (rel % 12 === 6 ? sw * clock.tickSec * 6 * .9 : 0);
        if (B.K && B.K[step] === 'x') engine.kick(tb);
        if (B.S && B.S[step] === 'x') engine.snare(tb);
        if (B.C && B.C[step] === 'x') engine.clap(tb);
        if (B.H && B.H[step] === 'x') engine.hat(tb, false, step % 4 === 0 ? 1 : .6);
        if (B.O && B.O[step] === 'x') engine.hat(tb, true, .8);
        if (B.R && B.R[step] === 'x') engine.rim(tb);
      }
      if (chordActive && S.bass === 'auto' && B && (rel % 96 === 0 || rel % 96 === 48) && !S.perform.startsWith('pat') && !pending) playBass(time, rel % 96 === 0 ? 1 : .8);
    }
    // performance por reloj
    if (chordActive && current && CLOCKED.has(S.perform)) {
      const notes = S.perform === 'arp2' ? [...current.notes, ...current.notes.map((n) => n + 12)] : current.notes;
      if (S.perform === 'arp' || S.perform === 'arp2') {
        const rate = S.arp16 ? 6 : 12;
        if (rel % rate === 0) {
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

  /* ------------------------------------------------------------ modo ayuda */
  let helpOn = false; const card = $('#helpcard');
  function setHelp(on) {
    helpOn = on; $('.app').classList.toggle('help', on); $('#helpBtn').classList.toggle('on', on);
    if (!on) { card.hidden = true; $$('[data-help].hl').forEach((x) => x.classList.remove('hl')); }
  }
  $('#helpBtn').addEventListener('click', () => setHelp(!helpOn));
  function showHelp(el) {
    const h = HELP[el.dataset.help]; if (!h) return;
    $$('[data-help].hl').forEach((x) => x.classList.remove('hl')); el.classList.add('hl');
    $('#helpTitle').textContent = h[0]; $('#helpText').textContent = h[1]; $('#helpMore').textContent = h[2] || '';
    card.hidden = false;
    const r = el.getBoundingClientRect(), cw = Math.min(320, window.innerWidth - 20), ch = card.offsetHeight;
    let left = clamp(r.left, 10, window.innerWidth - cw - 10), top = r.bottom + 10;
    if (top + ch > window.innerHeight - 10) top = Math.max(10, r.top - ch - 10);
    card.style.left = left + 'px'; card.style.top = top + 'px';
  }
  document.addEventListener('pointerdown', (e) => {
    if (!helpOn) return;
    const el = e.target.closest('[data-help]');
    if (el) { e.preventDefault(); e.stopPropagation(); showHelp(el); }
    else if (!e.target.closest('#helpBtn')) card.hidden = true;
  }, true);
  document.addEventListener('pointerover', (e) => { if (!helpOn || e.pointerType === 'touch') return; const el = e.target.closest('[data-help]'); if (el) showHelp(el); });
  document.addEventListener('keydown', (e) => { if (e.code === 'Escape' && helpOn) setHelp(false); });

  /* ------------------------------------------------------------ teclado de computadora */
  const KEYMAP = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12 };
  const TYPE_KEYS = { Digit1: 'maj', Digit2: 'min', Digit3: 'sus', Digit4: 'dim' }, MOD_KEYS = { Digit5: '6', Digit6: 'm7', Digit7: 'M7', Digit8: '9' };
  const downKeys = new Set();
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.target.tagName === 'SELECT' || e.metaKey || e.ctrlKey || helpOn) return;
    if (e.code in KEYMAP) { downKeys.add(e.code); keyDown(KEYMAP[e.code]); e.preventDefault(); }
    else if (e.code in TYPE_KEYS) { if (!S.keymode) { S.type = TYPE_KEYS[e.code]; refreshChord(); } }
    else if (e.code in MOD_KEYS) { S.mods[MOD_KEYS[e.code]] = !S.mods[MOD_KEYS[e.code]]; refreshChord(); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); setVoicing(S.voicing + 1); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); setVoicing(S.voicing - 1); }
    else if (e.code === 'ArrowUp') { e.preventDefault(); setKnob('octave', clamp(S.octave + 1, -2, 2)); }
    else if (e.code === 'ArrowDown') { e.preventDefault(); setKnob('octave', clamp(S.octave - 1, -2, 2)); }
    else if (e.code === 'Space') { e.preventDefault(); setPlaying(!transport.playing); }
    else if (e.code === 'KeyB') $('#bassOn').click();
    else if (e.code === 'Slash' || e.code === 'F1') { e.preventDefault(); setHelp(!helpOn); }
  });
  document.addEventListener('keyup', (e) => { if (e.code in KEYMAP && downKeys.has(e.code)) { downKeys.delete(e.code); keyUp(KEYMAP[e.code]); } });
  window.addEventListener('blur', () => { for (const c of [...downKeys]) { downKeys.delete(c); keyUp(KEYMAP[c]); } });

  /* ------------------------------------------------------------ celulares */
  function applyMobile() {
    const forced = document.body.classList.contains('force-mobile') || /[?&]mobile/.test(location.search);
    const auto = window.matchMedia('(max-width: 700px)').matches || (window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 1000);
    document.body.classList.toggle('mobile', forced || auto);
  }
  applyMobile(); window.addEventListener('resize', applyMobile);

  /* ------------------------------------------------------------ init */
  buildKeyboard(); bindChordButtons(); buildOptions();
  $$('[data-knob]').forEach(buildKnob);
  $$('[data-enc]').forEach(buildEnc);
  $$('[data-dial]').forEach(buildDial);
  setBassMode(S.bass); setKeyMode('off'); buildLoopSegs();
  render(); renderLoop(); setupMidi();
})();
