/* ==========================================================================
   ARMONÍA · motor de armonía tonal
   Cada tecla del Chord Builder es un grado, no una nota.
   ========================================================================== */
(function (global) {
  'use strict';

  const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const FLAT  = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

  // Teclas con bemoles vs sostenidos para el nombre del acorde
  const FLAT_KEYS = { major: [5, 10, 3, 8, 1, 6], minor: [2, 7, 0, 5, 10, 3] };

  // Distribución fija de una octava: 7 teclas blancas (grados) + 5 negras (cromáticas)
  const LAYOUT = [
    { black: false, deg: 0 }, { black: true, idx: 0 },
    { black: false, deg: 1 }, { black: true, idx: 1 },
    { black: false, deg: 2 },
    { black: false, deg: 3 }, { black: true, idx: 2 },
    { black: false, deg: 4 }, { black: true, idx: 3 },
    { black: false, deg: 5 }, { black: true, idx: 4 },
    { black: false, deg: 6 },
  ];

  // Calidades de acorde apiladas por terceras (relativas a la fundamental)
  const QUAL = {
    maj:  [0, 4, 7, 11, 14, 18, 21], // maj7 ♯11 13 (lidio) — intercambio modal
    dom:  [0, 4, 7, 10, 14, 17, 21],
    min:  [0, 3, 7, 10, 14, 17, 21],
    hdim: [0, 3, 6, 10, 14, 17, 20],
    dim:  [0, 3, 6, 9, 14, 17, 20],
  };

  // Teclas negras en función DIATÓNICA → intercambio modal / dominantes de paso
  const CHROMATIC = {
    major: [ { q: 'maj', fn: 'napolitano' }, { q: 'maj', fn: 'intercambio modal' },
             { q: 'hdim', fn: 'de paso' },   { q: 'maj', fn: 'intercambio modal' },
             { q: 'maj', fn: 'intercambio modal' } ],
    minor: [ { q: 'maj', fn: 'napolitano' }, { q: 'dim', fn: 'sensible de iv' },
             { q: 'dim', fn: 'sensible de V' }, { q: 'hdim', fn: 'de paso' },
             { q: 'dim', fn: 'sensible' } ],
  };

  const FUNCTION_OF_DEGREE = {
    major: ['tónica', 'subdominante', 'tónica', 'subdominante', 'dominante', 'tónica', 'dominante'],
    minor: ['tónica', 'subdominante', 'tónica', 'subdominante', 'dominante', 'subdominante', 'subtónica'],
  };

  const mod = (n, m) => ((n % m) + m) % m;

  function chromaticRoots(mode) {
    const s = SCALES[mode];
    const out = [];
    for (let i = 0; i < 12; i++) if (!s.includes(i)) out.push(i);
    return out; // major: 1,3,6,8,10 · minor: 1,4,6,9,11
  }

  /** Acorde diatónico apilado por terceras sobre el grado `deg` (0..6). */
  function diatonicStack(mode, deg) {
    const s = SCALES[mode];
    const iv = [];
    for (let k = 0; k < 7; k++) {
      const step = deg + 2 * k;
      iv.push(s[step % 7] + 12 * Math.floor(step / 7) - s[deg]);
    }
    // Menor armónica en la dominante: V se vuelve mayor (relación tónica–dominante)
    if (mode === 'minor' && deg === 4) iv[1] = 4;
    return iv;
  }

  /** Aplica el dial de extensiones (0 tríada … 4 trecena) y el sus. */
  function applyExtensions(intervals, ext, sus) {
    let iv = intervals.slice(0, 3 + ext);
    const third = iv[1];
    const has = (x) => iv.includes(x);
    if (ext >= 3 && third === 4 && has(17)) iv = iv.filter((x) => x !== 4);    // 11 natural sobre mayor → sin 3ª
    if (ext >= 4 && iv[3] === 10 && has(17)) iv = iv.filter((x) => x !== 17);  // dom13 → sin 11
    if (sus) iv = iv.map((x) => (x === 3 || x === 4 ? (sus === 2 ? 2 : 5) : x));
    return [...new Set(iv)].sort((a, b) => a - b);
  }

  function nameChord(rootPc, iv, useFlats) {
    const names = useFlats ? FLAT : SHARP;
    const root = names[mod(rootPc, 12)];
    const find = (arr) => arr.find((x) => iv.includes(x));
    const third = find([3, 4]);
    const fifth = find([6, 7, 8]);
    const seventh = find([9, 10, 11]);
    const ninth = find([13, 14, 15]);
    const eleventh = find([17, 18]);
    const thirteenth = find([20, 21]);
    const sus = iv.includes(2) && !third ? 'sus2' : iv.includes(5) && !third ? 'sus4' : '';

    let qual = '';
    if (third === 3 && fifth === 6) qual = seventh === 10 ? 'ø' : '°';
    else if (third === 3) qual = 'm';
    else if (third === 4 && fifth === 8) qual = '+';

    let top = '';
    if (thirteenth) top = '13';
    else if (eleventh) top = '11';
    else if (ninth) top = '9';
    else if (seventh) top = '7';

    let name = root + qual;
    if (top) {
      if (seventh === 11) name += 'maj';
      else if (seventh === 9 && qual === '°') name += '';
      name += top;
    }
    if (sus) name += sus;
    const alt = [];
    if (ninth === 13) alt.push('♭9');
    if (ninth === 15) alt.push('♯9');
    if (eleventh === 18 && (seventh || top)) alt.push('♯11');
    if (thirteenth === 20) alt.push('♭13');
    if (alt.length) name += alt.join('');
    return name;
  }

  function romanOf(rootPc, key, mode, iv) {
    const dist = mod(rootPc - key, 12);
    const s = SCALES[mode];
    const minorish = iv[1] === 3 || (!iv.includes(4) && iv.includes(3));
    const dim = iv.includes(6) && !iv.includes(7);
    const dimMark = dim ? '°' : '';
    const degIdx = s.indexOf(dist);
    let num;
    if (degIdx >= 0) num = ROMAN[degIdx];
    else if (mode === 'major') num = { 1: '♭II', 3: '♭III', 6: '♯IV', 8: '♭VI', 10: '♭VII' }[dist];
    else num = { 1: '♭II', 4: '♯III', 6: '♯IV', 9: '♯VI', 11: 'VII' }[dist];
    if (minorish) num = num.replace(/[IV]+/, (m) => m.toLowerCase());
    return num + dimMark;
  }

  /**
   * Construye el acorde según el estado del panel.
   * @param {object} st  { key, mode, keyIndex, func, ext, sus, inversion, voicing, octave }
   */
  function buildChord(st) {
    const mode = st.mode;
    const slot = LAYOUT[st.keyIndex];
    const useFlats = FLAT_KEYS[mode].includes(st.key);
    let rootPc, intervals, fn;

    if (st.func === 'dominant') {
      rootPc = slot.black ? chromaticRoots(mode)[slot.idx] : SCALES[mode][slot.deg];
      intervals = QUAL.dom.slice();
      if (!slot.black) {
        const target = mod(slot.deg + 3, 7);
        fn = slot.deg === 4 ? 'dominante' : 'V7/' + ROMAN[target].toLowerCase();
      } else fn = 'sustituto tritonal';
    } else if (st.func === 'dim') {
      rootPc = slot.black ? chromaticRoots(mode)[slot.idx] : SCALES[mode][slot.deg];
      intervals = QUAL.dim.slice();
      fn = 'disminuido de paso';
    } else if (slot.black) {
      const spec = CHROMATIC[mode][slot.idx];
      rootPc = chromaticRoots(mode)[slot.idx];
      intervals = QUAL[spec.q].slice();
      fn = spec.fn;
    } else {
      rootPc = SCALES[mode][slot.deg];
      intervals = diatonicStack(mode, slot.deg);
      fn = FUNCTION_OF_DEGREE[mode][slot.deg];
    }
    rootPc = mod(rootPc + st.key, 12);
    const iv = applyExtensions(intervals, st.ext, st.sus);
    const name = nameChord(rootPc, iv, useFlats);
    const roman = romanOf(rootPc, st.key, mode, iv);
    const notes = voice(rootPc, iv, st);
    const pcs = iv.map((i) => mod(rootPc + i, 12));
    return { rootPc, intervals: iv, name, roman, fn, notes, pcs, useFlats };
  }

  function voice(rootPc, iv, st) {
    let rootMidi = 48 + rootPc;
    if (rootMidi < 55) rootMidi += 12; // fundamental entre G3 y F♯4
    let n = iv.map((i) => rootMidi + i);
    for (let k = 0; k < st.inversion && n.length > 1; k++) {
      n.sort((a, b) => a - b);
      n[0] += 12;
    }
    n.sort((a, b) => a - b);
    const L = n.length;
    switch (st.voicing) {
      case 'drop2': if (L >= 3) n[L - 2] -= 12; break;
      case 'open':  if (L >= 3) n[L - 2] -= 12; if (L >= 4) n[L - 4] -= 12; break;
      case 'wide':  n[0] -= 12; if (L >= 3) n[L - 1] += 12; break;
      default: break;
    }
    n = n.map((x) => x + 12 * st.octave).map((x) => Math.min(108, Math.max(24, x)));
    return [...new Set(n)].sort((a, b) => a - b);
  }

  /** Nota de bajo: fundamental o alternativa (5ª del acorde, o 3ª si no hay 5ª justa). */
  function bassNote(chord, alt) {
    const root = chord.rootPc + 36; // C2..B2
    if (!alt) return root;
    const fifth = chord.intervals.find((x) => x === 7 || x === 6 || x === 8);
    const third = chord.intervals.find((x) => x === 3 || x === 4);
    const i = fifth != null ? fifth : third != null ? third : 12;
    return root + i;
  }

  function midiName(m, useFlats) {
    const names = useFlats ? FLAT : SHARP;
    return names[mod(m, 12)] + (Math.floor(m / 12) - 1);
  }

  function keyName(key, mode) {
    const useFlats = FLAT_KEYS[mode].includes(key);
    return (useFlats ? FLAT : SHARP)[key] + (mode === 'minor' ? 'm' : '');
  }

  function degreeLabels(mode) {
    return LAYOUT.map((slot) => {
      if (slot.black) return CHROMATIC[mode][slot.idx].q === 'maj' ? '♭' : '°';
      const iv = diatonicStack(mode, slot.deg);
      const r = ROMAN[slot.deg];
      const dim = iv[2] === 6;
      return (iv[1] === 3 ? r.toLowerCase() : r) + (dim ? '°' : '');
    });
  }

  global.Theory = { SHARP, FLAT, SCALES, LAYOUT, buildChord, bassNote, midiName, keyName, degreeLabels, chromaticRoots, mod };
})(window);
