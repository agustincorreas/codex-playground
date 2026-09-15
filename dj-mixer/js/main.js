import { Engine, Channel } from './audio/engine.js';
import { Deck } from './audio/deck.js';
import { Library } from './library.js';
import { Midi } from './midi.js';
import { AutoMix } from './automix.js';
import { DeckView } from './ui/deckview.js';
import { MixerView } from './ui/mixerview.js';
import { LibraryView } from './ui/libraryview.js';
import { ScrollingWave } from './ui/waveform.js';
import { bridge } from './sources/bridge.js';
import { spotify } from './sources/spotify.js';
import { store } from './store.js';
import { $, $$, el, toast, fmtTime, downloadBlob } from './utils.js';

const COLORS = { A: '#33d1ff', B: '#ff6a3d' };

// ---------- núcleo ----------
const engine = new Engine();
const channels = { A: new Channel(engine, 'A'), B: new Channel(engine, 'B') };
const decks = { A: new Deck('A', engine, channels.A), B: new Deck('B', engine, channels.B) };
const library = new Library();
const mixer = new MixerView(engine, channels, $('#mixer'));
$('#master-slot').append(mixer.masterVu, mixer.master.el);
const other = (d) => (d === decks.A ? decks.B : decks.A);
const mode = () => document.body.classList.contains('mode-expert') ? 'expert' : 'simple';

async function loadTrack(track, deck) {
  if (deck.playing) { toast(`El deck ${deck.id} está sonando. Pausalo o usá el otro deck.`, 'warn'); return false; }
  if (track.source === 'spotify' && !Deck.spotifyViaYouTube() && other(deck).kind === 'spotify') { toast('Spotify (reproductor oficial) solo permite un deck a la vez. Activá el bridge para usar los dos.', 'warn'); return false; }
  await engine.resume();
  const ok = await deck.load(track);
  if (!ok) return false;
  if (track.source === 'spotify') {
    if (deck.kind === 'buffer') toast(`Audio vía YouTube: ${track.matchedTitle || track.title}`);
    else if (track.matchError) toast(`Bridge: ${track.matchError} Se usa el reproductor de Spotify (sin EQ/waveform).`, 'error', 8000);
    else if (Deck.spotifyViaYouTube()) toast('No se encontró el tema en YouTube: se usa el reproductor de Spotify (sin EQ/waveform).', 'warn', 5000);
  }
  // auto-gain (como Serato): trim sugerido por el análisis
  const g = track.analysis?.gainDb; if (typeof g === 'number') mixer.controls[deck.id].trim.set(g);
  else mixer.controls[deck.id].trim.set(0);
  if (!deck.bpm && deck.supports.waveform) toast(`Deck ${deck.id}: no se detectó BPM (tap sobre el número o doble click para editar)`, 'warn');
  // modo simple: sync automático al cargar si el otro deck está sonando
  if (mode() === 'simple' && other(deck).playing && deck.bpm && other(deck).bpm) deck.syncTo(other(deck));
  library.emit('change');
  return true;
}
function syncDeck(deck) {
  const o = other(deck);
  if (!deck.bpm) return toast(`Deck ${deck.id} sin BPM: tocá el número BPM al ritmo (tap) o editalo.`, 'warn');
  if (!o.loaded || !o.bpm) return toast('El otro deck no tiene pista/BPM para sincronizar.', 'warn');
  if (deck.syncTo(o)) toast(`Deck ${deck.id} sincronizado a ${o.effectiveBpm.toFixed(1)} BPM`);
}

for (const d of Object.values(decks)) d.on('matched', () => library.persist());
const views = {
  A: new DeckView(decks.A, $('#deck-A'), { color: COLORS.A, onDropTrack: (id, d) => loadTrack(library.byId(id), d), onSync: syncDeck }),
  B: new DeckView(decks.B, $('#deck-B'), { color: COLORS.B, onDropTrack: (id, d) => loadTrack(library.byId(id), d), onSync: syncDeck }),
};
const waves = { A: new ScrollingWave($('#wave-A'), decks.A, COLORS.A), B: new ScrollingWave($('#wave-B'), decks.B, COLORS.B) };
$$('#waves .zoom button').forEach(b => b.addEventListener('click', () => { const z = waves.A.zoom * (b.dataset.zoom === '+' ? 0.5 : 2); waves.A.zoom = waves.B.zoom = Math.max(2, Math.min(32, z)); }));
const libView = new LibraryView(library, $('#library'), { onLoad: loadTrack, decks });
const automix = new AutoMix({ decks, library, mixer, onLoad: loadTrack });
$('#automix-btn').addEventListener('click', async () => { $('#automix-btn').classList.toggle('on', await automix.toggle()); });

// ---------- modos ----------
function setMode(m) {
  document.body.classList.toggle('mode-expert', m === 'expert'); document.body.classList.toggle('mode-simple', m !== 'expert');
  $$('.mode-switch button').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  for (const d of Object.values(decks)) { if (m === 'simple') d.quantize = true; }
  store.set('mode', m);
  if (m === 'simple') for (const id of ['A', 'B']) { const c = mixer.controls[id]; c.filter.set(0); }
}
$$('.mode-switch button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
setMode(store.get('mode', 'simple'));

// ---------- grabación ----------
const recBtn = $('#rec-btn');
recBtn.addEventListener('click', async () => {
  if (engine.recording) {
    const blob = await engine.stopRecording(); recBtn.classList.remove('on'); $('#rec-time').textContent = '';
    if (blob) { downloadBlob(blob, `mixr-set-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`); toast('Grabación guardada'); }
  } else { await engine.resume(); engine.startRecording(); recBtn.classList.add('on'); toast('Grabando la salida master…'); }
});

// ---------- MIDI ----------
const actions = {};
for (const id of ['A', 'B']) {
  const d = decks[id], v = views[id], c = mixer.controls[id];
  Object.assign(actions, {
    [`${id}.play`]: { label: `Deck ${id} · Play/Pause`, type: 'button', press: () => d.togglePlay(), led: () => d.playing },
    [`${id}.cue`]: { label: `Deck ${id} · Cue`, type: 'button', press: () => d.cueDown(), release: () => d.cueUp() },
    [`${id}.sync`]: { label: `Deck ${id} · Sync`, type: 'button', press: () => syncDeck(d) },
    [`${id}.pitch`]: { label: `Deck ${id} · Pitch fader`, type: 'abs', set: (x) => v.pitch.set(1 - x * 2) },
    [`${id}.jog`]: { label: `Deck ${id} · Jog (relativo)`, type: 'rel', turn: (delta) => d.nudge(delta) },
    [`${id}.keylock`]: { label: `Deck ${id} · Keylock`, type: 'button', press: () => d.setKeylock(!d.keylock), led: () => d.keylock },
    [`${id}.quantize`]: { label: `Deck ${id} · Quantize`, type: 'button', press: () => { d.quantize = !d.quantize; v.refresh(); }, led: () => d.quantize },
    [`${id}.loopIn`]: { label: `Deck ${id} · Loop In`, type: 'button', press: () => d.loopIn() },
    [`${id}.loopOut`]: { label: `Deck ${id} · Loop Out`, type: 'button', press: () => d.loopOut() },
    [`${id}.loopHalf`]: { label: `Deck ${id} · Loop ½`, type: 'button', press: () => d.loopHalf() },
    [`${id}.loopDouble`]: { label: `Deck ${id} · Loop ×2`, type: 'button', press: () => d.loopDouble() },
    [`${id}.loopExit`]: { label: `Deck ${id} · Loop Exit`, type: 'button', press: () => d.exitLoop(), led: () => !!d.loop },
    [`${id}.load`]: { label: `Deck ${id} · Cargar selección`, type: 'button', press: () => { const t = libView.selectedTrack(); if (t) loadTrack(t, d); } },
    [`mix.${id}.fader`]: { label: `Mixer ${id} · Fader`, type: 'abs', set: (x) => c.fader.set(x) },
    [`mix.${id}.trim`]: { label: `Mixer ${id} · Trim`, type: 'abs', set: (x) => c.trim.set(-12 + x * 24) },
    [`mix.${id}.high`]: { label: `Mixer ${id} · EQ Hi`, type: 'abs', set: (x) => c.hi.set(x * 2 - 1) },
    [`mix.${id}.mid`]: { label: `Mixer ${id} · EQ Mid`, type: 'abs', set: (x) => c.mid.set(x * 2 - 1) },
    [`mix.${id}.low`]: { label: `Mixer ${id} · EQ Low`, type: 'abs', set: (x) => c.low.set(x * 2 - 1) },
    [`mix.${id}.filter`]: { label: `Mixer ${id} · Filter`, type: 'abs', set: (x) => c.filter.set(x * 2 - 1) },
    [`mix.${id}.cue`]: { label: `Mixer ${id} · Cue (auriculares)`, type: 'button', press: () => { channels[id].setCue(!channels[id].v.cue); c.cue.set(channels[id].v.cue); }, led: () => channels[id].v.cue },
  });
  for (let i = 1; i <= 8; i++) actions[`${id}.hotcue${i}`] = { label: `Deck ${id} · Hot cue ${i}`, type: 'button', press: () => d.hotcue(i - 1), led: () => !!d.hotcues[i - 1] };
  for (const n of [1, 2, 4, 8, 16]) actions[`${id}.loop${n}`] = { label: `Deck ${id} · Loop ${n} beats`, type: 'button', press: () => d.loop?.beats === n ? d.exitLoop() : d.loopBeats(n), led: () => d.loop?.beats === n };
}
Object.assign(actions, {
  'mix.xfader': { label: 'Crossfader', type: 'abs', set: (x) => mixer.xf.set(x * 2 - 1) },
  'mix.master': { label: 'Master', type: 'abs', set: (x) => mixer.master.set(x * 1.25) },
  'lib.scroll': { label: 'Biblioteca · Scroll (encoder)', type: 'rel', turn: (delta) => libView.scroll(Math.sign(delta)) },
  'lib.up': { label: 'Biblioteca · Arriba', type: 'button', press: () => libView.scroll(-1) },
  'lib.down': { label: 'Biblioteca · Abajo', type: 'button', press: () => libView.scroll(1) },
  'automix': { label: 'Automix', type: 'button', press: () => $('#automix-btn').click(), led: () => automix.enabled },
  'rec': { label: 'Grabar', type: 'button', press: () => recBtn.click(), led: () => engine.recording },
});
const midi = new Midi(actions);
const midiBtn = $('#midi-btn');
midi.init().then(ins => { midiBtn.classList.toggle('on', ins.length > 0); }).catch(() => {});
midi.addEventListener('devices', (e) => { midiBtn.classList.toggle('on', e.detail.length > 0); renderMidi(); });
midi.addEventListener('change', renderMidi);
midi.addEventListener('learned', (e) => { toast(`Mapeado: ${actions[e.detail.id]?.label} ← ${e.detail.key}`); highlightLearn(null); renderMidi(); });
midi.addEventListener('learning', (e) => highlightLearn(e.detail));
function highlightLearn(id) { $$('[data-action]').forEach(n => n.classList.toggle('learning', n.dataset.action === id)); }
let learnUi = false;
function setLearnUi(on) {
  learnUi = on; $('#learn-banner').hidden = !on; document.body.classList.toggle('learn', on);
  if (!on) { midi.cancelLearn(); highlightLearn(null); }
}
document.addEventListener('pointerdown', (e) => {
  if (!learnUi) return;
  const n = e.target.closest('[data-action]'); if (!n) return;
  e.stopPropagation(); e.preventDefault();
  midi.learn(n.dataset.action);
}, true);
document.addEventListener('click', (e) => { if (learnUi && e.target.closest('[data-action]')) { e.stopPropagation(); e.preventDefault(); } }, true);
$('#learn-stop').addEventListener('click', () => setLearnUi(false));
$('#midi-learn-ui').addEventListener('click', () => { $('#midi-dialog').close(); setLearnUi(true); });
$('#midi-export').addEventListener('click', () => downloadBlob(new Blob([midi.export()], { type: 'application/json' }), 'mixr-midi-map.json'));
$('#midi-import').addEventListener('change', async (e) => { try { midi.import(await e.target.files[0].text()); toast('Mapa importado'); } catch (err) { toast('Mapa inválido', 'error'); } });
$('#midi-clear').addEventListener('click', () => { if (confirm('¿Borrar todos los mapeos MIDI?')) midi.clearAll(); });
midiBtn.addEventListener('click', async () => {
  if (!midi.access) { try { await midi.init(); } catch (e) { toast(e.message, 'error', 5000); } }
  renderMidi(); $('#midi-dialog').showModal();
});
function renderMidi() {
  $('#midi-devices').textContent = midi.inputs.length ? `Dispositivos: ${midi.inputs.map(i => i.name).join(', ')}` : (midi.supported ? 'Sin dispositivos MIDI conectados.' : 'Web MIDI no disponible en este navegador (usá Chrome/Edge).');
  const tb = $('#midi-table tbody'); tb.innerHTML = '';
  for (const [id, a] of Object.entries(actions)) {
    const m = midi.map[id];
    const learn = el('button', { type: 'button', class: `btn xs ${midi.learning === id ? 'on' : ''}` }, midi.learning === id ? 'Mové el control…' : 'Learn');
    learn.addEventListener('click', () => { midi.learn(id); renderMidi(); });
    const clear = el('button', { type: 'button', class: 'btn xs ghost' }, '✕'); clear.addEventListener('click', () => midi.clear(id));
    tb.append(el('tr', {}, el('td', {}, a.label), el('td', { class: 'mono' }, m?.key || '—'), el('td', {}, learn, m ? clear : null)));
  }
}
setInterval(() => midi.refreshLeds(), 250);

// ---------- ajustes ----------
const settings = $('#settings');
$('#settings-btn').addEventListener('click', async () => {
  if (bridge.available) { try { const c = await bridge.getConfig(); $('#yt-browser').value = c.cookiesFromBrowser || ''; $('#yt-cookies-file').value = c.cookiesFile || ''; } catch { /* sin bridge */ } } $('#spotify-via-yt').checked = store.get('spotifyViaYouTube', true) !== false; $('#spotify-client').value = spotify.clientId; $('#bridge-url').value = store.get('bridgeUrl', ''); $('#spotify-redirect').textContent = spotify.redirectUri; $('#xf-curve').value = store.get('xfCurve', 'smooth'); settings.showModal(); });
async function listDevices() {
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); } catch { /* sin permiso: sin etiquetas */ }
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput');
  for (const [sel, def] of [[$('#out-master'), 'Predeterminada'], [$('#out-cue'), '— sin cue —']]) {
    const cur = sel.value; sel.innerHTML = ''; sel.append(el('option', { value: '' }, def));
    devs.forEach((d, i) => sel.append(el('option', { value: d.deviceId }, d.label || `Salida ${i + 1}`)));
    sel.value = cur;
  }
  if (!devs.length) toast('No se detectaron salidas de audio adicionales.', 'warn');
}
$('#detect-devices').addEventListener('click', listDevices);
$('#out-master').addEventListener('change', async (e) => { try { await engine.setMasterOutput(e.target.value); toast('Salida master cambiada'); } catch (err) { toast(err.message, 'error', 5000); } });
$('#out-cue').addEventListener('change', async (e) => { try { await engine.setCueOutput(e.target.value); toast(e.target.value ? 'Auriculares activos' : 'Cue desactivado'); } catch (err) { toast(err.message, 'error', 5000); } });
$('#split-cue').addEventListener('change', (e) => engine.setSplitCue(e.target.checked));
$('#spotify-via-yt').addEventListener('change', (e) => { store.set('spotifyViaYouTube', e.target.checked); libView.render(); });
$('#spotify-client').addEventListener('change', (e) => { spotify.clientId = e.target.value; });
$('#bridge-url').addEventListener('change', async (e) => { store.set('bridgeUrl', e.target.value.trim()); await bridge.check(); libView.render(); status(); });
const saveYtConfig = async () => {
  const wants = $('#yt-browser').value || $('#yt-cookies-file').value.trim();
  if (wants) toast('Probando la sesión de YouTube… En Mac puede aparecer el aviso del llavero: poné la contraseña de tu usuario de Mac y elegí "Always Allow".', 'info', 12000);
  try {
    const c = await bridge.setConfig({ cookiesFromBrowser: $('#yt-browser').value, cookiesFile: $('#yt-cookies-file').value.trim() });
    libView.ytHome = null; libView.render(); status();
    if (!wants) toast('YouTube sin cuenta');
    else if (c.probe?.ok) toast('Cuenta de YouTube conectada', 'info', 4000);
    else toast(c.probe?.error || 'No se pudo leer la sesión de YouTube', 'error', 15000);
  } catch (e) { toast('No se pudo guardar en el bridge: ' + e.message, 'error'); }
};
$('#yt-browser').addEventListener('change', saveYtConfig); $('#yt-cookies-file').addEventListener('change', saveYtConfig);
$('#xf-curve').addEventListener('change', (e) => { store.set('xfCurve', e.target.value); mixer.curve = e.target.value; mixer.applyXf(mixer.xf.value); });
mixer.curve = store.get('xfCurve', 'smooth');

// ---------- atajos de teclado ----------
const KEYS = {
  q: () => decks.A.cueDown(), w: () => decks.A.togglePlay(), e: () => syncDeck(decks.A), r: () => decks.A.toggleLoop(4),
  o: () => decks.B.cueDown(), p: () => decks.B.togglePlay(), '[': () => syncDeck(decks.B), ']': () => decks.B.toggleLoop(4),
  '1': () => decks.A.hotcue(0), '2': () => decks.A.hotcue(1), '3': () => decks.A.hotcue(2), '4': () => decks.A.hotcue(3),
  '7': () => decks.B.hotcue(0), '8': () => decks.B.hotcue(1), '9': () => decks.B.hotcue(2), '0': () => decks.B.hotcue(3),
  z: () => mixer.xf.set(mixer.xf.value - 0.1), x: () => mixer.xf.set(mixer.xf.value + 0.1), c: () => mixer.xf.set(0),
  a: () => { const t = libView.selectedTrack(); if (t) loadTrack(t, decks.A); }, b: () => { const t = libView.selectedTrack(); if (t) loadTrack(t, decks.B); },
  f: () => libView.$search.focus(),
};
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { setLearnUi(false); return; }
  if (e.target.matches('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const fn = KEYS[e.key]; if (fn && !e.repeat) { e.preventDefault(); fn(); }
});
document.addEventListener('keyup', (e) => { if (e.key === 'q') decks.A.cueUp(); if (e.key === 'o') decks.B.cueUp(); });

// ---------- loop de render ----------
function frame() {
  for (const id of ['A', 'B']) { decks[id].tick(); views[id].update(); waves[id].draw(); }
  mixer.update(); automix.tick();
  if (engine.recording) $('#rec-time').textContent = fmtTime((Date.now() - engine.recStart) / 1000, { tenths: false });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function status() {
  const bits = [];
  bits.push(bridge.stale ? '⚠ servidor viejo' : bridge.ytdlp ? (bridge.account ? 'Bridge YT ✓ (cuenta)' : 'Bridge YT ✓') : 'YT embed');
  if (spotify.loggedIn) bits.push('Spotify ✓');
  if (!engine.hasKeylock) bits.push('sin keylock');
  $('#status').textContent = bits.join(' · ');
}
(async () => {
  document.addEventListener('pointerdown', () => engine.resume(), { once: true });
  try { if (await spotify.handleRedirect()) toast('Spotify conectado'); } catch (e) { toast('Spotify: ' + e.message, 'error', 6000); }
  await bridge.check();
  await engine.keylockReady;
  libView.render(); status();
  if (bridge.stale) toast('El servidor corre una versión vieja de MIXR. Cortalo con Ctrl+C (o lsof -i :8787 y kill) y volvé a ejecutar npm start.', 'error', 12000);
  if (!store.get('welcomed')) { toast('Bienvenido a MIXR. Agregá pistas con "+ Archivos" o pegá un link de YouTube.', 'info', 6000); store.set('welcomed', true); }
})();

window.mixr = { engine, decks, channels, library, mixer, midi, automix, views, loadTrack };
