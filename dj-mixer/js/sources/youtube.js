// Deck de YouTube vía IFrame Player API (sin bridge). Controla play/pause/seek/volumen/velocidad.
let apiPromise = null;
export function loadYouTubeApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => reject(new Error('No se pudo cargar la API de YouTube (¿sin internet?)'));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error('YouTube API: tiempo de espera agotado')), 15000);
  });
  return apiPromise;
}

export function parseYouTubeId(input) {
  const s = (input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0];
    if (u.hostname.includes('youtube.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]{11})/); if (m) return m[2];
    }
  } catch { /* no es URL */ }
  return null;
}

export class YouTubeBackend {
  constructor(deck) {
    this.deck = deck; this.kind = 'youtube';
    this.supports = { eq: false, waveform: false, pitch: 'coarse', keylock: false, loop: 'soft' };
    this.player = null; this._pos = 0; this._playing = false; this._lastT = 0; this._lastP = 0; this.rate = 1; this.duration = 0; this.volume = 1;
    this.latency = 0;
  }
  async load(track) {
    const YT = await loadYouTubeApi();
    const host = this.deck.videoHost; host.innerHTML = '';
    const div = document.createElement('div'); host.appendChild(div);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('YouTube no respondió')), 20000);
      this.player = new YT.Player(div, {
        videoId: track.videoId, width: '100%', height: '100%',
        playerVars: { controls: 0, disablekb: 1, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, origin: location.origin },
        events: {
          onReady: () => { clearTimeout(timer); resolve(); },
          onError: (e) => { clearTimeout(timer); reject(new Error(`YouTube: error ${e.data} (video no embebible o no disponible)`)); },
          onStateChange: (e) => this._state(e.data),
        },
      });
    });
    this.player.setVolume(Math.round(this.volume * 100));
    this.duration = this.player.getDuration() || track.duration || 0;
    const vd = this.player.getVideoData?.();
    if (vd?.title && (!track.title || track.title === track.videoId)) track.title = vd.title;
    if (vd?.author && !track.artist) track.artist = vd.author;
    track.duration = this.duration;
    return null;
  }
  _state(s) {
    const YT = window.YT;
    if (s === YT.PlayerState.PLAYING) { this._playing = true; this._sync(); this.duration = this.player.getDuration() || this.duration; }
    else if (s === YT.PlayerState.PAUSED) { this._playing = false; this._sync(); }
    else if (s === YT.PlayerState.ENDED) { this._playing = false; this._pos = this.duration; this.deck._onEnded(); }
  }
  _sync() { this._lastP = this.player?.getCurrentTime?.() ?? this._lastP; this._lastT = performance.now(); }
  get playing() { return this._playing; }
  get position() {
    if (!this.player) return 0;
    if (!this._playing) return this._lastP;
    return this._lastP + (performance.now() - this._lastT) / 1000 * this.rate;
  }
  tick() { if (this._playing && performance.now() - this._lastT > 400) this._sync(); }
  play(from) { if (from != null) this.player.seekTo(from, true); this.player.playVideo(); this._playing = true; this._lastP = from ?? this.position; this._lastT = performance.now(); }
  pause() { const p = this.position; this.player.pauseVideo(); this._playing = false; this._lastP = p; this._lastT = performance.now(); return p; }
  seek(s) { this.player.seekTo(s, true); this._lastP = s; this._lastT = performance.now(); }
  setRate(r) { this.rate = r; try { this.player.setPlaybackRate(r); } catch { /* fuera de rango */ } }
  setVolume(v) { this.volume = v; this.player?.setVolume(Math.round(v * 100)); }
  setLoop() {} clearLoop() {}
  dispose() { try { this.player?.destroy(); } catch { /* ignore */ } this.player = null; this._playing = false; if (this.deck.videoHost) this.deck.videoHost.innerHTML = ''; }
}
