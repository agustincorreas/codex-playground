import { uid, parseFilename } from './utils.js';
import { readId3 } from './id3.js';
import { store } from './store.js';
import { bridge } from './sources/bridge.js';
import { parseYouTubeId } from './sources/youtube.js';

const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm|aif|aiff)$/i;

export class Library extends EventTarget {
  constructor() {
    super();
    this.tracks = [];
    this.queue = store.get('queue', []);
    for (const t of store.get('tracks', [])) this._attach(t);
    this._pruneQueue();
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  byId(id) { return this.tracks.find(t => t.id === id); }
  add(track) {
    if (this.tracks.some(t => t.key === track.key)) return this.byId(this.tracks.find(t => t.key === track.key).id);
    this._attach(track); this._persist(); this.emit('change'); return track;
  }
  remove(id) { this.tracks = this.tracks.filter(t => t.id !== id); this.queue = this.queue.filter(q => q !== id); this._persist(); this.emit('change'); }
  persist() { this._persist(); }
  _persist() {
    store.set('tracks', this.tracks.filter(t => t.source !== 'local').map(({ getBuffer, analysis, file, ...rest }) => rest));
    store.set('queue', this.queue);
  }
  _pruneQueue() { this.queue = this.queue.filter(id => this.byId(id)); }
  _attach(track) {
    track.id = track.id || uid();
    const meta = store.get('meta.' + track.key, null);
    if (meta?.bpm) track.bpm = meta.bpm;
    track.getBuffer = async (ctx) => {
      let ab;
      if (track.source === 'local') ab = await track.file.arrayBuffer();
      else if (track.source === 'youtube' || (track.source === 'spotify' && track.matchedUrl)) {
        const r = await fetch(bridge.streamUrl(track.source === 'youtube' ? track.url : track.matchedUrl));
        if (!r.ok) throw new Error('El bridge no pudo obtener el audio de YouTube');
        ab = await r.arrayBuffer();
      } else {
        const r = await fetch(track.url, { mode: 'cors' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        ab = await r.arrayBuffer();
      }
      return ctx.decodeAudioData(ab);
    };
    this.tracks.push(track);
    return track;
  }

  // ---- fuentes ----
  async addFiles(files) {
    const added = [];
    for (const file of files) {
      if (!(file.type.startsWith('audio/') || AUDIO_EXT.test(file.name))) continue;
      const key = `local:${file.name}|${file.size}|${file.lastModified}`;
      if (this.tracks.some(t => t.key === key)) continue;
      const { artist, title } = parseFilename(file.name);
      const track = { key, source: 'local', file, title, artist, duration: null, bpm: null, cover: null, added: Date.now() };
      this._attach(track); added.push(track);
    }
    this.emit('change');
    // metadatos en segundo plano
    for (const t of added) {
      readId3(t.file).then(tags => {
        if (tags.title) t.title = tags.title; if (tags.artist) t.artist = tags.artist;
        if (tags.bpm && !t.bpm) t.bpm = tags.bpm; if (tags.key) t.musicalKey = tags.key; if (tags.cover) t.cover = tags.cover;
        this.emit('change');
      });
      this._duration(t.file).then(d => { t.duration = d; this.emit('change'); });
    }
    return added;
  }
  _duration(file) {
    return new Promise(resolve => {
      const a = new Audio(); const url = URL.createObjectURL(file);
      const done = (d) => { URL.revokeObjectURL(url); resolve(d); };
      a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : null);
      a.onerror = () => done(null);
      a.src = url;
    });
  }
  addYouTube(input, info = null) {
    const videoId = info?.id || parseYouTubeId(input);
    if (!videoId) throw new Error('URL o ID de YouTube inválido');
    return this.add({
      key: 'yt:' + videoId, source: 'youtube', videoId, url: `https://www.youtube.com/watch?v=${videoId}`,
      title: info?.title || videoId, artist: info?.artist || 'YouTube', duration: info?.duration || null,
      cover: info?.thumb || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`, bpm: null, added: Date.now(),
    });
  }
  addSpotify(item) {
    return this.add({ key: item.uri, source: 'spotify', uri: item.uri, title: item.title, artist: item.artist, duration: item.duration, cover: item.cover, bpm: null, added: Date.now() });
  }
  addSpotifyMany(items) { let n = 0; for (const it of items) { if (!this.tracks.some(t => t.key === it.uri)) { this._attach({ key: it.uri, source: 'spotify', uri: it.uri, title: it.title, artist: it.artist, duration: it.duration, cover: it.cover, bpm: null, added: Date.now() }); n++; } } this._persist(); this.emit('change'); return n; }
  addUrl(url) {
    let u; try { u = new URL(url); } catch { throw new Error('URL inválida'); }
    const name = decodeURIComponent(u.pathname.split('/').pop() || u.hostname);
    const { artist, title } = parseFilename(name);
    return this.add({ key: 'url:' + url, source: 'url', url, title: title || url, artist: artist || u.hostname, duration: null, bpm: null, cover: null, added: Date.now() });
  }
  // ---- cola automix ----
  enqueue(id) { if (this.byId(id) && !this.queue.includes(id)) { this.queue.push(id); this._persist(); this.emit('change'); } }
  dequeue(id) { this.queue = this.queue.filter(q => q !== id); this._persist(); this.emit('change'); }
  shiftQueue() { const id = this.queue.shift(); this._persist(); this.emit('change'); return id ? this.byId(id) : null; }
  moveInQueue(id, dir) { const i = this.queue.indexOf(id); const j = i + dir; if (i < 0 || j < 0 || j >= this.queue.length) return; [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]]; this._persist(); this.emit('change'); }

  filter({ source = 'all', q = '' } = {}) {
    let list = source === 'queue' ? this.queue.map(id => this.byId(id)).filter(Boolean) : this.tracks.filter(t => source === 'all' || t.source === source);
    if (q) { const s = q.toLowerCase(); list = list.filter(t => `${t.title} ${t.artist}`.toLowerCase().includes(s)); }
    return list;
  }
}
