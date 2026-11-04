/* ==========================================================================
   THE SOUND OF MONEY · teoría musical: modos, escalas, acordes y nombres
   ========================================================================== */
(function (g) {
  'use strict';

  const NOTAS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const mod = (n, m) => ((n % m) + m) % m;

  // Ordenados de más oscuro a más luminoso. `animo` es lo que muestra la pantalla.
  const MODOS = {
    locrio:    { nombre: 'Locrio',          iv: [0, 1, 3, 5, 6, 8, 10], animo: 'inestable',    brillo: 0 },
    frigio:    { nombre: 'Frigio',          iv: [0, 1, 3, 5, 7, 8, 10], animo: 'sombrío',      brillo: 1 },
    eolico:    { nombre: 'Eólico (menor)',  iv: [0, 2, 3, 5, 7, 8, 10], animo: 'melancólico',  brillo: 2 },
    dorico:    { nombre: 'Dórico',          iv: [0, 2, 3, 5, 7, 9, 10], animo: 'suspendido',   brillo: 3 },
    mixolidio: { nombre: 'Mixolidio',       iv: [0, 2, 4, 5, 7, 9, 10], animo: 'cálido',       brillo: 4 },
    jonico:    { nombre: 'Jónico (mayor)',  iv: [0, 2, 4, 5, 7, 9, 11], animo: 'sereno',       brillo: 5 },
    lidio:     { nombre: 'Lidio',           iv: [0, 2, 4, 6, 7, 9, 11], animo: 'luminoso',     brillo: 6 },
  };
  const ORDEN = ['locrio', 'frigio', 'eolico', 'dorico', 'mixolidio', 'jonico', 'lidio'];

  function masBrillante(modo, pasos = 1) {
    const i = Math.min(ORDEN.length - 1, Math.max(0, ORDEN.indexOf(modo) + pasos));
    return ORDEN[i];
  }
  function masOscuro(modo, pasos = 1) { return masBrillante(modo, -pasos); }

  /** Semitonos desde la raíz para el grado `idx` de la escala (idx puede ser negativo o pasar la octava). */
  function grado(modo, idx) {
    const iv = MODOS[modo].iv, n = iv.length;
    return Math.floor(idx / n) * 12 + iv[mod(idx, n)];
  }

  /** Índice de escala más cercano a un número de semitonos (para "cuantizar" a la escala). */
  function cuantizar(modo, semitonos) {
    const iv = MODOS[modo].iv, n = iv.length;
    const oct = Math.floor(semitonos / 12), rel = semitonos - oct * 12;
    let mejor = 0, dist = 99;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(iv[i] - rel);
      if (d < dist) { dist = d; mejor = i; }
    }
    return oct * n + mejor;
  }

  /** Acorde por terceras sobre el grado `g` del modo: devuelve semitonos desde la raíz del modo. */
  function acorde(modo, g, voces = 3) {
    const out = [];
    for (let i = 0; i < voces; i++) out.push(grado(modo, g + 2 * i));
    return out;
  }

  /** Nombre del acorde a partir de sus semitonos relativos a la raíz del modo. */
  function nombreAcorde(raizPc, semis) {
    const base = semis[0];
    const rel = semis.map((s) => mod(s - base, 12));
    const tiene = (x) => rel.includes(x);
    let cal;
    if (tiene(4) && tiene(8)) cal = '+';
    else if (tiene(3) && tiene(6)) cal = tiene(10) ? 'ø' : '°';
    else if (tiene(3)) cal = 'm';
    else if (tiene(4)) cal = '';
    else if (tiene(5)) cal = 'sus4';
    else cal = '';
    let ext = '';
    if (tiene(11)) ext = cal === 'm' ? 'maj7' : 'maj7';
    else if (tiene(10)) ext = cal === 'ø' ? '7' : '7';
    if (tiene(2) && semis.length >= 5) ext += ext ? '(9)' : 'add9';
    if (tiene(9) && semis.length >= 5 && !ext) ext = '6';
    if (cal === 'ø') return NOTAS[mod(raizPc + base, 12)] + 'ø7';
    return NOTAS[mod(raizPc + base, 12)] + cal + ext;
  }

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const nombreNota = (midi) => NOTAS[mod(midi, 12)] + (Math.floor(midi / 12) - 1);

  // Generador determinista (mulberry32): la misma vela siempre produce la misma frase.
  function rng(semilla) {
    let a = semilla >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(...xs) {
    let h = 2166136261;
    for (const x of xs) {
      const s = String(x);
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    }
    return h >>> 0;
  }

  g.Campana = g.Campana || {};
  Object.assign(g.Campana, { NOTAS, MODOS, ORDEN_MODOS: ORDEN, masBrillante, masOscuro, grado, cuantizar, acorde, nombreAcorde, mtof, nombreNota, rng, hash, mod });
})(window);
