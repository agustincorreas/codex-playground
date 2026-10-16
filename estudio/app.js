// app.js — Estudio. UI táctil, pistas, grabación overdub y micrófono.
'use strict';

const engine = new AudioEngine();

// --- Estado -----------------------------------------------------------------
let tracks = [];          // pistas en pantalla
let selectedId = null;    // pista seleccionada para tocar/grabar
let nextId = 1;
let recArmed = false;
let octave = 4;           // octava base del teclado
const activeNotes = new Map(); // midi -> { startTime, el } para notas sostenidas

const DRUM_PADS = [
  { voice: 'kick',    label: 'Kick' },
  { voice: 'snare',   label: 'Snare' },
  { voice: 'hat',     label: 'Hi-hat' },
  { voice: 'openhat', label: 'Open hat' },
  { voice: 'clap',    label: 'Clap' },
  { voice: 'tom',     label: 'Tom' },
];

// --- Referencias DOM --------------------------------------------------------
const $ = (id) => document.getElementById(id);
const el = {
  tracks: $('tracks'), playhead: $('playhead'),
  btnPlay: $('btnPlay'), btnRec: $('btnRec'), btnMetro: $('btnMetro'),
  bpmVal: $('bpmVal'), bpmUp: $('bpmUp'), bpmDown: $('bpmDown'), barsSel: $('barsSel'),
  perfName: $('perfName'), quantize: $('quantize'),
  keyboard: $('keyboard'), keys: $('keys'), octUp: $('octUp'), octDown: $('octDown'),
  pads: $('pads'), mic: $('mic'), micArm: $('micArm'), micHint: $('micHint'),
  hint: $('hint'),
};

// --- Utilidades -------------------------------------------------------------
function selectedTrack() { return tracks.find((t) => t.id === selectedId) || null; }

function recordingActive() {
  const t = selectedTrack();
  return recArmed && engine.isPlaying && t && (t.kind !== 'audio');
}

function quantTime(time) {
  if (!el.quantize.checked) return time;
  // 4 subdivisiones por beat (semicorcheas) = sensación de "ajustar al ritmo".
  return engine.quantize(time, 4);
}

// --- Pistas -----------------------------------------------------------------
function addTrack(kind) {
  engine.ensureContext();
  const isDrum = kind === 'drum';
  const isAudio = kind === 'audio';
  const instrument = (!isDrum && !isAudio) ? kind : null;
  const preset = instrument ? INSTRUMENTS[instrument] : null;
  const count = tracks.length + 1;

  const track = {
    id: nextId++,
    kind,                 // 'piano'|'synth'|'bass'|'pad'|'drum'|'audio'
    instrument,           // id de INSTRUMENTS o null
    label: isDrum ? 'Batería' : isAudio ? 'Micrófono' : (preset ? preset.label : kind),
    color: isDrum ? '#ff9f7c' : isAudio ? '#9affc9' : (preset ? preset.color : '#7cc5ff'),
    events: [],
    buffer: null,
    muted: false,
    solo: false,
    volume: 0.9,
    gain: engine.createTrackGain(),
    canvas: null,
  };
  track.gain.gain.value = track.volume;
  tracks.push(track);
  engine.tracks = tracks;
  renderTracks();
  selectTrack(track.id);
}

function removeTrack(id) {
  const i = tracks.findIndex((t) => t.id === id);
  if (i < 0) return;
  try { tracks[i].gain.disconnect(); } catch (e) {}
  tracks.splice(i, 1);
  engine.tracks = tracks;
  if (selectedId === id) selectedId = tracks.length ? tracks[tracks.length - 1].id : null;
  renderTracks();
  updatePerformer();
}

function selectTrack(id) {
  selectedId = id;
  document.querySelectorAll('.track').forEach((n) => {
    n.classList.toggle('selected', Number(n.dataset.id) === id);
  });
  updatePerformer();
}

function renderTracks() {
  el.tracks.innerHTML = '';
  tracks.forEach((track) => {
    const node = document.createElement('div');
    node.className = 'track' + (track.id === selectedId ? ' selected' : '');
    node.dataset.id = track.id;

    const head = document.createElement('div');
    head.className = 'track-head';
    head.innerHTML = `
      <div class="track-name"><span class="track-dot" style="background:${track.color}"></span>${track.label}</div>
      <div class="track-ctrls">
        <button data-role="mute">M</button>
        <button data-role="solo">S</button>
        <input type="range" min="0" max="1" step="0.01" value="${track.volume}" data-role="vol">
      </div>`;

    const lane = document.createElement('div');
    lane.className = 'track-lane';
    const canvas = document.createElement('canvas');
    lane.appendChild(canvas);
    track.canvas = canvas;

    const del = document.createElement('button');
    del.className = 'track-del';
    del.textContent = '✕';
    del.title = 'Eliminar pista';

    node.append(head, lane, del);
    el.tracks.appendChild(node);

    // Eventos
    node.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.track-ctrls') || e.target === del) return;
      selectTrack(track.id);
    });
    head.querySelector('[data-role=mute]').addEventListener('click', (e) => {
      track.muted = !track.muted;
      e.currentTarget.classList.toggle('active', track.muted);
    });
    head.querySelector('[data-role=solo]').addEventListener('click', (e) => {
      track.solo = !track.solo;
      e.currentTarget.classList.toggle('active', track.solo);
    });
    head.querySelector('[data-role=vol]').addEventListener('input', (e) => {
      track.volume = Number(e.target.value);
      track.gain.gain.value = track.volume;
    });
    del.addEventListener('click', () => removeTrack(track.id));
  });
  sizeCanvases();
  drawAllLanes();
}

// --- Dibujo de carriles -----------------------------------------------------
function sizeCanvases() {
  tracks.forEach((track) => {
    const c = track.canvas;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.floor(r.width * dpr));
    c.height = Math.max(1, Math.floor(r.height * dpr));
  });
}

function drawAllLanes() {
  tracks.forEach(drawLane);
}

function drawLane(track) {
  const c = track.canvas;
  if (!c) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);
  const d = engine.loopDuration;

  // Líneas de compás.
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let b = 1; b < engine.bars; b++) {
    const x = (b / engine.bars) * W;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }

  if (track.kind === 'audio') {
    if (track.buffer) {
      ctx.fillStyle = track.color;
      const data = track.buffer.getChannelData(0);
      const step = Math.max(1, Math.floor(data.length / W));
      const mid = H / 2;
      for (let x = 0; x < W; x++) {
        let min = 1, max = -1;
        for (let i = 0; i < step; i++) {
          const v = data[x * step + i] || 0;
          if (v < min) min = v; if (v > max) max = v;
        }
        ctx.fillRect(x, mid + min * mid, 1, Math.max(1, (max - min) * mid));
      }
    }
    return;
  }

  // Eventos de notas / batería como bloques.
  ctx.fillStyle = track.color;
  const events = track.events || [];
  events.forEach((ev) => {
    const x = (ev.time / d) * W;
    if (track.kind === 'drum') {
      ctx.fillRect(x - 1, 2, 3, H - 4);
    } else {
      const w = Math.max(2, ((ev.dur || 0.1) / d) * W);
      // Mapear midi a una posición vertical dentro del carril.
      const lo = 36, hi = 84;
      const n = Math.min(1, Math.max(0, (ev.midi - lo) / (hi - lo)));
      const y = H - n * (H - 6) - 4;
      ctx.fillRect(x, y, w, 4);
    }
  });
}

// --- Zona de interpretación -------------------------------------------------
function updatePerformer() {
  const t = selectedTrack();
  el.keyboard.hidden = true;
  el.pads.hidden = true;
  el.mic.hidden = true;

  if (!t) { el.perfName.textContent = 'Elegí o agregá una pista para tocar'; return; }
  el.perfName.textContent = t.label;

  if (t.kind === 'drum') {
    el.pads.hidden = false;
    renderPads();
  } else if (t.kind === 'audio') {
    el.mic.hidden = false;
  } else {
    el.keyboard.hidden = false;
    renderKeyboard();
  }
}

// Teclado: dos octavas desde la octava base.
function renderKeyboard() {
  el.keys.innerHTML = '';
  const whiteOffsets = [0, 2, 4, 5, 7, 9, 11];
  const blackMap = { 0: 1, 1: 3, 3: 6, 4: 8, 5: 10 }; // índice de blanca -> semitono negro
  const octaves = 2;
  const whites = [];
  for (let o = 0; o < octaves; o++) {
    whiteOffsets.forEach((semi) => {
      whites.push((octave + o) * 12 + semi);
    });
  }
  const whiteW = 100 / whites.length;

  whites.forEach((midi, i) => {
    const k = document.createElement('div');
    k.className = 'key';
    k.dataset.midi = midi;
    if (i % 7 === 0) k.innerHTML = `<span class="lbl">${midiToName(midi)}</span>`;
    el.keys.appendChild(k);
  });

  // Negras posicionadas sobre las blancas.
  for (let o = 0; o < octaves; o++) {
    Object.entries(blackMap).forEach(([whiteIdx, semi]) => {
      const i = o * 7 + Number(whiteIdx);
      const midi = (octave + o) * 12 + semi;
      const k = document.createElement('div');
      k.className = 'key black';
      k.dataset.midi = midi;
      k.style.left = `calc(${(i + 1) * whiteW}% - 4%)`;
      el.keys.appendChild(k);
    });
  }
}

function renderPads() {
  el.pads.innerHTML = '';
  DRUM_PADS.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'pad';
    b.textContent = p.label;
    b.dataset.voice = p.voice;
    el.pads.appendChild(b);
  });
}

// --- Interacción de notas (pointer) -----------------------------------------
function noteOn(midi, targetEl) {
  const t = selectedTrack();
  if (!t || t.kind === 'drum' || t.kind === 'audio') return;
  engine.ensureContext();
  if (activeNotes.has(midi)) return;
  // Sonido inmediato.
  const voice = engine.playNote(t.instrument, midi, engine.ctx.currentTime, 4, t.gain, 0.85);
  const startTime = engine.isPlaying ? quantTime(engine.playheadTime) : 0;
  activeNotes.set(midi, { voice, startTime, recording: recordingActive() });
  if (targetEl) targetEl.classList.add('down');
}

function noteOff(midi, targetEl) {
  const info = activeNotes.get(midi);
  if (!info) return;
  activeNotes.delete(midi);
  // Cortar la voz con un pequeño release manual.
  try {
    const g = info.voice.gain;
    const now = engine.ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
    g.gain.linearRampToValueAtTime(0.0001, now + 0.12);
    info.voice.osc.stop(now + 0.14);
    if (info.voice.osc2) info.voice.osc2.stop(now + 0.14);
  } catch (e) {}
  if (targetEl) targetEl.classList.remove('down');

  // Registrar el evento si estábamos grabando.
  if (info.recording) {
    const t = selectedTrack();
    if (t) {
      let dur = engine.playheadTime - info.startTime;
      if (dur <= 0) dur += engine.loopDuration;
      dur = Math.min(dur, engine.loopDuration);
      t.events.push({ time: info.startTime, midi, dur: Math.max(0.08, dur), velocity: 0.85 });
      drawLane(t);
    }
  }
}

function hitPad(voice, padEl) {
  const t = selectedTrack();
  if (!t || t.kind !== 'drum') return;
  engine.ensureContext();
  engine.playDrum(voice, engine.ctx.currentTime, t.gain, 1);
  if (padEl) { padEl.classList.add('hit'); setTimeout(() => padEl.classList.remove('hit'), 90); }
  if (recordingActive()) {
    const time = quantTime(engine.playheadTime);
    t.events.push({ time, voice, velocity: 1 });
    drawLane(t);
  }
}

// Delegación de pointer para teclas y pads.
function bindPerformerPointers() {
  const handleDown = (e) => {
    const key = e.target.closest('.key');
    if (key) { e.preventDefault(); noteOn(Number(key.dataset.midi), key); return; }
    const pad = e.target.closest('.pad');
    if (pad) { e.preventDefault(); hitPad(pad.dataset.voice, pad); }
  };
  const handleUp = (e) => {
    const key = e.target.closest('.key');
    if (key) { noteOff(Number(key.dataset.midi), key); }
  };

  el.keys.addEventListener('pointerdown', handleDown);
  el.keys.addEventListener('pointerup', handleUp);
  el.keys.addEventListener('pointercancel', handleUp);
  el.keys.addEventListener('pointerleave', (e) => {
    // Si el dedo sale de una tecla, soltarla.
    const key = e.target.closest('.key');
    if (key) noteOff(Number(key.dataset.midi), key);
  });
  el.pads.addEventListener('pointerdown', handleDown);
}

// --- Transporte -------------------------------------------------------------
function togglePlay() {
  engine.ensureContext();
  if (engine.isPlaying) {
    engine.stop();
    recArmed = false;
    el.btnRec.classList.remove('armed');
    el.btnPlay.classList.remove('playing');
    el.btnPlay.textContent = '▶';
    el.playhead.classList.remove('on');
  } else {
    engine.play();
    el.btnPlay.classList.add('playing');
    el.btnPlay.textContent = '■';
    el.playhead.classList.add('on');
  }
}

function toggleRec() {
  engine.ensureContext();
  recArmed = !recArmed;
  el.btnRec.classList.toggle('armed', recArmed);
  if (recArmed && !engine.isPlaying) togglePlay();
}

// --- Animación del playhead -------------------------------------------------
function animate() {
  if (engine.isPlaying) {
    const laneLeft = 120; // debe coincidir con el CSS
    const timeline = document.getElementById('timeline');
    const w = timeline.clientWidth - laneLeft - 10;
    const frac = engine.playheadTime / engine.loopDuration;
    el.playhead.style.left = (laneLeft + frac * w) + 'px';
  }
  requestAnimationFrame(animate);
}

// --- Micrófono --------------------------------------------------------------
let micStream = null;
let mediaRecorder = null;

async function armMic() {
  const t = selectedTrack();
  if (!t || t.kind !== 'audio') return;
  engine.ensureContext();
  try {
    if (!micStream) {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
  } catch (e) {
    el.micHint.textContent = 'No se pudo acceder al micrófono: ' + e.message;
    return;
  }

  // Asegurar que el loop esté girando para alinear la toma.
  if (!engine.isPlaying) togglePlay();

  el.micArm.classList.add('armed');
  el.micArm.textContent = 'Grabando una pasada…';
  el.micHint.textContent = 'Tocá ahora; se corta solo al terminar el loop.';

  const chunks = [];
  const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
  mediaRecorder = new MediaRecorder(micStream, mime ? { mimeType: mime } : undefined);
  mediaRecorder.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
  mediaRecorder.onstop = async () => {
    el.micArm.classList.remove('armed');
    el.micArm.textContent = 'Armar micrófono';
    el.micHint.textContent = 'Toma grabada. Volvé a armar para regrabar.';
    try {
      const blob = new Blob(chunks, { type: chunks[0] ? chunks[0].type : 'audio/webm' });
      const buf = await blob.arrayBuffer();
      t.buffer = await engine.decodeAudio(buf);
      drawLane(t);
    } catch (e) {
      el.micHint.textContent = 'No se pudo decodificar el audio: ' + e.message;
    }
  };

  mediaRecorder.start();
  // Parar al completar una pasada del loop (sincronizado al próximo límite).
  const remaining = engine.loopDuration - engine.playheadTime;
  setTimeout(() => { try { mediaRecorder.stop(); } catch (e) {} }, remaining * 1000 + 40);
}

// --- Controles de tempo / compases / metrónomo ------------------------------
function setBpm(v) {
  engine.bpm = Math.min(240, Math.max(40, v));
  el.bpmVal.textContent = engine.bpm;
  drawAllLanes();
}

// --- Bootstrap --------------------------------------------------------------
function init() {
  el.btnPlay.addEventListener('click', togglePlay);
  el.btnRec.addEventListener('click', toggleRec);
  el.btnMetro.addEventListener('click', () => {
    engine.metronomeOn = !engine.metronomeOn;
    el.btnMetro.classList.toggle('on', engine.metronomeOn);
  });
  el.bpmUp.addEventListener('click', () => setBpm(engine.bpm + 1));
  el.bpmDown.addEventListener('click', () => setBpm(engine.bpm - 1));
  el.barsSel.addEventListener('change', (e) => {
    engine.bars = Number(e.target.value);
    sizeCanvases();
    drawAllLanes();
  });
  el.octUp.addEventListener('click', () => { octave = Math.min(7, octave + 1); renderKeyboard(); });
  el.octDown.addEventListener('click', () => { octave = Math.max(1, octave - 1); renderKeyboard(); });
  el.micArm.addEventListener('click', armMic);

  document.querySelector('.add-track').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-kind]');
    if (b) addTrack(b.dataset.kind);
  });

  bindPerformerPointers();
  window.addEventListener('resize', () => { sizeCanvases(); drawAllLanes(); });

  // Pistas de arranque para que se pueda tocar enseguida.
  addTrack('drum');
  addTrack('piano');
  selectTrack(tracks[tracks.length - 1].id);

  animate();
}

document.addEventListener('DOMContentLoaded', init);
