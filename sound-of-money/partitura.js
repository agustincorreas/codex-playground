/* ==========================================================================
   THE SOUND OF MONEY · el compositor
   Cada minuto de mercado es un compás. El SPY es la orquesta (tonalidad, modo, acordes, bajo,
   pulso); la acción enfocada es el solista (instrumento por sector, registro por precio, densidad
   por volumen, modo por fuerza relativa); las demás son un coro lejano.
   ========================================================================== */
(function (g) {
  'use strict';
  const C = g.Campana;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // Grado siguiente del acorde según si la vela del SPY sube o baja (índices de grado 0..6).
  const TRANS_SUBE = { 0: [3, 4, 4, 0, 5], 1: [4, 0, 3], 2: [5, 3, 0], 3: [4, 0, 0, 4], 4: [0, 0, 5, 3], 5: [3, 4, 0, 0], 6: [0, 0, 4] };
  const TRANS_BAJA = { 0: [5, 1, 5, 3], 1: [5, 4, 3], 2: [5, 1], 3: [1, 5, 0], 4: [5, 3, 1], 5: [3, 1, 5, 0], 6: [5, 1] };
  const LEGATO = { arpegio: .7, swing: .62, tresillo: .68, rubato: 1.5, sostenido: 2.4, glitch: .33, motor: .5, ola: 1.1 };

  // Modo progresión: loops de cuatro acordes (grados 0..6) por cada ánimo del mercado.
  const PROGRESIONES = {
    lidio:     [[0, 1, 0, 1], [0, 4, 1, 3], [0, 1, 5, 4], [0, 6, 1, 0]],
    jonico:    [[0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 5, 4], [0, 2, 3, 4]],
    mixolidio: [[0, 6, 3, 0], [0, 3, 6, 3], [0, 6, 0, 4], [0, 4, 6, 3]],
    dorico:    [[0, 3, 0, 3], [0, 3, 6, 0], [0, 1, 3, 0], [0, 6, 3, 0]],
    eolico:    [[0, 5, 2, 6], [0, 5, 3, 4], [0, 3, 4, 0], [0, 6, 5, 6], [0, 2, 6, 5]],
    frigio:    [[0, 1, 0, 1], [0, 1, 6, 1], [0, 6, 1, 0], [0, 5, 1, 0]],
    locrio:    [[0, 1, 0, 5], [0, 5, 1, 0]],
  };
  const MAYOR = [0, 2, 4, 5, 7, 9, 11];
  const ROMANOS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  /** Cifrado romano del grado `gdo` en el modo: minúscula si es menor, ° disminuido, + aumentado, ♭/♯ frente a la escala mayor. */
  function romano(modo, gdo, semis) {
    const iv = C.MODOS[modo].iv[gdo], ref = MAYOR[gdo];
    const acc = iv < ref ? '♭' : iv > ref ? '♯' : '';
    const rel = semis.map((s) => C.mod(s - semis[0], 12));
    const menor = rel.includes(3), dim = menor && rel.includes(6), aug = rel.includes(4) && rel.includes(8);
    return acc + (menor ? ROMANOS[gdo].toLowerCase() : ROMANOS[gdo]) + (dim ? '°' : aug ? '+' : '');
  }

  class Compositor {
    constructor(motor, visual) {
      this.motor = motor; this.visual = visual; this.velocidad = 1; this.tProximo = 0;
      this.estilo = 'libre'; // 'libre' (ambient generativo) · 'progresion' (loop de cuatro acordes)
      this.reset();
    }
    reset() {
      this.modo = 'jonico'; this.modoCand = null; this.modoCont = 0; this.cambioModo = false;
      this.grado = 0; this.compasesAcorde = 99; this.acorde = null; this.raiz = 0; this.compasIdx = 0; this.ultimoSolista = null;
      this.prog = null; this.progPos = 0; this.progVueltas = 0;
    }
    nuevoDia(semilla) {
      this.reset();
      this.raiz = C.mod(semilla, 12);
      this.tProximo = this.motor.ahora() + .25;
    }
    /** Tempo desde la volatilidad del SPY (rango medio de la vela, en puntos básicos). */
    tempo(est) {
      const bp = (est.volat || .0005) * 1e4;
      return clamp(66 + (bp - 2) * 8, 62, 134);
    }

    /** Compone y agenda un compás. c = { m, spy:{bar, est}, solista:{sym, ficha, est, tf, k, enCurso, pan}, coro:[...], primero, ultimo, repeticion } */
    compas(c) {
      const est = c.spy.est;
      const bpm = this.tempo(est);
      const dur = (240 / bpm) / this.velocidad;
      const t0 = this.tProximo;
      const r = C.rng(C.hash(c.m, c.spy.bar ? c.spy.bar[4] : 0, this.raiz, c.repeticion || 0));
      this.actualizarModo(est);
      const acorde = this.orquesta(c, t0, dur, r);
      const sol = this.solista(c, t0, dur, r);
      this.coro(c, t0, dur, r);
      this.tProximo = t0 + dur; this.compasIdx++;
      return { t0, dur, bpm, modo: this.modo, acorde, raiz: this.raiz, solista: sol };
    }

    actualizarModo(est) {
      const s = est.pct * 100 * .65 + est.pendiente(15) * 100 * .35;
      let m;
      if (s > .55) m = 'lidio';
      else if (s > .15) m = 'jonico';
      else if (s > -.15) m = est.ultimo && est.vwap && est.ultimo[4] >= est.vwap ? 'mixolidio' : 'dorico';
      else if (s > -.55) m = 'eolico';
      else m = 'frigio';
      if (est.volat > .0022 && s < -.35) m = 'locrio';
      if (m !== this.modo) {
        if (m === this.modoCand) {
          if (++this.modoCont >= 3) { this.modo = m; this.modoCont = 0; this.modoCand = null; this.cambioModo = true; }
        } else { this.modoCand = m; this.modoCont = 1; }
      } else { this.modoCand = null; this.modoCont = 0; }
    }

    orquesta(c, t0, dur, r) {
      const bar = c.spy.bar, est = c.spy.est, beat = dur / 4, M = this.motor, V = this.visual;
      if (!bar || !est.ultimo) {
        // sin vela (pausa del mercado): sólo un soplo grave
        if (this.acorde) M.nota({ preset: 'pad', midi: this.acorde.midis[0], t: t0, dur, vel: .3, bus: 'orquesta', brillo: .2, ataque: 1.5 });
        return this.acorde;
      }
      if (this.estilo === 'progresion') return this.orquestaProgresion(c, t0, dur, r);
      const [, o, , , cl] = bar;
      const relVol = est.relVol, pctVela = cl / o - 1, sube = cl >= o;
      this.compasesAcorde++;
      const fuerte = Math.abs(pctVela) > .0012 || relVol > 2.4 || this.cambioModo;
      if (!this.acorde || this.compasesAcorde >= 2 || fuerte || c.primero) {
        const arriba = cl >= (est.vwap || cl);
        const opciones = (sube ? TRANS_SUBE : TRANS_BAJA)[this.grado] || [0];
        let gdo = c.primero ? 0 : opciones[Math.floor(r() * opciones.length)];
        if (!arriba && sube && r() < .3) gdo = 1;
        if (c.ultimo) gdo = 0;
        this.grado = gdo; this.compasesAcorde = 0;
        const voces = 3 + (relVol > 1.3 ? 1 : 0) + (relVol > 2.4 ? 1 : 0);
        const semis = C.acorde(this.modo, gdo, voces);
        const inv = Math.floor(clamp(est.posicion, 0, .999) * 3);
        const notas = semis.slice();
        for (let i = 0; i < inv; i++) notas.push(notas.shift() + 12);
        let midis = notas.map((s) => 48 + this.raiz + s);
        while (Math.min(...midis) < 50) midis = midis.map((x) => x + 12);
        while (Math.min(...midis) > 61) midis = midis.map((x) => x - 12);
        this.acorde = { grado: gdo, semis, midis, nombre: C.nombreAcorde(this.raiz, semis), modo: this.modo, nuevo: true, t: t0 };
      } else this.acorde.nuevo = false;
      this.cambioModo = false;
      const A = this.acorde;
      const brillo = clamp(.25 + relVol * .22, .2, 1);
      const n = A.midis.length;

      if (A.nuevo) {
        const durAc = dur * 2 - .15;
        A.midis.forEach((mi, i) => M.nota({ preset: 'pad', midi: mi, t: t0 + i * .035, dur: durAc, vel: .5 + .15 * est.posicion, bus: 'orquesta', pan: (i / (n - 1 || 1) - .5) * .9, brillo, ataque: 1 }));
        if (relVol > 1.5) M.nota({ preset: 'cuerdas', midi: A.midis[n - 1] + 12, t: t0 + .1, dur: durAc, vel: .28 + .1 * Math.min(relVol, 3) / 3, bus: 'orquesta', pan: .2, brillo: .6, ataque: 1.3 });
        V.evento({ tipo: 'acorde', t: t0, nombre: A.nombre, modo: this.modo, midis: A.midis, grado: A.grado });
      }

      // bajo: fundamental en el 1, quinta o fundamental en el 3, octava si hay volumen
      let bajo = 36 + this.raiz + C.grado(this.modo, A.grado);
      while (bajo < 33) bajo += 12; while (bajo > 46) bajo -= 12;
      const quinta = C.grado(this.modo, A.grado + 4) - C.grado(this.modo, A.grado);
      const velB = .55 + .25 * Math.min(relVol, 2) / 2;
      M.nota({ preset: 'bajo', midi: bajo, t: t0, dur: beat * 1.8, vel: velB, bus: 'orquesta' });
      M.nota({ preset: 'bajo', midi: sube ? bajo + quinta : bajo, t: t0 + 2 * beat, dur: beat * 1.6, vel: velB * .85, bus: 'orquesta' });
      if (relVol > 1.6) M.nota({ preset: 'bajo', midi: bajo + 12, t: t0 + 3.5 * beat, dur: beat * .4, vel: velB * .6, bus: 'orquesta' });

      // pulso: latido suave siempre; más capas cuanto más volumen
      const fuerza = clamp(relVol / 3, .15, 1);
      for (let b = 0; b < 4; b++) {
        const tb = t0 + b * beat;
        if (b % 2 === 0) M.percusion('latido', tb, .45 + .4 * fuerza);
        else if (relVol > 1.1) M.percusion('bombo', tb, .25 * fuerza);
        V.evento({ tipo: 'pulso', t: tb, fuerza: b % 2 === 0 ? .6 + .4 * fuerza : .3 * fuerza });
        if (relVol > .9) M.percusion('hat', tb + beat / 2, .18 + .2 * fuerza, (b % 2 ? .4 : -.4));
        if (relVol > 2) { M.percusion('shaker', tb + beat / 4, .14, .5); M.percusion('shaker', tb + 3 * beat / 4, .14, -.5); }
      }

      this.acontecimientos(c, t0, dur, A, bajo);
      return A;
    }

    /** Campana de apertura y cierre, brillo en el máximo del día, bronces en el mínimo. */
    acontecimientos(c, t0, dur, A, bajo) {
      const est = c.spy.est, M = this.motor, V = this.visual, n = A.midis.length;
      if (c.primero) {
        [0, 7, 12, 16].forEach((s, i) => M.nota({ preset: 'campana', midi: 72 + this.raiz + s, t: t0 + i * .18, dur: 3, vel: .55, bus: 'coro', pan: (i - 1.5) / 2 }));
        V.evento({ tipo: 'apertura', t: t0 });
      }
      if (c.ultimo) {
        [0, 7, 12].forEach((s, i) => M.nota({ preset: 'campana', midi: 72 + this.raiz + s, t: t0 + dur - 1 + i * .25, dur: 5, vel: .6, bus: 'coro', pan: (i - 1) / 2 }));
        A.midis.forEach((mi, i) => M.nota({ preset: 'pad', midi: mi, t: t0 + dur, dur: 6, vel: .45, bus: 'orquesta', pan: (i / (n - 1 || 1) - .5) * .9, brillo: .4, ataque: 2 }));
        V.evento({ tipo: 'cierre', t: t0 + dur });
      }
      if (est.nuevoMax && c.m > 5) {
        M.nota({ preset: 'brillo', midi: A.midis[n - 1] + 12, t: t0, dur: dur * 1.5, vel: .35, bus: 'orquesta', pan: .3, brillo: .9 });
        V.evento({ tipo: 'maximo', t: t0, sym: 'SPY' });
      }
      if (est.nuevoMin && c.m > 5) {
        M.nota({ preset: 'bronce', midi: bajo + 12, t: t0, dur: dur * 1.2, vel: .3, bus: 'orquesta', pan: -.3, brillo: .25, ataque: 6 });
        V.evento({ tipo: 'minimo', t: t0, sym: 'SPY' });
      }
    }

    /** Voicing cerrado de un grado del modo: semitonos, midis (invertidos según la posición del precio) y nombres. */
    voicing(gdo, voces, posicion) {
      const semis = C.acorde(this.modo, gdo, voces);
      const inv = Math.floor(clamp(posicion, 0, .999) * 3);
      const notas = semis.slice();
      for (let i = 0; i < inv; i++) notas.push(notas.shift() + 12);
      let midis = notas.map((s) => 48 + this.raiz + s);
      while (Math.min(...midis) < 50) midis = midis.map((x) => x + 12);
      while (Math.min(...midis) > 61) midis = midis.map((x) => x - 12);
      return { grado: gdo, semis, midis, nombre: C.nombreAcorde(this.raiz, semis), romano: romano(this.modo, gdo, semis) };
    }

    /** Modo progresión: un loop de cuatro acordes; cada minuto avanza un acorde y el volumen decide cómo se toca. */
    orquestaProgresion(c, t0, dur, r) {
      const bar = c.spy.bar, est = c.spy.est, beat = dur / 4, M = this.motor, V = this.visual;
      const [, o, , , cl] = bar;
      const relVol = est.relVol, pctVela = cl / o - 1, sube = cl >= o;
      const lista = PROGRESIONES[this.modo] || PROGRESIONES.jonico;
      let nueva = false;
      if (!this.prog || this.prog.modo !== this.modo || (this.progPos === 0 && this.progVueltas >= 4) || c.primero) {
        // la progresión cambia con el modo o cada cuatro vueltas; con mucho volumen se eligen las más movidas
        const idx = relVol > 1.6 ? Math.min(lista.length - 1, 1 + Math.floor(r() * (lista.length - 1))) : Math.floor(r() * lista.length);
        this.prog = { modo: this.modo, grados: lista[idx] }; this.progPos = 0; this.progVueltas = 0; nueva = true;
      }
      if (c.ultimo) this.progPos = 0;
      const gdo = this.prog.grados[this.progPos];
      const voces = 3 + (relVol > 1.3 || Math.abs(pctVela) > .0012 ? 1 : 0);
      const A = this.voicing(gdo, voces, est.posicion);
      A.modo = this.modo; A.nuevo = true; A.t = t0; A.pos = this.progPos;
      A.progresion = this.prog.grados.map((g) => this.voicing(g, 3, .5));
      this.acorde = A; this.grado = gdo; this.cambioModo = false;
      const n = A.midis.length, brillo = clamp(.3 + relVol * .22, .25, 1);
      const pan = (i) => (i / (n - 1 || 1) - .5) * .8;

      // colchón suave siempre
      A.midis.forEach((mi, i) => M.nota({ preset: 'pad', midi: mi, t: t0 + i * .02, dur: dur * 1.05, vel: .3, bus: 'orquesta', pan: pan(i), brillo: brillo * .7, ataque: .8 }));
      const claro = C.MODOS[this.modo].brillo >= 4;
      if (relVol < .9) {
        // calma: acorde en bloque
        A.midis.forEach((mi, i) => M.nota({ preset: claro ? 'epiano' : 'cuerdas', midi: mi, t: t0 + i * .025, dur: dur * .95, vel: .5, bus: 'orquesta', pan: pan(i), brillo }));
      } else if (relVol < 1.8) {
        // actividad media: arpegio en corcheas, subiendo y bajando
        const sec = [...A.midis, A.midis[0] + 12, ...A.midis.slice().reverse()].slice(0, 8);
        sec.forEach((mi, i) => M.nota({ preset: claro ? 'arpa' : 'epiano', midi: mi, t: t0 + i * beat / 2, dur: beat * .9, vel: i === 0 ? .6 : .42 + .06 * (i % 2), bus: 'orquesta', pan: pan(i % n), brillo }));
      } else {
        // frenesí: rasgueo con el patrón pop (1 · 2y · 3 · 4 · 4y)
        [0, 1.5, 2, 3, 3.5].forEach((b, k) => A.midis.forEach((mi, i) => M.nota({ preset: 'arpa', midi: mi, t: t0 + b * beat + i * .018, dur: beat * .8, vel: (k === 0 || k === 2 ? .62 : .46) * (sube ? 1 : .9), bus: 'orquesta', pan: pan(i), brillo })));
        if (relVol > 2.6) M.nota({ preset: 'cuerdas', midi: A.midis[n - 1] + 12, t: t0, dur: dur, vel: .3, bus: 'orquesta', pan: .2, brillo: .6, ataque: 1.2 });
      }

      // bajo
      let bajo = 36 + this.raiz + C.grado(this.modo, gdo);
      while (bajo < 33) bajo += 12; while (bajo > 46) bajo -= 12;
      const quinta = C.grado(this.modo, gdo + 4) - C.grado(this.modo, gdo);
      const velB = .55 + .25 * Math.min(relVol, 2) / 2;
      M.nota({ preset: 'bajo', midi: bajo, t: t0, dur: beat * 1.8, vel: velB, bus: 'orquesta' });
      M.nota({ preset: 'bajo', midi: bajo, t: t0 + 2 * beat, dur: beat * 1.3, vel: velB * .8, bus: 'orquesta' });
      if (relVol > 1.2) M.nota({ preset: 'bajo', midi: bajo + quinta, t: t0 + 2.5 * beat, dur: beat * .4, vel: velB * .6, bus: 'orquesta' });
      if (relVol > 1.2) M.nota({ preset: 'bajo', midi: sube ? bajo + 12 : bajo + quinta, t: t0 + 3.5 * beat, dur: beat * .4, vel: velB * .6, bus: 'orquesta' });

      // pulso
      const fuerza = clamp(relVol / 3, .15, 1);
      for (let b = 0; b < 4; b++) {
        const tb = t0 + b * beat;
        if (b % 2 === 0) M.percusion('latido', tb, .45 + .4 * fuerza); else if (relVol > 1) M.percusion('bombo', tb, .3 * fuerza);
        V.evento({ tipo: 'pulso', t: tb, fuerza: b % 2 === 0 ? .6 + .4 * fuerza : .3 * fuerza });
        if (relVol > 1.3) M.percusion('hat', tb + beat / 2, .18 + .2 * fuerza, (b % 2 ? .4 : -.4));
        if (relVol > 2.2) { M.percusion('shaker', tb + beat / 4, .14, .5); M.percusion('shaker', tb + 3 * beat / 4, .14, -.5); }
      }

      V.evento({ tipo: 'acorde', t: t0, nombre: A.nombre, romano: A.romano, modo: this.modo, midis: A.midis, grado: gdo, progresion: A.progresion, pos: this.progPos, nueva });
      this.acontecimientos(c, t0, dur, A, bajo);
      this.progPos = (this.progPos + 1) % this.prog.grados.length;
      if (this.progPos === 0) this.progVueltas++;
      return A;
    }

    /** Posiciones (en negras, 0..4) de N notas según el patrón del sector. */
    ritmo(patron, N, r) {
      const desde = (grid) => {
        if (N >= grid.length) return grid.slice();
        const out = []; for (let i = 0; i < N; i++) out.push(grid[Math.round(i * (grid.length - 1) / Math.max(1, N - 1))]);
        return [...new Set(out)];
      };
      const parejo = () => { const out = []; for (let i = 0; i < N; i++) out.push(i * 4 / N); return out; };
      switch (patron) {
        case 'swing': return desde([0, .67, 1, 1.67, 2, 2.67, 3, 3.67]);
        case 'tresillo': return desde(N > 6 ? [0, .375, .75, 1.125, 1.5, 1.875, 2, 2.375, 2.75, 3.125, 3.5, 3.875] : [0, .75, 1.5, 2, 2.75, 3.5]);
        case 'rubato': return parejo().map((p) => clamp(p + (r() - .5) * .36, 0, 3.9)).sort((a, b) => a - b);
        case 'sostenido': return N <= 1 ? [0] : N === 2 ? [0, 2] : parejo();
        case 'glitch': { const out = []; for (let i = 0; i < N; i++) out.push(Math.floor(i / 3) * (12 / Math.max(1, Math.ceil(N / 3))) / 3 + (i % 3) * .22); return out.map((p) => Math.min(p, 3.9)); }
        case 'ola': return parejo().map((p) => 4 * (0.5 - 0.5 * Math.cos(Math.PI * p / 4)));
        case 'motor': return parejo();
        default: return parejo();
      }
    }
    puntoCamino(camino, frac) {
      const segs = []; let total = 0;
      for (let i = 0; i < camino.length - 1; i++) { const d = Math.abs(camino[i + 1] - camino[i]); segs.push(d); total += d; }
      if (total <= 0) return camino[0];
      let obj = frac * total;
      for (let i = 0; i < segs.length; i++) {
        if (obj <= segs[i] || i === segs.length - 1) { const f = segs[i] ? clamp(obj / segs[i], 0, 1) : 0; return camino[i] + (camino[i + 1] - camino[i]) * f; }
        obj -= segs[i];
      }
      return camino[camino.length - 1];
    }

    solista(c, t0, dur, r) {
      const S = c.solista; if (!S || !S.enCurso || !S.est.ultimo) return null;
      const { sym, ficha, est, tf, k } = S; const bar = S.enCurso;
      const [, o, h, l, cl] = bar;
      const sector = ficha.sectorInfo, preset = sector.instrumento, beat = dur / 4, M = this.motor, V = this.visual;
      const relVol = est.relVol, rango = est.rangoRelativo || 1;
      // modo del solista: la fuerza relativa frente al SPY lo aclara u oscurece
      const delta = est.pct - c.spy.est.pct;
      let modo = this.modo;
      if (delta > .05) modo = C.masBrillante(modo, 2); else if (delta > .012) modo = C.masBrillante(modo);
      else if (delta < -.05) modo = C.masOscuro(modo, 2); else if (delta < -.012) modo = C.masOscuro(modo);
      // registro: precio bajo = agudo y liviano; precio alto = grave y pesado; el sector corre el centro
      let base = 84 - 12 * Math.log10(Math.max(cl, .05)) + sector.registro - 3 * ficha.tramo.peso;
      base = clamp(Math.round(base), 46, 82);
      const baseRaiz = base - C.mod(base - this.raiz, 12);
      // ventana de precios reciente → 14 grados (dos octavas)
      const w = est.ventana(20);
      const lo = w.lo - (w.hi - w.lo) * .08, span = Math.max((w.hi - w.lo) * 1.16, cl * .0008);
      const aIdx = (p) => Math.round(clamp((p - lo) / span, 0, 1) * 13);
      const sube = cl >= o; const camino = sube ? [o, l, h, cl] : [o, h, l, cl];
      const densidad = clamp(.35 + .55 * relVol, .35, 2.2) * (sector.ritmo === 'sostenido' ? .5 : 1) * (ficha.tramo.peso < .5 ? 1.15 : 1);
      const N = Math.max(1, Math.round(densidad * 4));
      const posiciones = this.ritmo(sector.ritmo, N, r);
      const A = this.acorde;
      const notas = posiciones.map((pos, i) => {
        const frac = (k + (i + .5) / posiciones.length) / tf;
        const p = this.puntoCamino(camino, frac);
        let midi = clamp(baseRaiz + C.grado(modo, aIdx(p)), 38, 98);
        // en modo progresión, las notas que caen en tiempo fuerte se apoyan en el acorde
        if (this.estilo === 'progresion' && A && Math.abs(pos - Math.round(pos)) < .06) {
          let mejor = midi, dist = 99;
          for (const s of A.semis) {
            const pc = C.mod(this.raiz + s, 12);
            for (const cand of [midi - C.mod(midi - pc, 12), midi + C.mod(pc - midi, 12)]) {
              const d = Math.abs(cand - midi); if (d < dist) { dist = d; mejor = cand; }
            }
          }
          midi = mejor;
        }
        return { pos, p, midi };
      });
      const legato = LEGATO[sector.ritmo] || .7;
      const vel = clamp(.42 + .22 * Math.min(rango, 2.5), .3, .95);
      const brillo = clamp(.3 + .3 * Math.min(relVol, 2), .2, 1);
      const golpe = relVol > 3 && k === 0;
      let ultima = null;
      notas.forEach((nn, i) => {
        const t = t0 + nn.pos * beat, sig = notas[i + 1];
        const durN = Math.max(((sig ? sig.pos : 4) - nn.pos) * beat * legato, beat * .22);
        if (i > 0 && r() < clamp((rango - 1) * .22, 0, .4)) M.nota({ preset, midi: nn.midi - 1, t: t - beat * .13, dur: beat * .1, vel: vel * .45, bus: 'solista', pan: S.pan, brillo });
        const v = golpe && i === 0 ? 1 : vel * (.82 + .3 * r());
        M.nota({ preset, midi: nn.midi, t, dur: durN, vel: v, bus: 'solista', pan: S.pan, brillo, vib: clamp(rango - .6, 0, 1.4) });
        V.evento({ tipo: 'nota', t, sym, midi: nn.midi, vel: v, dur: durN, color: sector.color, precio: nn.p });
        ultima = nn.midi;
      });
      if (golpe) { M.percusion('platillo', t0, .5); M.percusion('golpe', t0, .5, S.pan); V.evento({ tipo: 'golpe', t: t0, sym }); }
      if (k === tf - 1 && ultima != null) {
        const dir = est.nuevoMax ? 1 : est.nuevoMin ? -1 : 0;
        if (dir) {
          const idx0 = C.cuantizar(modo, ultima - baseRaiz);
          for (let i = 1; i <= 4; i++) M.nota({ preset, midi: clamp(baseRaiz + C.grado(modo, idx0 + dir * i), 38, 100), t: t0 + 3 * beat + i * beat / 4, dur: beat / 3, vel: .35 + .08 * i, bus: 'solista', pan: S.pan, brillo: .8 });
          V.evento({ tipo: dir > 0 ? 'maximo' : 'minimo', t: t0 + 3 * beat, sym });
        }
      }
      this.ultimoSolista = sym;
      return { modo, preset, instrumento: C.PRESETS[preset].nombre, notas: notas.length, delta };
    }

    coro(c, t0, dur, r) {
      const lista = (c.coro || []).filter((x) => x.est.ultimo && (Math.abs(x.est.pctVela) > .004 || x.est.relVol > 2.5 || x.est.nuevoMax || x.est.nuevoMin))
        .sort((a, b) => b.est.relVol - a.est.relVol).slice(0, 3);
      const beat = dur / 4;
      for (const x of lista) {
        const est = x.est, cl = est.ultimo[4];
        let base = clamp(Math.round(84 - 12 * Math.log10(Math.max(cl, .05)) + x.ficha.sectorInfo.registro), 52, 86);
        const baseRaiz = base - C.mod(base - this.raiz, 12);
        const idx = Math.round(clamp(est.posicion, 0, 1) * 13);
        const midi = clamp(baseRaiz + C.grado(this.modo, idx), 48, 96);
        const t = t0 + Math.floor(r() * 6) * beat / 2;
        const vel = clamp(.18 + .05 * Math.min(est.relVol, 4), .15, .4);
        this.motor.nota({ preset: 'cristal', midi, t, dur: beat * 2, vel, bus: 'coro', pan: x.pan, brillo: .7 });
        if (est.nuevoMax) this.motor.nota({ preset: 'cristal', midi: midi + 7, t: t + beat / 2, dur: beat * 2, vel: vel * .8, bus: 'coro', pan: x.pan, brillo: .9 });
        this.visual.evento({ tipo: 'coro', t, sym: x.sym, midi, color: x.ficha.sectorInfo.color });
      }
    }
  }

  g.Campana.Compositor = Compositor;
  g.Campana.PROGRESIONES = PROGRESIONES;
  g.Campana.romano = romano;
})(window);
