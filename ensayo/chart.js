// chart.js — parser de cifrados (ChordPro + timestamps LRC) y transposición.
// Sin dependencias. Expone window.Chart.
(function () {
  'use strict';

  const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm', 'Abm']);

  const CHORD_RE = /^([A-G](?:#|b)?)([^/\s]*)(?:\/([A-G](?:#|b)?))?$/;
  const TIME_RE = /^(\d+):(\d{1,2}(?:\.\d+)?)$/;
  const TOKEN_RE = /\[([^\]]*)\]/g;

  function noteIndex(note) {
    let i = SHARPS.indexOf(note);
    if (i < 0) i = FLATS.indexOf(note);
    if (i < 0 && note === 'Cb') i = 11;
    if (i < 0 && note === 'Fb') i = 4;
    if (i < 0 && note === 'E#') i = 5;
    if (i < 0 && note === 'B#') i = 0;
    return i;
  }

  function parseChord(s) {
    if (!s) return null;
    const m = CHORD_RE.exec(s.trim());
    if (!m) return null;
    if (noteIndex(m[1]) < 0) return null;
    // Evitar falsos positivos tipo "Am I..." — la calidad tiene que ser un sufijo típico.
    if (m[2] && !/^(?:maj|min|dim|aug|sus|add|m|M|°|ø|Δ|\+|-|#|b|\d|\(|\)|\.)*$/.test(m[2])) return null;
    return { root: m[1], quality: m[2] || '', bass: m[3] || null };
  }

  function isChord(s) { return parseChord(s) !== null; }
  function isTimestamp(s) { return TIME_RE.test(s.trim()); }

  function parseTime(s) {
    const m = TIME_RE.exec(s.trim());
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseFloat(m[2]);
  }

  function formatTime(t, decimals = 2) {
    if (t == null || isNaN(t)) return '';
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    const str = decimals ? s.toFixed(decimals) : String(Math.floor(s));
    return `${m}:${(s < 10 ? '0' : '') + str}`;
  }

  function formatClock(t) {
    if (t == null || isNaN(t)) return '0:00';
    t = Math.max(0, Math.floor(t));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  function useFlats(key) {
    if (!key) return false;
    return FLAT_KEYS.has(key.replace(/maj|min|M$/, '')) || /b/.test(key);
  }

  function transposeNote(note, semitones, flats) {
    const i = noteIndex(note);
    if (i < 0) return note;
    const j = ((i + semitones) % 12 + 12) % 12;
    return (flats ? FLATS : SHARPS)[j];
  }

  function transposeChord(chord, semitones, flats) {
    if (!semitones) return chord;
    const c = parseChord(chord);
    if (!c) return chord;
    let out = transposeNote(c.root, semitones, flats) + c.quality;
    if (c.bass) out += '/' + transposeNote(c.bass, semitones, flats);
    return out;
  }

  function transposeKey(key, semitones) {
    if (!key) return key;
    const m = /^([A-G](?:#|b)?)(.*)$/.exec(key.trim());
    if (!m) return key;
    // Preferimos la ortografía "natural" de la tonalidad destino.
    const cand = transposeNote(m[1], semitones, false) + m[2];
    const candFlat = transposeNote(m[1], semitones, true) + m[2];
    if (FLAT_KEYS.has(candFlat) || FLAT_KEYS.has(candFlat.replace(/m$/, ''))) return candFlat;
    // Tonalidades enarmónicas raras (ej. A#) → usar bemol.
    if (/^(A#|D#|G#|C#|F#)$/.test(cand) && !/m/.test(m[2])) return candFlat;
    return cand;
  }

  const SECTION_ALIASES = {
    chorus: 'Estribillo', verse: 'Verso', bridge: 'Puente', intro: 'Intro', outro: 'Final',
    solo: 'Solo', pre_chorus: 'Pre-estribillo', prechorus: 'Pre-estribillo', interlude: 'Interludio',
    tab: 'Tab', grid: 'Grilla',
  };

  /**
   * Parsea texto ChordPro (con timestamps LRC opcionales al inicio de línea).
   * Devuelve { meta, lines, sections }.
   * line = { type: 'line'|'section'|'comment'|'blank'|'tab', time, section, segments:[{chord,text}], text }
   */
  function parse(text) {
    const meta = {};
    const lines = [];
    const sections = [];
    let currentSection = null;
    let inTab = false;

    const rows = (text || '').replace(/\r\n?/g, '\n').split('\n');
    for (let raw of rows) {
      const line = raw.replace(/\t/g, '    ');
      const trimmed = line.trim();

      // Directivas {x: y}
      const dm = /^\{([^:}]+)(?::\s*(.*))?\}$/.exec(trimmed);
      if (dm) {
        const name = dm[1].trim().toLowerCase().replace(/-/g, '_');
        const val = (dm[2] || '').trim();
        if (['title', 't'].includes(name)) meta.title = val;
        else if (['subtitle', 'st', 'artist'].includes(name)) meta.artist = val;
        else if (name === 'key') meta.key = val;
        else if (['tempo', 'bpm'].includes(name)) meta.bpm = parseFloat(val) || undefined;
        else if (name === 'capo') meta.capo = parseInt(val, 10) || 0;
        else if (name === 'time') meta.time = val;
        else if (['c', 'comment', 'ci', 'comment_italic', 'cb', 'comment_box'].includes(name)) {
          lines.push({ type: 'comment', text: val, section: currentSection });
        } else if (name.startsWith('start_of_') || /^so[a-z]$/.test(name)) {
          const kind = name.startsWith('start_of_') ? name.slice(9) : ({ soc: 'chorus', sov: 'verse', sob: 'bridge', sot: 'tab' })[name] || name.slice(2);
          const label = val || SECTION_ALIASES[kind] || kind;
          inTab = kind === 'tab';
          currentSection = { label, kind, index: sections.length, time: null };
          sections.push(currentSection);
          lines.push({ type: 'section', text: label, section: currentSection });
        } else if (name.startsWith('end_of_') || /^eo[a-z]$/.test(name)) {
          inTab = false;
          currentSection = null;
        } else if (name === 'section') {
          currentSection = { label: val, kind: val.toLowerCase(), index: sections.length, time: null };
          sections.push(currentSection);
          lines.push({ type: 'section', text: val, section: currentSection });
        }
        continue;
      }

      if (trimmed === '') { lines.push({ type: 'blank', section: currentSection }); continue; }

      // Encabezado estilo Ultimate Guitar: [Verse 1] / [Estribillo]
      const hm = /^\[([^\]]+)\]$/.exec(trimmed);
      if (hm && !isChord(hm[1]) && !isTimestamp(hm[1])) {
        const label = hm[1].trim();
        currentSection = { label, kind: label.toLowerCase(), index: sections.length, time: null };
        sections.push(currentSection);
        lines.push({ type: 'section', text: label, section: currentSection });
        continue;
      }

      if (inTab) { lines.push({ type: 'tab', text: line, section: currentSection }); continue; }

      // Línea normal: [mm:ss.xx] opcional + segmentos [Acorde]texto
      let time = null;
      let body = line;
      const tm = /^\s*\[(\d+:\d{1,2}(?:\.\d+)?)\]\s?/.exec(body);
      if (tm) { time = parseTime(tm[1]); body = body.slice(tm[0].length); }

      const segments = [];
      let last = 0, m;
      let pendingChord = null;
      TOKEN_RE.lastIndex = 0;
      while ((m = TOKEN_RE.exec(body)) !== null) {
        const before = body.slice(last, m.index);
        if (before.length || pendingChord !== null) segments.push({ chord: pendingChord, text: before });
        pendingChord = m[1];
        last = m.index + m[0].length;
      }
      const tail = body.slice(last);
      if (tail.length || pendingChord !== null) segments.push({ chord: pendingChord, text: tail });
      if (!segments.length) segments.push({ chord: null, text: body });

      const plain = segments.map(s => s.text).join('').trim();
      const l = { type: 'line', time, section: currentSection, segments, text: plain,
        hasChords: segments.some(s => s.chord), hasLyrics: plain.length > 0 };
      if (currentSection && currentSection.time == null && time != null) currentSection.time = time;
      lines.push(l);
    }

    // Índices de líneas con tiempo, para búsqueda rápida.
    const timed = [];
    lines.forEach((l, i) => { if (l.type === 'line' && l.time != null) timed.push({ time: l.time, index: i }); });
    timed.sort((a, b) => a.time - b.time);

    return { meta, lines, sections, timed };
  }

  /** Índice de la línea activa para el tiempo t (última línea con time <= t). */
  function activeLineIndex(parsed, t) {
    const arr = parsed.timed;
    if (!arr.length) return -1;
    let lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans < 0 ? -1 : arr[ans].index;
  }

  /** Serializa de nuevo a ChordPro (para guardar tras editar tiempos). */
  function serialize(parsed, originalText) {
    // Estrategia simple: recorrer el texto original y reemplazar/insertar timestamps por línea.
    const rows = (originalText || '').replace(/\r\n?/g, '\n').split('\n');
    let li = 0;
    const out = [];
    for (const raw of rows) {
      const trimmed = raw.trim();
      const isDirective = /^\{[^}]*\}$/.test(trimmed);
      const isHeader = /^\[([^\]]+)\]$/.test(trimmed) && !isChord(trimmed.slice(1, -1)) && !isTimestamp(trimmed.slice(1, -1));
      if (isDirective) {
        if (/^\{(c|comment|ci|cb|comment_italic|comment_box|start_of_|so[a-z]|section)/i.test(trimmed)) li++;
        out.push(raw); continue;
      }
      if (trimmed === '' || isHeader) { li++; out.push(raw); continue; }
      const l = parsed.lines[li++];
      if (!l || l.type !== 'line') { out.push(raw); continue; }
      const stripped = raw.replace(/^\s*\[\d+:\d{1,2}(?:\.\d+)?\]\s?/, '');
      out.push(l.time != null ? `[${formatTime(l.time)}] ${stripped}` : stripped);
    }
    return out.join('\n');
  }

  /**
   * Convierte el formato "acordes arriba de la letra" (Ultimate Guitar, LaCuerda)
   * a ChordPro con acordes inline. Deja igual lo que ya está inline.
   */
  function convertChordsOverLyrics(text) {
    const rows = (text || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    const isChordLine = (s) => {
      const toks = s.trim().split(/\s+/).filter(Boolean);
      return toks.length > 0 && toks.every(t => isChord(t) || /^(N\.?C\.?|%|\||x\d+)$/i.test(t));
    };
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!isChordLine(row) || /\[[^\]]+\]/.test(row)) { out.push(row); continue; }
      const next = rows[i + 1];
      const nextIsLyric = next != null && next.trim() !== '' && !isChordLine(next) && !/^\{|^\[/.test(next.trim());
      const chords = [];
      const re = /\S+/g; let m;
      while ((m = re.exec(row)) !== null) chords.push({ col: m.index, chord: m[0] });
      if (!nextIsLyric) {
        out.push(chords.map(c => `[${c.chord}]`).join(' '));
        continue;
      }
      let lyric = next.padEnd(chords[chords.length - 1].col + 1, ' ');
      let result = '';
      let pos = 0;
      for (const c of chords) {
        let col = c.col;
        // Si el acorde cae sobre un espacio, lo pegamos a la palabra siguiente.
        while (col > pos && col < lyric.length && lyric[col] === ' ' && lyric[col - 1] === ' ') col++;
        if (col < lyric.length && lyric[col] === ' ' && col + 1 < lyric.length && lyric[col + 1] !== ' ') col++;
        result += lyric.slice(pos, col) + `[${c.chord}]`;
        pos = col;
      }
      result += lyric.slice(pos);
      out.push(result.replace(/\s+$/, ''));
      i++;
    }
    return out.join('\n');
  }

  /** Lista de acordes únicos en orden de aparición. */
  function uniqueChords(parsed) {
    const seen = [];
    for (const l of parsed.lines) if (l.type === 'line') for (const s of l.segments) {
      if (s.chord && isChord(s.chord) && !seen.includes(s.chord)) seen.push(s.chord);
    }
    return seen;
  }

  window.Chart = {
    parse, serialize, activeLineIndex, parseChord, isChord, isTimestamp, parseTime, formatTime, formatClock,
    transposeChord, transposeKey, useFlats, convertChordsOverLyrics, uniqueChords, SHARPS, FLATS,
  };
})();
