// player.js — adaptadores de reproducción con una interfaz común.
// Interfaz: load(track) → Promise, play(), pause(), seek(t), time(), duration(), setRate(r),
//           rates() → [..], state → 'idle'|'loading'|'ready'|'playing'|'paused'|'ended',
//           onState(cb), destroy(), kind.
(function () {
  'use strict';

  // --------------------------------------------------------------------------
  // YouTube (IFrame Player API oficial). El video queda visible en un dock
  // chico: los términos de YouTube no permiten ocultarlo ni superponerle nada.
  // --------------------------------------------------------------------------
  let ytApiPromise = null;
  function loadYouTubeApi() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (ytApiPromise) return ytApiPromise;
    ytApiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => reject(new Error('No se pudo cargar la API de YouTube (¿sin conexión?)'));
      document.head.appendChild(s);
      setTimeout(() => { if (!(window.YT && window.YT.Player)) reject(new Error('YouTube tardó demasiado en responder')); }, 15000);
    });
    return ytApiPromise;
  }

  function parseYouTubeId(input) {
    if (!input) return null;
    input = input.trim();
    if (/^[\w-]{11}$/.test(input)) return input;
    try {
      const u = new URL(input);
      if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0] || null;
      if (u.hostname.includes('youtube.com')) {
        if (u.searchParams.get('v')) return u.searchParams.get('v');
        const m = /\/(embed|shorts|live|v)\/([\w-]{11})/.exec(u.pathname);
        if (m) return m[2];
      }
    } catch (e) { /* no era URL */ }
    return null;
  }

  class YouTubeAdapter {
    constructor(container) {
      this.kind = 'youtube';
      this.container = container;
      this.player = null;
      this.state = 'idle';
      this.listeners = [];
      this.videoId = null;
      this._ready = null;
    }
    onState(cb) { this.listeners.push(cb); }
    _emit(s) { this.state = s; this.listeners.forEach(cb => cb(s, this)); }
    async load(track) {
      const id = parseYouTubeId(track.videoId || track.url);
      if (!id) throw new Error('Link de YouTube inválido');
      this._emit('loading');
      const YT = await loadYouTubeApi();
      if (this.player && this.videoId !== id) {
        this.player.cueVideoById(id);
        this.videoId = id;
        await new Promise(r => setTimeout(r, 200));
        this._emit('ready');
        return;
      }
      if (this.player) { this._emit('ready'); return; }
      this.videoId = id;
      await new Promise((resolve, reject) => {
        const el = document.createElement('div');
        this.container.innerHTML = '';
        this.container.appendChild(el);
        this.player = new YT.Player(el, {
          videoId: id,
          width: '100%', height: '100%',
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 1, origin: location.origin.startsWith('http') ? location.origin : undefined },
          events: {
            onReady: () => { this._emit('ready'); resolve(); },
            onError: (e) => { const msg = { 2: 'ID inválido', 5: 'Error del reproductor', 100: 'Video no encontrado', 101: 'El dueño no permite reproducirlo fuera de YouTube', 150: 'El dueño no permite reproducirlo fuera de YouTube' }[e.data] || 'Error ' + e.data; this._emit('error'); this.lastError = msg; reject(new Error(msg)); },
            onStateChange: (e) => {
              const S = YT.PlayerState;
              if (e.data === S.PLAYING) this._emit('playing');
              else if (e.data === S.PAUSED) this._emit('paused');
              else if (e.data === S.ENDED) this._emit('ended');
              else if (e.data === S.BUFFERING) this._emit('loading');
              else if (e.data === S.CUED) this._emit('ready');
            },
          },
        });
      });
    }
    play() { this.player && this.player.playVideo(); }
    pause() { this.player && this.player.pauseVideo(); }
    seek(t) { this.player && this.player.seekTo(Math.max(0, t), true); }
    time() { return this.player && this.player.getCurrentTime ? (this.player.getCurrentTime() || 0) : 0; }
    duration() { return this.player && this.player.getDuration ? (this.player.getDuration() || 0) : 0; }
    setRate(r) { this.player && this.player.setPlaybackRate(r); }
    rate() { return this.player && this.player.getPlaybackRate ? this.player.getPlaybackRate() : 1; }
    rates() { return this.player && this.player.getAvailablePlaybackRates ? this.player.getAvailablePlaybackRates() : [0.5, 0.75, 1, 1.25, 1.5]; }
    canPitch() { return false; }
    destroy() { try { this.player && this.player.destroy(); } catch (e) { } this.player = null; this.container.innerHTML = ''; this._emit('idle'); }
  }

  // --------------------------------------------------------------------------
  // Archivo local (mp3/wav/m4a). Usa <audio> con preservesPitch → cambiar el
  // tempo no cambia la afinación. Un cambio de tono real necesita un
  // time-stretcher (SoundTouch/RubberBand WASM); queda para más adelante.
  // --------------------------------------------------------------------------
  class LocalAudioAdapter {
    constructor(container) {
      this.kind = 'local';
      this.container = container;
      this.audio = new Audio();
      this.audio.preservesPitch = true;
      this.audio.mozPreservesPitch = true;
      this.state = 'idle';
      this.listeners = [];
      this.url = null;
      this.audio.addEventListener('play', () => this._emit('playing'));
      this.audio.addEventListener('pause', () => this._emit(this.audio.ended ? 'ended' : 'paused'));
      this.audio.addEventListener('ended', () => this._emit('ended'));
      this.audio.addEventListener('waiting', () => this._emit('loading'));
      this.audio.addEventListener('canplay', () => { if (this.state === 'loading') this._emit('ready'); });
    }
    onState(cb) { this.listeners.push(cb); }
    _emit(s) { this.state = s; this.listeners.forEach(cb => cb(s, this)); }
    async load(track) {
      this._emit('loading');
      if (this.url) URL.revokeObjectURL(this.url);
      const blob = track.blob || (track.fileId && await window.Store.getFile(track.fileId));
      if (!blob) throw new Error('No se encontró el archivo de audio. Volvé a cargarlo.');
      this.url = URL.createObjectURL(blob);
      this.audio.src = this.url;
      await new Promise((resolve, reject) => {
        const ok = () => { cleanup(); resolve(); };
        const bad = () => { cleanup(); reject(new Error('No se pudo decodificar el audio')); };
        const cleanup = () => { this.audio.removeEventListener('loadedmetadata', ok); this.audio.removeEventListener('error', bad); };
        this.audio.addEventListener('loadedmetadata', ok);
        this.audio.addEventListener('error', bad);
        this.audio.load();
      });
      this.container.innerHTML = `<div class="local-dock"><span class="icon">🎵</span><span>${(track.name || 'Archivo local').replace(/</g, '&lt;')}</span></div>`;
      this._emit('ready');
    }
    play() { this.audio.play().catch(() => { }); }
    pause() { this.audio.pause(); }
    seek(t) { this.audio.currentTime = Math.max(0, t); }
    time() { return this.audio.currentTime || 0; }
    duration() { return isFinite(this.audio.duration) ? this.audio.duration : 0; }
    setRate(r) { this.audio.playbackRate = r; }
    rate() { return this.audio.playbackRate; }
    rates() { return [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5]; }
    canPitch() { return false; }
    destroy() { this.audio.pause(); this.audio.src = ''; if (this.url) URL.revokeObjectURL(this.url); this.url = null; this.container.innerHTML = ''; this._emit('idle'); }
  }

  // --------------------------------------------------------------------------
  // Metrónomo (Web Audio). Para practicar sin base o para temas cuyo cifrado
  // está sincronizado por BPM. Genera un click con acento en el primer tiempo.
  // --------------------------------------------------------------------------
  class MetronomeAdapter {
    constructor(container) {
      this.kind = 'metronome';
      this.container = container;
      this.state = 'idle';
      this.listeners = [];
      this.bpm = 100;
      this.beats = 4;
      this.length = 300;
      this.rateValue = 1;
      this.ctx = null;
      this._startCtx = 0; this._startPos = 0; this._pos = 0;
      this._timer = null; this._nextBeat = 0; this._beatIndex = 0;
    }
    onState(cb) { this.listeners.push(cb); }
    _emit(s) { this.state = s; this.listeners.forEach(cb => cb(s, this)); }
    async load(track) {
      this.bpm = track.bpm || 100;
      this.beats = track.beats || 4;
      this.length = track.length || 300;
      this._pos = 0;
      this.container.innerHTML = `<div class="local-dock"><span class="icon">⏱</span><span>Metrónomo · ${this.bpm} BPM · ${this.beats}/4</span></div>`;
      this._emit('ready');
    }
    _ensureCtx() {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }
    _click(when, accent) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.value = accent ? 1600 : 1000;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(accent ? 0.6 : 0.35, when + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
      o.connect(g).connect(this.ctx.destination);
      o.start(when); o.stop(when + 0.08);
    }
    _schedule() {
      const secPerBeat = 60 / this.bpm / this.rateValue;
      while (this._nextBeat < this.ctx.currentTime + 0.15) {
        this._click(this._nextBeat, this._beatIndex % this.beats === 0);
        this._nextBeat += secPerBeat;
        this._beatIndex++;
      }
      if (this.time() >= this.length) { this.pause(); this._pos = 0; this._emit('ended'); return; }
      this._timer = setTimeout(() => this._schedule(), 50);
    }
    play() {
      if (this.state === 'playing') return;
      this._ensureCtx();
      this._startCtx = this.ctx.currentTime;
      this._startPos = this._pos;
      const secPerBeat = 60 / this.bpm;
      // Alinear el próximo click al grid de tiempos del tema.
      const beatsElapsed = this._pos / secPerBeat;
      this._beatIndex = Math.ceil(beatsElapsed - 1e-6);
      this._nextBeat = this.ctx.currentTime + (this._beatIndex * secPerBeat - this._pos) / this.rateValue;
      this._emit('playing');
      this._schedule();
    }
    pause() {
      if (this.state !== 'playing') return;
      this._pos = this.time();
      clearTimeout(this._timer); this._timer = null;
      this._emit('paused');
    }
    seek(t) {
      const wasPlaying = this.state === 'playing';
      if (wasPlaying) this.pause();
      this._pos = Math.max(0, Math.min(this.length, t));
      if (wasPlaying) this.play();
    }
    time() { return this.state === 'playing' && this.ctx ? this._startPos + (this.ctx.currentTime - this._startCtx) * this.rateValue : this._pos; }
    duration() { return this.length; }
    setRate(r) { const p = this.state === 'playing'; if (p) this.pause(); this.rateValue = r; if (p) this.play(); }
    rate() { return this.rateValue; }
    rates() { return [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5]; }
    canPitch() { return false; }
    destroy() { this.pause(); this.container.innerHTML = ''; this._emit('idle'); }
  }

  window.Players = { YouTubeAdapter, LocalAudioAdapter, MetronomeAdapter, parseYouTubeId, loadYouTubeApi };
})();
