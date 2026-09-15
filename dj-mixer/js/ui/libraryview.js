import { el, fmtTime, fmtBpm, toast, debounce } from '../utils.js';
import { bridge } from '../sources/bridge.js';
import { spotify } from '../sources/spotify.js';

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
    plus.addEventListener('click', () => { const t = add(); toast(`Agregado: ${t.title}`); });
    const a = el('button', { class: 'btn xs a', title: 'Agregar y cargar en Deck A' }, 'A'); a.addEventListener('click', () => this.onLoad(add(), this.decks.A));
    const b = el('button', { class: 'btn xs b', title: 'Agregar y cargar en Deck B' }, 'B'); b.addEventListener('click', () => this.onLoad(add(), this.decks.B));
    return el('div', { class: 'result' }, el('span', { class: 'cover', style: r.cover || r.thumb ? `background-image:url("${r.cover || r.thumb}")` : '' }),
      el('span', { class: 'grow' }, `${r.title} `, el('small', { class: 'muted' }, `${r.artist} · ${fmtTime(r.duration || 0, { tenths: false })}`)), el('span', { class: 'acts' }, plus, a, b));
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
    this.$search = el('input', { type: 'search', placeholder: 'Buscar en la biblioteca…', class: 'search' });
    this.$search.addEventListener('input', debounce(() => { this.q = this.$search.value; this.render(); }, 120));
    this.$search.addEventListener('keydown', e => { if (e.key === 'Escape') { this.$search.value = ''; this.q = ''; this.render(); } });
    // YouTube
    const ytIn = el('input', { type: 'text', placeholder: 'Pegá un link de YouTube (o buscá si el bridge está activo)', class: 'grow' });
    const ytAdd = el('button', { class: 'btn sm accent' }, 'Agregar');
    const ytGo = async () => {
      const v = ytIn.value.trim(); if (!v) return;
      try {
        if (/youtu\.?be/.test(v) || /^[\w-]{11}$/.test(v)) {
          let info = null;
          if (bridge.ytdlp) { try { info = await bridge.resolve(v); } catch { /* embed */ } }
          const t = this.lib.addYouTube(v, info); toast(`Agregado: ${t.title}`); ytIn.value = ''; this.source = 'youtube';
        } else if (bridge.ytdlp) {
          this.$ytResults.innerHTML = '<div class="muted">Buscando…</div>';
          const res = await bridge.search(v);
          this.$ytResults.innerHTML = '';
          for (const r of res) this.$ytResults.append(this.resultRow(r, () => this.lib.addYouTube(r.url, r)));
          if (!res.length) this.$ytResults.innerHTML = '<div class="muted">Sin resultados</div>';
        } else toast('Pegá un link de YouTube. Para buscar, ejecutá el bridge (npm start + yt-dlp).', 'warn', 5000);
      } catch (e) { toast(e.message, 'error'); }
      this.render();
    };
    ytAdd.addEventListener('click', ytGo); ytIn.addEventListener('keydown', e => e.key === 'Enter' && ytGo());
    this.$ytStatus = el('span', { class: 'muted small' });
    this.$ytResults = el('div', { class: 'results' });
    this.$ytPanel = el('div', { class: 'src-panel', dataset: { panel: 'youtube' } }, el('div', { class: 'row' }, ytIn, ytAdd, this.$ytStatus), this.$ytResults);
    // Spotify
    const spIn = el('input', { type: 'text', placeholder: 'Buscar en Spotify…', class: 'grow' });
    const spBtn = el('button', { class: 'btn sm accent' }, 'Buscar');
    this.$spLogin = el('button', { class: 'btn sm' }, 'Conectar Spotify');
    this.$spLogin.addEventListener('click', async () => {
      try { if (spotify.loggedIn) { spotify.logout(); this.render(); } else await spotify.login(); } catch (e) { toast(e.message, 'error', 5000); }
    });
    const spGo = async () => {
      const v = spIn.value.trim(); if (!v) return;
      if (!spotify.loggedIn) return toast('Conectá Spotify primero (Client ID en Ajustes).', 'warn');
      try {
        this.$spResults.innerHTML = '<div class="muted">Buscando…</div>';
        const res = await spotify.search(v); this.$spResults.innerHTML = '';
        for (const r of res) this.$spResults.append(this.resultRow(r, () => this.lib.addSpotify(r)));
        if (!res.length) this.$spResults.innerHTML = '<div class="muted">Sin resultados</div>';
      } catch (e) { toast(e.message, 'error', 5000); }
    };
    spBtn.addEventListener('click', spGo); spIn.addEventListener('keydown', e => e.key === 'Enter' && spGo());
    this.$spResults = el('div', { class: 'results' });
    this.$spPanel = el('div', { class: 'src-panel', dataset: { panel: 'spotify' } }, el('div', { class: 'row' }, this.$spLogin, spIn, spBtn, el('span', { class: 'muted small' }, 'Requiere Premium. Solo un deck a la vez. Sin EQ ni waveform (DRM).')), this.$spResults);
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
  async addFiles(files) {
    const added = await this.lib.addFiles(files);
    toast(added.length ? `${added.length} pista(s) agregada(s)` : 'No se encontraron archivos de audio', added.length ? 'info' : 'warn');
    this.source = 'local'; this.render();
  }
  freeDeck() { const { A, B } = this.decks; if (!A.loaded) return A; if (!B.loaded) return B; return A.playing ? (B.playing ? null : B) : A; }
  render() {
    this.$srcs.querySelectorAll('.src-btn').forEach(b => b.classList.toggle('active', b.dataset.src === this.source));
    this.$ytPanel.hidden = this.source !== 'youtube'; this.$spPanel.hidden = this.source !== 'spotify'; this.$urlPanel.hidden = this.source !== 'url';
    this.$ytStatus.textContent = bridge.ytdlp ? 'Bridge activo: audio completo + búsqueda' : 'Modo embed (sin waveform/EQ). Bridge: npm start + yt-dlp';
    this.$spLogin.textContent = spotify.loggedIn ? 'Desconectar Spotify' : 'Conectar Spotify';
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
