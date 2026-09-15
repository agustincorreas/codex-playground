// Cliente del bridge opcional (server/serve.js + yt-dlp): permite cargar YouTube como audio real.
import { store } from '../store.js';

export const EXPECTED_SERVER = 3;
export const bridge = {
  available: false, ytdlp: false, version: 0, stale: false,
  get base() { return (store.get('bridgeUrl', '') || '').replace(/\/$/, ''); },
  async check() {
    try {
      const r = await fetch(this.base + '/api/bridge/status', { cache: 'no-store' });
      const j = await r.json();
      this.available = !!j.ok; this.ytdlp = !!j.ytdlp; this.version = j.version || 0; this.stale = this.available && this.version < EXPECTED_SERVER;
    } catch { this.available = false; this.ytdlp = false; this.stale = false; }
    return this.ytdlp;
  },
  async resolve(url) {
    const r = await fetch(`${this.base}/api/resolve?url=${encodeURIComponent(url)}`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'No se pudo resolver el video');
    return r.json();
  },
  async search(q) {
    const r = await fetch(`${this.base}/api/search?q=${encodeURIComponent(q)}`);
    if (!r.ok) throw new Error('Búsqueda fallida');
    return r.json();
  },
  async match({ artist, title, duration }) {
    const q = new URLSearchParams({ artist: artist || '', title: title || '' }); if (duration) q.set('duration', String(Math.round(duration)));
    const r = await fetch(`${this.base}/api/match?${q}`);
    if (r.status === 404) throw new Error('El servidor corre una versión vieja: cortalo con Ctrl+C y volvé a ejecutar npm start.');
    if (!r.ok) throw new Error(`El bridge no pudo buscar en YouTube (HTTP ${r.status})`);
    const j = await r.json(); console.info('[bridge] match', j); return j && j.url ? j : null;
  },
  streamUrl(url) { return `${this.base}/api/stream?url=${encodeURIComponent(url)}`; },
};
