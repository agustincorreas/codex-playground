import { analyzeBuffer } from './analysis.js';
import { YouTubeBackend } from '../sources/youtube.js';
import { SpotifyBackend } from '../sources/spotify.js';
import { bridge } from '../sources/bridge.js';
import { clamp } from '../utils.js';
import { store } from '../store.js';

// ---------- Backend de buffer (archivos locales, URLs con CORS, YouTube vía bridge) ----------
export class BufferBackend {
  constructor(deck) {
    this.deck = deck; this.kind = 'buffer';
    this.supports = { eq: true, waveform: true, pitch: true, keylock: true, loop: 'native' };
    const c = this.ctx = deck.engine.ctx;
    this.out = c.createGain();
    this.out.connect(deck.channel.input);
    this.src = null; this.buffer = null; this._pos = 0; this.rate = 1; this.loop = null; this.duration = 0;
    this.keylockNode = null; this.keylockOn = false; this.latency = 0;
  }
  async load(track) {
    const buffer = await track.getBuffer(this.ctx);
    this.buffer = buffer; this.duration = buffer.duration; this._pos = 0;
    track.duration = buffer.duration;
    if (!track.analysis) track.analysis = await analyzeBuffer(buffer);
    return track.analysis;
  }
  get playing() { return !!this.src; }
  get position() {
    if (!this.src) return this._pos;
    const raw = this._startPos + (this.ctx.currentTime - this._startTime) * this.rate;
    return Math.max(0, this._applyLoop(raw) - this.latency * this.rate);
  }
  _applyLoop(raw) {
    if (this.loop && raw > this.loop.end) {
      const len = this.loop.end - this.loop.start;
      return len > 0 ? this.loop.start + ((raw - this.loop.start) % len) : this.loop.start;
    }
    return Math.min(raw, this.duration);
  }
  _target() { return this.keylockNode && this.keylockOn ? this.keylockNode : this.out; }
  play(from) {
    if (!this.buffer) return;
    if (this.src) this.stop();
    let pos = clamp(from ?? this._pos, 0, Math.max(0, this.duration - 0.01));
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer; src.playbackRate.value = this.rate;
    if (this.loop) { src.loop = true; src.loopStart = this.loop.start; src.loopEnd = this.loop.end; if (pos > this.loop.end) pos = this.loop.start; }
    src.connect(this._target());
    src.onended = () => { if (this.src === src) { this.src = null; this._pos = this.duration; this.deck._onEnded(); } };
    src.start(0, pos);
    this.src = src; this._startPos = pos; this._startTime = this.ctx.currentTime;
  }
  _reanchor() { if (this.src) { const raw = this._startPos + (this.ctx.currentTime - this._startTime) * this.rate; this._startPos = this._applyLoop(raw); this._startTime = this.ctx.currentTime; } }
  pause() { this._pos = this.position; this.stop(); return this._pos; }
  stop() { const s = this.src; if (!s) return; this.src = null; s.onended = null; try { s.stop(); } catch { /* ya detenido */ } s.disconnect(); }
  seek(s) { s = clamp(s, 0, this.duration); if (this.src) this.play(s); else this._pos = s; }
  setRate(r) {
    this._reanchor();
    this.rate = r;
    if (this.src) this.src.playbackRate.setTargetAtTime(r, this.ctx.currentTime, 0.005);
    this._updateKeylock();
  }
  setKeylock(on) {
    if (on && !this.keylockNode && this.deck.engine.hasKeylock) {
      try { this.keylockNode = new AudioWorkletNode(this.ctx, 'keylock', { outputChannelCount: [2] }); this.keylockNode.connect(this.out); }
      catch (e) { console.warn('keylock no disponible', e); }
    }
    if (on && !this.keylockNode) return false;
    if (on === this.keylockOn) return on;
    this.keylockOn = on;
    this.latency = on ? 0.045 / 2 : 0;
    if (this.src) { this.src.disconnect(); this.src.connect(this._target()); }
    this._updateKeylock();
    return on;
  }
  _updateKeylock() {
    if (!this.keylockNode) return;
    const p = this.keylockOn ? clamp(1 / this.rate, 0.25, 4) : 1;
    this.keylockNode.parameters.get('pitch').setTargetAtTime(p, this.ctx.currentTime, 0.01);
  }
  setLoop(start, end) {
    if (!(end > start)) return;
    this._reanchor();
    this.loop = { start, end };
    if (this.src) {
      this.src.loopStart = start; this.src.loopEnd = end; this.src.loop = true;
      if (this._startPos > end || this._startPos < start - 0.05) this.play(start);
    } else if (this._pos > end || this._pos < start) this._pos = start;
  }
  clearLoop() { if (!this.loop) return; this._reanchor(); if (this.src) this.src.loop = false; this.loop = null; }
  setVolume() {}
  tick() {}
  dispose() { this.stop(); this.out.disconnect(); this.keylockNode?.disconnect(); this.buffer = null; }
}

// ---------- Backend <audio> (URLs sin CORS): sin EQ/waveform, pero con keylock nativo ----------
export class MediaBackend {
  constructor(deck) {
    this.deck = deck; this.kind = 'media';
    this.supports = { eq: false, waveform: false, pitch: true, keylock: true, loop: 'soft' };
    this.el = new Audio(); this.el.preload = 'auto'; this.el.crossOrigin = null;
    this.rate = 1; this.volume = 1; this.duration = 0; this.latency = 0;
    this.el.addEventListener('ended', () => this.deck._onEnded());
  }
  async load(track) {
    this.el.src = track.url;
    await new Promise((resolve, reject) => {
      this.el.onloadedmetadata = () => resolve();
      this.el.onerror = () => reject(new Error('No se pudo reproducir la URL (formato o permisos).'));
    });
    this.duration = this.el.duration; track.duration = this.duration;
    this.el.volume = this.volume;
    return null;
  }
  get playing() { return !this.el.paused; }
  get position() { return this.el.currentTime; }
  play(from) { if (from != null) this.el.currentTime = from; this.el.play().catch(e => this.deck.emit('error', e)); }
  pause() { this.el.pause(); return this.el.currentTime; }
  seek(s) { this.el.currentTime = clamp(s, 0, this.duration); }
  setRate(r) { this.rate = r; this.el.playbackRate = r; }
  setKeylock(on) { this.el.preservesPitch = on; return on; }
  setVolume(v) { this.volume = v; this.el.volume = v; }
  setLoop() {} clearLoop() {}
  tick() {}
  dispose() { this.el.pause(); this.el.removeAttribute('src'); this.el.load(); }
}

// ---------- Deck: estado común + delegación al backend ----------
export class Deck extends EventTarget {
  constructor(id, engine, channel) {
    super();
    this.id = id; this.engine = engine; this.channel = channel;
    this.backend = null; this.track = null; this.analysis = null;
    this.rate = 1; this.pitchRange = 0.08; this.keylock = false; this.quantize = true;
    this.hotcues = []; this.loop = null; this.cuePoint = 0; this.bpm = null; this.beatOffset = 0;
    this.loaded = false; this.loading = false; this.videoHost = null;
    this._volume = 1; this._cueHeld = false; this._pendingLoopBeats = null;
    channel.onVolume = (v) => { this._volume = v; this.backend?.setVolume?.(v); };
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, fn) { this.addEventListener(type, e => fn(e.detail)); return this; }

  static spotifyViaYouTube() { return bridge.ytdlp && store.get('spotifyViaYouTube', true) !== false; }
  _makeBackend(track) {
    if (track.source === 'youtube') return bridge.ytdlp ? new BufferBackend(this) : new YouTubeBackend(this);
    if (track.source === 'spotify') return track.matchedUrl && Deck.spotifyViaYouTube() ? new BufferBackend(this) : new SpotifyBackend(this);
    return new BufferBackend(this);
  }
  async load(track) {
    if (this.loading) return;
    this.loading = true; this.emit('loading', track);
    this.eject(true);
    // Spotify no permite procesar su audio (DRM): con el bridge, buscamos el mismo tema en YouTube.
    if (track.source === 'spotify' && Deck.spotifyViaYouTube() && !track.matchedUrl && !track.matchFailed) {
      track.matchError = null;
      try {
        const m = await bridge.match({ artist: track.artist, title: track.title, duration: track.duration });
        if (m) { track.matchedUrl = m.url; track.matchedTitle = m.title; this.emit('matched', track); }
        else track.matchFailed = true;
      } catch (e) { console.warn('match', e); track.matchError = e.message || String(e); }
    }
    let backend = this._makeBackend(track);
    try {
      try { await backend.load(track); }
      catch (e) {
        if (track.source === 'url' && backend.kind === 'buffer') { backend.dispose(); backend = new MediaBackend(this); await backend.load(track); }
        else throw e;
      }
    } catch (e) {
      backend.dispose?.(); this.loading = false; this.emit('error', e); this.emit('state'); return false;
    }
    if (track.source === 'spotify' && backend.kind === 'buffer') { track.duration = backend.duration; }
    this.backend = backend; this.track = track; this.analysis = track.analysis || null;
    const meta = store.get('meta.' + track.key, {});
    this.bpm = meta.bpm || track.bpm || this.analysis?.bpm || null;
    this.beatOffset = meta.beatOffset ?? this.analysis?.beatOffset ?? 0;
    this.hotcues = meta.hotcues || [];
    this.cuePoint = meta.cue || 0;
    if (this.bpm) track.bpm = this.bpm;
    this.loop = null; this.loaded = true; this.loading = false;
    backend.setVolume?.(this._volume);
    backend.setRate(this.rate);
    backend.setKeylock?.(this.keylock);
    if (this.cuePoint) backend.seek(this.cuePoint);
    this.emit('loaded', track); this.emit('state');
    return true;
  }
  eject(silent = false) {
    if (this.backend) { this.backend.dispose(); }
    this.backend = null; this.track = null; this.analysis = null; this.loaded = false; this.loop = null; this.bpm = null; this.hotcues = [];
    if (!silent) { this.emit('ejected'); this.emit('state'); }
  }
  _saveMeta() {
    if (!this.track) return;
    store.set('meta.' + this.track.key, { bpm: this.bpm, beatOffset: this.beatOffset, hotcues: this.hotcues, cue: this.cuePoint });
  }
  get kind() { return this.backend?.kind || null; }
  get supports() { return this.backend?.supports || {}; }
  get playing() { return !!this.backend?.playing; }
  get position() { return this.backend?.position ?? 0; }
  get duration() { return this.backend?.duration || this.track?.duration || 0; }
  get effectiveBpm() { return this.bpm ? this.bpm * this.rate : null; }
  get beatLen() { return this.bpm ? 60 / this.bpm : null; }

  play() { if (!this.loaded) return; this.engine.resume(); if (this.position >= this.duration - 0.05) this.backend.seek(0); this.backend.play(); this.emit('state'); }
  pause() { if (!this.loaded) return; this.backend.pause(); this.emit('state'); }
  togglePlay() { this.playing ? this.pause() : this.play(); }
  seek(s) { if (!this.loaded) return; this.backend.seek(clamp(s, 0, this.duration)); this.emit('state'); }
  // CUE estilo Serato: en play → vuelve al cue y pausa; en pausa → fija el cue (o reproduce mientras se mantiene apretado)
  cueDown() {
    if (!this.loaded) return;
    if (this.playing) { this.pause(); this.seek(this.cuePoint); return; }
    if (Math.abs(this.position - this.cuePoint) > 0.02) { this.cuePoint = this.quantizePos(this.position); this.seek(this.cuePoint); this._saveMeta(); }
    else { this._cueHeld = true; this.play(); }
  }
  cueUp() { if (this._cueHeld) { this._cueHeld = false; this.pause(); this.seek(this.cuePoint); } }
  _onEnded() { this.emit('ended'); this.emit('state'); }

  setPitch(p) { p = clamp(p, -1, 1); this.pitch = p; this.setRate(1 + p * this.pitchRange); }
  setRate(r) {
    r = clamp(r, 0.25, 2.5);
    if (Math.abs(r - 1) < 0.0008) r = 1;
    this.rate = r; this.pitch = clamp((r - 1) / this.pitchRange, -1, 1);
    this.backend?.setRate(r); this.emit('rate');
  }
  setPitchRange(v) { this.pitchRange = v; this.setRate(1 + this.pitch * v); }
  nudge(delta) { // empujón temporal (jog): delta en "vueltas"
    if (!this.loaded) return;
    if (!this.playing) { this.seek(this.position + delta * 1.8); return; }
    const r = this.rate;
    this.backend.setRate(clamp(r * (1 + delta * 4), 0.3, 2.5));
    clearTimeout(this._nudgeT);
    this._nudgeT = setTimeout(() => this.backend?.setRate(this.rate), 90);
  }
  setKeylock(on) { this.keylock = !!on; const ok = this.backend?.setKeylock?.(this.keylock); if (on && ok === false) this.keylock = false; this.emit('state'); return this.keylock; }

  // --- beatgrid ---
  phaseAt(pos) { return this.bpm ? (((pos - this.beatOffset) / this.beatLen) % 1 + 1) % 1 : 0; }
  quantizePos(pos) { if (!this.bpm || !this.quantize) return pos; const b = Math.round((pos - this.beatOffset) / this.beatLen); return clamp(this.beatOffset + b * this.beatLen, 0, this.duration); }
  prevBeat(pos) { if (!this.bpm) return pos; const b = Math.floor((pos - this.beatOffset + 1e-3) / this.beatLen); return Math.max(0, this.beatOffset + b * this.beatLen); }
  setBpm(b) { if (b > 0) { this.bpm = b; if (this.track) this.track.bpm = b; this._saveMeta(); this.emit('state'); } }
  setGridHere() { if (!this.bpm) return; this.beatOffset = this.position % this.beatLen; this._saveMeta(); this.emit('state'); }
  tapTempo() {
    const now = performance.now();
    if (!this._taps || now - this._taps.at(-1) > 2000) this._taps = [];
    this._taps.push(now);
    if (this._taps.length >= 4) {
      const iv = (this._taps.at(-1) - this._taps[0]) / (this._taps.length - 1);
      this.setBpm(Math.round(60000 / iv * 10) / 10);
      if (this._taps.length > 12) this._taps.shift();
    }
  }
  syncTo(other) {
    if (!this.loaded || !other?.loaded || !this.bpm || !other.bpm) return false;
    let target = other.effectiveBpm;
    // elegir el múltiplo más cercano (half/double time)
    const cands = [target, target * 2, target / 2];
    target = cands.reduce((a, b) => Math.abs(b / this.bpm - 1) < Math.abs(a / this.bpm - 1) ? b : a);
    const r = target / this.bpm;
    if (Math.abs(r - 1) > this.pitchRange) this.setPitchRange(Math.abs(r - 1) > 0.16 ? 0.5 : 0.16);
    this.setRate(r);
    if (other.playing) {
      const d = other.phaseAt(other.position) - this.phaseAt(this.position);
      const diff = d - Math.round(d); // en beats, [-0.5, 0.5)
      if (Math.abs(diff) > 0.01) this.seek(this.position + diff * this.beatLen);
    }
    this.emit('state');
    return true;
  }

  // --- hot cues ---
  hotcue(i, { setOnly = false } = {}) {
    if (!this.loaded) return;
    const hc = this.hotcues[i];
    if (hc && !setOnly) { this.seek(hc.pos); if (!this.playing) this.play(); }
    else if (!hc) { this.hotcues[i] = { pos: this.quantizePos(this.position) }; this._saveMeta(); this.emit('state'); }
  }
  deleteHotcue(i) { if (this.hotcues[i]) { this.hotcues[i] = undefined; this._saveMeta(); this.emit('state'); } }

  // --- loops ---
  loopBeats(beats) {
    if (!this.loaded) return;
    if (!this.bpm) { const start = this.position, len = beats * 0.5; return this._setLoop(start, start + len); }
    const start = this.loop ? this.loop.start : this.prevBeat(this.position);
    this._setLoop(start, start + beats * this.beatLen);
    this.loop.beats = beats;
  }
  loopIn() { if (!this.loaded) return; this._loopIn = this.quantizePos(this.position); this.emit('state'); }
  loopOut() { if (!this.loaded || this._loopIn == null) return; const out = this.quantizePos(this.position); if (out > this._loopIn) this._setLoop(this._loopIn, out); this._loopIn = null; }
  loopHalf() { if (this.loop) { const len = (this.loop.end - this.loop.start) / 2; if (len > 0.02) this._setLoop(this.loop.start, this.loop.start + len, this.loop.beats && this.loop.beats / 2); } }
  loopDouble() { if (this.loop) { const len = (this.loop.end - this.loop.start) * 2; this._setLoop(this.loop.start, Math.min(this.duration, this.loop.start + len), this.loop.beats && this.loop.beats * 2); } }
  _setLoop(start, end, beats) {
    if (!(end > start)) return;
    this.loop = { start, end, beats: beats ?? this.loop?.beats ?? null };
    this.backend.setLoop(start, end);
    this.emit('state');
  }
  exitLoop() { if (!this.loop) return; this.loop = null; this.backend.clearLoop(); this.emit('state'); }
  toggleLoop(beats) { this.loop ? this.exitLoop() : this.loopBeats(beats ?? 4); }

  tick() {
    if (!this.backend) return;
    this.backend.tick?.();
    if (this.loop && this.backend.supports.loop === 'soft' && this.playing && this.position >= this.loop.end) this.backend.seek(this.loop.start);
  }
}
