// Spotify: OAuth PKCE + Web Playback SDK (requiere cuenta Premium y un Client ID propio).
import { store } from '../store.js';

const SCOPES = 'streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state';
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const spotify = {
  player: null, deviceId: null, state: null, stateAt: 0, connecting: null, listeners: new Set(),
  get clientId() { return store.get('spotifyClientId', ''); },
  set clientId(v) { store.set('spotifyClientId', v.trim()); },
  // Spotify exige HTTPS, salvo la IP de loopback: http://127.0.0.1:PUERTO/ (localhost no vale).
  get redirectUri() { const u = new URL(location.href); if (u.hostname === 'localhost') u.hostname = '127.0.0.1'; return u.origin + u.pathname; },
  get redirectOk() { const h = location.hostname; return location.protocol === 'https:' || h === '127.0.0.1' || h === '[::1]' || h === 'localhost'; },
  get token() { return store.get('spotifyToken', null); },
  get loggedIn() { return !!this.token?.refresh_token; },
  async login() {
    if (!this.clientId) throw new Error('Configurá tu Spotify Client ID en Ajustes.');
    if (!this.redirectOk) throw new Error(`Spotify solo acepta HTTPS o http://127.0.0.1. Abrí la app en ${this.redirectUri} o serví con HTTPS.`);
    if (location.hostname === 'localhost') { // saltar a 127.0.0.1 (otro origen) y seguir el login ahí
      const u = new URL(this.redirectUri); u.searchParams.set('spotify_login', '1'); u.searchParams.set('client_id', this.clientId);
      location.href = u.href; return;
    }
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(64)));
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    sessionStorage.setItem('mixr.pkce', verifier);
    const p = new URLSearchParams({ client_id: this.clientId, response_type: 'code', redirect_uri: this.redirectUri, scope: SCOPES, code_challenge_method: 'S256', code_challenge: challenge });
    location.href = 'https://accounts.spotify.com/authorize?' + p;
  },
  logout() { store.del('spotifyToken'); this.player?.disconnect(); this.player = null; this.deviceId = null; },
  async handleRedirect() {
    const u = new URL(location.href); const code = u.searchParams.get('code');
    if (u.searchParams.get('spotify_login')) {
      const cid = u.searchParams.get('client_id'); if (cid) this.clientId = cid;
      history.replaceState({}, '', u.pathname);
      await this.login(); return false;
    }
    if (u.searchParams.get('error')) { history.replaceState({}, '', u.pathname); throw new Error(u.searchParams.get('error')); }
    if (!code) return false;
    const verifier = sessionStorage.getItem('mixr.pkce');
    history.replaceState({}, '', u.pathname);
    if (!verifier) return false;
    await this._tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri, code_verifier: verifier });
    return true;
  },
  async _tokenRequest(params) {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, ...params }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error_description || j.error || 'Error de autenticación Spotify');
    const prev = this.token || {};
    store.set('spotifyToken', { ...prev, ...j, expires_at: Date.now() + (j.expires_in - 60) * 1000 });
    return j.access_token;
  },
  async accessToken() {
    const t = this.token; if (!t) throw new Error('Iniciá sesión en Spotify.');
    if (Date.now() < t.expires_at) return t.access_token;
    return this._tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  },
  async api(path, opts = {}) {
    const tok = await this.accessToken();
    const r = await fetch('https://api.spotify.com/v1' + path, { ...opts, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    if (r.status === 204) return null;
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.error?.message || `Spotify API ${r.status}`);
    return j;
  },
  async search(q) {
    const j = await this.api(`/search?type=track&limit=20&q=${encodeURIComponent(q)}`);
    return (j?.tracks?.items || []).map(t => ({
      uri: t.uri, id: t.id, title: t.name, artist: t.artists.map(a => a.name).join(', '), duration: t.duration_ms / 1000,
      cover: t.album?.images?.at(-1)?.url || null,
    }));
  },
  async connect() {
    if (this.player && this.deviceId) return this.player;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      await new Promise((resolve, reject) => {
        if (window.Spotify) return resolve();
        window.onSpotifyWebPlaybackSDKReady = resolve;
        const s = document.createElement('script'); s.src = 'https://sdk.scdn.co/spotify-player.js';
        s.onerror = () => reject(new Error('No se pudo cargar el SDK de Spotify'));
        document.head.appendChild(s);
      });
      const player = new window.Spotify.Player({ name: 'MIXR DJ', volume: 1, getOAuthToken: (cb) => this.accessToken().then(cb).catch(() => cb('')) });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Spotify no conectó (¿cuenta Premium?)')), 20000);
        player.addListener('ready', ({ device_id }) => { this.deviceId = device_id; clearTimeout(timer); resolve(); });
        player.addListener('not_ready', () => { this.deviceId = null; });
        player.addListener('player_state_changed', (st) => { this.state = st; this.stateAt = performance.now(); this.listeners.forEach(fn => fn(st)); });
        for (const ev of ['initialization_error', 'authentication_error', 'account_error', 'playback_error'])
          player.addListener(ev, ({ message }) => { console.warn('Spotify', ev, message); if (ev !== 'playback_error') { clearTimeout(timer); reject(new Error('Spotify: ' + message)); } });
        player.connect().then(ok => { if (!ok) { clearTimeout(timer); reject(new Error('Spotify: conexión rechazada')); } });
      });
      this.player = player;
      return player;
    })();
    try { return await this.connecting; } finally { this.connecting = null; }
  },
  async playUri(uri, positionMs = 0) {
    await this.connect();
    await this.api(`/me/player/play?device_id=${this.deviceId}`, { method: 'PUT', body: JSON.stringify({ uris: [uri], position_ms: positionMs }) });
  },
};

export class SpotifyBackend {
  constructor(deck) {
    this.deck = deck; this.kind = 'spotify';
    this.supports = { eq: false, waveform: false, pitch: false, keylock: false, loop: 'soft' };
    this.rate = 1; this.duration = 0; this.volume = 1; this.latency = 0; this._playing = false; this._pos = 0; this.uri = null;
    this._onState = (st) => this._state(st);
  }
  async load(track) {
    await spotify.connect();
    spotify.listeners.add(this._onState);
    this.uri = track.uri; this.duration = track.duration || 0; this._pos = 0; this._playing = false;
    await spotify.player.setVolume(this.volume);
    return null;
  }
  _state(st) {
    if (!st) return;
    const cur = st.track_window?.current_track;
    if (cur && cur.uri !== this.uri) return; // otro contenido
    if (cur?.duration_ms) this.duration = cur.duration_ms / 1000;
    this._playing = !st.paused; this._pos = st.position / 1000; this._at = performance.now();
    if (st.paused && st.position === 0 && this._wasPlaying && this._pos < 1) this.deck._onEnded();
    this._wasPlaying = this._playing;
  }
  get playing() { return this._playing; }
  get position() { return this._playing ? this._pos + (performance.now() - this._at) / 1000 : this._pos; }
  tick() {}
  play(from) {
    const start = from ?? this._pos;
    this._playing = true; this._pos = start; this._at = performance.now();
    const cur = spotify.state?.track_window?.current_track;
    if (cur?.uri === this.uri && from == null) spotify.player.resume().catch(() => {});
    else spotify.playUri(this.uri, Math.round(start * 1000)).catch(e => this.deck.emit('error', e));
  }
  pause() { const p = this.position; this._playing = false; this._pos = p; spotify.player?.pause().catch(() => {}); return p; }
  seek(s) { this._pos = s; this._at = performance.now(); spotify.player?.seek(Math.round(s * 1000)).catch(() => {}); }
  setRate() {}
  setVolume(v) { this.volume = v; spotify.player?.setVolume(v).catch(() => {}); }
  setLoop() {} clearLoop() {}
  dispose() { spotify.listeners.delete(this._onState); if (this._playing) spotify.player?.pause().catch(() => {}); this._playing = false; }
}
