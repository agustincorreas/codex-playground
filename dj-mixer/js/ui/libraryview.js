import { el, fmtTime, fmtBpm, toast, debounce } from '../utils.js';
import { bridge } from '../sources/bridge.js';
import { spotify } from '../sources/spotify.js';
import { Deck } from '../audio/deck.js';
import { store } from '../store.js';

const SRC_LABEL = { local: 'Local', youtube: 'YouTube', spotify: 'Spotify', url: 'URL' };

export class LibraryView {
  constructor(library, root, { onLoad, decks }) {
    this.lib = library; this.root = root; this.onLoad = onLoad; this.decks = decks;
    this.source = 'all'; this.q = ''; this.selected = null;
    this.build();
    library.addEventListener('change', () => this.render());
    this.render();
  }
  resultRow(r, add) {
    const plus = el('button', { class: 'btn xs', title: 'Agregar a la biblioteca' }, '+');
    plus.addEventListener('click', () => { const t = add(); toast(`Agregado: ${t.title}`); this.selected = t.id; this.render(); });
    const a = el('button', { class: 'btn xs a', title: 'Agregar y cargar en Deck A' }, 'A'); a.addEventListener('click', () => this.onLoad(add(), this.decks.A));
    const b = el('button', { class: 'btn xs b', title: 'Agregar y cargar en Deck B' }, 'B'); b.addEventListener('click', () => this.onLoad(add(), this.decks.B));
    const key = r.uri || (r.id ? 'yt:' + r.id : null);
    const row = el('div', { class: 'result' + (key && this.lib.tracks.some(t => t.key === key) ? ' added' : '') }, el('span', { class: 'cover', style: r.cover || r.thumb ? `background-image:url("${r.cover || r.thumb}")` : '' }),
      el('span', { class: 'grow' }, `${r.title} `, el('small', { class: 'muted' }, `${r.artist} · ${fmtTime(r.duration || 0, { tenths: false })}`)), el('span', { class: 'acts' }, plus, a, b));
    const mark = () => row.classList.add('added');
    plus.addEventListener('click', mark); a.addEventListener('click', mark); b.addEventListener('click', mark);
    return row;
  }
  build() {
    const srcBtn = (id, label) => { const b = el('button', { class: 'src-btn', dataset: { src: id } }, label); b.addEventListener('click', () => { this.source = id; this.render(); }); return b; };
    this.$srcs = el('div', { class: 'lib-sources' }, srcBtn('all', 'Todo'), srcBtn('local', '💾 Local'), srcBtn('youtube', '▶ YouTube'), srcBtn('spotify', '● Spotify'), srcBtn('url', '🔗 URL'), srcBtn('queue', '☰ Cola Automix'));
    const files = el('input', { type: 'file', multiple: '', accept: 'audio/*,.mp3,.m4a,.flac,.wav,.ogg,.aac,.opus' });
    files.addEventListener('change', () => this.addFiles(files.files));
    const folder = el('input', { type: 'file', webkitdirectory: '', multiple: '' });
    folder.addEventListener('change', () => this.addFiles(folder.files));
    this.$add = el('div', { class: 'lib-add' }, el('label', { class: 'btn sm accent' }, '+ Archivos', files), el('label', { class: 'btn sm' }, '+ Carpeta', folder));
    // toolbar
    this.$search = el('input', { type: 'search', placeholder: 'Buscar en la biblioteca… (o pegá un link y Enter)', class: 'search' });
    this.$search.addEventListener('input', debounce(() => { this.q = this.$search.value; this.render(); }, 120));
    this.$search.addEventListener('keydown', e => {
      if (e.key === 'Escape') { this.$search.value = ''; this.q = ''; this.render(); }
      if (e.key === 'Enter' && this.isLink(this.$search.value)) { e.preventDefault(); this.addLink(this.$search.value.trim(), e.shiftKey); }
    });
    // YouTube: link o búsqueda + inicio (tendencias, relacionados, y con cuenta: recomendados/historial/me gusta)
    const ytIn = el('input', { type: 'text', placeholder: 'Pegá un link de YouTube o buscá (con el bridge activo)', class: 'grow' });
    const ytAdd = el('button', { class: 'btn sm accent' }, 'Agregar / Buscar');
    this.ytView = { mode: 'home' }; this.ytHome = null;
    const ytGo = async () => {
      const v = ytIn.value.trim(); if (!v) { this.ytView = { mode: 'home' }; return this.renderYouTube(); }
      try {
        if (/youtu\.?be/.test(v) || /^[\w-]{11}$/.test(v)) { await this.addLink(v); ytIn.value = ''; this.source = 'youtube'; this.render(); return; }
        if (!bridge.ytdlp) return toast('Pegá un link de YouTube. Para buscar, ejecutá el bridge (npm start + yt-dlp).', 'warn', 5000);
        this.ytView = { mode: 'loading' }; this.renderYouTube();
        const res = await bridge.search(v);
        this.ytView = { mode: 'results', items: res, q: v }; this.renderYouTube();
      } catch (e) { this.ytView = { mode: 'home' }; this.renderYouTube(); toast(e.message, 'error'); }
    };
    ytAdd.addEventListener('click', ytGo);
    ytIn.addEventListener('keydown', e => { if (e.key === 'Enter') ytGo(); if (e.key === 'Escape') { ytIn.value = ''; this.ytView = { mode: 'home' }; this.renderYouTube(); } });
    ytIn.addEventListener('input', () => { if (!ytIn.value.trim() && this.ytView.mode !== 'home') { this.ytView = { mode: 'home' }; this.renderYouTube(); } });
    const ytHomeBtn = el('button', { class: 'btn sm', title: 'Volver al inicio y actualizar' }, 'Inicio'); ytHomeBtn.addEventListener('click', () => { ytIn.value = ''; this.ytHome = null; this.ytView = { mode: 'home' }; this.renderYouTube(); });
    this.ytCollapsed = store.get('ytCollapsed', false);
    this.$ytToggle = el('button', { class: 'btn sm ghost' }, '');
    this.$ytToggle.addEventListener('click', () => { this.ytCollapsed = !this.ytCollapsed; store.set('ytCollapsed', this.ytCollapsed); this.renderYouTube(); });
    this.$ytStatus = el('span', { class: 'muted small' });
    this.$ytContent = el('div', { class: 'sp-content' });
    this.$ytPanel = el('div', { class: 'src-panel', dataset: { panel: 'youtube' } }, el('div', { class: 'row' }, ytHomeBtn, ytIn, ytAdd, this.$ytToggle), this.$ytStatus, this.$ytContent);
    // Spotify: búsqueda con filtros + inicio + detalle
    const spIn = el('input', { type: 'text', placeholder: 'Buscar en Spotify…', class: 'grow' });
    const spBtn = el('button', { class: 'btn sm accent' }, 'Buscar');
    this.spType = 'track'; this.spView = { mode: 'home' }; this.spHome = null;
    const types = [['track', 'Canciones'], ['artist', 'Artistas'], ['album', 'Álbumes'], ['playlist', 'Playlists']];
    this.$spTypes = el('div', { class: 'chips' }, ...types.map(([id, label]) => { const c = el('button', { class: 'chip', dataset: { type: id } }, label); c.addEventListener('click', () => { this.spType = id; this.renderSpotify(); if (spIn.value.trim()) spGo(); }); return c; }));
    this.$spLogin = el('button', { class: 'btn sm' }, 'Conectar Spotify');
    this.$spLogin.addEventListener('click', async () => {
      try { if (spotify.loggedIn) { spotify.logout(); this.spHome = null; this.render(); } else await spotify.login(); } catch (e) { toast(e.message, 'error', 5000); }
    });
    const spHomeBtn = el('button', { class: 'btn sm' }, 'Inicio'); spHomeBtn.addEventListener('click', () => { spIn.value = ''; this.spView = { mode: 'home' }; this.renderSpotify(); });
    const spGo = async () => {
      const v = spIn.value.trim(); if (!v) { this.spView = { mode: 'home' }; return this.renderSpotify(); }
      if (!spotify.loggedIn) return toast('Conectá Spotify primero (Client ID en Ajustes).', 'warn');
      if (/open\.spotify\.com|^spotify:/.test(v)) { await this.addLink(v); spIn.value = ''; return; }
      try {
        this.spView = { mode: 'loading' }; this.renderSpotify();
        const res = await spotify.search(v, this.spType);
        this.spView = { mode: 'results', type: this.spType, items: res, q: v }; this.renderSpotify();
      } catch (e) { this.spView = { mode: 'home' }; this.renderSpotify(); toast(e.message, 'error', 5000); }
    };
    spBtn.addEventListener('click', spGo);
    spIn.addEventListener('keydown', e => { if (e.key === 'Enter') spGo(); if (e.key === 'Escape') { spIn.value = ''; this.spView = { mode: 'home' }; this.renderSpotify(); } });
    spIn.addEventListener('input', () => { if (!spIn.value.trim() && this.spView.mode !== 'home') { this.spView = { mode: 'home' }; this.renderSpotify(); } });
    this.spCollapsed = store.get('spCollapsed', false);
    this.$spToggle = el('button', { class: 'btn sm ghost', title: 'Mostrar u ocultar el inicio de Spotify' }, '');
    this.$spToggle.addEventListener('click', () => { this.spCollapsed = !this.spCollapsed; store.set('spCollapsed', this.spCollapsed); this.renderSpotify(); });
    this.$spContent = el('div', { class: 'sp-content' });
    this.$spNote = el('span', { class: 'muted small' });
    this.$spPanel = el('div', { class: 'src-panel', dataset: { panel: 'spotify' } }, el('div', { class: 'row' }, this.$spLogin, spHomeBtn, spIn, this.$spTypes, spBtn, this.$spToggle), this.$spNote, this.$spContent);
    // URL
    const urlIn = el('input', { type: 'url', placeholder: 'https://…/tema.mp3 (stream directo, radio, etc.)', class: 'grow' });
    const urlAdd = el('button', { class: 'btn sm accent' }, 'Agregar');
    const urlGo = () => { try { const t = this.lib.addUrl(urlIn.value.trim()); toast(`Agregado: ${t.title}`); urlIn.value = ''; this.source = 'url'; this.render(); } catch (e) { toast(e.message, 'error'); } };
    urlAdd.addEventListener('click', urlGo); urlIn.addEventListener('keydown', e => e.key === 'Enter' && urlGo());
    this.$urlPanel = el('div', { class: 'src-panel', dataset: { panel: 'url' } }, el('div', { class: 'row' }, urlIn, urlAdd));
    this.$count = el('span', { class: 'muted small' });
    const toolbar = el('div', { class: 'lib-toolbar' }, this.$srcs, this.$add, this.$search, this.$count);
    this.$tbody = el('tbody');
    const table = el('table', { class: 'tracks' }, el('thead', {}, el('tr', {}, el('th', { class: 'c-load' }), el('th', {}, 'Título'), el('th', {}, 'Artista'), el('th', { class: 'num' }, 'BPM'), el('th', { class: 'num' }, 'Tiempo'), el('th', {}, 'Fuente'), el('th', { class: 'c-act' }))), this.$tbody);
    this.$empty = el('div', { class: 'lib-empty muted' }, 'La biblioteca está vacía. Tocá "+ Archivos" o "+ Carpeta", arrastrá música acá, o pegá un link en YouTube / URL.');
    this.$list = el('div', { class: 'lib-list' }, table, this.$empty);
    this.root.append(toolbar, this.$ytPanel, this.$spPanel, this.$urlPanel, this.$list);
    // drop de archivos
    this.root.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); this.root.classList.add('drop'); } });
    this.root.addEventListener('dragleave', () => this.root.classList.remove('drop'));
    this.root.addEventListener('drop', e => { this.root.classList.remove('drop'); if (e.dataTransfer.files?.length) { e.preventDefault(); this.addFiles(e.dataTransfer.files); } });
    this.$list.addEventListener('keydown', e => this.keys(e));
  }
  // Tarjeta con portada. Si `add` está, es un tema: click agrega, y A/B agregan y cargan.
  card(item, { onOpen = null, add = null, wide = false } = {}) {
    const c = el('div', { class: `sp-card ${wide ? 'wide' : ''}`, title: item.name, tabindex: '0', role: 'button' },
      el('span', { class: 'sp-cover', style: item.cover ? `background-image:url("${item.cover}")` : '' }), el('span', { class: 'sp-name' }, item.name), el('span', { class: 'sp-sub muted' }, item.sub || ''));
    if (add) {
      const mark = () => c.classList.add('added');
      const a = el('button', { class: 'btn xs a', title: 'Cargar en Deck A' }, 'A'); a.addEventListener('click', e => { e.stopPropagation(); mark(); this.onLoad(add(), this.decks.A); });
      const b = el('button', { class: 'btn xs b', title: 'Cargar en Deck B' }, 'B'); b.addEventListener('click', e => { e.stopPropagation(); mark(); this.onLoad(add(), this.decks.B); });
      c.append(el('span', { class: 'sp-card-acts' }, a, b));
      if (item.key && this.lib.tracks.some(t => t.key === item.key)) mark();
      onOpen = () => { const t = add(); mark(); toast(`Agregado: ${t.title}`); this.selected = t.id; this.render(); };
    }
    if (onOpen) { c.addEventListener('click', onOpen); c.addEventListener('keydown', e => { if (e.key === 'Enter') onOpen(); }); }
    return c;
  }
  spCard(item) {
    if (item.kind === 'track') return this.card(item, { add: () => this.lib.addSpotify(item.track) });
    return this.card(item, { onOpen: () => this.spOpen(item) });
  }
  ytCard(r) { return this.card({ name: r.title, sub: r.artist, cover: r.thumb, key: 'yt:' + r.id }, { add: () => this.lib.addYouTube(r.url, r), wide: true }); }
  ytCardRow(title, items, note = '') {
    if (!items?.length && !note) return null;
    return el('div', { class: 'sp-section' }, el('div', { class: 'row-label' }, title), items?.length ? el('div', { class: 'sp-cards' }, ...items.map(i => this.ytCard(i))) : el('div', { class: 'muted small' }, note));
  }
  libraryArtists(max = 3) {
    const count = new Map();
    for (const t of this.lib.tracks) { const a = (t.artist || '').split(/,|&| feat\.? /i)[0].trim(); if (a && !/^(youtube|spotify)$/i.test(a)) count.set(a, (count.get(a) || 0) + 1); }
    return [...count.entries()].sort((x, y) => y[1] - x[1]).slice(0, max).map(e => e[0]);
  }
  async renderYouTube() {
    const box = this.$ytContent; box.innerHTML = '';
    const v = this.ytView;
    const collapsed = this.ytCollapsed && v.mode === 'home';
    this.$ytToggle.textContent = collapsed ? '▸ Mostrar inicio' : '▾ Ocultar inicio';
    box.hidden = collapsed || !bridge.ytdlp; if (box.hidden) return;
    if (v.mode === 'loading') { box.append(el('div', { class: 'muted sp-empty' }, 'Buscando…')); return; }
    if (v.mode === 'results') {
      if (!v.items.length) { box.append(el('div', { class: 'muted sp-empty' }, `Sin resultados para "${v.q}"`)); return; }
      box.append(el('div', { class: 'sp-section' }, el('div', { class: 'row-label' }, `Resultados · "${v.q}"`), el('div', { class: 'results' }, ...v.items.map(r => this.resultRow(r, () => this.lib.addYouTube(r.url, r))))));
      return;
    }
    // inicio: secciones que se completan a medida que llegan
    if (!this.ytHome) this.ytHome = {};
    const sections = [];
    if (bridge.account) sections.push(['rec', 'Recomendado para vos'], ['history', 'Historial'], ['liked', 'Me gusta'], ['later', 'Ver más tarde']);
    sections.push(['trending', 'Tendencias de música']);
    const artists = this.libraryArtists();
    for (const a of artists) sections.push([`related:${a}`, `Más de ${a}`]);
    if (!bridge.account) box.append(el('div', { class: 'muted small sp-empty' }, 'Para ver tus recomendaciones, historial y me gusta, elegí tu navegador en Ajustes (⚙) → "YouTube: usar tu cuenta".'));
    if (!artists.length) box.append(el('div', { class: 'muted small sp-empty' }, 'Cuando tengas temas en la biblioteca, acá aparecen sugerencias de sus artistas.'));
    for (const [key, title] of sections) {
      const holder = el('div', { class: 'sp-section' }, el('div', { class: 'row-label' }, title), el('div', { class: 'muted small' }, 'Cargando…'));
      box.append(holder);
      const fill = (data) => {
        if (this.ytView !== v) return;
        const row = this.ytCardRow(title, data.items, data.error || data.needsAccount ? (data.error || 'Necesita tu cuenta (Ajustes).') : 'Nada por acá.');
        holder.replaceWith(row);
      };
      if (this.ytHome[key]) { fill(this.ytHome[key]); continue; }
      const [section, q] = key.startsWith('related:') ? ['related', key.slice(8)] : [key, ''];
      bridge.home(section, q).then(d => { this.ytHome[key] = d; fill(d); }).catch(e => fill({ items: [], error: e.message }));
    }
  }
  spCardRow(title, items) { if (!items?.length) return null; return el('div', { class: 'sp-section' }, el('div', { class: 'row-label' }, title), el('div', { class: 'sp-cards' }, ...items.map(i => this.spCard(i)))); }
  spTrackList(title, tracks, { importAll = null } = {}) {
    if (!tracks?.length) return null;
    const head = el('div', { class: 'row sp-head' }, el('span', { class: 'row-label' }, title));
    if (importAll) { const b = el('button', { class: 'btn xs accent' }, `Importar todo (${tracks.length})`); b.addEventListener('click', () => { const n = this.lib.addSpotifyMany(tracks); toast(`${n} pista(s) importadas`); this.renderSpotify(); }); head.append(b); }
    return el('div', { class: 'sp-section' }, head, el('div', { class: 'results' }, ...tracks.map(r => this.resultRow(r, () => this.lib.addSpotify(r)))));
  }
  async spOpen(item) {
    if (item.kind === 'track') { const t = this.lib.addSpotify(item.track); toast(`Agregado: ${t.title}`); this.selected = t.id; this.render(); return; }
    const back = this.spView;
    this.spView = { mode: 'loading' }; this.renderSpotify();
    try {
      if (item.kind === 'artist') { const d = await spotify.artistDetail(item.id); this.spView = { mode: 'detail', item, back, tracks: d.tracks, albums: d.albums }; }
      else { const tracks = await spotify.collectionTracks(`spotify:${item.kind}:${item.id}`); this.spView = { mode: 'detail', item, back, tracks, importAll: true }; }
    } catch (e) { this.spView = back; toast(e.message, 'error', 5000); }
    this.renderSpotify();
  }
  async renderSpotify() {
    this.$spTypes.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.type === this.spType));
    const box = this.$spContent; box.innerHTML = '';
    const v0 = this.spView;
    // plegado: solo oculta el inicio; una búsqueda o un detalle siempre se muestran
    const collapsed = this.spCollapsed && v0.mode === 'home';
    this.$spToggle.textContent = collapsed ? '▸ Mostrar inicio' : '▾ Ocultar inicio';
    box.hidden = collapsed; if (collapsed) return;
    if (!spotify.loggedIn) { box.append(el('div', { class: 'muted sp-empty' }, 'Conectá Spotify para ver tu inicio y buscar por canción, artista, álbum o playlist.')); return; }
    const v = this.spView;
    if (v.mode === 'loading') { box.append(el('div', { class: 'muted sp-empty' }, 'Cargando…')); return; }
    if (v.mode === 'home') {
      if (!spotify.hasHomeScopes) {
        const b = el('button', { class: 'btn sm accent' }, 'Reconectar Spotify'); b.addEventListener('click', () => spotify.login().catch(e => toast(e.message, 'error')));
        box.append(el('div', { class: 'sp-empty row' }, el('span', { class: 'muted' }, 'Para ver tu inicio (playlists, recientes, me gusta) hay que volver a autorizar la app con permisos nuevos.'), b)); return;
      }
      if (!this.spHome) { box.append(el('div', { class: 'muted sp-empty' }, 'Cargando tu inicio…')); try { this.spHome = await spotify.home(); } catch (e) { box.innerHTML = ''; box.append(el('div', { class: 'muted sp-empty' }, 'No se pudo cargar el inicio: ' + e.message)); return; } if (this.spView !== v) return; box.innerHTML = ''; }
      const h = this.spHome;
      const recentCards = h.recent.slice(0, 12).map(t => ({ kind: 'track', track: t, name: t.title, sub: t.artist, cover: t.cover }));
      box.append(this.spCardRow('Tus playlists', h.playlists), this.spCardRow('Escuchado recientemente', recentCards), this.spTrackList('Tus me gusta', h.liked, { importAll: true }), this.spTrackList('Lo que más escuchás', h.top, { importAll: true }));
      if (!h.playlists.length && !h.recent.length && !h.liked.length && !h.top.length) box.append(el('div', { class: 'muted sp-empty' }, 'Tu cuenta todavía no tiene actividad para mostrar.'));
      return;
    }
    if (v.mode === 'results') {
      if (!v.items.length) { box.append(el('div', { class: 'muted sp-empty' }, `Sin resultados para "${v.q}"`)); return; }
      if (v.type === 'track') box.append(this.spTrackList(`Canciones · "${v.q}"`, v.items));
      else box.append(el('div', { class: 'sp-section' }, el('div', { class: 'row-label' }, `${v.type === 'artist' ? 'Artistas' : v.type === 'album' ? 'Álbumes' : 'Playlists'} · "${v.q}"`), el('div', { class: 'sp-grid' }, ...v.items.map(i => this.spCard(i)))));
      return;
    }
    if (v.mode === 'detail') {
      const backBtn = el('button', { class: 'btn xs ghost' }, '← Volver'); backBtn.addEventListener('click', () => { this.spView = v.back || { mode: 'home' }; this.renderSpotify(); });
      box.append(el('div', { class: 'row sp-detail-head' }, backBtn, el('span', { class: 'sp-cover sm', style: v.item.cover ? `background-image:url("${v.item.cover}")` : '' }), el('b', {}, v.item.name), el('span', { class: 'muted small' }, v.item.sub || '')));
      if (v.item.kind === 'artist') box.append(this.spTrackList('Más escuchadas', v.tracks), this.spCardRow('Álbumes y singles', v.albums));
      else box.append(this.spTrackList('Temas', v.tracks, { importAll: true }));
    }
  }
  isLink(v) { v = (v || '').trim(); return /youtu\.?be/.test(v) || /open\.spotify\.com|^spotify:/.test(v) || /^https?:\/\//.test(v); }
  // Pegar un link + Enter lo agrega a la lista (YouTube, tema/playlist/álbum de Spotify, o URL de audio).
  async addLink(v, loadToo = false) {
    try {
      let track = null;
      if (/youtu\.?be/.test(v)) { let info = null; if (bridge.ytdlp) { try { info = await bridge.resolve(v); } catch { /* embed */ } } track = this.lib.addYouTube(v, info); }
      else if (/open\.spotify\.com|^spotify:/.test(v)) {
        if (!spotify.loggedIn) return toast('Conectá Spotify primero (Client ID en Ajustes).', 'warn');
        if (spotify.parseCollection(v)) { toast('Importando…'); const items = await spotify.collectionTracks(v); const n = this.lib.addSpotifyMany(items); toast(`${n} pista(s) importadas`); this.$search.value = ''; this.q = ''; this.source = 'spotify'; this.render(); return; }
        const t = await spotify.trackFromLink(v); if (!t) return toast('Link de Spotify no reconocido', 'warn'); track = this.lib.addSpotify(t);
      }
      else track = this.lib.addUrl(v);
      this.$search.value = ''; this.q = ''; this.selected = track.id; this.source = 'all'; this.render();
      toast(`Agregado: ${track.title}`);
      if (loadToo) { const d = this.freeDeck(); if (d) this.onLoad(track, d); }
    } catch (e) { toast(e.message, 'error', 5000); }
  }
  async addFiles(files) {
    const added = await this.lib.addFiles(files);
    toast(added.length ? `${added.length} pista(s) agregada(s)` : 'No se encontraron archivos de audio', added.length ? 'info' : 'warn');
    this.source = 'local'; this.render();
  }
  freeDeck() { const { A, B } = this.decks; if (!A.loaded) return A; if (!B.loaded) return B; return A.playing ? (B.playing ? null : B) : A; }
  render() {
    this.$srcs.querySelectorAll('.src-btn').forEach(b => b.classList.toggle('active', b.dataset.src === this.source));
    this.$ytPanel.hidden = this.source !== 'youtube'; this.$spPanel.hidden = this.source !== 'spotify'; this.$urlPanel.hidden = this.source !== 'url';
    this.$ytStatus.textContent = bridge.ytdlp ? (bridge.account ? 'Bridge activo con tu cuenta de YouTube: audio completo, búsqueda e inicio personalizado.' : 'Bridge activo: audio completo + búsqueda. Para ver tus recomendaciones e historial, elegí tu navegador en Ajustes (⚙).') : 'Modo embed (sin waveform/EQ ni búsqueda). Bridge: npm start + yt-dlp';
    if (this.source === 'youtube') this.renderYouTube();
    this.$spLogin.textContent = spotify.loggedIn ? 'Desconectar Spotify' : 'Conectar Spotify';
    if (this.source === 'spotify') this.renderSpotify();
    this.$spNote.textContent = Deck.spotifyViaYouTube()
      ? 'Bridge activo: al cargar un tema de Spotify, el audio se toma de YouTube (waveform, EQ, loops y los dos decks). Requiere Premium para buscar e importar.'
      : 'Sin bridge: reproductor oficial de Spotify (Premium). Un deck a la vez y sin EQ ni waveform por DRM. Con yt-dlp + npm start se desbloquea todo.';
    const list = this.lib.filter({ source: this.source, q: this.q });
    this.$count.textContent = `${list.length} pista${list.length === 1 ? '' : 's'}`;
    this.$empty.hidden = list.length > 0;
    this.$empty.textContent = this.source === 'queue' ? 'La cola Automix está vacía: agregá pistas con el botón ☰ de la lista.' : 'La biblioteca está vacía. Tocá "+ Archivos" o "+ Carpeta", arrastrá música acá, o pegá un link en YouTube / URL.';
    this.$tbody.innerHTML = '';
    const inQueue = new Set(this.lib.queue);
    for (const t of list) {
      const loadA = el('button', { class: 'btn xs a', title: 'Cargar en Deck A' }, 'A'); loadA.addEventListener('click', () => this.onLoad(t, this.decks.A));
      const loadB = el('button', { class: 'btn xs b', title: 'Cargar en Deck B' }, 'B'); loadB.addEventListener('click', () => this.onLoad(t, this.decks.B));
      const q = el('button', { class: `btn xs ${inQueue.has(t.id) ? 'on' : ''}`, title: inQueue.has(t.id) ? 'Quitar de la cola' : 'Agregar a la cola Automix' }, '☰');
      q.addEventListener('click', () => inQueue.has(t.id) ? this.lib.dequeue(t.id) : this.lib.enqueue(t.id));
      const del = el('button', { class: 'btn xs ghost', title: 'Quitar de la biblioteca' }, '✕'); del.addEventListener('click', () => this.lib.remove(t.id));
      const act = el('span', { class: 'acts' }, q, del);
      if (this.source === 'queue') {
        const up = el('button', { class: 'btn xs ghost' }, '↑'); up.addEventListener('click', () => this.lib.moveInQueue(t.id, -1));
        const dn = el('button', { class: 'btn xs ghost' }, '↓'); dn.addEventListener('click', () => this.lib.moveInQueue(t.id, 1));
        act.prepend(up, dn);
      }
      const inDeck = ['A', 'B'].filter(id => this.decks[id].track === t);
      const tr = el('tr', { draggable: 'true', tabindex: '0', dataset: { id: t.id }, class: inDeck.length ? `in-deck-${inDeck[0]}` : '' },
        el('td', { class: 'c-load' }, loadA, loadB),
        el('td', { class: 'title-cell' }, el('span', { class: 'cover', style: t.cover ? `background-image:url("${t.cover}")` : '' }), el('span', {}, t.title), inDeck.length ? el('span', { class: 'deck-tag' }, inDeck.join('/')) : null),
        el('td', {}, t.artist || '—'), el('td', { class: 'num' }, fmtBpm(t.bpm)), el('td', { class: 'num' }, t.duration ? fmtTime(t.duration, { tenths: false }) : '--:--'),
        el('td', {}, el('span', { class: `src-tag ${t.source}` }, SRC_LABEL[t.source])), el('td', { class: 'c-act' }, act));
      tr.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-track', t.id); e.dataTransfer.effectAllowed = 'copy'; });
      tr.addEventListener('dblclick', () => { const d = this.freeDeck(); d ? this.onLoad(t, d) : toast('Ambos decks están sonando. Usá los botones A/B.', 'warn'); });
      tr.addEventListener('click', () => { this.selected = t.id; this.$tbody.querySelectorAll('tr').forEach(r => r.classList.toggle('sel', r.dataset.id === t.id)); });
      if (this.selected === t.id) tr.classList.add('sel');
      this.$tbody.append(tr);
    }
  }
  keys(e) {
    const rows = [...this.$tbody.querySelectorAll('tr')]; if (!rows.length) return;
    let i = rows.findIndex(r => r.dataset.id === this.selected);
    if (e.key === 'ArrowDown') { i = Math.min(rows.length - 1, i + 1); } else if (e.key === 'ArrowUp') { i = Math.max(0, i - 1); }
    else if (e.key === 'Enter' && i >= 0) { rows[i].dispatchEvent(new Event('dblclick')); return; } else return;
    e.preventDefault(); rows[i].click(); rows[i].focus(); rows[i].scrollIntoView({ block: 'nearest' });
  }
  scroll(delta) {
    const rows = [...this.$tbody.querySelectorAll('tr')]; if (!rows.length) return;
    let i = rows.findIndex(r => r.dataset.id === this.selected); i = Math.max(0, Math.min(rows.length - 1, i + delta));
    rows[i].click(); rows[i].scrollIntoView({ block: 'nearest' });
  }
  selectedTrack() { return this.lib.byId(this.selected); }
}
