// app.js — Ensayo: vistas, estado, sincronización y transporte.
(function () {
  'use strict';
  const C = window.Chart, Store = window.Store, Players = window.Players;
  const $ = (sel, root = document) => root.querySelector(sel);
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const INSTRUMENTS = {
    guitarra: { label: 'Guitarra', emoji: '🎸', desc: 'Base sin guitarra principal. Ves acordes y letra.', show: 'both', queries: ['guitar backing track', 'backing track sin guitarra', 'no lead guitar backing'] },
    bajo: { label: 'Bajo', emoji: '🎸', desc: 'Base sin bajo. Ves acordes y letra.', show: 'both', queries: ['bass backing track', 'bassless', 'backing track sin bajo'] },
    bateria: { label: 'Batería', emoji: '🥁', desc: 'Base sin batería. Ves acordes, letra y secciones.', show: 'both', queries: ['drumless', 'no drums', 'backing track sin batería'] },
    voz: { label: 'Voz', emoji: '🎤', desc: 'Karaoke: todo menos la voz. Solo letra.', show: 'lyrics', queries: ['karaoke', 'instrumental con coros', 'backing track vocal'] },
    teclado: { label: 'Teclado', emoji: '🎹', desc: 'Base sin piano/teclas. Ves acordes y letra.', show: 'both', queries: ['piano backing track', 'no piano backing track', 'backing track sin teclado'] },
    otro: { label: 'Otro', emoji: '🎵', desc: 'Vientos, cuerdas, lo que sea. Acordes y letra.', show: 'both', queries: ['backing track', 'instrumental'] },
  };
  const LEVELS = { principiante: 'Principiante', intermedio: 'Intermedio', avanzado: 'Avanzado' };
  const KEYS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B', 'Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];

  // ------------------------------------------------------------------ estado
  let S = Store.load();
  if (!S) S = Store.defaultState();
  function persist() { Store.save(S); }

  const CATALOG = window.Catalog || [];
  const catalogById = (id) => CATALOG.find(c => c.id === id);
  function norm(str) { return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

  /** Crea un tema a partir de una entrada del catálogo (bases de YouTube por instrumento incluidas). */
  function songFromCatalog(c) {
    const tracks = {};
    for (const [k, vid] of Object.entries(c.yt || {})) if (vid) tracks[k] = { type: 'youtube', videoId: vid, offset: 0 };
    return { id: Store.uid(), catalogId: c.id, title: c.title, artist: c.artist, key: c.key || '', bpm: c.bpm || null, beats: c.beats || 4,
      tags: c.tags || [], sections: c.sections || [], chordsConfidence: c.chordsConfidence || 'high', notes: '', chart: '',
      lyricsStatus: 'pending', tracks, transpose: 0, capo: 0, createdAt: Date.now() };
  }
  const STARTER = ['de-musica-ligera', 'knockin-on-heavens-door', 'wonderwall', 'flaca', 'creep', 'seminare', 'mil-horas', 'persiana-americana', 'let-it-be', 'sweet-child-o-mine', 'californication', 'ji-ji-ji', 'highway-to-hell', 'zombie'];
  function seedStarter(name = 'Ensayo con la banda') {
    const sl = { id: Store.uid(), name, songIds: [] };
    // Temas conocidos que ya traen base de YouTube, para que el primer Play suene de verdad.
    const picks = STARTER.map(catalogById).filter(c => c && c.yt && (c.yt._default || c.yt.guitarra)).slice(0, 8);
    for (const c of picks) { const song = songFromCatalog(c); S.songs.push(song); sl.songIds.push(song.id); }
    S.setlists.push(sl); S.currentSetlistId = sl.id; persist();
    return sl;
  }
  function migrate() {
    if ((S.version || 1) < 2) {
      // v1 traía 3 temas de ejemplo con metrónomo; si el usuario no cargó nada propio, arrancamos con el catálogo.
      if (!S.songs.length || S.songs.every(x => x.demo)) { S.songs = []; S.setlists = []; S.currentSetlistId = null; }
      S.version = 2;
    }
    if (!S.setlists.length) { if (CATALOG.length) seedStarter(); else { const sl = { id: Store.uid(), name: 'Ensayo con la banda', songIds: [] }; S.setlists.push(sl); S.currentSetlistId = sl.id; } }
    persist();
  }

  // Letra automática (LRCLIB). Una búsqueda en curso por tema.
  const lyricsInflight = {};
  function ensureLyrics(song, force) {
    if (!window.Lyrics) return Promise.resolve();
    if (!force && song.lyricsStatus && song.lyricsStatus !== 'pending') return Promise.resolve();
    if (lyricsInflight[song.id]) return lyricsInflight[song.id];
    song.lyricsStatus = 'pending';
    const c = song.catalogId ? catalogById(song.catalogId) : null;
    const artist = song.artist || (c && c.artist) || '';
    lyricsInflight[song.id] = window.Lyrics.fetchLyrics(song.title, artist).then((r) => {
      if (r.status === 'synced' || r.status === 'plain') { if (!(song.chart || '').trim()) song.chart = r.chart; song.lyricsStatus = r.status; if (r.duration && !song.duration) song.duration = r.duration; }
      else song.lyricsStatus = 'notfound';
    }).catch(() => { song.lyricsStatus = 'notfound'; }).then(() => { delete lyricsInflight[song.id]; persist(); });
    return lyricsInflight[song.id];
  }
  migrate();

  const songById = (id) => S.songs.find(s => s.id === id);
  const currentSetlist = () => S.setlists.find(s => s.id === S.currentSetlistId) || S.setlists[0];
  const myInstrument = () => S.profile.instrument || 'otro';
  function trackFor(song, inst = myInstrument()) { return (song.tracks && (song.tracks[inst] || song.tracks._default)) || null; }
  function trackLabel(tr) {
    if (!tr) return 'Sin base';
    if (tr.type === 'youtube') return 'YouTube';
    if (tr.type === 'local') return tr.name ? 'Archivo: ' + tr.name : 'Archivo';
    if (tr.type === 'metronome') return 'Metrónomo';
    return tr.type;
  }

  // ------------------------------------------------------------------ audio
  // iOS/Safari solo deja arrancar audio dentro de un toque del usuario, y el
  // interruptor de silencio del iPhone apaga Web Audio salvo que haya un <audio>
  // HTML reproduciendo. AudioEngine.unlock() se llama en el primer toque a Play.
  const AudioEngine = {
    ctx: null, silent: null, unlocked: false,
    unlock() {
      try {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        if (!this.unlocked) {
          const src = this.ctx.createBufferSource();
          src.buffer = this.ctx.createBuffer(1, 1, 22050);
          src.connect(this.ctx.destination); src.start(0);
          this.unlocked = true;
        }
      } catch (e) { console.warn('AudioContext no disponible', e); }
      return this.ctx;
    },
    // <audio> en loop con silencio: hace que iOS trate la página como reproductor
    // de música (ignora el switch de silencio). Solo se usa con el metrónomo.
    keepAlive(on) {
      if (on) {
        if (!this.silent) {
          const a = new Audio(silentWavUrl()); a.loop = true; a.volume = 0.01; a.setAttribute('playsinline', '');
          this.silent = a;
        }
        this.silent.play().catch(() => { });
      } else if (this.silent) { this.silent.pause(); }
    },
  };
  let _silentUrl = null;
  function silentWavUrl() {
    if (_silentUrl) return _silentUrl;
    const rate = 8000, secs = 1, n = rate * secs;
    const buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    _silentUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    return _silentUrl;
  }

  function toast(msg, ms = 2200, err) { const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', !!err); t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms); }
  // Errores inesperados visibles en pantalla (para poder diagnosticar desde una captura).
  window.addEventListener('error', (e) => toast('Error: ' + (e.message || e.error) + ' (' + String(e.filename || '').split('/').pop() + ':' + e.lineno + ')', 8000, true));
  window.addEventListener('unhandledrejection', (e) => toast('Error: ' + (e.reason && e.reason.message || e.reason), 8000, true));

  // ------------------------------------------------------------------ router
  const app = $('#app');
  let practice = null; // sesión de práctica activa

  function route() {
    if (practice) { practice.destroy(); practice = null; }
    document.body.classList.remove('in-practice');
    const hash = location.hash.replace(/^#\/?/, '');
    const [view, arg, arg2] = hash.split('/');
    if (!S.profile.instrument) return renderOnboarding();
    switch (view) {
      case 'practice': return renderPractice(arg, arg2);
      case 'add': return renderAdd(decodeURIComponent(arg || ''));
      case 'edit': return renderEdit(arg);
      case 'takes': return renderTakes();
      case 'settings': return renderSettings();
      default: return renderSetlist();
    }
  }
  window.addEventListener('hashchange', route);
  const go = (path) => { if (location.hash === '#' + path) route(); else location.hash = path; };

  function shell(active, inner) {
    const inst = INSTRUMENTS[myInstrument()];
    app.innerHTML = '';
    app.appendChild(h(`
      <header class="topbar">
        <a class="brand" href="#setlist" style="text-decoration:none;color:inherit"><span class="logo">▶</span> Ensayo</a>
        <button class="chip accent" id="instchip" title="Cambiar instrumento">${inst.emoji} ${inst.label}</button>
        <nav>
          <a href="#setlist" class="${active === 'setlist' ? 'active' : ''}">Setlist</a>
          <a href="#takes" class="${active === 'takes' ? 'active' : ''}">Tomas</a>
          <a href="#settings" class="${active === 'settings' ? 'active' : ''}">Ajustes</a>
        </nav>
      </header>`));
    $('#instchip').onclick = () => go('settings');
    const page = h('<main class="page"></main>');
    page.appendChild(inner);
    app.appendChild(page);
  }

  // ------------------------------------------------------------------ onboarding
  function renderOnboarding() {
    let inst = null, level = 'intermedio';
    app.innerHTML = '';
    const el = h(`
      <div class="onboard"><div class="card">
        <h1>¿Qué tocás?</h1>
        <p class="lead">Ensayo te arma la base sin tu instrumento y te muestra la letra y los acordes sincronizados, para que practiques los temas de tu banda aunque la banda no esté.</p>
        <div class="instruments"></div>
        <p class="small muted" style="margin:0 0 8px">Nivel</p>
        <div class="levels"></div>
        <div class="row"><button class="btn primary xl" id="start" disabled>Empezar</button><span class="small muted">Podés cambiarlo después en Ajustes.</span></div>
      </div></div>`);
    const grid = $('.instruments', el);
    for (const [k, v] of Object.entries(INSTRUMENTS)) {
      const b = h(`<button class="instrument"><span class="emoji">${v.emoji}</span><span class="name">${v.label}</span><span class="desc">${v.desc}</span></button>`);
      b.onclick = () => { inst = k; grid.querySelectorAll('.instrument').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); $('#start', el).disabled = false; };
      grid.appendChild(b);
    }
    const lv = $('.levels', el);
    for (const [k, v] of Object.entries(LEVELS)) {
      const b = h(`<button class="btn ${k === level ? 'active' : ''}">${v}</button>`);
      b.onclick = () => { level = k; lv.querySelectorAll('.btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); };
      lv.appendChild(b);
    }
    $('#start', el).onclick = () => { S.profile.instrument = inst; S.profile.level = level; persist(); go('setlist'); };
    app.appendChild(el);
  }

  // ------------------------------------------------------------------ setlist
  function renderSetlist() {
    const sl = currentSetlist();
    const inst = myInstrument();
    const inner = h(`<div>
      <div class="setlist-head">
        <select id="slsel"></select>
        <button class="btn sm" id="slnew">+ Nueva setlist</button>
        <button class="btn sm ghost" id="slren">Renombrar</button>
        <span class="grow"></span>
        <button class="btn primary" id="songnew">+ Agregar tema</button>
      </div>
      <div class="songs" id="songs"></div>
      <h2>Biblioteca</h2>
      <div class="songs" id="library"></div>
    </div>`);
    const sel = $('#slsel', inner);
    for (const s of S.setlists) sel.appendChild(h(`<option value="${s.id}" ${s.id === sl.id ? 'selected' : ''}>${esc(s.name)}</option>`));
    sel.onchange = () => { S.currentSetlistId = sel.value; persist(); route(); };
    $('#slnew', inner).onclick = () => { const name = prompt('Nombre de la setlist', 'Show ' + new Date().toLocaleDateString('es-AR')); if (!name) return; const n = { id: Store.uid(), name, songIds: [] }; S.setlists.push(n); S.currentSetlistId = n.id; persist(); route(); };
    $('#slren', inner).onclick = () => { const name = prompt('Nuevo nombre', sl.name); if (!name) return; sl.name = name; persist(); route(); };
    $('#songnew', inner).onclick = () => go('add');

    const list = $('#songs', inner);
    const songs = sl.songIds.map(songById).filter(Boolean);
    if (!songs.length) list.appendChild(h('<div class="empty">La setlist está vacía. Tocá <b>+ Agregar tema</b> y buscá los temas que ensaya tu banda.</div>'));
    songs.forEach((song, i) => {
      const tr = trackFor(song, inst);
      const parsed = C.parse(song.chart || '');
      const synced = parsed.timed.length;
      const trChip = tr ? `<span class="chip ${tr.type === 'metronome' ? '' : 'ok'}">${tr.type === 'youtube' ? '▶ YouTube' : tr.type === 'local' ? '🎵 Archivo' : '⏱ Metrónomo'}</span>` : `<span class="chip warn">Sin base para ${INSTRUMENTS[inst].label.toLowerCase()}</span>`;
      const card = h(`<div class="song">
        <div class="num">${i + 1}</div>
        <div>
          <div class="title">${esc(song.title)}</div>
          <div class="sub"><span>${esc(song.artist || '')}</span>
            ${song.key ? `<span class="keybadge">${esc(song.key)}${song.transpose ? ' → <b>' + esc(C.transposeKey(song.key, song.transpose)) + '</b>' : ''}</span>` : ''}
            ${song.bpm ? `<span class="muted">${song.bpm} bpm</span>` : ''}
            ${trChip}
            <span class="chip">${synced ? '🎤 letra sync' : song.lyricsStatus === 'pending' ? '⏳ letra…' : song.lyricsStatus === 'plain' ? 'letra sin tiempos' : 'sin letra'}</span>
          </div>
        </div>
        <div class="actions">
          <div class="order"><button title="Subir">▲</button><button title="Bajar">▼</button></div>
          <button class="btn sm ghost" data-a="edit">Editar</button>
          <button class="btn sm ghost danger" data-a="remove" title="Quitar de la setlist">✕</button>
          <button class="btn sm primary" data-a="play">Ensayar</button>
        </div></div>`);
      const [up, down] = card.querySelectorAll('.order button');
      up.onclick = () => { if (i > 0) { [sl.songIds[i - 1], sl.songIds[i]] = [sl.songIds[i], sl.songIds[i - 1]]; persist(); route(); } };
      down.onclick = () => { if (i < sl.songIds.length - 1) { [sl.songIds[i + 1], sl.songIds[i]] = [sl.songIds[i], sl.songIds[i + 1]]; persist(); route(); } };
      card.querySelector('[data-a=edit]').onclick = () => go('edit/' + song.id);
      card.querySelector('[data-a=remove]').onclick = () => { sl.songIds = sl.songIds.filter(id => id !== song.id); persist(); route(); };
      card.querySelector('[data-a=play]').onclick = () => go('practice/' + song.id);
      list.appendChild(card);
    });

    const lib = $('#library', inner);
    const others = S.songs.filter(s => !sl.songIds.includes(s.id));
    if (!others.length) lib.appendChild(h('<div class="empty small">Todos tus temas están en esta setlist.</div>'));
    for (const song of others) {
      const card = h(`<div class="song"><div class="num">·</div><div><div class="title">${esc(song.title)}</div><div class="sub">${esc(song.artist || '')} ${song.key ? '· ' + esc(song.key) : ''}</div></div>
        <div class="actions"><button class="btn sm ghost" data-a="edit">Editar</button><button class="btn sm ghost danger" data-a="del">Borrar</button><button class="btn sm" data-a="add">+ Agregar</button><button class="btn sm primary" data-a="play">Ensayar</button></div></div>`);
      card.querySelector('[data-a=add]').onclick = () => { sl.songIds.push(song.id); persist(); route(); };
      card.querySelector('[data-a=edit]').onclick = () => go('edit/' + song.id);
      card.querySelector('[data-a=play]').onclick = () => go('practice/' + song.id);
      card.querySelector('[data-a=del]').onclick = () => { if (confirm(`¿Borrar "${song.title}" de la biblioteca?`)) { S.songs = S.songs.filter(s => s.id !== song.id); S.setlists.forEach(x => x.songIds = x.songIds.filter(id => id !== song.id)); persist(); route(); } };
      lib.appendChild(card);
    }
    shell('setlist', inner);
  }

  // ------------------------------------------------------------------ agregar tema (catálogo)
  function renderAdd(initialQuery) {
    const inst = myInstrument();
    const sl = currentSetlist();
    const inner = h(`<div>
      <div class="row" style="margin-bottom:12px"><a class="btn ghost" href="#setlist">← Volver</a><h1 style="margin:0">Agregar tema</h1></div>
      <input class="search" id="q" placeholder="Buscá por título o artista…" autocomplete="off" value="${esc(initialQuery)}">
      <p class="small muted" id="hint">${CATALOG.length} temas con base lista para ${INSTRUMENTS[inst].label.toLowerCase()} y otros instrumentos. Si no está, lo agregás igual y buscamos la base en YouTube.</p>
      <div class="results" id="results"></div>
      <div class="row" style="margin-top:20px"><button class="btn ghost" id="manual">✏️ Crear a mano (pegar letra y acordes)</button></div>
    </div>`);
    const qEl = $('#q', inner), res = $('#results', inner);
    const inSetlist = new Set(sl ? sl.songIds.map(id => (songById(id) || {}).catalogId).filter(Boolean) : []);
    function render() {
      const query = norm(qEl.value);
      const words = query.split(' ').filter(Boolean);
      let items = CATALOG.filter(c => { const hay = norm(c.title + ' ' + c.artist + ' ' + (c.tags || []).join(' ')); return words.every(w => hay.includes(w)); });
      if (!query) items = items.slice(0, 40);
      res.innerHTML = '';
      for (const c of items.slice(0, 60)) {
        const yt = c.yt || {};
        const base = yt[inst] ? `<span class="chip ok">▶ base para ${INSTRUMENTS[inst].label.toLowerCase()}</span>` : yt._default || Object.keys(yt).length ? '<span class="chip">▶ base genérica</span>' : '<span class="chip warn">sin base (la buscamos)</span>';
        const added = inSetlist.has(c.id);
        const card = h(`<button class="result ${added ? 'added' : ''}"><div><div class="title">${esc(c.title)}</div><div class="sub">${esc(c.artist)} ${c.key ? '· ' + esc(c.key) : ''} ${c.bpm ? '· ' + c.bpm + ' bpm' : ''}</div></div><div class="right">${added ? '<span class="chip accent">en la setlist</span>' : base}</div></button>`);
        card.onclick = () => addFromCatalog(c);
        res.appendChild(card);
      }
      if (qEl.value.trim() && items.length < 3) {
        const raw = qEl.value.trim();
        const card = h(`<button class="result manual"><div><div class="title">Agregar "${esc(raw)}" igual</div><div class="sub">No está en el catálogo. Buscamos la letra y la base en YouTube.</div></div><div class="right"><span class="chip">＋</span></div></button>`);
        card.onclick = () => addCustom(raw);
        res.appendChild(card);
      }
      if (!items.length && !qEl.value.trim()) res.appendChild(h('<div class="empty">El catálogo no cargó. Probá recargar la página.</div>'));
    }
    function addFromCatalog(c) {
      const song = songFromCatalog(c);
      S.songs.push(song); if (sl) sl.songIds.push(song.id); persist();
      ensureLyrics(song);
      toast(`"${c.title}" agregado a la setlist`);
      go('practice/' + song.id);
    }
    function addCustom(raw) {
      let title = raw, artist = '';
      const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(raw); if (m) { title = m[1].trim(); artist = m[2].trim(); }
      const song = { id: Store.uid(), title, artist, key: '', bpm: null, beats: 4, tags: [], sections: [], notes: '', chart: '', lyricsStatus: 'pending', tracks: {}, transpose: 0, capo: 0, createdAt: Date.now() };
      S.songs.push(song); if (sl) sl.songIds.push(song.id); persist();
      ensureLyrics(song);
      go('practice/' + song.id);
    }
    qEl.oninput = render;
    $('#manual', inner).onclick = () => go('edit/new');
    render();
    shell('setlist', inner);
    setTimeout(() => { if (!initialQuery) qEl.focus(); }, 50);
  }

  // ------------------------------------------------------------------ editor de tema
  function renderEdit(id) {
    const isNew = !id || id === 'new';
    const song = isNew ? { id: Store.uid(), title: '', artist: '', key: '', bpm: '', beats: 4, tags: [], sections: [], notes: '', chart: '', lyricsStatus: null, tracks: {}, transpose: 0, capo: 0, createdAt: Date.now() } : songById(id);
    if (!song) return go('setlist');
    const inst = myInstrument();
    const inner = h(`<div>
      <div class="row" style="margin-bottom:16px"><a class="btn ghost" href="#setlist">← Volver</a><h1 style="margin:0">${isNew ? 'Nuevo tema' : 'Editar tema'}</h1></div>
      <div class="card">
        <div class="grid-2">
          <div class="field"><label>Título</label><input id="f-title" value="${esc(song.title)}" placeholder="Ej: De música ligera"></div>
          <div class="field"><label>Artista</label><input id="f-artist" value="${esc(song.artist)}" placeholder="Ej: Soda Stereo"></div>
        </div>
        <div class="grid-3">
          <div class="field"><label>Tonalidad original</label><select id="f-key"><option value="">—</option>${KEYS.map(k => `<option ${k === song.key ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
          <div class="field"><label>BPM</label><input id="f-bpm" type="number" min="30" max="300" value="${esc(song.bpm)}" placeholder="120"></div>
          <div class="field"><label>Tiempos por compás</label><select id="f-beats">${[2, 3, 4, 6].map(b => `<option ${b === (song.beats || 4) ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Notas para el ensayo</label><input id="f-notes" value="${esc(song.notes)}" placeholder="Ej: la intro la hace el teclado, entrar en el 2do compás"></div>
        <div class="field"><label>Acordes por sección <span class="muted">— una por línea, "Sección: acordes"</span></label><textarea id="f-sections" style="min-height:90px;white-space:pre-wrap" placeholder="Intro: Am F C G\nVerso: Am F C G\nEstribillo: F G Am">${esc((song.sections || []).map(x => x.name + ': ' + x.chords).join('\n'))}</textarea></div>
      </div>

      <h2>Backing track por instrumento</h2>
      <p class="small muted">Cada instrumento tiene su propia base (sin ese instrumento). Vos estás en <b>${INSTRUMENTS[inst].label}</b>. La base "Cualquiera" se usa si un instrumento no tiene la suya.</p>
      <div class="tracks-grid" id="tracks"></div>

      <h2>Letra y acordes (ChordPro)</h2>
      <div class="card">
        <div class="row" style="margin-bottom:10px">
          <button class="btn sm" id="paste">📋 Pegar del portapapeles</button>
          <button class="btn sm" id="convert">Convertir "acordes arriba de la letra"</button>
          <button class="btn sm ghost" id="help">¿Cómo se escribe?</button>
        </div>
        <div class="field"><textarea id="f-chart" spellcheck="false" placeholder="[Intro]\n[0:00.00] [Am] [C] [D] [F]\n\n[Verso 1]\n[0:12.30] There [Am]is a [C]house in [D]New Or[F]leans">${esc(song.chart)}</textarea>
          <div class="help" id="chart-stats"></div></div>
        <details id="helpbox" class="hidden"><summary>Formato</summary>
          <div class="small muted">
            <p>Acordes entre corchetes, justo antes de la sílaba donde cambian: <code>There [Am]is a [C]house</code>.</p>
            <p>Secciones entre corchetes en una línea sola: <code>[Intro]</code>, <code>[Verso 1]</code>, <code>[Estribillo]</code>, <code>[Solo]</code>. También sirve <code>{soc}</code>/<code>{eoc}</code> de ChordPro.</p>
            <p>Tiempo de cada línea al principio: <code>[1:23.45]</code>. No hace falta escribirlos a mano: en Ensayar → <b>Sincronizar</b> los marcás tocando un botón mientras suena la base.</p>
            <p>Líneas solo de acordes (intro, solo): <code>[A7] [D7] [A7] [E7]</code>. Comentarios: <code>{c: cortar en seco}</code>. Tablaturas: entre <code>{sot}</code> y <code>{eot}</code>.</p>
            <p>Si pegás desde Ultimate Guitar / LaCuerda (acordes arriba de la letra), apretá <b>Convertir</b>.</p>
          </div></details>
      </div>
      <div class="row" style="margin-top:16px">
        <button class="btn primary xl" id="save">Guardar</button>
        <button class="btn" id="save-play">Guardar y ensayar</button>
        ${isNew ? '' : '<span class="grow"></span><button class="btn ghost danger" id="del">Borrar tema</button>'}
      </div>
    </div>`);

    // --- tracks
    const tracks = JSON.parse(JSON.stringify(song.tracks || {}));
    const tgrid = $('#tracks', inner);
    const slots = [inst, ...Object.keys(INSTRUMENTS).filter(k => k !== inst), '_default'];
    const pendingFiles = {};
    for (const slot of slots) {
      const label = slot === '_default' ? '🎵 Cualquiera (fallback)' : `${INSTRUMENTS[slot].emoji} ${INSTRUMENTS[slot].label}`;
      const tr = tracks[slot] || { type: '' };
      const card = h(`<div class="track-card ${slot === inst ? 'mine' : ''}"><h4>${label} ${slot === inst ? '<span class="chip accent">tu instrumento</span>' : ''}</h4>
        <div class="field"><label>Fuente</label><select class="src"><option value="">Sin base</option><option value="youtube" ${tr.type === 'youtube' ? 'selected' : ''}>YouTube</option><option value="local" ${tr.type === 'local' ? 'selected' : ''}>Archivo de audio (mp3, wav, m4a)</option><option value="metronome" ${tr.type === 'metronome' ? 'selected' : ''}>Metrónomo</option></select></div>
        <div class="src-youtube ${tr.type === 'youtube' ? '' : 'hidden'}">
          <div class="field"><label>Link o ID de YouTube</label><input class="yturl" value="${esc(tr.url || tr.videoId || '')}" placeholder="https://www.youtube.com/watch?v=..."></div>
          <div class="row" style="margin-bottom:10px"><button class="btn sm ytsearch">🔎 Buscar backing en YouTube</button><button class="btn sm ghost ytsearch-in ${S.settings.ytApiKey ? '' : 'hidden'}">Buscar acá (API)</button></div>
          <div class="yt-results"></div>
        </div>
        <div class="src-local ${tr.type === 'local' ? '' : 'hidden'}">
          <div class="field"><label>Archivo ${tr.name ? '(actual: ' + esc(tr.name) + ')' : ''}</label><input type="file" class="file" accept="audio/*"></div>
        </div>
        <div class="field"><label>Desfase (seg) <span class="muted">— si la base arranca antes/después que los tiempos del cifrado</span></label><input class="offset" type="number" step="0.1" value="${tr.offset || 0}"></div>
      </div>`);
      const src = $('.src', card);
      src.onchange = () => { $('.src-youtube', card).classList.toggle('hidden', src.value !== 'youtube'); $('.src-local', card).classList.toggle('hidden', src.value !== 'local'); };
      $('.ytsearch', card).onclick = () => {
        const q = buildQuery(slot);
        window.open('https://www.youtube.com/results?search_query=' + encodeURIComponent(q), '_blank');
        toast('Buscá una base que te guste, copiá el link y pegalo acá.', 4000);
      };
      $('.ytsearch-in', card).onclick = () => ytSearchInApp(buildQuery(slot), $('.yt-results', card), (vid) => { $('.yturl', card).value = 'https://www.youtube.com/watch?v=' + vid; });
      $('.file', card).onchange = (e) => { pendingFiles[slot] = e.target.files[0] || null; };
      card._slot = slot;
      tgrid.appendChild(card);
    }
    function buildQuery(slot) {
      const t = $('#f-title', inner).value.trim(), a = $('#f-artist', inner).value.trim();
      const q = INSTRUMENTS[slot === '_default' ? 'otro' : slot].queries[0];
      return `${t} ${a} ${q}`.trim();
    }

    // --- chart
    const ta = $('#f-chart', inner);
    const stats = $('#chart-stats', inner);
    const updateStats = () => { const p = C.parse(ta.value); const chords = C.uniqueChords(p); stats.textContent = `${p.lines.filter(l => l.type === 'line').length} líneas · ${p.timed.length} con tiempo · ${p.sections.length} secciones · acordes: ${chords.join(' ') || '—'}`; };
    ta.oninput = updateStats; updateStats();
    $('#paste', inner).onclick = async () => { try { const t = await navigator.clipboard.readText(); ta.value = (ta.value ? ta.value + '\n' : '') + t; updateStats(); } catch (e) { toast('El navegador no dejó leer el portapapeles. Pegá con Ctrl+V.'); } };
    $('#convert', inner).onclick = () => { ta.value = C.convertChordsOverLyrics(ta.value); updateStats(); toast('Convertido a acordes inline'); };
    $('#help', inner).onclick = () => { const hb = $('#helpbox', inner); hb.classList.toggle('hidden'); hb.open = true; };

    async function collect() {
      song.title = $('#f-title', inner).value.trim() || 'Sin título';
      song.artist = $('#f-artist', inner).value.trim();
      song.key = $('#f-key', inner).value;
      song.bpm = parseFloat($('#f-bpm', inner).value) || null;
      song.beats = parseInt($('#f-beats', inner).value, 10) || 4;
      song.notes = $('#f-notes', inner).value.trim();
      song.sections = $('#f-sections', inner).value.split('\n').map(l => { const m = /^\s*([^:]+):\s*(.+)$/.exec(l); return m ? { name: m[1].trim(), chords: m[2].trim() } : null; }).filter(Boolean);
      song.chart = ta.value;
      if (song.chart.trim()) song.lyricsStatus = C.parse(song.chart).timed.length ? 'synced' : 'plain';
      const meta = C.parse(song.chart).meta;
      if (!song.key && meta.key) song.key = meta.key;
      if (!song.bpm && meta.bpm) song.bpm = meta.bpm;
      if (song.title === 'Sin título' && meta.title) song.title = meta.title;
      if (!song.artist && meta.artist) song.artist = meta.artist;
      const newTracks = {};
      for (const card of tgrid.children) {
        const slot = card._slot, type = $('.src', card).value;
        if (!type) continue;
        const prev = tracks[slot] || {};
        const tr = { type, offset: parseFloat($('.offset', card).value) || 0 };
        if (type === 'youtube') {
          const url = $('.yturl', card).value.trim();
          const vid = Players.parseYouTubeId(url);
          if (!vid) { toast('Link de YouTube inválido en ' + slot); throw new Error('bad url'); }
          tr.url = url; tr.videoId = vid;
        } else if (type === 'local') {
          const f = pendingFiles[slot];
          if (f) { tr.fileId = Store.uid(); tr.name = f.name; await Store.putFile(tr.fileId, f); if (prev.fileId) Store.deleteFile(prev.fileId).catch(() => { }); }
          else if (prev.type === 'local' && prev.fileId) { tr.fileId = prev.fileId; tr.name = prev.name; }
          else { toast('Elegí un archivo de audio para ' + slot); throw new Error('no file'); }
        }
        newTracks[slot] = tr;
      }
      song.tracks = newTracks;
      if (isNew) { S.songs.push(song); const sl = currentSetlist(); if (sl) sl.songIds.push(song.id); }
      persist();
    }
    $('#save', inner).onclick = async () => { try { await collect(); toast('Guardado'); go('setlist'); } catch (e) { } };
    $('#save-play', inner).onclick = async () => { try { await collect(); go('practice/' + song.id); } catch (e) { } };
    if (!isNew) $('#del', inner).onclick = () => { if (confirm(`¿Borrar "${song.title}"?`)) { S.songs = S.songs.filter(s => s.id !== song.id); S.setlists.forEach(x => x.songIds = x.songIds.filter(i => i !== song.id)); persist(); go('setlist'); } };
    shell('setlist', inner);
  }

  async function ytSearchInApp(q, resultsEl, onPick) {
    const key = S.settings.ytApiKey;
    if (!key) return toast('Cargá una API key de YouTube en Ajustes');
    resultsEl.innerHTML = '<div class="small muted">Buscando…</div>';
    try {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=8&q=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`);
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      resultsEl.innerHTML = '';
      for (const it of j.items || []) {
        const vid = it.id.videoId, sn = it.snippet;
        const b = h(`<button class="yt-result"><img src="${esc(sn.thumbnails.default.url)}" alt=""><div><div class="t">${esc(sn.title)}</div><div class="c">${esc(sn.channelTitle)}</div></div></button>`);
        b.onclick = () => { resultsEl.querySelectorAll('.yt-result').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); onPick(vid); };
        resultsEl.appendChild(b);
      }
      if (!(j.items || []).length) resultsEl.innerHTML = '<div class="small muted">Sin resultados.</div>';
    } catch (e) { resultsEl.innerHTML = `<div class="small" style="color:var(--danger)">Error: ${esc(e.message)}</div>`; }
  }

  // ------------------------------------------------------------------ práctica
  function renderPractice(songId, takeId) {
    const song = songById(songId);
    if (!song) return go('setlist');
    const inst = myInstrument();
    const instDef = INSTRUMENTS[inst];
    const sl = currentSetlist();
    const idx = sl ? sl.songIds.indexOf(song.id) : -1;
    const prevId = idx > 0 ? sl.songIds[idx - 1] : null, nextId = idx >= 0 && idx < sl.songIds.length - 1 ? sl.songIds[idx + 1] : null;
    let track = trackFor(song, inst);
    let parsed = C.parse(song.chart || '');
    const show = { chords: instDef.show !== 'lyrics' && S.settings.showChords, lyrics: S.settings.showLyrics };
    const st = { transpose: song.transpose || 0, capo: song.capo || 0, loopA: null, loopB: null, rate: 1, sync: false, syncTarget: -1, syncUndo: [], countdown: 0, chordsOpen: true };
    const recorder = new window.Recorder();
    document.body.classList.add('in-practice');

    app.innerHTML = '';
    const el = h(`<div class="practice">
      <div class="phead">
        <a class="btn icon ghost" href="#setlist" title="Volver a la setlist">←</a>
        <button class="btn icon ghost" id="prev" ${prevId ? '' : 'disabled'} title="Tema anterior">⏮</button>
        <div class="grow" style="min-width:0"><div class="ttl">${esc(song.title)}</div><div class="art">${esc(song.artist || '')}${song.notes ? '<i> · ' + esc(song.notes) + '</i>' : ''}</div></div>
        <button class="btn icon ghost" id="next" ${nextId ? '' : 'disabled'} title="Tema siguiente">⏭</button>
        <div class="meta">
          <span class="keybadge" id="keybadge"></span>
          <span class="chip accent">${instDef.emoji} ${instDef.label}</span>
          <button class="btn sm ghost" id="edit">Editar</button>
        </div>
      </div>
      <div class="chart-wrap" id="chartwrap">
        <div class="chordpanel hidden" id="chordpanel"></div>
        <div class="chart" id="chart"></div>
      </div>
      <aside class="dock">
        <div class="player-box"><div id="playerbox"></div><div class="countin hidden" id="countin"></div></div>
        <video class="rec-preview" id="recpreview" playsinline muted></video>
        <div class="player-note" id="playernote"><span id="notetext"></span> <button class="linkbtn" id="changebase">Cambiar base</button></div>
        <div class="transport">
          <div class="main">
            <button class="play" id="play" title="Play/Pausa (espacio)">▶</button>
            <div class="grow"><input type="range" id="seek" min="0" max="1000" value="0"><div class="time"><span id="tcur">0:00</span> / <span id="tdur">0:00</span></div></div>
          </div>
          <div class="ctl">
            <button class="btn" id="rate" title="Velocidad (el tono no cambia)"><span>Velocidad</span><span class="v" id="ratev">1×</span></button>
            <div class="btn stepper" title="Transponer acordes (solo la pantalla; el audio no cambia)"><button id="transpm">−</button><span><span>Tono</span><span class="v" id="transpv">0</span></span><button id="transpp">+</button></div>
            <div class="btn stepper" title="Capo: muestra las posiciones con capotraste"><button id="capom">−</button><span><span>Capo</span><span class="v" id="capov">0</span></span><button id="capop">+</button></div>
            <div class="btn stepper" title="Si la letra va adelantada o atrasada respecto a la base"><button id="offm">−</button><span><span>Desfase</span><span class="v" id="offv">0s</span></span><button id="offp">+</button></div>
            <button class="btn" id="font" title="Tamaño de letra"><span>Letra</span><span class="v">Aa</span></button>
          </div>
          <div class="ctl">
            <button class="btn" id="loopA" title="Marcar inicio del loop ([)"><span>Loop A</span><span class="v" id="loopAv">—</span></button>
            <button class="btn" id="loopB" title="Marcar fin del loop (])"><span>Loop B</span><span class="v" id="loopBv">—</span></button>
            <button class="btn ghost" id="loopX" title="Quitar loop (L)"><span>✕ loop</span></button>
            <button class="btn ${show.chords ? 'active' : ''}" id="tchords" ${instDef.show === 'lyrics' ? 'disabled' : ''}><span>Acordes</span></button>
            <button class="btn ${show.lyrics ? 'active' : ''}" id="tlyrics"><span>Letra</span></button>
            <button class="btn ${S.settings.countIn ? 'active' : ''}" id="tcount" title="Un compás de clicks antes de arrancar"><span>Count-in</span></button>
            <button class="btn" id="tsync" title="Marcar el tiempo de cada línea mientras suena"><span>Sincronizar</span></button>
            <button class="btn rec" id="recA" title="Grabar audio del micrófono">● Audio</button>
            <button class="btn rec" id="recV" title="Grabar cámara + micrófono">● Video</button>
          </div>
        </div>
        <div class="sections-bar" id="sections"></div>
        <div class="status-line" id="status"></div>
      </aside>
      <div class="syncpanel hidden" id="syncpanel">
        <button class="stamp" id="stamp">MARCAR LÍNEA <span class="kbd">Enter</span></button>
        <button class="btn" id="syncundo">Deshacer</button>
        <button class="btn" id="syncshiftm" title="Correr todos los tiempos 0.25s antes">−0.25s</button>
        <button class="btn" id="syncshiftp" title="Correr todos los tiempos 0.25s después">+0.25s</button>
        <button class="btn" id="syncclear">Borrar tiempos</button>
        <button class="btn primary" id="syncsave">Guardar</button>
        <button class="btn ghost" id="synccancel">Cancelar</button>
        <div class="info" id="syncinfo">Dale play y apretá MARCAR (o Enter) cuando empiece cada línea. Tocá una línea del cifrado para elegir desde dónde marcar.</div>
      </div>
    </div>`);
    app.appendChild(el);
    const q = (s) => $(s, el);
    const chartEl = q('#chart'), wrap = q('#chartwrap');
    chartEl.style.setProperty('--chart-scale', (S.settings.fontSize || 100) / 100);
    q('#prev').onclick = () => prevId && go('practice/' + prevId);
    q('#next').onclick = () => nextId && go('practice/' + nextId);
    q('#edit').onclick = () => go('edit/' + song.id);

    // ---- panel de acordes por sección (cifrado básico del catálogo)
    function renderChordPanel() {
      const cp = q('#chordpanel');
      const secs = (song.sections || []).filter(s => s.chords);
      if (!show.chords || !secs.length) { cp.classList.add('hidden'); return; }
      cp.classList.remove('hidden');
      const semis = st.transpose - st.capo;
      const flats = C.useFlats(C.transposeKey(song.key, semis));
      cp.innerHTML = `<div class="cp-head"><span>Acordes${song.chordsConfidence === 'low' ? ' <span class="muted">(aprox.)</span>' : ''}</span><span class="muted">${st.chordsOpen ? 'ocultar ▴' : 'mostrar ▾'}</span></div>`;
      if (st.chordsOpen) for (const s of secs) {
        const chords = s.chords.split(/\s+/).filter(Boolean).map(c => C.isChord(c) ? C.transposeChord(c, semis, flats) : c);
        cp.appendChild(h(`<div class="cp-row"><span class="cp-name">${esc(s.name)}</span><span class="cp-chords">${chords.map(c => `<b>${esc(c)}</b>`).join(' ')}</span></div>`));
      }
      $('.cp-head', cp).onclick = () => { st.chordsOpen = !st.chordsOpen; renderChordPanel(); };
    }

    // ---- render chart
    let lineEls = [];
    function renderChart() {
      chartEl.innerHTML = '';
      chartEl.classList.toggle('hide-chords', !show.chords);
      chartEl.classList.toggle('hide-lyrics', !show.lyrics);
      lineEls = [];
      const semis = st.transpose - st.capo;
      const targetKey = C.transposeKey(song.key, st.transpose);
      const flats = C.useFlats(C.transposeKey(song.key, semis));
      const hasLines = parsed.lines.some(l => l.type === 'line');
      if (song.lyricsStatus === 'pending') chartEl.appendChild(h(`<div class="nosync">⏳ Buscando la letra sincronizada…</div>`));
      else if (!hasLines) chartEl.appendChild(h(`<div class="nosync">No encontré la letra de este tema. Podés seguir con los acordes de arriba, o tocar <b>Editar</b> y pegar la letra. <button class="btn sm" id="retrylyrics">Buscar de nuevo</button></div>`));
      else if (!parsed.timed.length) chartEl.appendChild(h(`<div class="nosync">La letra no tiene tiempos: no se va a mover sola con la base. Apretá <b>Sincronizar</b>, dale play y marcá cada línea cuando empiece. Se hace una vez y queda.</div>`));
      const rl = $('#retrylyrics', chartEl); if (rl) rl.onclick = () => { song.lyricsStatus = 'pending'; persist(); renderChart(); ensureLyrics(song, true); };
      parsed.lines.forEach((l, i) => {
        let node;
        if (l.type === 'section') {
          node = h(`<div class="section">${esc(l.text)} <span class="t">${l.section && l.section.time != null ? C.formatClock(l.section.time) : ''}</span></div>`);
          node.onclick = () => { if (l.section && l.section.time != null) seekTo(l.section.time); };
        } else if (l.type === 'comment') node = h(`<div class="comment">${esc(l.text)}</div>`);
        else if (l.type === 'tab') node = h(`<div class="tab">${esc(l.text)}</div>`);
        else if (l.type === 'blank') node = h('<div style="height:.5em"></div>');
        else {
          node = h(`<div class="line ${l.hasChords ? 'has-chords' : ''} ${l.hasLyrics ? '' : 'chords-only'}"></div>`);
          if (st.sync) node.appendChild(h(`<span class="time">${l.time != null ? C.formatTime(l.time) : '—'}</span>`));
          for (const s of l.segments) {
            const chord = s.chord ? (C.isChord(s.chord) ? C.transposeChord(s.chord, semis, flats) : s.chord) : '';
            node.appendChild(h(`<span class="seg"><span class="chord">${esc(chord)}</span><span class="lyric">${esc(s.text)}</span></span>`));
          }
          node.onclick = () => { if (st.sync) { st.syncTarget = i; markSync(); } else if (l.time != null) seekTo(l.time); };
        }
        node.dataset.i = i;
        chartEl.appendChild(node);
        lineEls[i] = node;
      });
      q('#keybadge').innerHTML = song.key ? `${st.transpose ? '<s>' + esc(song.key) + '</s>' : ''}<b>${esc(targetKey)}</b>${st.capo ? ' <span class="muted">capo ' + st.capo + '</span>' : ''}` : '<span class="muted">sin tono</span>';
      q('#transpv').textContent = (st.transpose > 0 ? '+' : '') + st.transpose;
      q('#capov').textContent = st.capo;
      const sb = q('#sections'); sb.innerHTML = '';
      for (const sec of parsed.sections) { if (sec.time == null) continue; const b = h(`<button class="btn">${esc(sec.label)}</button>`); b.onclick = () => seekTo(sec.time); sb.appendChild(b); }
      renderChordPanel();
      markSync();
      lastActive = -2;
    }
    function markSync() { lineEls.forEach(n => n && n.classList.remove('sync-target')); if (st.sync && lineEls[st.syncTarget]) lineEls[st.syncTarget].classList.add('sync-target'); }

    // ---- letra automática
    if (song.lyricsStatus === 'pending' || (song.lyricsStatus == null && !(song.chart || '').trim() && song.catalogId)) {
      song.lyricsStatus = 'pending';
      ensureLyrics(song).then(() => { if (practice && practice.songId === song.id) { parsed = C.parse(song.chart || ''); renderChart(); } });
    }

    // ---- reproductor
    let player = null;
    let offset = (track && track.offset) || 0;
    const chartTime = (t) => t - offset;      // tiempo de la base → tiempo del cifrado
    const trackTime = (t) => t + offset;      // tiempo del cifrado → tiempo de la base
    const noteText = q('#notetext'), status = q('#status');
    function setStatus(msg, err) { status.textContent = msg || ''; status.classList.toggle('err', !!err); }
    const updateOffset = () => { q('#offv').textContent = (offset > 0 ? '+' : '') + (Math.round(offset * 10) / 10) + 's'; };

    function showBasePanel(msg) {
      const box = q('#playerbox');
      if (player) { player.destroy(); player = null; }
      box.innerHTML = '';
      const query = `${song.title} ${song.artist || ''} ${instDef.queries[0]}`.trim();
      const panel = h(`<div class="base-panel">
        <div class="bp-title">${msg ? esc(msg) : `Falta la base para ${instDef.label.toLowerCase()}`}</div>
        <button class="btn primary" id="bp-search">🔎 Buscar en YouTube</button>
        <div class="bp-paste"><input id="bp-url" placeholder="Pegá acá el link del video" inputmode="url"><button class="btn" id="bp-paste">Pegar</button></div>
        <div class="row" style="gap:6px;justify-content:center"><button class="btn sm ghost" id="bp-metro">Usar metrónomo por ahora</button>${S.settings.ytApiKey ? '<button class="btn sm ghost" id="bp-inapp">Buscar acá</button>' : ''}</div>
        <div class="yt-results" id="bp-results"></div>
      </div>`);
      box.appendChild(panel);
      const useUrl = (url) => {
        const vid = Players.parseYouTubeId(url);
        if (!vid) return toast('Ese link no parece de YouTube', 3000, true);
        song.tracks = song.tracks || {}; song.tracks[inst] = { type: 'youtube', videoId: vid, url, offset: 0 };
        persist(); track = song.tracks[inst]; offset = 0; updateOffset(); setupPlayer(); toast('Base cargada');
      };
      $('#bp-search', panel).onclick = () => { window.open('https://www.youtube.com/results?search_query=' + encodeURIComponent(query), '_blank'); toast('Elegí un video, tocá Compartir → Copiar enlace, volvé y apretá Pegar.', 5000); };
      $('#bp-paste', panel).onclick = async () => {
        const inp = $('#bp-url', panel);
        if (inp.value.trim()) return useUrl(inp.value.trim());
        try { const t = await navigator.clipboard.readText(); if (t && Players.parseYouTubeId(t)) useUrl(t); else { inp.value = t || ''; inp.focus(); toast('Pegá el link en el campo y tocá Pegar'); } }
        catch (e) { inp.focus(); toast('Mantené apretado el campo y elegí "Pegar"'); }
      };
      $('#bp-url', panel).addEventListener('change', (e) => { if (Players.parseYouTubeId(e.target.value)) useUrl(e.target.value.trim()); });
      $('#bp-url', panel).addEventListener('paste', () => setTimeout(() => { const v = $('#bp-url', panel).value.trim(); if (Players.parseYouTubeId(v)) useUrl(v); }, 50));
      $('#bp-metro', panel).onclick = () => { song.tracks = song.tracks || {}; song.tracks[inst] = { type: 'metronome', offset: 0 }; persist(); track = song.tracks[inst]; offset = 0; updateOffset(); setupPlayer(); };
      const inapp = $('#bp-inapp', panel); if (inapp) inapp.onclick = () => ytSearchInApp(query, $('#bp-results', panel), (vid) => useUrl('https://www.youtube.com/watch?v=' + vid));
      noteText.textContent = '';
    }

    async function setupPlayer() {
      const box = q('#playerbox');
      if (player) { player.destroy(); player = null; }
      box.innerHTML = '';
      if (!track) return showBasePanel();
      if (track.type === 'youtube') { player = new Players.YouTubeAdapter(box); noteText.textContent = 'Base de YouTube (el video queda visible, lo exigen sus términos).'; }
      else if (track.type === 'local') { player = new Players.LocalAudioAdapter(box); noteText.textContent = 'Archivo local: la velocidad no cambia la afinación.'; }
      else { player = new Players.MetronomeAdapter(box, { getCtx: () => AudioEngine.unlock() }); noteText.textContent = 'Metrónomo al BPM del tema. Cargá una base real para practicar con la banda.'; }
      player.onState((s) => {
        q('#play').textContent = s === 'playing' ? '❚❚' : '▶';
        if (s === 'ended' && st.loopB == null) { if (recorder.recording) stopRec(); }
        if (s === 'error') { showBasePanel('Este video no se puede reproducir acá. Buscá otra base.'); }
        if (s === 'ready') refreshRates();
      });
      try {
        const dur = parsed.timed.length ? parsed.timed[parsed.timed.length - 1].time + 20 : 240;
        await player.load(Object.assign({}, track, { bpm: song.bpm || 100, beats: song.beats || 4, length: dur }));
        setStatus('');
      } catch (e) { showBasePanel(e.message); }
    }
    function refreshRates() {
      const rates = player ? player.rates() : [1];
      q('#rate').onclick = () => { if (!player) return; const i = rates.indexOf(st.rate); st.rate = rates[(i + 1) % rates.length]; player.setRate(st.rate); q('#ratev').textContent = st.rate + '×'; };
    }
    function seekTo(chartT) { if (!player) return; const t = Math.max(0, trackTime(chartT)); player.seek(t); clock.report(t, true); }
    q('#changebase').onclick = () => showBasePanel('Elegí otra base para ' + instDef.label.toLowerCase());

    // ---- reloj interpolado (YouTube reporta cada ~250 ms)
    const clock = {
      last: 0, at: 0,
      report(t, force) { if (force || Math.abs(t - this.last) > 0.001) { this.last = t; this.at = performance.now(); } },
      now() { if (!player) return 0; const t = player.time(); this.report(t); return player.state === 'playing' ? this.last + (performance.now() - this.at) / 1000 * (player.rate ? player.rate() : 1) : t; },
    };

    // ---- loop de UI
    let raf = 0, lastActive = -2, userScrolling = 0;
    wrap.addEventListener('wheel', () => { userScrolling = performance.now(); }, { passive: true });
    wrap.addEventListener('touchmove', () => { userScrolling = performance.now(); }, { passive: true });
    function tick() {
      raf = requestAnimationFrame(tick);
      if (!player) return;
      const t = clock.now();
      const dur = player.duration();
      q('#tcur').textContent = C.formatClock(t);
      q('#tdur').textContent = C.formatClock(dur);
      if (dur && document.activeElement !== q('#seek')) q('#seek').value = Math.round(t / dur * 1000);
      if (st.loopA != null && st.loopB != null && player.state === 'playing' && t >= st.loopB) { player.seek(st.loopA); clock.report(st.loopA, true); }
      const ai = C.activeLineIndex(parsed, chartTime(t) + 0.05);
      if (ai !== lastActive) {
        lastActive = ai;
        lineEls.forEach((n, i) => {
          if (!n || !n.classList.contains('line')) return;
          n.classList.remove('active', 'past');
          if (i === ai) n.classList.add('active');
          else if (ai >= 0 && i < ai) n.classList.add('past');
        });
        if (ai >= 0 && S.settings.autoScroll && performance.now() - userScrolling > 3000) {
          const n = lineEls[ai];
          wrap.scrollTo({ top: n.offsetTop - wrap.clientHeight * 0.35, behavior: 'smooth' });
        }
      }
    }
    raf = requestAnimationFrame(tick);

    // ---- transporte
    q('#play').onclick = togglePlay;
    function togglePlay() {
      if (!player) return toast('Primero cargá una base (buscala en YouTube o usá el metrónomo).', 3500);
      if (st.countdown > 0) return;
      const ctx = AudioEngine.unlock();
      if (player.kind === 'metronome') {
        if (!ctx) { setStatus('Este navegador no permite generar audio.', true); return; }
        AudioEngine.keepAlive(true);
      }
      if (player.state === 'playing') { player.pause(); return; }
      try {
        if (S.settings.countIn && song.bpm && ctx) countIn(ctx).then(() => player.play());
        else player.play();
      } catch (e) { setStatus('No se pudo arrancar: ' + e.message, true); }
      if (player.kind === 'metronome' && /iPhone|iPad/.test(navigator.userAgent)) setStatus('Si no escuchás el click: sacá el modo silencio y subí el volumen.');
    }
    function countIn(audioCtx) {
      return new Promise((resolve) => {
        const beats = song.beats || 4, spb = 60 / song.bpm / st.rate;
        const cnt = q('#countin'), playBtn = q('#play'); cnt.classList.remove('hidden');
        const t0 = audioCtx.currentTime + 0.05;
        for (let i = 0; i < beats; i++) {
          const o = audioCtx.createOscillator(), g = audioCtx.createGain();
          o.frequency.value = i === 0 ? 1600 : 1000; g.gain.setValueAtTime(0.5, t0 + i * spb); g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * spb + 0.07);
          o.connect(g).connect(audioCtx.destination); o.start(t0 + i * spb); o.stop(t0 + i * spb + 0.1);
          setTimeout(() => { cnt.textContent = beats - i; playBtn.textContent = beats - i; st.countdown = beats - i; }, i * spb * 1000);
        }
        st.countdown = beats; playBtn.textContent = beats;
        setTimeout(() => { cnt.classList.add('hidden'); st.countdown = 0; playBtn.textContent = '▶'; resolve(); }, beats * spb * 1000);
      });
    }
    q('#seek').oninput = (e) => { if (!player) return; const t = e.target.value / 1000 * player.duration(); player.seek(t); clock.report(t, true); };
    const setTransp = (d) => { st.transpose = Math.max(-6, Math.min(6, st.transpose + d)); song.transpose = st.transpose; persist(); renderChart(); };
    const setCapo = (d) => { st.capo = Math.max(0, Math.min(9, st.capo + d)); song.capo = st.capo; persist(); renderChart(); };
    const setOffset = (d) => { offset = Math.round((offset + d) * 10) / 10; if (track) { track.offset = offset; persist(); } updateOffset(); lastActive = -2; };
    q('#transpp').onclick = () => setTransp(1); q('#transpm').onclick = () => setTransp(-1);
    q('#capop').onclick = () => setCapo(1); q('#capom').onclick = () => setCapo(-1);
    q('#offp').onclick = () => setOffset(0.5); q('#offm').onclick = () => setOffset(-0.5);
    updateOffset();
    q('#font').onclick = () => { const sizes = [85, 100, 120, 140, 165]; const i = sizes.indexOf(S.settings.fontSize); S.settings.fontSize = sizes[(i + 1) % sizes.length]; persist(); chartEl.style.setProperty('--chart-scale', S.settings.fontSize / 100); };
    q('#tchords').onclick = () => { show.chords = !show.chords; S.settings.showChords = show.chords; persist(); q('#tchords').classList.toggle('active', show.chords); renderChart(); };
    q('#tlyrics').onclick = () => { show.lyrics = !show.lyrics; S.settings.showLyrics = show.lyrics; persist(); q('#tlyrics').classList.toggle('active', show.lyrics); renderChart(); };
    q('#tcount').onclick = () => { S.settings.countIn = !S.settings.countIn; persist(); q('#tcount').classList.toggle('active', S.settings.countIn); };
    const setLoop = () => { q('#loopAv').textContent = st.loopA != null ? C.formatClock(st.loopA) : '—'; q('#loopBv').textContent = st.loopB != null ? C.formatClock(st.loopB) : '—'; q('#loopA').classList.toggle('active', st.loopA != null); q('#loopB').classList.toggle('active', st.loopB != null); };
    q('#loopA').onclick = () => { if (!player) return; st.loopA = clock.now(); if (st.loopB != null && st.loopB <= st.loopA) st.loopB = null; setLoop(); };
    q('#loopB').onclick = () => { if (!player) return; const t = clock.now(); if (st.loopA == null) st.loopA = 0; if (t > st.loopA) { st.loopB = t; setLoop(); toast('Loop A-B activo'); } };
    q('#loopX').onclick = () => { st.loopA = st.loopB = null; setLoop(); };

    // ---- grabación
    const recA = q('#recA'), recV = q('#recV'), preview = q('#recpreview');
    let recMeta = null;
    async function startRec(video) {
      try {
        await recorder.start({ video, previewEl: preview });
        preview.classList.toggle('on', video);
        recMeta = { trackTime: player ? clock.now() : 0, startedAt: Date.now() };
        (video ? recV : recA).classList.add('on'); (video ? recV : recA).textContent = '■ Detener';
        if (player && player.state !== 'playing') togglePlay();
        setStatus('Grabando… ' + (track && track.type === 'youtube' ? 'El mic capta la base por los parlantes; con auriculares graba solo tu instrumento.' : ''));
      } catch (e) { setStatus('No se pudo acceder al micrófono/cámara: ' + e.message, true); }
    }
    async function stopRec() {
      const r = await recorder.stop();
      recA.classList.remove('on'); recV.classList.remove('on'); recA.textContent = '● Audio'; recV.textContent = '● Video'; preview.classList.remove('on');
      if (!r) return;
      const fileId = Store.uid();
      await Store.putFile(fileId, r.blob);
      S.takes.unshift({ id: Store.uid(), songId: song.id, songTitle: song.title, instrument: inst, date: recMeta.startedAt, duration: r.duration, video: r.video, mime: r.mime, fileId, trackTime: recMeta.trackTime, rate: st.rate });
      persist();
      setStatus(`Toma guardada (${C.formatClock(r.duration)}). Vela en "Tomas".`);
      toast('Toma guardada');
    }
    recA.onclick = () => recorder.recording ? stopRec() : startRec(false);
    recV.onclick = () => recorder.recording ? stopRec() : startRec(true);

    // ---- revisar una toma junto con la base
    async function reviewTake(id) {
      const take = S.takes.find(t => t.id === id); if (!take) return;
      const blob = await Store.getFile(take.fileId); if (!blob) return toast('No se encontró el archivo de la toma');
      const media = document.createElement(take.video ? 'video' : 'audio');
      media.src = URL.createObjectURL(blob); media.controls = true; media.style.width = '100%'; media.playsInline = true;
      const box = h(`<div style="padding:12px;border-top:1px solid var(--line)"><div class="small muted" style="margin-bottom:6px">Revisando toma del ${new Date(take.date).toLocaleString('es-AR')}. Play arranca la base en el mismo punto.</div></div>`);
      box.appendChild(media);
      const b = h('<button class="btn sm primary" style="margin-top:8px">▶ Toma + base</button>');
      b.onclick = () => { if (!player) return; AudioEngine.unlock(); player.seek(take.trackTime); clock.report(take.trackTime, true); player.setRate(take.rate || 1); media.currentTime = 0; media.play(); player.play(); };
      box.appendChild(b);
      q('.dock').appendChild(box);
    }

    // ---- sincronización
    const syncpanel = q('#syncpanel');
    function nextUnstamped(from) { for (let i = from; i < parsed.lines.length; i++) if (parsed.lines[i].type === 'line') return i; return -1; }
    function enterSync() {
      if (!parsed.lines.some(l => l.type === 'line')) return toast('Primero hace falta la letra (Editar → pegar letra).', 3500);
      st.sync = true; syncpanel.classList.remove('hidden'); q('#tsync').classList.add('active');
      const firstEmpty = parsed.lines.findIndex(l => l.type === 'line' && l.time == null);
      st.syncTarget = firstEmpty >= 0 ? firstEmpty : nextUnstamped(0);
      st.syncUndo = [];
      renderChart();
    }
    function exitSync(save) {
      if (save) { song.chart = C.serialize(parsed, song.chart); persist(); toast('Sincronización guardada'); go('practice/' + song.id); return; }
      st.sync = false; syncpanel.classList.add('hidden'); q('#tsync').classList.remove('active');
      parsed = C.parse(song.chart || '');
      renderChart();
    }
    function stamp() {
      if (!st.sync || !player) return;
      const i = st.syncTarget; if (i < 0) return toast('No quedan líneas por marcar');
      const l = parsed.lines[i];
      st.syncUndo.push({ i, prev: l.time });
      l.time = Math.max(0, Math.round(chartTime(clock.now()) * 100) / 100);
      recomputeTimed();
      st.syncTarget = nextUnstamped(i + 1);
      renderChart();
      q('#syncinfo').textContent = `"${(l.text || 'acordes').slice(0, 40)}" → ${C.formatTime(l.time)}. ${st.syncTarget >= 0 ? 'Siguiente: "' + (parsed.lines[st.syncTarget].text || 'acordes') + '"' : 'Listo, guardá.'}`;
      const n = lineEls[st.syncTarget]; if (n) wrap.scrollTo({ top: n.offsetTop - wrap.clientHeight * 0.35, behavior: 'smooth' });
    }
    function recomputeTimed() {
      parsed.timed = [];
      parsed.lines.forEach((l, i) => { if (l.type === 'line' && l.time != null) parsed.timed.push({ time: l.time, index: i }); });
      parsed.timed.sort((a, b) => a.time - b.time);
      parsed.sections.forEach(s => { s.time = null; });
      parsed.lines.forEach(l => { if (l.type === 'line' && l.time != null && l.section && (l.section.time == null || l.time < l.section.time)) l.section.time = l.time; });
    }
    q('#tsync').onclick = () => st.sync ? exitSync(false) : enterSync();
    q('#stamp').onclick = stamp;
    q('#syncundo').onclick = () => { const u = st.syncUndo.pop(); if (!u) return; parsed.lines[u.i].time = u.prev; st.syncTarget = u.i; recomputeTimed(); renderChart(); };
    q('#syncclear').onclick = () => { if (!confirm('¿Borrar todos los tiempos de este cifrado?')) return; parsed.lines.forEach(l => { if (l.type === 'line') l.time = null; }); recomputeTimed(); st.syncTarget = nextUnstamped(0); renderChart(); };
    q('#syncshiftm').onclick = () => { parsed.lines.forEach(l => { if (l.time != null) l.time = Math.max(0, l.time - 0.25); }); recomputeTimed(); renderChart(); };
    q('#syncshiftp').onclick = () => { parsed.lines.forEach(l => { if (l.time != null) l.time += 0.25; }); recomputeTimed(); renderChart(); };
    q('#syncsave').onclick = () => exitSync(true);
    q('#synccancel').onclick = () => exitSync(false);

    // ---- teclado
    function onKey(e) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'Enter' && st.sync) { e.preventDefault(); stamp(); }
      else if (e.key === 'ArrowLeft' && player) { const t = Math.max(0, clock.now() - 5); player.seek(t); clock.report(t, true); }
      else if (e.key === 'ArrowRight' && player) { const t = clock.now() + 5; player.seek(t); clock.report(t, true); }
      else if (e.key === '[') q('#loopA').click();
      else if (e.key === ']') q('#loopB').click();
      else if (e.key.toLowerCase() === 'l') q('#loopX').click();
      else if (e.key === '+' || e.key === '=') setTransp(1);
      else if (e.key === '-') setTransp(-1);
    }
    document.addEventListener('keydown', onKey);

    renderChart(); setLoop();
    setupPlayer().then(() => { if (takeId) reviewTake(takeId); });

    practice = {
      songId: song.id,
      destroy() {
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', onKey);
        if (recorder.recording) recorder.stop().catch(() => { });
        if (player) player.destroy();
        AudioEngine.keepAlive(false);
      },
    };
  }

  // ------------------------------------------------------------------ tomas
  function renderTakes() {
    const inner = h('<div><h1>Tomas</h1><p class="muted small">Grabaciones que hiciste practicando. Se guardan en este dispositivo.</p><div class="takes" id="takes"></div></div>');
    const list = $('#takes', inner);
    if (!S.takes.length) list.appendChild(h('<div class="empty">Todavía no grabaste nada. En Ensayar, apretá "Grabar audio" o "Grabar video".</div>'));
    for (const take of S.takes) {
      const card = h(`<div class="take">
        <div><div style="font-weight:700">${esc(take.songTitle)} <span class="chip">${INSTRUMENTS[take.instrument] ? INSTRUMENTS[take.instrument].emoji + ' ' + INSTRUMENTS[take.instrument].label : ''}</span></div>
        <div class="small muted">${new Date(take.date).toLocaleString('es-AR')} · ${C.formatClock(take.duration)} · ${take.video ? 'video' : 'audio'} · desde ${C.formatClock(take.trackTime)} de la base</div></div>
        <div class="row"><button class="btn sm" data-a="listen">▶ Escuchar</button><button class="btn sm" data-a="withbase">Con la base</button><button class="btn sm ghost" data-a="dl">Descargar</button><button class="btn sm ghost danger" data-a="del">Borrar</button></div>
        <div class="media hidden"></div></div>`);
      card.querySelector('[data-a=listen]').onclick = async () => {
        const m = card.querySelector('.media'); m.classList.remove('hidden');
        if (m.children.length) return;
        const blob = await Store.getFile(take.fileId); if (!blob) return toast('No se encontró el archivo');
        const media = document.createElement(take.video ? 'video' : 'audio'); media.src = URL.createObjectURL(blob); media.controls = true; media.playsInline = true; m.appendChild(media); media.play();
      };
      card.querySelector('[data-a=withbase]').onclick = () => go(`practice/${take.songId}/${take.id}`);
      card.querySelector('[data-a=dl]').onclick = async () => { const blob = await Store.getFile(take.fileId); if (!blob) return; const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${take.songTitle} - ${new Date(take.date).toISOString().slice(0, 16).replace('T', ' ')}.${take.video ? 'webm' : 'webm'}`; a.click(); };
      card.querySelector('[data-a=del]').onclick = async () => { if (!confirm('¿Borrar esta toma?')) return; await Store.deleteFile(take.fileId).catch(() => { }); S.takes = S.takes.filter(t => t.id !== take.id); persist(); route(); };
      list.appendChild(card);
    }
    shell('takes', inner);
  }

  // ------------------------------------------------------------------ ajustes
  function renderSettings() {
    const inner = h(`<div><h1>Ajustes</h1>
      <div class="card">
        <h2 style="margin-top:0">Tu perfil</h2>
        <div class="field"><label>Instrumento</label><select id="s-inst">${Object.entries(INSTRUMENTS).map(([k, v]) => `<option value="${k}" ${k === S.profile.instrument ? 'selected' : ''}>${v.emoji} ${v.label}</option>`).join('')}</select><div class="help">Cambia qué base se usa en cada tema y qué se muestra (los cantantes ven solo la letra).</div></div>
        <div class="field"><label>Nivel</label><select id="s-level">${Object.entries(LEVELS).map(([k, v]) => `<option value="${k}" ${k === S.profile.level ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      </div>
      <div class="card" style="margin-top:14px">
        <h2 style="margin-top:0">Reproducción</h2>
        <div class="field"><label><input type="checkbox" id="s-count" ${S.settings.countIn ? 'checked' : ''}> Count-in de un compás antes de arrancar</label></div>
        <div class="field"><label><input type="checkbox" id="s-scroll" ${S.settings.autoScroll ? 'checked' : ''}> Auto-scroll del cifrado</label></div>
      </div>
      <div class="card" style="margin-top:14px">
        <h2 style="margin-top:0">Búsqueda en YouTube dentro de la app (opcional)</h2>
        <div class="field"><label>API key de YouTube Data API v3</label><input id="s-key" value="${esc(S.settings.ytApiKey)}" placeholder="AIza..."><div class="help">Sin key, el botón "Buscar backing" abre YouTube en otra pestaña y pegás el link. Con key, buscás acá mismo (cupo gratuito: ~100 búsquedas por día por key). Se guarda solo en este dispositivo.</div></div>
      </div>
      <div class="card" style="margin-top:14px">
        <h2 style="margin-top:0">Tus datos</h2>
        <div class="row"><button class="btn" id="exp">⬇ Exportar setlists y temas (JSON)</button><label class="btn">⬆ Importar JSON <input type="file" id="imp" accept="application/json" class="hidden"></label><button class="btn ghost" id="demo">Cargar setlist de ejemplo</button><button class="btn ghost danger" id="wipe">Borrar todo</button></div>
        <p class="small muted">Todo se guarda en este navegador (setlists, cifrados, grabaciones). Exportá para pasarlo a otro dispositivo o compartirlo con la banda.</p>
      </div>
      <div class="row" style="margin-top:16px"><button class="btn primary" id="save">Guardar</button></div>
    </div>`);
    $('#save', inner).onclick = () => { S.profile.instrument = $('#s-inst', inner).value; S.profile.level = $('#s-level', inner).value; S.settings.countIn = $('#s-count', inner).checked; S.settings.autoScroll = $('#s-scroll', inner).checked; S.settings.ytApiKey = $('#s-key', inner).value.trim(); persist(); toast('Guardado'); go('setlist'); };
    $('#exp', inner).onclick = () => { const data = { version: 1, songs: S.songs, setlists: S.setlists }; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = 'ensayo-setlists.json'; a.click(); };
    $('#imp', inner).onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        let n = 0;
        for (const s of data.songs || []) { if (!songById(s.id)) { S.songs.push(s); n++; } }
        for (const sl of data.setlists || []) { if (!S.setlists.find(x => x.id === sl.id)) S.setlists.push(sl); }
        persist(); toast(`Importados ${n} temas`); route();
      } catch (err) { toast('Archivo inválido'); }
    };
    $('#demo', inner).onclick = () => { seedStarter('Setlist de ejemplo'); toast('Setlist de ejemplo cargada'); go('setlist'); };
    $('#wipe', inner).onclick = async () => { if (!confirm('¿Borrar TODO (temas, setlists, tomas)? No se puede deshacer.')) return; await Store.clearFiles(); localStorage.clear(); location.hash = ''; location.reload(); };
    shell('settings', inner);
  }

  // ------------------------------------------------------------------ init
  route();
})();
