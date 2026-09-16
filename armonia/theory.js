/* ==========================================================================
   ARMONÍA · motor de acordes (modelo Orchid)
   tecla = fundamental · tipo (maj/min/sus/dim) · modificadores (6, m7, M7, 9)
   voicing = cascada de inversiones nota a nota
   ========================================================================== */
(function (global) {
  'use strict';

  const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const FLAT  = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  const FLAT_ROOTS = [1, 3, 5, 8, 10]; // D♭ E♭ F A♭ B♭ se escriben con bemol

  const TYPES = {
    maj: { iv: [0, 4, 7], sym: '',     name: 'Major' },
    min: { iv: [0, 3, 7], sym: 'm',    name: 'Minor' },
    sus: { iv: [0, 5, 7], sym: 'sus4', name: 'Sus' },
    dim: { iv: [0, 3, 6], sym: '°',    name: 'Dim' },
  };
  const MODS = { '6': 9, 'm7': 10, 'M7': 11, '9': 14 };
  const mod = (n, m) => ((n % m) + m) % m;

  function intervalsFor(type, mods) {
    const iv = TYPES[type].iv.slice();
    for (const m in MODS) if (mods[m]) iv.push(MODS[m]);
    return [...new Set(iv)].sort((a, b) => a - b);
  }

  function nameFor(rootPc, type, mods) {
    const root = (FLAT_ROOTS.includes(rootPc) ? FLAT : SHARP)[rootPc];
    const has6 = !!mods['6'], m7 = !!mods['m7'], M7 = !!mods['M7'], has9 = !!mods['9'];
    let core = TYPES[type].sym, ext = '';

    if (type === 'dim') {
      if (m7 && !has6) core = 'ø';            // semidisminuido
      else if (has6) core = '°';
      let s = '';
      if (has6 && m7) s = '7(♭♭7)';
      else if (has6) s = '7';
      else if (m7) s = '7';
      if (M7) s += 'maj7';
      if (has9) s += has6 || m7 ? '(9)' : 'add9';
      return root + core + s;
    }

    let seventh = M7 ? 'maj7' : m7 ? '7' : '';
    if (M7 && m7) seventh = 'maj7(♭7)';
    if (has9) {
      if (seventh && !(M7 && m7)) seventh = seventh.replace('7', '9');
      else if (!seventh) ext = has6 ? '6/9' : 'add9';
      else ext = '(9)';
    }
    if (has6 && !(has9 && !seventh)) {
      if (seventh) seventh = seventh.replace(/9$/, '13').replace(/7$/, '7(13)');
      else ext = '6' + ext;
    }
    if (type === 'sus') return root + seventh + ext + 'sus4';
    return root + core + seventh + ext;
  }

  /**
   * @param {object} st { root (0-11), type, mods {6,m7,M7,9}, voicing (int), octave (int) }
   */
  function buildChord(st) {
    const rootPc = mod(st.root, 12);
    const iv = intervalsFor(st.type, st.mods);
    let n = iv.map((i) => 48 + rootPc + i + 12 * (st.octave || 0));
    const v = st.voicing || 0;
    for (let k = 0; k < Math.abs(v); k++) {
      n.sort((a, b) => a - b);
      if (v > 0) n[0] += 12; else n[n.length - 1] -= 12;
    }
    n = n.map((x) => Math.min(108, Math.max(24, x))).sort((a, b) => a - b);
    return {
      rootPc, intervals: iv, notes: [...new Set(n)],
      pcs: iv.map((i) => mod(rootPc + i, 12)),
      name: nameFor(rootPc, st.type, st.mods),
      typeName: TYPES[st.type].name,
      useFlats: FLAT_ROOTS.includes(rootPc),
    };
  }

  function bassNote(chord, alt) {
    const root = 36 + chord.rootPc;
    return alt ? root + (chord.intervals.includes(7) ? 7 : chord.intervals[1]) : root;
  }
  function midiName(m, useFlats) { return (useFlats ? FLAT : SHARP)[mod(m, 12)] + (Math.floor(m / 12) - 1); }

  global.Theory = { SHARP, FLAT, TYPES, MODS, buildChord, bassNote, midiName, mod };
})(window);
