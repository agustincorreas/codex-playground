// Cliente del bridge opcional (server/serve.js + yt-dlp): permite cargar YouTube como audio real.
import { store } from '../store.js';

export const bridge = {
  available: false, ytdlp: false,
  get base() { return (store.get('bridgeUrl', '') || '').replace(/\/$/, ''); },
  async check() {
    try {
      const r = await fetch(this.base + '/api/bridge/status', { cache: 'no-store' });
      const j = await r.json();
      this.available = !!j.ok; this.ytdlp = !!j.ytdlp;
    } catch { this.available = false; this.ytdlp = false; }
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
  streamUrl(url) { return `${this.base}/api/stream?url=${encodeURIComponent(url)}`; },
};
