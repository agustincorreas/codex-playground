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
      let row = rows[i];
      // "Intro: Am Dm E Am" / "Solo: ( C G )" → encabezado de sección + línea de acordes
      const lm = /^\s*([A-Za-zÁ-úñÑ][A-Za-zÁ-úñÑ0-9 ]{1,24}?)\s*:\s*(.+)$/.exec(row);
      if (lm && isChordLine(lm[2].replace(/[()|]/g, ' '))) {
        out.push(`[${lm[1].trim()}]`, lm[2].replace(/[()|]/g, ' ').trim().split(/\s+/).map(c => `[${c}]`).join(' '));
        continue;
      }
      if (/^\s*\(.*\)\s*$/.test(row) && isChordLine(row.replace(/[()]/g, ' '))) row = row.replace(/[()]/g, ' ');
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

  // ---------------------------------------------------------------------------
  // Acordes sobre la letra, automáticos y por alineación.
  // ---------------------------------------------------------------------------
  function normText(str) { return (str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function dice(a, b) {
    const A = normText(a).split(' ').filter(Boolean), B = normText(b).split(' ').filter(Boolean);
    if (!A.length || !B.length) return 0;
    const setB = new Map(); B.forEach(w => setB.set(w, (setB.get(w) || 0) + 1));
    let inter = 0; for (const w of A) { const c = setB.get(w) || 0; if (c) { inter++; setB.set(w, c - 1); } }
    return 2 * inter / (A.length + B.length);
  }
  function fmtLine(time, body) { return time != null ? `[${formatTime(time)}] ${body}` : body; }

  /**
   * Toma un cifrado (inline o recién convertido de "acordes arriba") y le asigna a cada
   * línea de letra el tiempo de la línea más parecida del LRC (letra sincronizada).
   * Devuelve { text, matched, total }.
   */
  function alignToTimes(chartText, lrcText) {
    const target = parse(lrcText || '').lines.filter(l => l.type === 'line' && l.time != null && l.text && l.text !== '♪');
    const rows = (chartText || '').replace(/\r\n?/g, '\n').split('\n');
    let ti = 0, matched = 0, total = 0;
    const out = [];
    for (const raw of rows) {
      const stripped = raw.replace(/^\s*\[\d+:\d{1,2}(?:\.\d+)?\]\s?/, '');
      const trimmed = stripped.trim();
      const isDirective = /^\{[^}]*\}$/.test(trimmed);
      const isHeader = /^\[([^\]]+)\]$/.test(trimmed) && !isChord(trimmed.slice(1, -1));
      const plain = stripped.replace(/\[[^\]]*\]/g, '').trim();
      if (!trimmed || isDirective || isHeader || plain.length < 3 || /^(intro|solo|puente|final|outro|coro|estribillo|verso)\s*:?$/i.test(plain)) { out.push(stripped); continue; }
      total++;
      let best = -1, bestScore = 0;
      for (let j = ti; j < Math.min(target.length, ti + 10); j++) {
        const sc = dice(plain, target[j].text);
        if (sc > bestScore) { bestScore = sc; best = j; }
      }
      if (best >= 0 && bestScore >= 0.5) { out.push(fmtLine(target[best].time, stripped)); ti = best + 1; matched++; }
      else out.push(stripped);
    }
    return { text: out.join('\n'), matched, total };
  }

  /**
   * Genera un cifrado con acordes inline a partir de la letra sincronizada (LRC) y las
   * progresiones por sección del catálogo. Es aproximado: detecta el estribillo por
   * líneas repetidas, corta secciones por silencios largos y reparte los acordes de la
   * progresión a lo largo de cada línea.
   */
  function autoChart(lrcText, sections) {
    const lines = parse(lrcText || '').lines.filter(l => l.type === 'line' && l.text && l.text !== '♪');
    const secs = (sections || []).map(s => ({ name: normText(s.name), chords: (s.chords || '').split(/\s+/).filter(isChord) })).filter(s => s.chords.length);
    if (!lines.length || !secs.length) return null;
    const find = (...keys) => { for (const k of keys) { const s = secs.find(x => x.name.startsWith(k)); if (s) return s.chords; } return null; };
    const verse = find('verso', 'estrofa', 'verse') || secs[0].chords;
    const chorus = find('estribillo', 'coro', 'chorus') || verse;
    const pre = find('pre');
    const intro = find('intro');
    const solo = find('solo', 'puente', 'bridge', 'interludio');
    const outro = find('final', 'outro');

    // Estribillo = líneas cuyo texto se repite en el tema.
    const counts = {};
    lines.forEach(l => { const n = normText(l.text); if (n.length > 8) counts[n] = (counts[n] || 0) + 1; });
    const isChorusLine = (l) => (counts[normText(l.text)] || 0) >= 2;

    // Bloques: cortar por silencios largos o por cambio verso/estribillo.
    const blocks = [];
    let cur = null;
    lines.forEach((l, i) => {
      const prev = lines[i - 1];
      const gap = prev && l.time != null && prev.time != null ? l.time - prev.time : 0;
      const ch = isChorusLine(l);
      if (!cur || gap > 7 || ch !== cur.chorus) { cur = { chorus: ch, lines: [], gapBefore: gap }; blocks.push(cur); }
      cur.lines.push(l);
    });

    const bracket = (arr) => arr.map(c => `[${c}]`).join(' ');
    const out = [];
    const first = lines[0].time || 0;
    if (intro && first > 4) { out.push('[Intro]', fmtLine(0, bracket(intro)), ''); }
    let lastEnd = first;
    let verseNo = 0;
    blocks.forEach((b, bi) => {
      const start = b.lines[0].time;
      if (bi > 0 && b.gapBefore > 14 && solo && start != null) { out.push('[Solo]', fmtLine(lastEnd + 2, bracket(solo)), ''); }
      let prog = b.chorus ? chorus : verse;
      if (!b.chorus && pre && bi + 1 < blocks.length && blocks[bi + 1].chorus && b.lines.length <= 2) prog = pre;
      out.push(b.chorus ? '[Estribillo]' : prog === pre ? '[Pre-estribillo]' : `[Verso ${++verseNo}]`);
      let ci = 0;
      for (const l of b.lines) {
        const words = l.text.split(/\s+/).filter(Boolean);
        const per = prog.length >= 2 && words.length >= 5 ? 2 : 1;
        let body = '';
        for (let k = 0; k < per; k++) {
          const from = Math.round(k * words.length / per), to = Math.round((k + 1) * words.length / per);
          body += (k ? ' ' : '') + `[${prog[ci % prog.length]}]` + words.slice(from, to).join(' ');
          ci++;
        }
        out.push(fmtLine(l.time, body));
      }
      out.push('');
      lastEnd = b.lines[b.lines.length - 1].time || lastEnd;
    });
    if (outro) out.push('[Final]', fmtLine(lastEnd + 3, bracket(outro)));
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  window.Chart = {
    parse, serialize, activeLineIndex, parseChord, isChord, isTimestamp, parseTime, formatTime, formatClock,
    transposeChord, transposeKey, useFlats, convertChordsOverLyrics, uniqueChords, alignToTimes, autoChart, normText, SHARPS, FLATS,
  };
})();
