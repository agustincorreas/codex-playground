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
    perform: [['chord', 'Chord'], ['strum', 'Strum ↓'], ['strumUp', 'Strum ↑'], ['strumAlt', 'Strum ↕'], ['strum2', 'Strum 2 Oct'], ['rake', 'Rake'], ['roll', 'Roll'], ['slop', 'Slop'], ['arp', 'Arpeggiate'], ['arpUD', 'Arp ↕'], ['arp2', 'Arp 2 Oct'], ['patA', 'Pattern A'], ['patB', 'Pattern B'], ['patC', 'Pattern C'], ['patD', 'Pattern D'], ['harp', 'Harp']],
    fx: Object.keys(FX).map((k) => [k, FX[k].name]),
    key: Theory.SHARP.map((n, i) => [i, n]),
    loopBars: [[1, '1 bar'], [2, '2 bars'], [4, '4 bars'], [8, '8 bars']],
    beat: [['off', 'Off'], ['hiphop', 'Hip hop'], ['boombap', 'Boom bap'], ['dilla', 'Dilla'], ['lofi', 'Lo-fi'], ['neosoul', 'Neo soul'], ['triphop', 'Trip hop'], ['disco', 'Disco'], ['house', 'House'], ['garage', 'UK garage'], ['techno', 'Techno'], ['dnb', 'Drum & bass'], ['bossa', 'Bossa nova'], ['samba', 'Samba'], ['cumbia', 'Cumbia'], ['reggaeton', 'Reggaetón'], ['dub', 'Dub'], ['afrobeat', 'Afrobeat'], ['breaks', 'Breakbeat'], ['electro', 'Electronic'], ['trap', 'Trap'], ['funk', 'Funk'], ['motown', 'Motown'], ['rock', 'Rock'], ['jazz', 'Jazz'], ['ambient', 'Ambient']],
    bass: [['off', 'Bass off'], ['root', 'Root'], ['root5', 'Root · 5th'], ['walk', 'Walking'], ['oct', 'Octaves'], ['pulse', 'Pulse 8ths'], ['solo', 'Solo']],
    bassSound: Object.keys(BASS).map((k) => [k, BASS[k].name]),
    option: [['secret', 'Secret chords'], ['quant', 'Quantize'], ['extRetrig', 'Ext retrig'], ['velocity', 'Velocity'], ['latch', 'Latch'], ['arp16', 'Arp 1/16'], ['swing', 'Swing'], ['metro', 'Metro']],
  };
  const CLOCKED = new Set(['arp', 'arpUD', 'arp2', 'patA', 'patB', 'patC', 'patD']);
  const STRUMS = new Set(['strum', 'strumUp', 'strumAlt', 'strum2', 'rake']);
  const PATTERNS = {
    patA: ['0', '.', '1', '.', '2', '.', '1', '.', '0', '.', '1', '.', '2', '.', '3', '.'],
    patB: ['AB', '.', '.', 'A', '.', '.', 'A', '.', 'B', '.', 'A', '.', '.', '.', 'A', '.'],
    patC: ['AB', '.', '.', 'A', '.', '.', 'AB', '.', '.', 'A', '.', '.', 'AB', '.', 'A', '.'],
    patD: ['0B', '2', '1', '2', '3', '2', '1', '2', '0B', '2', '1', '2', '3', '2', '1', '2'],
  };
  // beats de 16 pasos · K bombo · S redoblante · H hat · O hat abierto · C palma · R aro · T shaker · L tom
  // dinámica: X acento · x normal · o ghost · . silencio
  const BEATS = {
    hiphop:    { sw: .3,  K: 'X..x..x...X.x...', S: '....X......o.X..', H: 'x.o.x.o.x.o.x.o.', O: '..............x.' },
    boombap:   { sw: .24, K: 'X.....x.X.....x.', S: '....X.......X..o', H: 'x.x.xox.x.x.xox.', T: '..x...x...x...x.' },
    lofi:      { sw: .36, K: 'X......x..x.....', S: '....X.......X...', H: '..x...x...x...x.', O: '......x.........', T: 'o.o.o.o.o.o.o.o.' },
    neosoul:   { sw: .4,  K: 'X.....x...x.x...', S: '....X..o....X...', H: 'x.x.x.x.x.x.x.xo', R: '..........o.....', T: '.o.o.o.o.o.o.o.o' },
    disco:     { sw: 0,   K: 'X...X...X...X...', S: '....X.......X...', H: 'x.x.x.x.x.x.x.x.', O: '..X...X...X...X.', C: '....x.......x...' },
    house:     { sw: .08, K: 'X...X...X...X...', C: '....X.......X...', O: '..X...X...X...X.', H: 'x.o.x.o.x.o.x.o.', T: '..x...x...x...x.' },
    techno:    { sw: 0,   K: 'X...X...X...X...', S: '....x.......x...', H: 'oxoxoxoxoxoxoxox', O: '..x...x...x...x.', C: '............x...' },
    bossa:     { sw: 0,   K: 'X..x..X.X..x..X.', R: 'x..x..x...x..x..', H: 'x.x.x.x.x.x.x.x.', T: 'o.oxo.oxo.oxo.ox' },
    reggaeton: { sw: 0,   K: 'X...X...X...X...', S: '...X..X....X..X.', H: 'x.x.x.x.x.x.x.x.', T: '..o...o...o...o.' },
    breaks:    { sw: .1,  K: 'X.....X...X..X..', S: '....X..o.o..X...', H: 'x.x.x.x.xox.x.x.', O: '.......x........' },
    electro:   { sw: 0,   K: 'X..x....X.x.....', S: '....X.......X...', H: 'xoxoxoxoxoxoxoxo', O: '......x.......x.', C: '....x.......x...' },
    trap:      { sw: .12, K: 'X......x..X.....', S: '....X.......X...', H: 'x.xxx.x.xxxox.xx', O: '.......o.......x' },
    funk:      { sw: .14, K: 'X.x...x..x..X...', S: '....X..o....X..o', H: 'x.x.x.x.x.x.x.x.', O: '.......x........', L: '..............x.' },
    dilla:     { sw: .5,  K: 'X..x.....x.X....', S: '....X.......X..o', H: 'x.xox.x.x.xox.x.', T: '...o...o...o...o' },
    triphop:   { sw: .2,  K: 'X.......x.X.....', S: '....X.......X...', H: 'x...x.o.x...x.o.', O: '......x.........', T: '..o...o...o...o.' },
    garage:    { sw: .3,  K: 'X.....x...X.x...', S: '....X.......X...', H: 'x.x.xox.x.x.xox.', O: '..x.......x.....', T: '.o.o.o.o.o.o.o.o' },
    dnb:       { sw: 0,   K: 'X.........X.....', S: '....X.......X..o', H: 'xoxoxoxoxoxoxoxo', O: '......x.......x.' },
    samba:     { sw: 0,   K: 'X..X..X.X..X..X.', R: 'x.x.x.x.x.x.x.x.', T: 'xoxoxoxoxoxoxoxo', L: '.......x.......x' },
    cumbia:    { sw: 0,   K: 'X...X...X...X...', R: '..x...x...x...x.', H: 'x.x.x.x.x.x.x.x.', T: 'o.xoo.xoo.xoo.xo' },
    dub:       { sw: .05, K: 'X.......X.......', S: '........X.......', R: '....x.......x...', H: '..x...x...x...x.', O: '......o.......o.' },
    afrobeat:  { sw: 0,   K: 'X..x..x...x..x..', S: '....x..x....x..x', H: 'x.x.x.x.x.x.x.x.', R: 'x..x..x.x..x..x.', T: 'oxoxoxoxoxoxoxox' },
    motown:    { sw: .08, K: 'X...X...X...X...', S: 'X...X...X...X...', H: 'x.x.x.x.x.x.x.x.', T: 'x.x.x.x.x.x.x.x.' },
    rock:      { sw: 0,   K: 'X.....x.X...x...', S: '....X.......X...', H: 'X.x.X.x.X.x.X.x.', O: '..............x.' },
    jazz:      { sw: .45, K: 'o.......o.......', S: '......o....o....', D: 'X..xX..xX..xX..x', H: '....x.......x...' },
    ambient:   { sw: 0,   K: 'X...............', S: '........o.......', O: '......x.........', T: '....o.......o...' },
  };
  const DYN = { X: 1, x: .72, o: .32 };

  /* ------------------------------------------------------------ ayuda */
  const HELP = {
    screen: ['Pantalla', 'Muestra el acorde que suena y sus notas, el estado de cada sección y la barra del loop.', 'Un nombre en amarillo con flecha es un acorde esperando el próximo tiempo (Quantize).'],
    sound: ['Sound', 'Elige el timbre del acorde: 20 presets, de Keys y E-Piano a Choir, Clav, Harp, Vibes, Flute, Poly 80, Kalimba, Glass o Dream. Cada uno trae su propio chorus, vibrato o trémolo.', 'Cambiar Sound afecta lo que tocás ahora y lo que grabás en la capa actual: las capas ya grabadas del loop conservan su sonido.'],
    perform: ['Perform', 'Cómo se toca el acorde: todo junto (Chord); rasgueos como guitarra con fundamental grave y acento (Strum ↓ de grave a agudo, ↑ al revés, ↕ alterna en cada tecla, 2 Oct dobla la octava, Rake rasguea rápido y fuerte, Roll despliega dos octavas subiendo y bajando); Slop con timing humano; arpegios al tempo (Arpeggiate, Arp ↕, Arp 2 Oct); patrones rítmicos A–D; o Harp, cascada de tres octavas.', 'Los modos al tempo siguen el BPM. Al cambiar de acorde el patrón continúa sin cortarse gracias a Quantize.'],
    fx: ['FX', 'Efecto master: Dry, Room, Hall, Echo, Tape, Chorus o Lo-fi.', 'La perilla AMT regula cuánto efecto se aplica.'],
    fxAmt: ['FX amount', 'Cantidad del efecto elegido, de seco (0) a máximo (100).', ''],
    key: ['Key', 'Transpone el teclado: la tecla de la izquierda pasa a ser esta nota. Atajo: mantené apretado el encoder medio segundo y después tocá una tecla; esa nota pasa a ser la tonalidad.', 'Con Key Mode activo, además define la tonalidad de la que salen los acordes.'],
    keymode: ['Key Mode', 'Off: vos elegís el tipo con los botones Major/Minor/Sus/Dim. Major o Minor: cualquier tecla genera automáticamente el acorde que pertenece a esa tonalidad, y los botones de tipo se eligen solos (quedan en amarillo, informativos).', '"Minor" acá es la tonalidad completa (por ejemplo La menor); el botón Minor de abajo es el tipo de un solo acorde. Con Key Mode activo ese botón no se usa.'],
    chord: ['Chord Type y Modifiers', 'Fila de arriba: el tipo del acorde. Con Secret chords activo, tocá un segundo botón de tipo para combinarlos: Major+Minor = aumentado, Major+Sus = sus2, Major+Dim = ♭5, Minor+Sus = power chord, Minor+Dim = m♭6, Sus+Dim = cuartal (7sus4). Fila de abajo: modificadores 6, m7, M7 y 9, combinables.', 'En Key Mode la fila de arriba es automática; m7 y M7 se convierten en "la séptima que corresponde a la tonalidad".'],
    voicing: ['Voicing Dial', 'Gira nota a nota: cada paso sube la nota más grave una octava (o baja la más aguda), cambiando el color del acorde en cascada.', 'Con el acorde sonando, las notas que se mueven se vuelven a disparar: un arpegio dinámico en tiempo real.'],
    octave: ['Octave', 'Desplaza todo el acorde hasta dos octavas hacia arriba o abajo.', ''],
    split: ['Split', 'Para tocar melodías con el bajo en Solo: divide el teclado en el punto marcado. Las teclas a la izquierda suenan una octava más grave y las de la derecha una más aguda, así una sola octava de teclas cubre dos. Con Split activo, el Voicing Dial mueve el punto de división.', ''],
    save: ['Save', 'Guarda el loop actual (capas, compases y tempo) en este navegador.', ''],
    load: ['Load', 'Recupera el loop guardado. Después apretá Play o Loop para reproducirlo.', ''],
    bass: ['Bass', 'Nivel del bajo. El bajo sigue la fundamental del acorde y, con un beat sonando, remarca los tiempos 1 y 3.', ''],
    bassMode: ['Bass mode', 'Off: sin bajo. Root: fundamental con el acorde y en los tiempos 1 y 3. Root · 5th: fundamental y quinta alternadas. Walking: línea caminante por las notas del acorde, una por tiempo. Octaves: corcheas alternando octavas. Pulse 8ths: corcheas repetidas con acentos. Solo: el teclado toca el bajo nota a nota mientras el acorde sigue sonando.', 'Los patrones siguen el reloj con Play; sin transporte el bajo toca la fundamental al cambiar de acorde. Cada capa del loop recuerda su modo de bajo.'],
    bassSound: ['Bass sound', 'Timbre del bajo: Sub (seno profundo), Finger (eléctrico redondo), Pick (con púa, más brillante), Synth (filtro resonante) u 808 (con caída de tono y saturación).', ''],
    loop: ['Loop', 'Largo del loop en compases (1, 2, 4 u 8). Elegilo antes de grabar.', ''],
    rec: ['Rec', 'Arma la grabación: el loop arranca exacto con la primera nota que toques, cuantizada al tempo. Al completar los compases pasa solo a reproducirse. Volver a apretar Rec durante la reproducción abre una capa de Overdub.', 'Cada capa es una pista independiente: guarda su Sound, su Perform y su bajo, y suena superpuesta a las demás. Podés grabar un pad, luego cambiar a Pluck con arpegio y grabar encima. Rojo = grabando, amarillo = overdub, blanco = reproducción.'],
    loopPlay: ['Loop play', 'Reproduce o detiene el loop grabado.', ''],
    undo: ['Undo', 'Quita la última capa grabada con Overdub, sin tocar las anteriores.', ''],
    clear: ['Clear', 'Borra el loop completo.', ''],
    bpm: ['BPM', 'Tempo de todo: arpegios, patrones, strum, delay, beats y loop.', ''],
    beat: ['Beat', '26 loops de batería sintetizada, de Hip hop, Dilla y Neo soul a House, Techno, Drum & bass, Bossa nova, Samba, Cumbia, Reggaetón, Dub, Afrobeat, Motown, Rock, Jazz o Ambient. Arranca con Play.', 'Si un beat suena, los cambios de acorde se alinean a su grid (Quantize).'],
    play: ['Play', 'Transporte: arranca y detiene el beat, el metrónomo y el loop.', 'Con Rec armado, la primera nota tocada también pone Play.'],
    options: ['Options', 'Secret chords habilita acordes extra combinando dos botones de tipo. Quantize elige el grid (1/4 a 1/32, o off) al que se alinean los cambios de acorde y la grabación del loop cuando hay beat, loop, arpegio o patrón. Ext retrig: al agregar una extensión se vuelve a disparar todo el acorde en vez de sumar sólo la nota nueva. Velocity: en pantalla, tocar la tecla más abajo suena más fuerte; con MIDI usa la velocidad del controlador. Latch mantiene el acorde al soltar. Arp 1/16 duplica la velocidad del arpegio. Swing balancea las semicorcheas. Metro enciende el metrónomo con Play.', ''],
    volume: ['Volume', 'Volumen general.', ''],
    keyboard: ['Teclado', 'Una octava: cada tecla es la fundamental del acorde. Podés deslizar el dedo entre teclas. En Bass Solo, toca el bajo.', 'Atajos: A W S E D F T G Y H U J K. Un teclado MIDI conectado hace lo mismo.'],
    midi: ['MIDI', 'Entrada: las teclas del controlador son las mismas de la pantalla (el Do del teclado es la primera tecla, en cualquier octava); rueda de modulación = voicing; pedal de sustain = latch. Salida: acorde en canal 1, bajo en canal 2.', 'Funciona en Chrome y Edge; aceptá el permiso MIDI.'],
  };

  /* ------------------------------------------------------------ estado */
  const S = {
    root: 0, key: 0, keyIndex: null, type: 'maj', mods: { 6: false, m7: false, M7: false, 9: false }, voicing: 0, octave: 0,
    keyModeState: 'off', keymode: false, minor: false,
    sound: 'keys', perform: 'chord', fx: 'room', fxAmt: .6, bass: 'root', bassSound: 'finger', bassLevel: .8, loopBars: 2, bpm: 96, beat: 'off',
    quant: 6, secret: true, extRetrig: false, velocity: true, latch: false, arp16: true, swing: 0, metro: false, volume: .8,
    type2: null, split: false, splitPoint: 5,
  };
  const QUANTS = [[0, 'Q off'], [24, 'Q 1/4'], [12, 'Q 1/8'], [8, 'Q 1/8T'], [6, 'Q 1/16'], [4, 'Q 1/16T'], [3, 'Q 1/32']];
  let keyPick = false;
  let current = null, shown = null, chordActive = false, powered = false, pending = null;
  const held = new Set();
  const midiNotes = new Map();

  /* Pistas: la pista "live" es lo que tocás; cada capa del loop tiene la suya, con su propio sonido,
     modo de performance y bajo, para que suenen superpuestas y cambiar Sound no altere lo ya grabado. */
  const mkTrack = (id) => ({ id, chord: null, active: false, sound: S.sound, perform: S.perform, bass: S.bass, bassSound: S.bassSound, arpIdx: 0, arpDir: 1, strumDir: 1, walk: 0 });
  const live = mkTrack('live');
  const layerTracks = {};
  const trackFor = (layer) => layerTracks[layer] || (layerTracks[layer] = mkTrack('L' + layer));
  const activeTracks = () => [live, ...Object.keys(layerTracks).sort((a, b) => a - b).map((k) => layerTracks[k])].filter((t) => t.active && t.chord);
  const bassAuto = (m) => m !== 'off' && m !== 'solo';
  const bassOwner = () => activeTracks().find((t) => bassAuto(t.bass)) || null;

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
    if (type === 0x90 && d2 > 0) { const i = d1 % 12; midiNotes.set(d1, i); keyDown(i, d2 / 127); }
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
  window.__armoniaState = () => ({ live: { ...live }, layers: Object.fromEntries(Object.entries(layerTracks).map(([k, t]) => [k, { sound: t.sound, perform: t.perform, active: t.active }])), loop: { state: loop.state, layer: loop.layer, events: loop.events.length }, voices: engine.voices.map((v) => v.track + ':' + v.midi) });

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
  document.addEventListener('touchend', () => { if (powered) engine.resume(); }, { passive: true }); // iOS: reactivar audio tras un gesto

  /* ------------------------------------------------------------ parámetros */
  const label = (list, v) => (LISTS[list].find((o) => String(o[0]) === String(v)) || [v, v])[1];
  const H = {
    sound: (v) => { engine.setSound(v); $('#sSound').textContent = label('sound', v); if (chordActive) retrigger(); },
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
    bass: (v) => setBassMode(v),
    bassSound: (v) => { live.bassSound = v; },
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
      let pressT = null;
      knob.addEventListener('pointerdown', (e) => { if (helpOn) return; knob.setPointerCapture(e.pointerId); sy = e.clientY; si = idx; e.preventDefault(); if (name === 'key') pressT = setTimeout(() => setKeyPick(true), 450); });
      knob.addEventListener('pointermove', (e) => { if (!knob.hasPointerCapture(e.pointerId)) return; if (Math.abs(e.clientY - sy) > 4) { clearTimeout(pressT); pressT = null; } apply(clamp(si + Math.round((sy - e.clientY) / 22), 0, list.length - 1)); });
      knob.addEventListener('pointerup', () => { clearTimeout(pressT); pressT = null; });
      knob.addEventListener('wheel', (e) => { e.preventDefault(); apply(clamp(idx + (e.deltaY < 0 ? 1 : -1), 0, list.length - 1)); }, { passive: false });
    }
    el._set = (val) => { const i = list.findIndex((o) => String(o[0]) === String(val)); if (i >= 0) { idx = i; render(); set(name, list[idx][0]); } };
    render(); set(name, list[idx][0]);
  }
  function buildDial(el) {
    el.insertAdjacentHTML('afterbegin', `<div class="knob big"><div class="cap"></div></div><span class="val">0</span><label>${el.dataset.label}</label>`);
    const knob = $(':scope > .knob', el), cap = $('.cap', knob), val = $(':scope > .val', el);
    const render = () => { cap.style.setProperty('--angle', (S.voicing * 30) + 'deg'); val.textContent = fmt('voicing', S.voicing); if (!S.split) $('#sVoice').textContent = fmt('voicing', S.voicing); };
    let sy = 0, sv = 0;
    knob.addEventListener('pointerdown', (e) => { if (helpOn) return; knob.setPointerCapture(e.pointerId); sy = e.clientY; sv = S.voicing; e.preventDefault(); });
    knob.addEventListener('pointermove', (e) => { if (!knob.hasPointerCapture(e.pointerId)) return; setVoicing(sv + Math.round((sy - e.clientY) / 14)); });
    knob.addEventListener('wheel', (e) => { e.preventDefault(); setVoicing(S.voicing + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
    knob.addEventListener('dblclick', () => setVoicing(0));
    el._render = render; render();
  }
  function setKnob(path, v) { const el = $(`[data-knob="${path}"]`); if (el && el._set) el._set(v); else set(path, v); }
  function setEnc(name, v) { const el = $(`[data-enc="${name}"]`); if (el && el._set) el._set(v); else set(name, v); }
  function setKeyPick(on) { keyPick = on; $('[data-enc="key"]').classList.toggle('keypick', on); const k = $('#sKey'); if (on) { k.textContent = 'tocá una tecla…'; k.classList.add('hot'); } else renderKey(); }

  // opciones
  function buildOptions() {
    const box = $('#options');
    for (const [k, l] of LISTS.option) box.insertAdjacentHTML('beforeend', `<button class="tog" type="button" data-opt="${k}"><i></i>${l}</button>`);
    $$('button', box).forEach((b) => b.addEventListener('click', () => {
      if (helpOn) return;
      const k = b.dataset.opt;
      if (k === 'swing') setOption('swing', S.swing === 0 ? .25 : S.swing === .25 ? .5 : 0);
      else if (k === 'quant') { const i = QUANTS.findIndex((q) => q[0] === S.quant); setOption('quant', QUANTS[(i + 1) % QUANTS.length][0]); }
      else setOption(k, !S[k]);
    }));
    renderOptions();
  }
  function setOption(k, v) { set(k, v); renderOptions(); }
  function renderOptions() {
    $$('#options button').forEach((b) => {
      const k = b.dataset.opt, on = k === 'swing' ? S.swing > 0 : k === 'quant' ? S.quant > 0 : !!S[k];
      b.classList.toggle('on', on);
      if (k === 'swing') b.lastChild.textContent = S.swing ? `Swing ${Math.round(S.swing * 100)}` : 'Swing';
      if (k === 'quant') b.lastChild.textContent = QUANTS.find((q) => q[0] === S.quant)[1];
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
      if (b.dataset.type) {
        if (S.keymode) return;
        const t = b.dataset.type;
        if (t === S.type2) S.type2 = null;                                                   // quitar el segundo tipo
        else if (t === S.type) { if (S.type2) { S.type = S.type2; S.type2 = null; } }        // quitar el primero: queda el segundo
        else if (S.secret && Theory.comboType(S.type, t)) S.type2 = t;                       // acorde secreto
        else { S.type = t; S.type2 = null; }
      } else S.mods[b.dataset.mod] = !S.mods[b.dataset.mod];
      refreshChord();
    }));
  }
  const effectiveType = () => (S.type2 && Theory.comboType(S.type, S.type2)) || S.type;
  function renderChordButtons() {
    const type = S.keymode && current ? current.type : S.type, mods = S.keymode && current ? current.mods : S.mods;
    const t2 = S.keymode ? null : S.type2;
    $$('#cgrid .cbtn').forEach((b) => {
      const on = b.dataset.type ? (b.dataset.type === type || b.dataset.type === t2) : !!mods[b.dataset.mod];
      b.classList.toggle('on', on); b.classList.toggle('secret', !!t2 && on && !!b.dataset.type);
    });
  }

  /* ------------------------------------------------------------ teclado */
  const kb = $('#keyboard'), keyEls = [];
  const BLACK = new Set([1, 3, 6, 8, 10]);
  function buildKeyboard() {
    const mark = $('#splitMark'); kb.innerHTML = ''; keyEls.length = 0; if (mark) kb.appendChild(mark);
    const w = 100 / 8; let wi = 0;
    for (let i = 0; i <= 12; i++) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.i = i;
      if (!BLACK.has(i)) { b.className = 'w'; b.style.left = `calc(${wi * w}% + 2px)`; b.style.width = `calc(${w}% - 4px)`; wi++; }
      else { b.className = 'b'; b.style.left = `calc(${wi * w}% - ${w * .3}%)`; b.style.width = `${w * .6}%`; }
      kb.appendChild(b); keyEls[i] = b;
    }
    buildKeyboardLabels();
  }
  function buildKeyboardLabels() { keyEls.forEach((b, i) => { b.textContent = Theory.SHARP[(S.key + i) % 12]; }); if (typeof renderSplit === 'function' && $('#splitMark')) renderSplit(); }
  let pointerKey = null;
  kb.addEventListener('pointerdown', (e) => {
    if (helpOn) return; const b = e.target.closest('button'); if (!b) return;
    kb.setPointerCapture(e.pointerId); e.preventDefault(); pointerKey = +b.dataset.i;
    const r = b.getBoundingClientRect(), vel = S.velocity ? .5 + .5 * clamp((e.clientY - r.top) / r.height, 0, 1) : .85; // más abajo = más fuerte
    keyDown(pointerKey, vel);
  });
  kb.addEventListener('pointermove', (e) => {
    if (pointerKey == null || !kb.hasPointerCapture(e.pointerId)) return;
    const el = document.elementFromPoint(e.clientX, e.clientY), b = el && el.closest('#keyboard button');
    if (b && +b.dataset.i !== pointerKey) { keyUp(pointerKey); pointerKey = +b.dataset.i; keyDown(pointerKey); }
  });
  const endPointer = () => { if (pointerKey != null) { keyUp(pointerKey); pointerKey = null; } };
  kb.addEventListener('pointerup', endPointer); kb.addEventListener('pointercancel', endPointer);

  /* ------------------------------------------------------------ acordes */
  const chordFor = () => Theory.buildChord({ root: S.root, type: effectiveType(), mods: S.mods, voicing: S.voicing, octave: S.octave, keyMode: S.keymode, key: S.key, minor: S.minor });
  /** ¿Hay un grid al que alinear el cambio? (beat, loop, arpegio o patrón) */
  const gridActive = () => S.quant > 0 && (CLOCKED.has(S.perform) || (transport.playing && S.beat !== 'off') || loop.state === 'play' || loop.state === 'overdub' || loop.state === 'rec');
  function keyDown(i, vel = .85) {
    ensureAudio();
    if (!S.velocity) vel = .85;
    if (keyPick) { setKeyPick(false); setEnc('key', (S.key + i) % 12); return; }           // Key rápido: nota tocada = tonalidad
    keyEls[i].classList.add('on');
    if (S.bass === 'solo') { bassSolo(36 + S.key + i + (S.split ? (i < S.splitPoint ? -12 : 12) : 0), vel); return; }
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
  function bassSolo(note, vel, time, fromLoop, sound) {
    const t = time ?? engine.now();
    engine.bassOn(note, t, vel, sound || S.bassSound); allOff(CH.bass, t); noteOn(CH.bass, note, Math.round(vel * 127), t);
    if (!fromLoop) loopRecord({ type: 'bass', note, vel, bassSound: S.bassSound });
  }
  const harpNotes = (notes) => { const out = []; for (let o = 0; o < 3; o++) for (const n of notes) if (n + 12 * o <= 108) out.push(n + 12 * o); return out; };
  /** Notas y tiempos según el modo de performance (no clockeado). Devuelve [{n, dt, v}] */
  function performPlan(tr, chord, vel) {
    const beat = 60 / S.bpm, mode = tr.perform, notes = chord.notes.slice();
    const rootLow = chord.rootPc + 36 + 12 * (notes[0] >= 60 ? 1 : 0);              // fundamental grave, como la 6ª cuerda
    const withBass = (ns) => (rootLow < ns[0] - 4 ? [rootLow, ...ns] : ns);
    const ramp = (ns, step, accentEnd, accel) => ns.map((n, i) => {
      const f = ns.length > 1 ? i / (ns.length - 1) : 0;
      const dt = step * i * (1 - (accel || 0) * f);                                    // el rasgueo se acelera al final
      const v = vel * (accentEnd ? .7 + .3 * f : 1 - .3 * f);
      return { n, dt, v };
    });
    switch (mode) {
      case 'strum': return ramp(withBass(notes), beat / 22, true, .25);
      case 'strumUp': return ramp(withBass(notes).reverse(), beat / 22, true, .25);
      case 'strumAlt': { tr.strumDir = -tr.strumDir; const ns = withBass(notes); return ramp(tr.strumDir > 0 ? ns : ns.reverse(), beat / 22, true, .25); }
      case 'strum2': return ramp(withBass([...notes, ...notes.map((n) => n + 12).filter((n) => n <= 108)]), beat / 26, true, .3);
      case 'rake': return ramp(withBass(notes), beat / 60, true, 0).map((x, i, a) => ({ ...x, v: i === a.length - 1 ? vel : vel * .55 }));
      case 'roll': { const up = [...notes, ...notes.map((n) => n + 12).filter((n) => n <= 108)]; const seq = [...up, ...up.slice(0, -1).reverse()]; return seq.map((n, i) => ({ n, dt: (beat / 6) * i, v: vel * (.8 + .2 * Math.sin((i / seq.length) * Math.PI)) })); }
      case 'harp': return harpNotes(notes).map((n, i) => ({ n, dt: (beat / 4) * i, v: vel * .9 }));
      case 'slop': return notes.map((n) => ({ n, dt: Math.random() * .07, v: vel * (.7 + Math.random() * .3) }));
      default: return notes.map((n) => ({ n, dt: 0, v: vel }));
    }
  }
  function triggerOnTrack(tr, chord, opts = {}) {
    const t = opts.time ?? engine.now();
    engine.releaseAll(t, tr.id); if (tr === live) allOff(CH.chord, t);
    tr.chord = chord; tr.active = true;
    tr.sound = opts.sound ?? S.sound; tr.perform = opts.perform ?? S.perform; tr.bass = opts.bass ?? S.bass; tr.bassSound = opts.bassSound ?? S.bassSound;
    if (!opts.keepArp) { tr.arpIdx = 0; tr.arpDir = 1; }
    tr.walk = 0;
    const vel = opts.vel ?? .85;
    if (!CLOCKED.has(tr.perform)) {
      const relMul = tr.perform === 'harp' ? 2.2 : tr.perform === 'roll' ? 1.6 : 1;
      for (const { n, dt, v } of performPlan(tr, chord, vel)) {
        engine.noteOn(n, v, t + dt, { relMul, preset: tr.sound, track: tr.id });
        if (tr === live) noteOn(CH.chord, n, Math.round(v * 127), t + dt);
      }
    }
    if (bassAuto(tr.bass) && bassOwner() === tr) playBass(t, 1, tr);
    if (tr === live && !opts.fromLoop) loopRecord({ type: 'on', chord, keyIndex: S.keyIndex, sound: tr.sound, perform: tr.perform, bass: tr.bass, bassSound: tr.bassSound }, opts.tick);
    shown = chord; if (tr === live) { current = chord; chordActive = true; }
    render();
  }
  function releaseTrack(tr, fromLoop, time, tick) {
    const t = time ?? engine.now();
    engine.releaseAll(t, tr.id); if (tr === live) allOff(CH.chord, t);
    tr.active = false;
    if (tr === live) { chordActive = false; if (!fromLoop) loopRecord({ type: 'off' }, tick); }
    render();
  }
  const triggerChord = (chord, opts = {}) => triggerOnTrack(live, chord, opts);
  const releaseChord = (fromLoop, time, tick) => releaseTrack(live, fromLoop, time, tick);
  function refreshChord() {
    if (S.keyIndex == null) { render(); return; }
    const old = current ? current.notes : [];
    current = chordFor(); live.chord = current; if (chordActive) shown = current;
    if (pending) pending.chord = current;
    if (chordActive && S.extRetrig) { retrigger(); return; }
    if (chordActive && !CLOCKED.has(live.perform)) {
      const t = engine.now();
      for (const n of old) if (!current.notes.includes(n)) { engine.releaseNote(n, t, 'live'); noteOff(CH.chord, n, t); }
      for (const n of current.notes) if (!old.includes(n)) { engine.noteOn(n, .8, t, { preset: live.sound, track: 'live' }); noteOn(CH.chord, n, 100, t); }
    }
    render();
  }
  function retrigger() { if (current) triggerChord(current, { fromLoop: true, keepArp: true }); }
  function renderSplit() {
    const m = $('#splitMark'); m.hidden = !S.split;
    if (S.split) { const b = keyEls[S.splitPoint]; m.style.left = `calc(${b.style.left.match(/[\d.]+%/)[0]} - 1px)`; }
    $('#splitBtn').classList.toggle('on', S.split);
    $('#sVoice').textContent = S.split ? 'split ' + Theory.SHARP[(S.key + S.splitPoint) % 12] : fmt('voicing', S.voicing);
  }
  $('#splitBtn').addEventListener('click', () => { if (helpOn) return; S.split = !S.split; renderSplit(); });
  function setVoicing(v) {
    if (S.split) { S.splitPoint = clamp(S.splitPoint + Math.sign(v - S.voicing), 1, 12); renderSplit(); return; }   // con split, el dial mueve el punto
    v = clamp(v, -8, 8); if (v === S.voicing) return;
    S.voicing = v; const d = $('[data-dial="voicing"]'); if (d && d._render) d._render();
    refreshChord();
  }
  function playBass(t, vel = 1, tr, offset = 0) {
    tr = tr || bassOwner() || live; const chord = tr.chord; if (!chord) return;
    const n = Theory.bassNote(chord, false) + offset;
    engine.bassOn(n, t, vel, tr.bassSound || S.bassSound); allOff(CH.bass, t); noteOn(CH.bass, n, Math.round(vel * 120), t);
  }
  /** Nota del patrón de bajo para el tick relativo al compás (0..95). */
  function bassStep(tr, pos) {
    const iv = tr.chord.intervals, fifth = iv.includes(7) ? 7 : iv.includes(6) ? 6 : 12, third = iv.find((x) => x === 3 || x === 4) ?? 0;
    switch (tr.bass) {
      case 'root':  return pos === 0 ? [0, 1] : pos === 48 ? [0, .8] : null;
      case 'root5': return pos === 0 ? [0, 1] : pos === 48 ? [fifth, .85] : pos === 84 ? [fifth - 12, .6] : null;
      case 'walk':  if (pos % 24) return null; { const seq = [0, third, fifth, iv.includes(10) ? 10 : iv.includes(9) ? 9 : fifth + 2]; const n = seq[tr.walk % 4]; tr.walk++; return [n, tr.walk % 4 === 1 ? 1 : .8]; }
      case 'oct':   return pos % 12 ? null : [pos % 24 ? 12 : 0, pos % 24 ? .75 : .95];
      case 'pulse': return pos % 12 ? null : [0, pos % 48 === 0 ? 1 : pos % 24 ? .6 : .8];
      default: return null;
    }
  }
  function setBassMode(m) {
    S.bass = m; live.bass = m;
    $('#sBass').textContent = label('bass', m).replace('Bass off', 'Off'); $('#sBass').classList.toggle('hot', m === 'solo');
    if (m === 'solo') { held.clear(); pending = null; keyEls.forEach((k) => k.classList.remove('on')); }
  }
  const BASS_MODES = LISTS.bass.map((b) => b[0]);

  /* ------------------------------------------------------------ pantalla */
  function render() {
    renderChordButtons();
    const anyActive = activeTracks().length > 0;
    $('#screen').classList.toggle('idle', !anyActive && !pending);
    const name = $('#oName'); name.classList.remove('pend');
    const c = chordActive ? current : (shown || current);
    if (!c) { name.textContent = '—'; $('#oNotes').textContent = 'tocá una tecla'; return; }
    name.textContent = c.name;
    $('#oNotes').textContent = c.notes.map((n) => Theory.midiName(n, c.useFlats)).join(' ');
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
      pending = null; releaseLayers();
      if (held.size === 0) releaseChord(true);
    }
    renderLoop();
  }
  function releaseLayers() { for (const k in layerTracks) releaseTrack(layerTracks[k], true); }
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
    if (loop.state === 'play' || loop.state === 'overdub') { loop.state = 'idle'; releaseLayers(); }
    else { if (!transport.playing) setPlaying(true); loop.state = 'play'; loop.startTick = transport.playing ? loop.startTick : transport.startTick; }
    renderLoop();
  });
  $('#loopUndo').addEventListener('click', () => {
    if (helpOn || !loop.events.length) return;
    const last = Math.max(...loop.events.map((e) => e.layer));
    loop.events = loop.events.filter((e) => e.layer !== last);
    if (layerTracks[last]) { releaseTrack(layerTracks[last], true); delete layerTracks[last]; }
    if (loop.state === 'overdub') loop.layer++;
    if (!loop.events.length) { loop.hasContent = false; loop.state = 'idle'; }
    renderLoop();
  });
  $('#loopClear').addEventListener('click', () => { if (helpOn) return; loop.events = []; loop.hasContent = false; loop.state = 'idle'; loop.layer = 0; releaseLayers(); for (const k in layerTracks) delete layerTracks[k]; renderLoop(); });
  const LOOP_KEY = 'armonia.loop';
  function flashLoopLabel(text) { const l = $('#loopLbl'); l.textContent = text; l.dataset.hold = '1'; setTimeout(() => { delete l.dataset.hold; renderLoop(); }, 1400); }
  $('#loopSave').addEventListener('click', () => {
    if (helpOn || !loop.hasContent) return;
    try { localStorage.setItem(LOOP_KEY, JSON.stringify({ bars: S.loopBars, bpm: S.bpm, layer: loop.layer, events: loop.events })); flashLoopLabel('loop guardado'); } catch (e) { flashLoopLabel('no se pudo guardar'); }
  });
  $('#loopLoad').addEventListener('click', () => {
    if (helpOn) return;
    let d = null; try { d = JSON.parse(localStorage.getItem(LOOP_KEY) || 'null'); } catch (e) { /* noop */ }
    if (!d || !d.events || !d.events.length) { flashLoopLabel('no hay loop guardado'); return; }
    releaseLayers(); for (const k in layerTracks) delete layerTracks[k];
    setEnc('loopBars', d.bars); setKnob('bpm', d.bpm);
    loop.events = d.events.map((e) => ({ ...e, absTick: -1e9 })); loop.layer = d.layer || 1; loop.hasContent = true; loop.state = 'idle';
    if (transport.playing) { const rel = clock.nowTick() - transport.startTick; loop.startTick = transport.startTick + Math.ceil(rel / 96) * 96; loop.state = 'play'; }
    renderLoop(); flashLoopLabel(transport.playing ? 'loop cargado · arranca en el próximo compás' : 'loop cargado · play para reproducir');
  });
  function buildLoopSegs() { $('#loopSegs').innerHTML = '<i></i>'.repeat(S.loopBars); }
  let lastBar = -1;
  function renderLoop(onlyPos) {
    const s = $('#sLoop'), bar = $('#loopbar'), cur = $('#loopCursor'), lbl = $('#loopLbl');
    if (!onlyPos) {
      const r = $('#rec'); r.classList.toggle('arm', loop.state === 'armed'); r.classList.toggle('on', loop.state === 'rec' || loop.state === 'overdub');
      $('#loopPlay').classList.toggle('on', loop.state === 'play' || loop.state === 'overdub'); $('#loopPlay').disabled = !loop.hasContent; $('#loopUndo').disabled = !loop.hasContent; $('#loopSave').disabled = !loop.hasContent;
      bar.className = 'loopbar ' + (loop.state === 'rec' ? 'rec' : loop.state === 'overdub' ? 'dub' : loop.state === 'play' ? 'play' : loop.state);
    }
    const layers = new Set(loop.events.map((e) => e.layer)).size;
    if (loop.state === 'idle') { s.textContent = loop.hasContent ? `${S.loopBars} bars${layers > 1 ? ' ×' + layers : ''}` : '—'; s.classList.remove('hot'); cur.style.width = '0'; if (!lbl.dataset.hold) lbl.textContent = loop.hasContent ? 'loop listo · play' : `${S.loopBars} bars · rec para grabar`; return; }
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
    const q = S.quant || 6, at = tick ?? Math.round(clock.nowTick() / q) * q;
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
    if (pending && tick % S.quant === 0) {
      const p = pending; pending = null;
      S.keyIndex = p.keyIndex;
      triggerChord(p.chord, { vel: p.vel, time, tick, keepArp: true });
      if (p.released) releaseChord(false, time + clock.tickSec * S.quant, tick + S.quant);
    }
    // looper
    if (loop.state === 'rec' && tick - loop.startTick >= loopLen()) { loop.state = 'play'; renderLoop(); }
    if (loop.state === 'play' || loop.state === 'overdub') {
      const pos = (((tick - loop.startTick) % loopLen()) + loopLen()) % loopLen();
      for (const e of loop.events) {
        if (e.tick !== pos || Math.abs(e.absTick - tick) < 12) continue;
        if (e.type === 'on') { triggerOnTrack(trackFor(e.layer), e.chord, { fromLoop: true, time, keepArp: true, sound: e.sound, perform: e.perform, bass: e.bass, bassSound: e.bassSound }); flashKey(e.keyIndex); }
        else if (e.type === 'off') releaseTrack(trackFor(e.layer), true, time);
        else if (e.type === 'bass') bassSolo(e.note, e.vel, time, true, e.bassSound);
      }
    }
    // metrónomo y beats
    if (transport.playing && rel >= 0) {
      if (S.metro && beat) engine.metronome(time, rel % 96 === 0);
      const B = BEATS[S.beat];
      if (B && step16) {
        const sw = S.swing || B.sw, tb = time + (rel % 12 === 6 ? sw * clock.tickSec * 6 * .9 : 0) + (Math.random() - .5) * .004;
        const hit = (inst, fn) => { const c = B[inst] && B[inst][step]; if (c && c !== '.') fn(tb, DYN[c] * (0.94 + Math.random() * .08)); };
        hit('K', (t, v) => engine.kick(t, v)); hit('S', (t, v) => engine.snare(t, v)); hit('C', (t, v) => engine.clap(t, v));
        hit('H', (t, v) => engine.hat(t, false, v)); hit('O', (t, v) => engine.hat(t, true, v)); hit('R', (t, v) => engine.rim(t, v));
        hit('T', (t, v) => engine.shaker(t, v)); hit('L', (t, v) => engine.tom(t, v, step % 8 < 4)); hit('D', (t, v) => engine.ride(t, v));
      }
      const bo = bassOwner();
      if (bo && !bo.perform.startsWith('pat') && !pending && rel % 6 === 0) {
        const st = bassStep(bo, ((rel % 96) + 96) % 96);
        if (st && !(bo.bass === 'root' && !B)) playBass(ts, st[1], bo, st[0]);
      }
    }
    // performance por reloj, pista por pista
    for (const tr of activeTracks()) {
      if (!CLOCKED.has(tr.perform)) continue;
      const chord = tr.chord, isLive = tr === live;
      const notes = tr.perform === 'arp2' ? [...chord.notes, ...chord.notes.map((n) => n + 12)] : chord.notes;
      const play = (n, v, gate) => { engine.noteOn(n, v, ts, { gate, preset: tr.sound, track: tr.id }); if (isLive) { noteOn(CH.chord, n, Math.round(v * 127), ts); noteOff(CH.chord, n, ts + gate); } };
      if (tr.perform === 'arp' || tr.perform === 'arp2' || tr.perform === 'arpUD') {
        const rate = S.arp16 ? 6 : 12;
        if (rel % rate === 0) {
          let n;
          if (tr.perform === 'arpUD' && notes.length > 1) {
            n = notes[tr.arpIdx]; tr.arpIdx += tr.arpDir;
            if (tr.arpIdx >= notes.length) { tr.arpIdx = notes.length - 2; tr.arpDir = -1; } else if (tr.arpIdx < 0) { tr.arpIdx = 1; tr.arpDir = 1; }
          } else { n = notes[tr.arpIdx % notes.length]; tr.arpIdx++; }
          play(n, .78 + (rel % 24 === 0 ? .12 : 0), clock.tickSec * rate * .75);
        }
      } else if (step16) {
        const tok = PATTERNS[tr.perform][step];
        if (tok !== '.') {
          const gate = clock.tickSec * 6 * 1.6;
          if (tok.includes('A')) chord.notes.forEach((n) => play(n, step % 4 === 0 ? .85 : .65, gate));
          if (/\d/.test(tok)) play(notes[+tok.match(/\d/)[0] % notes.length], step % 4 === 0 ? .85 : .7, gate);
          if (tok.includes('B') && bassAuto(tr.bass) && bassOwner() === tr) playBass(ts, step === 0 ? 1 : .8, tr);
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
    else if (e.code in TYPE_KEYS) { if (!S.keymode) { const t = TYPE_KEYS[e.code]; if (e.shiftKey && S.secret && Theory.comboType(S.type, t)) S.type2 = t; else { S.type = t; S.type2 = null; } refreshChord(); } }
    else if (e.code in MOD_KEYS) { S.mods[MOD_KEYS[e.code]] = !S.mods[MOD_KEYS[e.code]]; refreshChord(); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); setVoicing(S.voicing + 1); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); setVoicing(S.voicing - 1); }
    else if (e.code === 'ArrowUp') { e.preventDefault(); setKnob('octave', clamp(S.octave + 1, -2, 2)); }
    else if (e.code === 'ArrowDown') { e.preventDefault(); setKnob('octave', clamp(S.octave - 1, -2, 2)); }
    else if (e.code === 'Space') { e.preventDefault(); setPlaying(!transport.playing); }
    else if (e.code === 'KeyB') setEnc('bass', BASS_MODES[(BASS_MODES.indexOf(S.bass) + 1) % BASS_MODES.length]);
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
  setKeyMode('off'); buildLoopSegs(); renderSplit();
  render(); renderLoop(); setupMidi();
})();
