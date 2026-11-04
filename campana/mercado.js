/* ==========================================================================
   CAMPANA · mercado: estadísticas por símbolo y fuentes de velas
   Fuentes: Replay (días grabados) · Sintética (día inventado, determinista) · Viva (Massive REST)
   Vela = [minuto desde la apertura, apertura, máximo, mínimo, cierre, volumen en miles]
   ========================================================================== */
(function (g) {
  'use strict';
  const C = g.Campana;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const media = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  class Estadisticas {
    constructor(sym) {
      this.sym = sym; this.n = 0; this.apertura = null; this.max = -Infinity; this.min = Infinity;
      this.sumPV = 0; this.sumV = 0; this.vwap = null; this.vols = []; this.rangos = []; this.velas = [];
      this.ultimo = null; this.relVol = 1; this.pct = 0; this.pctVela = 0; this.volat = 0; this.rangoRel = 0;
      this.rangoRelativo = 1; this.posicion = .5; this.nuevoMax = false; this.nuevoMin = false; this.volMedia = 0;
      this.previo = null;
    }
    /** Contexto del día cuando se arranca a mitad de sesión (modo en vivo). */
    sembrar({ apertura, max, min, vwap, volMedia, previo }) {
      if (apertura) this.apertura = apertura;
      if (max) this.max = max; if (min) this.min = min;
      if (vwap) this.vwap = vwap; if (volMedia) this.volMedia = volMedia; if (previo) this.previo = previo;
    }
    agregar(bar) {
      const [, o, h, l, c, v] = bar;
      this.n++;
      if (this.apertura == null) this.apertura = o;
      this.nuevoMax = this.n > 1 && h > this.max;
      this.nuevoMin = this.n > 1 && l < this.min;
      this.max = Math.max(this.max, h); this.min = Math.min(this.min, l);
      this.sumPV += v * (h + l + c) / 3; this.sumV += v;
      this.vwap = this.sumV > 0 ? this.sumPV / this.sumV : c;
      const volPrev = this.volMedia;
      // relVol: volumen de la vela contra la media móvil (la primera vela del día pesa poco)
      this.relVol = volPrev > 0 ? v / volPrev : 1;
      this.vols.push(v);
      const ref = this.vols.length > 1 ? this.vols.slice(Math.max(1, this.vols.length - 30)) : this.vols;
      this.volMedia = this.volMedia > 0 ? this.volMedia * .85 + media(ref) * .15 : media(ref);
      if (this.n <= 2) this.relVol = clamp(this.relVol, .5, 1.5);
      this.rangoRel = c > 0 ? (h - l) / c : 0;
      const rangosPrev = this.rangos.slice(-20);
      this.rangoRelativo = rangosPrev.length >= 3 ? this.rangoRel / Math.max(media(rangosPrev), 1e-6) : 1;
      this.rangos.push(this.rangoRel);
      this.volat = media(this.rangos.slice(-10));
      this.velas.push(bar); this.ultimo = bar;
      this.pct = this.apertura ? c / this.apertura - 1 : 0;
      this.pctVela = o ? c / o - 1 : 0;
      this.posicion = this.max > this.min ? (c - this.min) / (this.max - this.min) : .5;
    }
    pendiente(n) {
      const cs = this.velas; if (cs.length < 2) return 0;
      const ref = cs[Math.max(0, cs.length - 1 - n)][4];
      return ref ? cs[cs.length - 1][4] / ref - 1 : 0;
    }
    ventana(n) {
      const vs = this.velas.slice(-n);
      if (!vs.length) return { lo: 0, hi: 1 };
      let lo = Infinity, hi = -Infinity;
      for (const b of vs) { lo = Math.min(lo, b[3]); hi = Math.max(hi, b[2]); }
      return { lo, hi };
    }
    get precio() { return this.ultimo ? this.ultimo[4] : (this.previo || 0); }
  }

  /* ----------------------------------------------------------- Replay */
  class FuenteReplay {
    constructor(dia, clave) {
      this.dia = dia; this.clave = clave; this.tipo = 'replay';
      this.series = dia.series;
      this.simbolos = Object.keys(this.series).filter((s) => s !== 'SPY');
      this.porMinuto = {};
      for (const s in this.series) {
        const m = new Map();
        for (const b of this.series[s].bars) m.set(b[0], b);
        this.porMinuto[s] = m;
      }
      this.total = 390;
    }
    tf(sym) { return (this.series[sym] || { tf: 1 }).tf; }
    velasEn(m) {
      const out = {};
      for (const s in this.porMinuto) { const b = this.porMinuto[s].get(m); if (b) out[s] = b; }
      return out;
    }
    listo(m) { return true; }
  }

  /* ----------------------------------------------------------- Sintética */
  const EMPRESAS = [
    ['LUMN', 'Lumen Therapeutics', 'biotec', 14], ['QNTA', 'Quanta Semi', 'semis', 180], ['ORBI', 'Orbital Networks', 'internet', 92],
    ['HELX', 'Helix Software', 'software', 48], ['VERT', 'Vertex Oil & Gas', 'energia', 71], ['KYRO', 'Kyro Capital', 'bancos', 230],
    ['ZENO', 'Zeno Digital Assets', 'cripto', 27], ['NOVA', 'Nova Retail', 'consumo', 64], ['DRAC', 'Draco Motors', 'auto', 310],
    ['EMBR', 'Ember Mining', 'mineria', 3.2], ['FLUX', 'Fluxa Shipping', 'maritimo', 9.5], ['IONO', 'Iono Hardware', 'hardware', 21],
    ['CYTO', 'Cyto Genomics', 'biotec', 6.4], ['ASTR', 'Astra AI', 'software', 410], ['PYRA', 'Pyra Pharma', 'farma', 38],
  ];
  const REGIMENES = [
    ['subida sostenida', 0.0025, .35], ['caída con rebote', -0.003, .6], ['día plano y nervioso', 0, .5],
    ['venta fuerte', -0.0075, .9], ['rally de cierre', 0.0045, .55], ['apertura falsa', -0.001, .7],
  ];

  function diaSintetico(semilla) {
    const r = C.rng(semilla);
    const [nombreReg, deriva, agit] = REGIMENES[Math.floor(r() * REGIMENES.length)];
    const total = 390;
    // volumen en U: fuerte al abrir y al cerrar
    const perfilVol = (m) => 1.6 * Math.exp(-m / 45) + .35 + 1.4 * Math.exp(-(total - 1 - m) / 25) + .25 * Math.sin(m / 23);
    const caminar = (p0, beta, idio, spy, saltos, volBase) => {
      const bars = []; let p = p0;
      for (let m = 0; m < total; m++) {
        const retSpy = spy ? spy[m].ret : 0;
        const vol = idio * (1 + .8 * Math.exp(-m / 60)) * (0.7 + 0.6 * agit);
        let ret = beta * retSpy + (r() - .5 + (r() - .5)) * vol;
        let spike = 1;
        for (const s of saltos) if (m === s.m) { ret += s.mag; spike = s.vol; }
        if (m === 0) ret += (r() - .5) * vol * 4;
        const o = p, c = p * (1 + ret);
        const extra = Math.abs(ret) * (0.3 + r() * .8) + vol * .4 * r();
        const h = Math.max(o, c) * (1 + extra * r()), l = Math.min(o, c) * (1 - extra * r());
        const v = Math.max(1, volBase * perfilVol(m) * (0.5 + r()) * spike * (1 + 30 * Math.abs(ret)));
        bars.push({ bar: [m, +o.toFixed(3), +h.toFixed(3), +l.toFixed(3), +c.toFixed(3), +v.toFixed(1)], ret });
        p = c;
      }
      return bars;
    };
    // SPY: deriva del régimen más ruido, con un giro a mitad de día
    const spyRaw = (() => {
      const bars = []; let p = 700 + r() * 90;
      const giro = 120 + Math.floor(r() * 200);
      for (let m = 0; m < total; m++) {
        const fase = m < giro ? 1 : (nombreReg.includes('rebote') || nombreReg.includes('rally') ? -1.4 : .6);
        const ret = (deriva / total) * fase * 1.3 + (r() - .5 + (r() - .5)) * .00045 * (1 + agit) * (1 + Math.exp(-m / 40));
        const o = p, c = p * (1 + ret);
        const extra = Math.abs(ret) * .6 + .00018 * (1 + r());
        const h = Math.max(o, c) * (1 + extra * r()), l = Math.min(o, c) * (1 - extra * r());
        const v = 120 * perfilVol(m) * (0.6 + r() * .8) * (1 + 400 * Math.abs(ret));
        bars.push({ bar: [m, +o.toFixed(2), +h.toFixed(2), +l.toFixed(2), +c.toFixed(2), +v.toFixed(0)], ret });
        p = c;
      }
      return bars;
    })();
    const series = { SPY: { tf: 1, bars: spyRaw.map((x) => x.bar) } };
    const elegidas = EMPRESAS.slice().sort(() => r() - .5).slice(0, 8);
    let solista = null, mejor = 0;
    for (const [sym, nombre, sector, precio] of elegidas) {
      const chico = precio < 30;
      const saltos = [];
      const nSaltos = chico ? 1 + Math.floor(r() * 3) : (r() < .3 ? 1 : 0);
      for (let i = 0; i < nSaltos; i++) saltos.push({ m: 5 + Math.floor(r() * 300), mag: (r() - .35) * (chico ? .18 : .03), vol: chico ? 8 + r() * 20 : 3 + r() * 4 });
      const bars = caminar(precio * (0.9 + r() * .2), chico ? .4 : .8 + r() * .8, chico ? .006 : .0012, spyRaw, saltos, chico ? 40 : 300);
      series[sym] = { tf: 1, bars: bars.map((x) => x.bar) };
      C.registrarFicha(sym, { nombre, sector, capital: precio * (chico ? 2e7 : 3e9) * (1 + r() * 8) });
      const mov = Math.abs(bars[bars.length - 1].bar[4] / bars[0].bar[1] - 1);
      if (mov > mejor) { mejor = mov; solista = sym; }
    }
    return {
      titulo: `Día inventado nº ${semilla}`,
      resumen: `Mercado sintético con régimen "${nombreReg}": ocho empresas imaginarias con betas, sectores y noticias al azar, generadas de forma determinista a partir de la semilla ${semilla}.`,
      solista, series, sintetico: true,
    };
  }

  /* ----------------------------------------------------------- En vivo (Massive) */
  function horaNY(fecha = new Date()) {
    const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' }).formatToParts(fecha);
    const o = {}; for (const p of partes) o[p.type] = p.value;
    const h = +o.hour % 24, mi = +o.minute;
    return { y: +o.year, mo: +o.month, d: +o.day, h, mi, s: +o.second, dia: o.weekday, minutoSesion: (h - 9) * 60 + mi - 30, fecha: `${o.year}-${o.month}-${o.day}` };
  }

  class FuenteViva {
    constructor({ apiKey, simbolos, onEstado }) {
      this.tipo = 'vivo'; this.apiKey = apiKey; this.simbolos = simbolos.filter((s) => s !== 'SPY');
      this.todos = ['SPY', ...this.simbolos]; this.onEstado = onEstado || (() => {});
      this.porMinuto = {}; this.contexto = {}; this.total = 390; this.timer = null; this.ultimoMin = {};
      for (const s of this.todos) this.porMinuto[s] = new Map();
    }
    tf() { return 1; }
    velasEn(m) { const out = {}; for (const s of this.todos) { const b = this.porMinuto[s].get(m); if (b) out[s] = b; } return out; }
    listo(m) { return this.porMinuto.SPY.has(m); }
    minutoActual() { return horaNY().minutoSesion; }
    async _get(path, params = {}) {
      const u = new URL('https://api.massive.com' + path);
      for (const k in params) u.searchParams.set(k, params[k]);
      u.searchParams.set('apiKey', this.apiKey);
      const res = await fetch(u.toString());
      if (!res.ok) throw new Error(`Massive respondió ${res.status}`);
      return res.json();
    }
    async preparar() {
      // sector y nombre de cada símbolo (una consulta por símbolo, en orden, para respetar el plan gratis)
      for (const s of this.simbolos) {
        if (C.FICHAS[s]) continue;
        try {
          const j = await this._get(`/v3/reference/tickers/${s}`);
          const r = j.results || {};
          C.registrarFicha(s, { nombre: r.name || s, sector: C.sectorDesdeSic(r.sic_description, r.name), capital: r.market_cap, tipo: r.type });
        } catch (e) { C.registrarFicha(s, { nombre: s, sector: 'otros' }); }
        await new Promise((ok) => setTimeout(ok, 400));
      }
    }
    async sondear() {
      const j = await this._get('/v2/snapshot/locale/us/markets/stocks/tickers', { tickers: this.todos.join(',') });
      const ny = horaNY();
      for (const t of j.tickers || []) {
        const s = t.ticker, min = t.min, day = t.day || {};
        this.contexto[s] = { apertura: day.o, max: day.h, min: day.l, vwap: day.vw, volDia: day.v, previo: (t.prevDay || {}).c, actualizado: t.updated };
        if (!min || !min.t) continue;
        const d = new Date(min.t); const nyMin = horaNY(d);
        if (nyMin.fecha !== ny.fecha) continue; // vela de otro día (mercado cerrado)
        const m = nyMin.minutoSesion;
        if (m < 0 || m >= this.total) continue;
        const bar = [m, min.o, min.h, min.l, min.c, (min.v || 0) / 1000];
        this.porMinuto[s].set(m, bar); // la vela en curso se va actualizando hasta que cambia el minuto
        this.ultimoMin[s] = m;
      }
      this.onEstado({ hora: ny, abierto: ny.minutoSesion >= 0 && ny.minutoSesion < this.total && !['Sat', 'Sun'].includes(ny.dia) });
    }
    arrancar(cadaMs = 20000) {
      this.detener();
      const tick = () => this.sondear().catch((e) => this.onEstado({ error: e.message }));
      tick(); this.timer = setInterval(tick, cadaMs);
    }
    detener() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  }

  g.Campana.Estadisticas = Estadisticas;
  g.Campana.FuenteReplay = FuenteReplay;
  g.Campana.FuenteViva = FuenteViva;
  g.Campana.diaSintetico = diaSintetico;
  g.Campana.horaNY = horaNY;
})(window);
