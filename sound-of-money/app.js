/* ==========================================================================
   THE SOUND OF MONEY · la app: transporte, director, HUD y fuentes
   ========================================================================== */
(function () {
  'use strict';
  const C = window.Campana;
  const $ = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const motor = new C.Motor();
  const visual = new C.Visual($('#lienzo'), motor);
  const compositor = new C.Compositor(motor, visual);

  const E = {
    fuente: null, dia: null, clave: null, m: -1, reproduciendo: false, est: {}, solista: null, solistaDesde: -99,
    director: 'auto', velocidad: 1, repeticion: 0, panes: {}, ultimo: null, fin: false, hudOculto: false, ocioso: 0, semillaSintetica: 7,
  };

  /* ----------------------------------------------------------- HUD */
  const hud = {
    dia: $('#dia'), sol: $('#solista'), orq: $('#orquesta'), linea: $('#linea'), aviso: $('#aviso'),
  };
  let avisoTimer = null;
  function avisar(txt, ms = 3200) {
    hud.aviso.textContent = txt; hud.aviso.classList.add('visible');
    clearTimeout(avisoTimer); avisoTimer = setTimeout(() => hud.aviso.classList.remove('visible'), ms);
  }
  const horaDe = (m) => { const t = 9 * 60 + 30 + Math.max(0, m); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  const fmtPrecio = (p) => p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(3).replace(/0$/, '') : p.toFixed(4);
  const fmtPct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)} %`;
  const claseCambio = (x) => (x >= 0 ? 'cambio sube' : 'cambio baja');

  function pintarHud(res, c) {
    const f = E.fuente; if (!f) return;
    hud.dia.querySelector('.hora').textContent = horaDe(E.m);
    const spy = E.est.SPY;
    if (spy && spy.ultimo) {
      hud.orq.querySelector('.valor').textContent = fmtPrecio(spy.ultimo[4]);
      const ch = hud.orq.querySelector('.cambio'); ch.textContent = fmtPct(spy.pct); ch.className = claseCambio(spy.pct);
      hud.orq.querySelector('.relvol').textContent = `${spy.relVol.toFixed(1)}×`;
    }
    if (res) {
      const modo = C.MODOS[res.modo];
      hud.orq.querySelector('.tonalidad').textContent = `${C.NOTAS[res.raiz]} ${modo.nombre.toLowerCase()}`;
      hud.orq.querySelector('.modo').textContent = modo.animo;
      hud.orq.querySelector('.tempo').textContent = `${Math.round(res.bpm)} bpm`;
      if (res.acorde) hud.orq.querySelector('.acorde').textContent = res.acorde.romano && compositor.estilo === 'progresion' ? `${res.acorde.romano} · ${res.acorde.nombre}` : res.acorde.nombre;
    }
    const s = E.solista; const es = E.est[s];
    if (s && es) {
      const fi = C.ficha(s);
      const symEl = hud.sol.querySelector('.sym'); symEl.textContent = s; symEl.style.color = fi.sectorInfo.color;
      hud.sol.querySelector('.nombre').textContent = fi.nombre;
      const inst = C.PRESETS[fi.sectorInfo.instrumento].nombre;
      const modoSol = res && res.solista ? ` · ${C.MODOS[res.solista.modo].nombre.toLowerCase()}` : '';
      hud.sol.querySelector('.detalle').textContent = `${fi.sectorInfo.nombre} · ${fi.tramo.nombre} · ${inst}${modoSol}`;
      if (es.ultimo) {
        hud.sol.querySelector('.precio').textContent = `$ ${fmtPrecio(es.ultimo[4])}`;
        const ch = hud.sol.querySelector('.cambio'); ch.textContent = fmtPct(es.pct); ch.className = claseCambio(es.pct);
        hud.sol.querySelector('.volumen').textContent = `vol ${es.relVol.toFixed(1)}×`;
      }
    }
    const prog = clamp((E.m + 1) / f.total, 0, 1);
    hud.linea.querySelector('.progreso').style.width = `${prog * 100}%`;
    hud.linea.querySelector('.marca').style.left = `${prog * 100}%`;
  }

  /* ----------------------------------------------------------- días disponibles */
  function opcionesDias() {
    const out = [];
    for (const fecha of Object.keys(window.CAMPANA_DIAS || {}).sort()) {
      const d = window.CAMPANA_DIAS[fecha];
      out.push({ clave: fecha, titulo: d.titulo, resumen: d.resumen });
    }
    out.push({ clave: 'sintetico', titulo: 'Un día inventado', resumen: 'Ocho empresas imaginarias y un mercado generado al azar: cada semilla es un día distinto. Sirve para escuchar cómo cambia la música con cada régimen.' });
    out.push({ clave: 'vivo', titulo: 'El mercado ahora, en vivo', resumen: 'Conectá tu API key de Massive y escuchá la sesión de hoy mientras ocurre (9:30 a 16:00, hora de Nueva York). Alcanza el plan gratis.' });
    return out;
  }

  function cargarDia(clave) {
    E.clave = clave; E.m = -1; E.fin = false; E.repeticion = 0; E.est = {}; E.solista = null; E.solistaDesde = -99; E.ultimo = null;
    if (E.fuente && E.fuente.detener) E.fuente.detener();
    visual.reset();
    $('#panel-vivo').classList.toggle('visible', clave === 'vivo');
    if (clave === 'vivo') { $('#mas').classList.add('visible'); $('#btn-mas').classList.add('activo'); }
    let dia;
    if (clave === 'vivo') {
      E.fuente = null; E.dia = { titulo: 'El mercado ahora', resumen: '' };
      hud.dia.querySelector('.titulo').textContent = 'En vivo · esperando conexión';
      hud.dia.querySelector('.estado').textContent = 'Pegá tu API key de Massive y tocá Conectar';
      return;
    }
    if (clave === 'sintetico') { dia = C.diaSintetico(E.semillaSintetica); }
    else dia = window.CAMPANA_DIAS[clave];
    E.dia = dia;
    E.fuente = new C.FuenteReplay(dia, clave);
    prepararSimbolos(['SPY', ...E.fuente.simbolos]);
    compositor.nuevoDia(C.hash(clave, E.semillaSintetica));
    compositor.velocidad = E.velocidad;
    E.solista = dia.solista && E.fuente.simbolos.includes(dia.solista) ? dia.solista : E.fuente.simbolos[0];
    hud.dia.querySelector('.titulo').textContent = dia.titulo;
    hud.dia.querySelector('.estado').textContent = clave === 'sintetico' ? `semilla ${E.semillaSintetica} · mercado imaginario` : 'Nueva York · datos reales (Massive)';
    pintarHud(null, null);
    visual.actualizar(estadoVisual());
  }

  function prepararSimbolos(lista) {
    E.est = {}; E.panes = {};
    for (const s of lista) E.est[s] = new C.Estadisticas(s);
    const otros = lista.filter((s) => s !== 'SPY');
    otros.forEach((s, i) => { E.panes[s] = otros.length > 1 ? (i / (otros.length - 1)) * 1.4 - .7 : 0; });
  }

  /* ----------------------------------------------------------- avance */
  function ingresar(m) {
    const velas = E.fuente.velasEn(m);
    for (const s in velas) if (E.est[s]) E.est[s].agregar(velas[s]);
    E.m = m; E.repeticion = 0;
    if (E.director === 'auto') elegirSolista(m);
    return velas;
  }
  function contexto(m, velas) {
    const f = E.fuente, spy = E.est.SPY;
    const sol = E.solista ? E.est[E.solista] : null;
    let solista = null;
    if (sol && sol.ultimo) {
      const tf = f.tf(E.solista); const k = m - sol.ultimo[0];
      solista = { sym: E.solista, ficha: C.ficha(E.solista), est: sol, tf, k, enCurso: k >= 0 && k < tf ? sol.ultimo : null, pan: E.panes[E.solista] || 0 };
    }
    const coro = [];
    for (const s of f.simbolos) if (s !== E.solista && velas[s]) coro.push({ sym: s, est: E.est[s], ficha: C.ficha(s), pan: E.panes[s] || 0 });
    return { m, spy: { bar: velas.SPY || null, est: spy }, solista, coro, primero: spy.n === 1 && !!velas.SPY, ultimo: m === f.total - 1, repeticion: E.repeticion };
  }
  function avanzar() {
    const f = E.fuente; if (!f) return false;
    const m = E.m + 1;
    if (m >= f.total) { terminar(); return false; }
    if (!f.listo(m)) {
      // en vivo: la próxima vela todavía no llegó → variación sobre la última
      if (f.tipo === 'vivo' && E.m >= 0) {
        E.repeticion++;
        const velas = f.velasEn(E.m);
        E.ultimo = compositor.compas(contexto(E.m, velas));
        pintarHud(E.ultimo);
        return true;
      }
      return false;
    }
    const velas = ingresar(m);
    E.ultimo = compositor.compas(contexto(m, velas));
    pintarHud(E.ultimo);
    return true;
  }
  function terminar() {
    if (E.fin) return; E.fin = true; E.reproduciendo = false;
    $('#btn-play').textContent = '▶';
    avisar('Cierra el mercado. Elegí otro día o volvé a escuchar desde la línea de tiempo.', 6000);
  }
  function saltar(m) {
    const f = E.fuente; if (!f || f.tipo === 'vivo') return;
    m = clamp(Math.floor(m), 0, f.total - 1);
    prepararSimbolos(['SPY', ...f.simbolos]);
    compositor.nuevoDia(C.hash(E.clave, E.semillaSintetica));
    compositor.velocidad = E.velocidad;
    visual.reset();
    for (let i = 0; i < m; i++) { const velas = f.velasEn(i); for (const s in velas) if (E.est[s]) E.est[s].agregar(velas[s]); compositor.actualizarModo(E.est.SPY); }
    E.m = m - 1; E.fin = false; E.solistaDesde = m - 99;
    if (!E.reproduciendo) reproducir();
    visual.actualizar(estadoVisual());
  }

  function elegirSolista(m) {
    const f = E.fuente;
    if (m - E.solistaDesde < 8 || m % 4 !== 0) return;
    let mejor = null, mejorP = 0, actualP = 0;
    for (const s of f.simbolos) {
      const e = E.est[s]; if (!e.ultimo || m - e.ultimo[0] > 4) continue;
      const p = e.relVol * (1 + 60 * Math.abs(e.pctVela)) + (e.nuevoMax || e.nuevoMin ? 1.2 : 0) + Math.abs(e.pct) * 15 + (e.rangoRelativo > 2 ? .8 : 0);
      if (s === E.solista) actualP = p;
      if (p > mejorP) { mejorP = p; mejor = s; }
    }
    if (mejor && mejor !== E.solista && mejorP > actualP * 1.7 + .6) cambiarSolista(mejor, m, true);
  }
  function cambiarSolista(sym, m, automatico) {
    if (!E.est[sym] || sym === E.solista) return;
    E.solista = sym; E.solistaDesde = m == null ? E.m : m;
    const fi = C.ficha(sym);
    avisar(`${automatico ? 'El director enfoca' : 'Solista'}: ${sym} · ${fi.nombre} · ${C.PRESETS[fi.sectorInfo.instrumento].nombre}`);
    pintarHud(E.ultimo);
  }
  function solistaRelativo(paso) {
    const f = E.fuente; if (!f) return;
    const i = f.simbolos.indexOf(E.solista);
    const j = (i + paso + f.simbolos.length) % f.simbolos.length;
    E.director = 'manual'; pintarDirector();
    cambiarSolista(f.simbolos[j], E.m, false);
  }

  function estadoVisual() {
    const f = E.fuente; if (!f) return null;
    const spy = E.est.SPY; const s = E.solista; const es = s ? E.est[s] : null;
    return {
      m: E.m, total: f.total, modo: compositor.modo, acorde: compositor.acorde,
      spy: { velas: spy.velas, est: spy },
      solista: s && es ? { sym: s, velas: es.velas, est: es, ficha: C.ficha(s), color: C.ficha(s).sectorInfo.color } : null,
      otros: f.simbolos.map((x) => ({ sym: x, est: E.est[x], ficha: C.ficha(x), color: C.ficha(x).sectorInfo.color, enfocado: x === s })),
    };
  }

  /* ----------------------------------------------------------- transporte */
  async function reproducir() {
    if (!E.fuente) { avisar('Primero conectá el mercado en vivo o elegí un día.'); return; }
    motor.init(); await motor.resume();
    if (E.fin) { saltar(0); return; }
    E.reproduciendo = true; compositor.tProximo = Math.max(compositor.tProximo, motor.ahora() + .15);
    $('#btn-play').textContent = '❚❚';
  }
  async function pausar() {
    E.reproduciendo = false; $('#btn-play').textContent = '▶';
    await motor.suspender();
  }
  function alternar() { if (E.reproduciendo) pausar(); else reproducir(); }

  function cuadro() {
    requestAnimationFrame(cuadro);
    if (E.reproduciendo && motor.listo) {
      let guard = 0;
      while (compositor.tProximo - motor.ahora() < .7 && guard++ < 4) { if (!avanzar()) break; }
    }
    visual.actualizar(estadoVisual());
    visual.frame();
    pintarPiano();
    // paneles: se esconden solos tras un rato sin mover el mouse
    E.ocioso += 1 / 60;
    if (E.ocioso > 6 && !E.hudOculto && E.reproduciendo && !$('#panel-vivo').classList.contains('visible')) ocultarHud(true, true);
  }

  /* ----------------------------------------------------------- modo progresión: partitura y piano */
  const partitura = { acorde: null, teclas: [] };
  const piano = $('#piano'), pianoCtx = piano.getContext('2d');
  const PIANO_DESDE = 48, PIANO_HASTA = 72; // C3 … C5
  const esNegra = (midi) => [1, 3, 6, 8, 10].includes(C.mod(midi, 12));
  function setEstilo(e) {
    compositor.estilo = e; E.estilo = e;
    document.body.classList.toggle('estilo-progresion', e === 'progresion');
    for (const b of $('#estilo').children) b.classList.toggle('activo', b.dataset.e === e);
    try { localStorage.setItem('campana.estilo', e); } catch (err) { /* sin storage */ }
  }
  visual.onAcorde = (e) => {
    partitura.acorde = e;
    if (!e.progresion) return;
    const pal = C.PALETAS[e.modo] || C.PALETAS.jonico;
    const panel = $('#progresion'); panel.style.setProperty('--acento-modo', pal.acento);
    panel.querySelector('.tono').textContent = `${C.NOTAS[compositor.raiz]} ${C.MODOS[e.modo].nombre.toLowerCase()} · ${C.MODOS[e.modo].animo}`;
    panel.querySelectorAll('.card').forEach((card, i) => {
      const a = e.progresion[i];
      card.classList.toggle('activo', i === e.pos);
      card.querySelector('.rom').textContent = a ? a.romano : '—';
      card.querySelector('.nom').textContent = a ? a.nombre : '';
    });
  };
  visual.onNota = (e) => { partitura.teclas.push({ midi: e.midi, color: e.color, hasta: motor.ahora() + Math.max(.25, Math.min(e.dur, 1.2)) }); };
  function pintarPiano() {
    if (compositor.estilo !== 'progresion' || E.hudOculto) return;
    const W = piano.width, H = piano.height, ctx = pianoCtx;
    const blancas = []; for (let m = PIANO_DESDE; m <= PIANO_HASTA; m++) if (!esNegra(m)) blancas.push(m);
    const anchoB = W / blancas.length;
    const ahora = motor.ahora();
    partitura.teclas = partitura.teclas.filter((t) => t.hasta > ahora);
    const acorde = partitura.acorde && partitura.acorde.midis ? new Set(partitura.acorde.midis.map((m) => { let x = m; while (x > PIANO_HASTA) x -= 12; while (x < PIANO_DESDE) x += 12; return x; })) : new Set();
    const pal = C.PALETAS[(partitura.acorde && partitura.acorde.modo) || compositor.modo] || C.PALETAS.jonico;
    const solista = new Map(); for (const t of partitura.teclas) { let x = t.midi; while (x > PIANO_HASTA) x -= 12; while (x < PIANO_DESDE) x += 12; solista.set(x, t.color); }
    ctx.clearRect(0, 0, W, H);
    const xDe = (midi) => { let i = 0; for (let m = PIANO_DESDE; m < midi; m++) if (!esNegra(m)) i++; return esNegra(midi) ? i * anchoB - anchoB * .3 : i * anchoB; };
    blancas.forEach((m) => {
      const x = xDe(m); const enAcorde = acorde.has(m), enSol = solista.get(m);
      ctx.fillStyle = enSol ? enSol : enAcorde ? pal.nebulosa[0] : 'rgba(255,255,255,.88)';
      ctx.fillRect(x + 1, 0, anchoB - 2, H);
      if (enAcorde || enSol) { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(x + 1, H * .75, anchoB - 2, H * .25); }
      if (C.mod(m, 12) === 0) { ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.font = '600 10px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(C.nombreNota(m), x + anchoB / 2, H - 6); }
    });
    for (let m = PIANO_DESDE; m <= PIANO_HASTA; m++) {
      if (!esNegra(m)) continue;
      const x = xDe(m); const enAcorde = acorde.has(m), enSol = solista.get(m);
      ctx.fillStyle = enSol ? enSol : enAcorde ? pal.nebulosa[0] : '#15172a';
      ctx.fillRect(x, 0, anchoB * .6, H * .62);
      if (enAcorde || enSol) { ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(x, H * .5, anchoB * .6, H * .12); }
    }
  }

  let pistaTimer = null;
  function ocultarHud(ocultar, automatico) {
    E.hudOculto = ocultar;
    $('#hud').classList.toggle('oculto', ocultar);
    $('#btn-ocultar').textContent = ocultar ? 'Mostrar paneles' : 'Ocultar paneles';
    clearTimeout(pistaTimer);
    if (ocultar) {
      const tactil = 'ontouchstart' in window;
      $('#pista-ocultar').textContent = automatico ? (tactil ? 'los paneles se esconden solos · tocá la pantalla para verlos' : 'los paneles se esconden solos · mové el mouse o apretá H') : 'H muestra los paneles';
      $('#pista-ocultar').classList.add('visible');
      pistaTimer = setTimeout(() => $('#pista-ocultar').classList.remove('visible'), 4500);
    } else $('#pista-ocultar').classList.remove('visible');
  }

  /* ----------------------------------------------------------- en vivo */
  function proveedor() { return E.proveedor || 'alpaca'; }
  function pintarProveedor() {
    const p = proveedor();
    for (const b of $('#proveedor').children) b.classList.toggle('activo', b.dataset.p === p);
    $('#vivo-key').placeholder = p === 'alpaca' ? 'API key ID de Alpaca' : 'API key de Massive (massive.com)';
    $('#vivo-secret').style.display = p === 'alpaca' ? '' : 'none';
    $('#vivo-feed').style.display = p === 'alpaca' ? '' : 'none';
    $('#vivo-nota').textContent = p === 'alpaca'
      ? 'Las claves quedan sólo en este navegador. Con Alpaca se reconstruye el día entero al conectar; después, dos consultas cada 20 s.'
      : 'La clave queda sólo en este navegador. Con Massive se arranca desde el minuto actual; una consulta cada 20 s.';
    try { $('#vivo-key').value = localStorage.getItem(`campana.${p}.key`) || ''; $('#vivo-secret').value = localStorage.getItem('campana.alpaca.secret') || ''; } catch (e) { /* sin storage */ }
  }
  async function conectarVivo() {
    const p = proveedor();
    const key = $('#vivo-key').value.trim(), secret = $('#vivo-secret').value.trim(), feed = $('#vivo-feed').value;
    const tickers = $('#vivo-tickers').value.split(/[\s,]+/).map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, 12);
    if (!key) { avisar(p === 'alpaca' ? 'Falta la API key ID de Alpaca.' : 'Falta la API key de Massive.'); return; }
    if (p === 'alpaca' && !secret) { avisar('Falta el API secret de Alpaca.'); return; }
    try {
      localStorage.setItem(`campana.${p}.key`, key); if (p === 'alpaca') localStorage.setItem('campana.alpaca.secret', secret);
      localStorage.setItem('campana.tickers', tickers.join(',')); localStorage.setItem('campana.proveedor', p); localStorage.setItem('campana.feed', feed);
    } catch (e) { /* sin storage */ }
    const nombre = p === 'alpaca' ? 'Alpaca' : 'Massive';
    avisar(`Conectando con ${nombre}…`);
    if (E.fuente && E.fuente.detener) E.fuente.detener();
    const fuente = p === 'alpaca'
      ? new C.FuenteAlpaca({ keyId: key, secret, feed, simbolos: tickers, onEstado: estadoVivo })
      : new C.FuenteViva({ apiKey: key, simbolos: tickers, onEstado: estadoVivo });
    E.fuente = fuente; E.clave = 'vivo'; E.m = -1; E.fin = false; E.est = {};
    prepararSimbolos(['SPY', ...fuente.simbolos]);
    compositor.nuevoDia(C.hash('vivo', C.horaNY().fecha));
    compositor.velocidad = E.velocidad;
    E.solista = fuente.simbolos[0]; E.solistaDesde = -99;
    hud.dia.querySelector('.titulo').textContent = `El mercado ahora · ${nombre}`;
    try {
      await fuente.preparar();
      await fuente.sondear();
    } catch (e) { avisar(`No pude conectar: ${e.message}. Si el navegador bloquea la consulta (CORS), probá desde otra red o usá los días grabados.`, 8000); return; }
    const ahora = fuente.minutoActual();
    for (const s of fuente.todos) {
      const cx = fuente.contexto[s]; if (!cx) continue;
      E.est[s].sembrar({ apertura: cx.apertura, max: cx.max, min: cx.min, vwap: cx.vwap, volMedia: cx.volDia && ahora > 0 ? cx.volDia / 1000 / Math.max(1, ahora) : 0, previo: cx.previo });
    }
    // lo que ya pasó del día entra a las estadísticas sin sonar; la música arranca en el minuto actual
    const hasta = Math.max(0, Math.min(ahora, fuente.total));
    let ingresadas = 0;
    for (let i = 0; i < hasta; i++) { const velas = fuente.velasEn(i); for (const s in velas) if (E.est[s]) { E.est[s].agregar(velas[s]); ingresadas++; } if (velas.SPY) compositor.actualizarModo(E.est.SPY); }
    E.m = hasta - 1; E.solistaDesde = E.m - 99;
    if (E.director === 'auto' && E.m >= 0) elegirSolista(E.m + 8 - ((E.m + 8) % 4));
    visual.reset();
    fuente.arrancar(20000);
    const cerrado = ahora < 0 || ahora >= 390;
    avisar(`Conectado a ${nombre}. ${fuente.simbolos.length} acciones + SPY${ingresadas ? `, ${Math.floor(ingresadas / fuente.todos.length)} minutos reconstruidos` : ''}. ${cerrado ? 'El mercado está cerrado: suenan las últimas velas disponibles.' : 'Escuchando la sesión de hoy.'}`, 7000);
    reproducir();
  }
  function estadoVivo(s) {
    if (s.error) { avisar(`${proveedor() === 'alpaca' ? 'Alpaca' : 'Massive'}: ${s.error}`, 5000); return; }
    if (s.stream === true) avisar('Stream de Alpaca conectado: las velas llegan en tiempo real.', 4000);
    if (s.stream === false) avisar('Se cortó el stream de Alpaca; sigo por sondeo cada 20 s y reintento en 15 s.', 5000);
    if (s.hora) hud.dia.querySelector('.estado').textContent = `${s.abierto ? 'Mercado abierto' : 'Mercado cerrado'} · ${String(s.hora.h).padStart(2, '0')}:${String(s.hora.mi).padStart(2, '0')} Nueva York${E.fuente && E.fuente.tiempoReal ? ' · tiempo real' : ''}`;
  }

  /* ----------------------------------------------------------- UI */
  function pintarDirector() { for (const b of $('#director').children) b.classList.toggle('activo', b.dataset.d === E.director); }
  function pintarVelocidad() { for (const b of $('#velocidad').children) b.classList.toggle('activo', +b.dataset.v === E.velocidad); }
  function setVelocidad(v) { E.velocidad = v; compositor.velocidad = v; pintarVelocidad(); }

  function armarUI() {
    const dias = opcionesDias();
    const sel = $('#selector-dia');
    sel.innerHTML = dias.map((d) => `<option value="${d.clave}">${d.titulo}</option>`).join('');
    sel.addEventListener('change', () => {
      pausar(); cargarDia(sel.value);
      if (sel.value !== 'vivo') reproducir();
    });
    const cont = $('#portada-dias');
    cont.innerHTML = dias.filter((d) => d.clave !== 'vivo').map((d, i) => `<div class="tarjeta ${i === 0 ? 'activa' : ''}" data-clave="${d.clave}"><div class="t">${d.titulo}</div><div class="d">${d.resumen}</div></div>`).join('');
    let elegido = dias[0].clave;
    cont.addEventListener('click', (ev) => {
      const t = ev.target.closest('.tarjeta'); if (!t) return;
      for (const x of cont.children) x.classList.toggle('activa', x === t);
      elegido = t.dataset.clave;
    });
    $('#btn-escuchar').addEventListener('click', async () => {
      $('#portada').classList.add('cerrando');
      sel.value = elegido; cargarDia(elegido);
      await reproducir();
      setTimeout(() => $('#portada').remove(), 1300);
    });

    $('#btn-play').addEventListener('click', alternar);
    $('#btn-mas').addEventListener('click', () => { const v = $('#mas').classList.toggle('visible'); $('#btn-mas').classList.toggle('activo', v); });
    $('#velocidad').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) setVelocidad(+b.dataset.v); });
    $('#estilo').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; setEstilo(b.dataset.e); avisar(b.dataset.e === 'progresion' ? 'Progresión de acordes: un loop de cuatro acordes elegido por el ánimo del mercado.' : 'Estilo libre: armonía generativa minuto a minuto.'); });
    try { const e = localStorage.getItem('campana.estilo'); if (e === 'progresion') setEstilo(e); } catch (err) { /* sin storage */ }
    $('#director').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; E.director = b.dataset.d; pintarDirector(); avisar(E.director === 'auto' ? 'Director automático: enfoca la acción más activa.' : 'Director manual: elegís el solista con las estrellas o ← →.'); });
    $('#volumen').addEventListener('input', (ev) => motor.setNivel('master', +ev.target.value));
    $('#btn-ocultar').addEventListener('click', () => ocultarHud(!E.hudOculto, false));
    $('#btn-pantalla').addEventListener('click', pantallaCompleta);
    $('#vivo-conectar').addEventListener('click', conectarVivo);
    $('#proveedor').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; E.proveedor = b.dataset.p; pintarProveedor(); });
    try {
      E.proveedor = localStorage.getItem('campana.proveedor') || 'alpaca';
      const t = localStorage.getItem('campana.tickers'); if (t) $('#vivo-tickers').value = t.split(',').join(', ');
      const f = localStorage.getItem('campana.feed'); if (f) $('#vivo-feed').value = f;
    } catch (e) { /* sin storage */ }
    pintarProveedor();

    $('#linea').addEventListener('click', (ev) => {
      const r = $('#linea').getBoundingClientRect(); const frac = clamp((ev.clientX - r.left) / r.width, 0, 1);
      if (E.fuente && E.fuente.tipo !== 'vivo') { saltar(frac * E.fuente.total); avisar(`Saltamos a las ${horaDe(Math.floor(frac * 390))}`); }
    });

    const lienzo = $('#lienzo');
    lienzo.addEventListener('click', (ev) => {
      const s = visual.estrellaEn(ev.clientX, ev.clientY);
      if (s) { E.director = 'manual'; pintarDirector(); cambiarSolista(s, E.m, false); }
    });
    window.addEventListener('mousemove', (ev) => {
      E.ocioso = 0; if (E.hudOculto) ocultarHud(false, true);
      visual.hover = visual.estrellaEn(ev.clientX, ev.clientY);
      lienzo.style.cursor = visual.hover ? 'pointer' : 'default';
    });
    window.addEventListener('touchstart', () => { E.ocioso = 0; if (E.hudOculto) ocultarHud(false, true); }, { passive: true });

    window.addEventListener('keydown', (ev) => {
      if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
      switch (ev.key) {
        case ' ': ev.preventDefault(); alternar(); break;
        case 'ArrowRight': solistaRelativo(1); break;
        case 'ArrowLeft': solistaRelativo(-1); break;
        case 'a': case 'A': E.director = E.director === 'auto' ? 'manual' : 'auto'; pintarDirector(); avisar(`Director ${E.director === 'auto' ? 'automático' : 'manual'}`); break;
        case 'h': case 'H': ocultarHud(!E.hudOculto, false); break;
        case 'p': case 'P': setEstilo(compositor.estilo === 'progresion' ? 'libre' : 'progresion'); avisar(compositor.estilo === 'progresion' ? 'Progresión de acordes' : 'Estilo libre'); break;
        case 'f': case 'F': pantallaCompleta(); break;
        case '1': setVelocidad(.5); break; case '2': setVelocidad(1); break; case '3': setVelocidad(2); break; case '4': setVelocidad(3); break;
        case 'n': case 'N': if (E.clave === 'sintetico') { E.semillaSintetica = Math.floor(Math.random() * 9999); cargarDia('sintetico'); reproducir(); } break;
      }
    });
  }
  function pantallaCompleta() {
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {});
  }

  armarUI();
  cargarDia(opcionesDias()[0].clave);
  requestAnimationFrame(cuadro);

  // para jugar desde la consola
  window.campana = { motor, visual, compositor, estado: E, cargarDia, saltar, cambiarSolista, reproducir, pausar };
})();
