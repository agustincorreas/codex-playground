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
  if (!S) { S = Store.defaultState(); seedDemo(); }
  if (!S.songs.length) seedDemo();
  function persist() { Store.save(S); }
  function seedDemo() {
    const ids = [];
    for (const d of window.DemoSongs) {
      const id = Store.uid();
      ids.push(id);
      S.songs.push({ id, title: d.title, artist: d.artist, key: d.key, bpm: d.bpm, beats: d.beats || 4, genre: d.genre || '', notes: d.notes || '', chart: d.chart,
        tracks: { _default: { type: 'metronome' } }, transpose: 0, capo: 0, createdAt: Date.now(), demo: true });
    }
    const sl = { id: Store.uid(), name: 'Ensayo con la banda', songIds: ids };
    S.setlists.push(sl);
    S.currentSetlistId = sl.id;
    persist();
  }
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

  function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms); }

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
        <button class="btn primary" id="songnew">+ Nuevo tema</button>
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
    $('#songnew', inner).onclick = () => go('edit/new');

    const list = $('#songs', inner);
    const songs = sl.songIds.map(songById).filter(Boolean);
    if (!songs.length) list.appendChild(h('<div class="empty">La setlist está vacía. Agregá temas de la biblioteca o creá uno nuevo.</div>'));
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
            <span class="chip">${synced ? '⏱ ' + synced + ' líneas sync' : 'sin sincronizar'}</span>
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

  // ------------------------------------------------------------------ editor de tema
  function renderEdit(id) {
    const isNew = !id || id === 'new';
    const song = isNew ? { id: Store.uid(), title: '', artist: '', key: '', bpm: '', beats: 4, genre: '', notes: '', chart: '', tracks: {}, transpose: 0, capo: 0, createdAt: Date.now() } : songById(id);
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
      song.chart = ta.value;
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
    const track = trackFor(song, inst);
    const parsed = C.parse(song.chart || '');
    const show = { chords: instDef.show !== 'lyrics' && S.settings.showChords, lyrics: S.settings.showLyrics };
    const st = { transpose: song.transpose || 0, capo: song.capo || 0, loopA: null, loopB: null, rate: 1, sync: false, syncTarget: -1, syncUndo: [], countdown: 0, reviewTake: null };
    const recorder = new window.Recorder();
    document.body.classList.add('in-practice');

    app.innerHTML = '';
    const el = h(`<div class="practice">
      <div class="phead">
        <a class="btn icon ghost" href="#setlist" title="Volver a la setlist">←</a>
        <button class="btn icon ghost" id="prev" ${prevId ? '' : 'disabled'} title="Tema anterior">⏮</button>
        <div><div class="ttl">${esc(song.title)}</div><div class="art">${esc(song.artist || '')}${song.notes ? '<i> · ' + esc(song.notes) + '</i>' : ''}</div></div>
        <button class="btn icon ghost" id="next" ${nextId ? '' : 'disabled'} title="Tema siguiente">⏭</button>
        <div class="meta">
          <span class="keybadge" id="keybadge"></span>
          <span class="chip accent">${instDef.emoji} ${instDef.label}</span>
          <button class="btn sm ghost" id="edit">Editar</button>
        </div>
      </div>
      <div class="chart-wrap" id="chartwrap"><div class="chart" id="chart"></div></div>
      <aside class="dock">
        <div class="player-box" id="playerbox"><div class="countin hidden" id="countin"></div></div>
        <video class="rec-preview" id="recpreview" playsinline muted></video>
        <div class="player-note" id="playernote"></div>
        <div class="transport">
          <div class="main">
            <button class="play" id="play" title="Play/Pausa (espacio)">▶</button>
            <div class="grow"><input type="range" id="seek" min="0" max="1000" value="0"><div class="time"><span id="tcur">0:00</span> / <span id="tdur">0:00</span></div></div>
          </div>
          <div class="ctl">
            <button class="btn" id="rate" title="Velocidad (tono igual)"><span>Velocidad</span><span class="v" id="ratev">1×</span></button>
            <div class="btn stepper" title="Transponer acordes (solo la pantalla; el audio de YouTube no cambia)"><button id="transpm">−</button><span><span>Tono</span><span class="v" id="transpv">0</span></span><button id="transpp">+</button></div>
            <div class="btn stepper" title="Capo: muestra las posiciones con capotraste"><button id="capom">−</button><span><span>Capo</span><span class="v" id="capov">0</span></span><button id="capop">+</button></div>
            <button class="btn" id="font" title="Tamaño de letra"><span>Letra</span><span class="v">Aa</span></button>
          </div>
          <div class="loopbar">
            <button class="btn" id="loopA" title="Marcar inicio del loop ([)">A: —</button>
            <button class="btn" id="loopB" title="Marcar fin del loop (])">B: —</button>
            <button class="btn ghost" id="loopX" title="Quitar loop (L)">✕</button>
          </div>
          <div class="ctl">
            <button class="btn ${show.chords ? 'active' : ''}" id="tchords" ${instDef.show === 'lyrics' ? 'disabled' : ''}><span>Acordes</span></button>
            <button class="btn ${show.lyrics ? 'active' : ''}" id="tlyrics"><span>Letra</span></button>
            <button class="btn ${S.settings.countIn ? 'active' : ''}" id="tcount" title="Un compás de clicks antes de arrancar"><span>Count-in</span></button>
            <button class="btn" id="tsync" title="Marcar el tiempo de cada línea mientras suena"><span>Sincronizar</span></button>
          </div>
          <div class="ctl" style="grid-template-columns:1fr 1fr">
            <button class="btn rec" id="recA" title="Grabar audio del micrófono">● Grabar audio</button>
            <button class="btn rec" id="recV" title="Grabar cámara + micrófono">● Grabar video</button>
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
      if (!parsed.timed.length) chartEl.appendChild(h(`<div class="nosync">Este cifrado todavía no tiene tiempos: no va a seguir la base solo. Apretá <b>Sincronizar</b>, dale play y marcá cada línea cuando empiece. Lo hacés una vez y queda guardado.</div>`));
      if (!parsed.lines.some(l => l.type === 'line')) chartEl.appendChild(h(`<div class="nosync">Este tema no tiene letra ni acordes cargados. Tocá <b>Editar</b> para pegarlos.</div>`));
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
      // secciones
      const sb = q('#sections'); sb.innerHTML = '';
      for (const sec of parsed.sections) { if (sec.time == null) continue; const b = h(`<button class="btn">${esc(sec.label)}</button>`); b.onclick = () => seekTo(sec.time); sb.appendChild(b); }
      markSync();
    }
    function markSync() { lineEls.forEach(n => n && n.classList.remove('sync-target')); if (st.sync && lineEls[st.syncTarget]) lineEls[st.syncTarget].classList.add('sync-target'); }

    // ---- reproductor
    let player = null;
    const offset = (track && track.offset) || 0;
    const chartTime = (t) => t - offset;      // tiempo de la base → tiempo del cifrado
    const trackTime = (t) => t + offset;      // tiempo del cifrado → tiempo de la base
    const note = q('#playernote'), status = q('#status');
    function setStatus(msg, err) { status.textContent = msg || ''; status.classList.toggle('err', !!err); }

    async function setupPlayer() {
      const box = q('#playerbox');
      const cnt = q('#countin'); box.innerHTML = ''; box.appendChild(cnt);
      if (!track) {
        box.appendChild(h(`<div class="local-dock"><div><div style="font-size:26px">${instDef.emoji}</div>No hay base para ${instDef.label.toLowerCase()} en este tema.<br><button class="btn sm primary" style="margin-top:8px" id="addtrack">Agregar base</button></div></div>`));
        $('#addtrack', box).onclick = () => go('edit/' + song.id);
        note.textContent = 'Sin base: podés leer el cifrado igual.';
        return;
      }
      if (track.type === 'youtube') { player = new Players.YouTubeAdapter(box); note.textContent = 'Base de YouTube. El video queda visible (lo exigen sus términos); el foco está en la letra y los acordes de al lado.'; }
      else if (track.type === 'local') { player = new Players.LocalAudioAdapter(box); note.textContent = 'Archivo local: el cambio de velocidad mantiene la afinación.'; }
      else { player = new Players.MetronomeAdapter(box); note.textContent = 'Metrónomo: los tiempos del cifrado se calculan con el BPM del tema.'; }
      player.onState((s) => {
        q('#play').textContent = s === 'playing' ? '❚❚' : '▶';
        if (s === 'ended' && st.loopB == null) { if (recorder.recording) stopRec(); }
        if (s === 'error') setStatus(player.lastError, true);
        if (s === 'ready') refreshRates();
      });
      try {
        await player.load(Object.assign({}, track, { bpm: song.bpm || 100, beats: song.beats || 4, length: (parsed.timed.length ? parsed.timed[parsed.timed.length - 1].time + 20 : 240) }));
        setStatus('');
      } catch (e) { setStatus(e.message, true); }
    }
    function refreshRates() {
      const rates = player ? player.rates() : [1];
      const btn = q('#rate');
      btn.onclick = () => {
        const i = rates.indexOf(st.rate);
        st.rate = rates[(i + 1) % rates.length];
        player.setRate(st.rate);
        q('#ratev').textContent = st.rate + '×';
      };
    }
    function seekTo(chartT) { if (!player) return; const t = Math.max(0, trackTime(chartT)); player.seek(t); clock.report(t, true); }

    // ---- reloj interpolado (YouTube reporta cada ~250 ms)
    const clock = {
      last: 0, at: 0, val: 0,
      report(t, force) { if (force || Math.abs(t - this.last) > 0.001) { this.last = t; this.at = performance.now(); } },
      now() { if (!player) return 0; const t = player.time(); this.report(t); const playing = player.state === 'playing'; return playing ? this.last + (performance.now() - this.at) / 1000 * (player.rate ? player.rate() : 1) : t; },
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
      // loop A-B
      if (st.loopA != null && st.loopB != null && player.state === 'playing' && t >= st.loopB) { player.seek(st.loopA); clock.report(st.loopA, true); }
      // línea activa
      const ct = chartTime(t);
      const ai = C.activeLineIndex(parsed, ct + 0.05);
      if (ai !== lastActive) {
        lastActive = ai;
        let seenActive = false;
        lineEls.forEach((n, i) => {
          if (!n || !n.classList.contains('line')) return;
          n.classList.remove('active', 'past', 'next');
          if (i === ai) { n.classList.add('active'); seenActive = true; }
          else if (ai >= 0 && i < ai && parsed.lines[i].time != null) n.classList.add('past');
          else if (ai >= 0 && i < ai && !seenActive) n.classList.add('past');
        });
        if (ai >= 0 && S.settings.autoScroll && performance.now() - userScrolling > 3000) {
          const n = lineEls[ai];
          const top = n.offsetTop - wrap.clientHeight * 0.3;
          wrap.scrollTo({ top, behavior: 'smooth' });
        }
      }
    }
    raf = requestAnimationFrame(tick);

    // ---- transporte
    q('#play').onclick = togglePlay;
    function togglePlay() {
      if (!player) return toast('Este tema no tiene base para tu instrumento');
      if (player.state === 'playing') { player.pause(); return; }
      if (S.settings.countIn && song.bpm && st.countdown === 0) countIn().then(() => player.play());
      else player.play();
    }
    let audioCtx = null;
    function countIn() {
      return new Promise((resolve) => {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const beats = song.beats || 4, spb = 60 / song.bpm / st.rate;
        const cnt = q('#countin'); cnt.classList.remove('hidden');
        const t0 = audioCtx.currentTime + 0.05;
        for (let i = 0; i < beats; i++) {
          const o = audioCtx.createOscillator(), g = audioCtx.createGain();
          o.frequency.value = i === 0 ? 1600 : 1000; g.gain.setValueAtTime(0.5, t0 + i * spb); g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * spb + 0.07);
          o.connect(g).connect(audioCtx.destination); o.start(t0 + i * spb); o.stop(t0 + i * spb + 0.1);
          setTimeout(() => { cnt.textContent = beats - i; st.countdown = beats - i; }, i * spb * 1000);
        }
        setTimeout(() => { cnt.classList.add('hidden'); st.countdown = 0; resolve(); }, beats * spb * 1000);
      });
    }
    q('#seek').oninput = (e) => { if (!player) return; const t = e.target.value / 1000 * player.duration(); player.seek(t); clock.report(t, true); };
    const setTransp = (d) => { st.transpose = Math.max(-6, Math.min(6, st.transpose + d)); song.transpose = st.transpose; persist(); renderChart(); };
    const setCapo = (d) => { st.capo = Math.max(0, Math.min(9, st.capo + d)); song.capo = st.capo; persist(); renderChart(); };
    q('#transpp').onclick = () => setTransp(1); q('#transpm').onclick = () => setTransp(-1);
    q('#capop').onclick = () => setCapo(1); q('#capom').onclick = () => setCapo(-1);
    q('#font').onclick = () => { const sizes = [85, 100, 120, 140, 165]; const i = sizes.indexOf(S.settings.fontSize); S.settings.fontSize = sizes[(i + 1) % sizes.length]; persist(); chartEl.style.setProperty('--chart-scale', S.settings.fontSize / 100); };
    q('#tchords').onclick = () => { show.chords = !show.chords; S.settings.showChords = show.chords; persist(); q('#tchords').classList.toggle('active', show.chords); renderChart(); };
    q('#tlyrics').onclick = () => { show.lyrics = !show.lyrics; S.settings.showLyrics = show.lyrics; persist(); q('#tlyrics').classList.toggle('active', show.lyrics); renderChart(); };
    q('#tcount').onclick = () => { S.settings.countIn = !S.settings.countIn; persist(); q('#tcount').classList.toggle('active', S.settings.countIn); };
    const setLoop = () => { q('#loopA').textContent = 'A: ' + (st.loopA != null ? C.formatClock(st.loopA) : '—'); q('#loopB').textContent = 'B: ' + (st.loopB != null ? C.formatClock(st.loopB) : '—'); q('#loopA').classList.toggle('active', st.loopA != null); q('#loopB').classList.toggle('active', st.loopB != null); };
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
      recA.classList.remove('on'); recV.classList.remove('on'); recA.textContent = '● Grabar audio'; recV.textContent = '● Grabar video'; preview.classList.remove('on');
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
      b.onclick = () => { if (!player) return; player.seek(take.trackTime); clock.report(take.trackTime, true); player.setRate(take.rate || 1); media.currentTime = 0; media.play(); player.play(); };
      box.appendChild(b);
      q('.dock').appendChild(box);
    }

    // ---- sincronización
    const syncpanel = q('#syncpanel');
    function nextUnstamped(from) { for (let i = from; i < parsed.lines.length; i++) if (parsed.lines[i].type === 'line') return i; return -1; }
    function enterSync() {
      st.sync = true; syncpanel.classList.remove('hidden'); q('#tsync').classList.add('active');
      st.syncTarget = nextUnstamped(0);
      // Si ya hay tiempos, arrancar en la primera línea sin tiempo.
      const firstEmpty = parsed.lines.findIndex(l => l.type === 'line' && l.time == null);
      if (firstEmpty >= 0) st.syncTarget = firstEmpty;
      st.syncUndo = [];
      S.settings.countIn && toast('Tip: el count-in sigue activo; los tiempos se marcan sobre la base, no sobre los clicks.', 3500);
      renderChart();
    }
    function exitSync(save) {
      if (save) {
        song.chart = C.serialize(parsed, song.chart);
        persist();
        toast('Sincronización guardada');
        go('practice/' + song.id); return;
      }
      st.sync = false; syncpanel.classList.add('hidden'); q('#tsync').classList.remove('active');
      // descartar: recargar el cifrado original
      const fresh = C.parse(song.chart); parsed.lines = fresh.lines; parsed.timed = fresh.timed; parsed.sections = fresh.sections;
      renderChart();
    }
    function stamp() {
      if (!st.sync || !player) return;
      const i = st.syncTarget; if (i < 0) return toast('No quedan líneas por marcar');
      const l = parsed.lines[i];
      st.syncUndo.push({ i, prev: l.time });
      l.time = Math.max(0, Math.round(chartTime(clock.now()) * 100) / 100);
      if (l.section && (l.section.time == null || l.section.time > l.time)) l.section.time = l.time;
      recomputeTimed();
      st.syncTarget = nextUnstamped(i + 1);
      renderChart();
      q('#syncinfo').textContent = `"${(l.text || "acordes").slice(0, 40)}" → ${C.formatTime(l.time)}. ${st.syncTarget >= 0 ? 'Siguiente: "' + (parsed.lines[st.syncTarget].text || 'acordes') + '"' : 'Listo, guardá.'}`;
      const n = lineEls[st.syncTarget]; if (n) wrap.scrollTo({ top: n.offsetTop - wrap.clientHeight * 0.3, behavior: 'smooth' });
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
      else if (e.key === 'ArrowLeft' && player) { player.seek(Math.max(0, clock.now() - 5)); clock.report(Math.max(0, clock.now() - 5), true); }
      else if (e.key === 'ArrowRight' && player) { player.seek(clock.now() + 5); clock.report(clock.now() + 5, true); }
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
      destroy() {
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', onKey);
        if (recorder.recording) recorder.stop().catch(() => { });
        if (player) player.destroy();
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
        <div class="row"><button class="btn" id="exp">⬇ Exportar setlists y temas (JSON)</button><label class="btn">⬆ Importar JSON <input type="file" id="imp" accept="application/json" class="hidden"></label><button class="btn ghost" id="demo">Volver a cargar los temas de ejemplo</button><button class="btn ghost danger" id="wipe">Borrar todo</button></div>
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
    $('#demo', inner).onclick = () => { seedDemo(); toast('Temas de ejemplo cargados'); route(); };
    $('#wipe', inner).onclick = async () => { if (!confirm('¿Borrar TODO (temas, setlists, tomas)? No se puede deshacer.')) return; await Store.clearFiles(); localStorage.clear(); location.hash = ''; location.reload(); };
    shell('settings', inner);
  }

  // ------------------------------------------------------------------ init
  route();
})();
