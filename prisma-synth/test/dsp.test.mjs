// Prueba de humo del DSP: renderiza cada motor, filtro y efecto fuera del
// navegador y verifica que no haya NaN, silencio inesperado ni niveles absurdos.
import { SynthCore, BLOCK } from '../js/audio/synth-processor.js';
import { PARAMS, FX_TYPES, LFO_DIV_BEATS, ARP_DIV_BEATS, DRUM_PATTERNS, LOOP_BARS, ARP_PATTERNS, pidx, norm, SRC_INDEX } from '../js/shared/params.js';

const SR = 48000;
let failures = 0;
const check = (name, cond, info = '') => { if (!cond) { failures++; console.log(`  ✗ ${name} ${info}`); } else console.log(`  ✓ ${name} ${info}`); };

function makeCore() {
  return new SynthCore(SR, PARAMS, FX_TYPES, LFO_DIV_BEATS, ARP_DIV_BEATS, { drumPatterns: DRUM_PATTERNS, loopBars: LOOP_BARS });
}
function set(core, id, value) {
  const d = PARAMS[pidx(id)];
  core.setParam(d.index, norm(d, value));
}
function render(core, blocks) {
  const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK);
  let sq = 0, peak = 0, nan = false, count = 0;
  for (let b = 0; b < blocks; b++) {
    core.process(L, R);
    for (let i = 0; i < BLOCK; i++) {
      const v = L[i];
      if (Number.isNaN(v) || !Number.isFinite(v)) nan = true;
      sq += v * v; count++;
      if (Math.abs(v) > peak) peak = Math.abs(v);
    }
  }
  return { rms: Math.sqrt(sq / count), peak, nan };
}
const t0 = Date.now();
const c0 = makeCore();
console.log(`init ${Date.now() - t0} ms, params=${PARAMS.length}`);

console.log('\nMotores (A solo, filtro abierto):');
const engineNames = ['Analog', 'Wavetable', 'FM', 'Granular', 'Harmonic', 'Modal', 'Sample'];
for (let t = 0; t < 7; t++) {
  const core = makeCore();
  set(core, 'a.type', t); set(core, 'b.on', 0); set(core, 'f1.cutoff', 20000);
  core.noteOn(60, 0.9);
  const r = render(core, 60); // ~160 ms
  const t1 = Date.now();
  const r2 = render(core, 200);
  const ms = Date.now() - t1;
  check(engineNames[t], !r.nan && r.rms > 0.01 && r.peak < 1.01, `rms=${r.rms.toFixed(3)} peak=${r.peak.toFixed(3)} sustain rms=${r2.rms.toFixed(3)} (200 blocks in ${ms} ms)`);
  core.noteOff(60);
  const r3 = render(core, 400);
  check(`${engineNames[t]} release → silencio`, !r3.nan && core.voices[0].active === false, `rms=${r3.rms.toFixed(4)}`);
}

console.log('\nUnison / warp / algoritmos:');
{
  const core = makeCore();
  set(core, 'a.type', 0); set(core, 'a.va.unison', 7); set(core, 'a.va.detune', 40); set(core, 'a.va.wave', 3); set(core, 'a.va.sub', 0.5); set(core, 'a.va.noise', 0.2);
  core.noteOn(48, 1); const r = render(core, 100); check('VA unison 7 + sub + noise', !r.nan && r.rms > 0.02 && r.peak < 1.01, `rms=${r.rms.toFixed(3)} peak=${r.peak.toFixed(3)}`);
}
for (let mode = 0; mode < 4; mode++) {
  const core = makeCore();
  set(core, 'a.type', 1); set(core, 'a.wt.table', 5); set(core, 'a.wt.pos', 0.7); set(core, 'a.wt.warp', 0.8); set(core, 'a.wt.warpMode', mode); set(core, 'a.wt.unison', 3);
  core.noteOn(64, 1); const r = render(core, 100); check(`WT warp mode ${mode}`, !r.nan && r.rms > 0.02 && r.peak < 1.01, `rms=${r.rms.toFixed(3)}`);
}
for (let alg = 0; alg < 4; alg++) {
  const core = makeCore();
  set(core, 'a.type', 2); set(core, 'a.fm.alg', alg); set(core, 'a.fm.index3', 4); set(core, 'a.fm.feedback', 0.5); set(core, 'a.fm.shape', 0.4);
  core.noteOn(60, 1); const r = render(core, 100); check(`FM alg ${alg}`, !r.nan && r.rms > 0.02 && r.peak < 1.01, `rms=${r.rms.toFixed(3)}`);
}
for (const mat of [0, 0.4, 0.7, 1]) {
  const core = makeCore();
  set(core, 'a.type', 5); set(core, 'a.modal.material', mat); set(core, 'a.modal.exciter', 1); set(core, 'a.modal.modes', 16);
  core.noteOn(60, 1); const r = render(core, 100); check(`Modal material ${mat}`, !r.nan && r.rms > 0.005 && r.peak < 1.01, `rms=${r.rms.toFixed(3)} peak=${r.peak.toFixed(3)}`);
}
{
  const core = makeCore();
  set(core, 'a.type', 5); set(core, 'a.modal.exciter', 2);
  core.noteOn(60, 1); const r = render(core, 200); check('Modal sustain exciter', !r.nan && r.rms > 0.005 && r.peak < 1.01, `rms=${r.rms.toFixed(3)} peak=${r.peak.toFixed(3)}`);
}

console.log('\nFiltros:');
for (let ft = 0; ft < 8; ft++) {
  const core = makeCore();
  set(core, 'a.type', 0); set(core, 'f1.type', ft); set(core, 'f1.cutoff', 800); set(core, 'f1.res', 0.7); set(core, 'f1.drive', 0.5);
  core.noteOn(48, 1); const r = render(core, 100); check(`Filtro tipo ${ft}`, !r.nan && r.rms > 0.005 && r.peak < 1.5, `rms=${r.rms.toFixed(3)} peak=${r.peak.toFixed(3)}`);
}
{
  const core = makeCore();
  set(core, 'a.type', 0); set(core, 'b.on', 1); set(core, 'filter.routing', 1); set(core, 'a.filter', 2);
  core.noteOn(48, 1); const r = render(core, 100); check('Ruteo en serie con A→F1+F2', !r.nan && r.rms > 0.01, `rms=${r.rms.toFixed(3)}`);
}

console.log('\nEfectos:');
for (let ft = 1; ft < FX_TYPES.length; ft++) {
  const core = makeCore();
  set(core, 'a.type', 0); set(core, 'fx1.type', ft);
  core.noteOn(57, 1); const r = render(core, 200); check(`FX ${FX_TYPES[ft].name}`, !r.nan && r.rms > 0.01 && r.peak < 1.01, `rms=${r.rms.toFixed(3)} peak=${r.peak.toFixed(3)}`);
}
{
  const core = makeCore();
  set(core, 'a.type', 1); set(core, 'fx1.type', 1); set(core, 'fx2.type', 6); set(core, 'fx3.type', 7); set(core, 'fx4.type', 9);
  core.noteOn(57, 1); const r = render(core, 200); core.noteOff(57); const r2 = render(core, 300);
  check('Cadena de 4 FX', !r.nan && !r2.nan && r.rms > 0.01, `rms=${r.rms.toFixed(3)} tail rms=${r2.rms.toFixed(3)}`);
}

console.log('\nModulación, polifonía, mono/legato, arp:');
{
  const core = makeCore();
  set(core, 'a.type', 0); set(core, 'f1.cutoff', 200);
  core.setMods([{ src: SRC_INDEX.env2, dst: pidx('f1.cutoff'), amt: 0.8 }, { src: SRC_INDEX.lfo1, dst: pidx('a.fine'), amt: 0.1 }, { src: SRC_INDEX.macro1, dst: pidx('fx1.p0'), amt: 0.5 }]);
  set(core, 'fx1.type', 6);
  core.noteOn(60, 1);
  const r = render(core, 100);
  const v = core.voices[0];
  check('Cutoff modulado por Env2', v.p[pidx('f1.cutoff')] > 250, `cutoff mod=${v.p[pidx('f1.cutoff')].toFixed(0)} base=200`);
  check('Render con mods', !r.nan && r.rms > 0.005, `rms=${r.rms.toFixed(3)}`);
}
{
  const core = makeCore();
  set(core, 'master.voices', 4);
  for (const n of [60, 64, 67, 71, 74, 77]) core.noteOn(n, 0.8);
  render(core, 10);
  check('Robo de voces (máx 4)', core.voices.filter(v => v.active).length === 4, `activas=${core.voices.filter(v => v.active).length}`);
}
{
  const core = makeCore();
  set(core, 'master.poly', 2); set(core, 'master.glide', 0.2);
  core.noteOn(60, 1); render(core, 10); core.noteOn(72, 1); render(core, 5);
  const v = core.voices[0];
  check('Legato + glide', core.voices.filter(x => x.active).length === 1 && v.pitch > 60 && v.pitch < 72, `pitch=${v.pitch.toFixed(2)}`);
  core.noteOff(72); render(core, 5);
  check('Legato vuelve a la nota anterior', v.gate && v.targetPitch === 60);
}
{
  const core = makeCore();
  set(core, 'arp.on', 1); set(core, 'arp.rate', 4); set(core, 'arp.octaves', 2);
  core.noteOn(60, 1); core.noteOn(64, 1); core.noteOn(67, 1);
  const seen = new Set();
  for (let b = 0; b < 400; b++) { render(core, 1); for (const nn of core.arp.cur) seen.add(nn); }
  check('Arpegiador recorre notas y octavas', seen.size >= 5, `notas=${[...seen].sort((a, b) => a - b).join(',')}`);
  core.noteOff(60); core.noteOff(64); core.noteOff(67); render(core, 200);
  check('Arp se detiene al soltar', core.arp.cur.length === 0 && core.voices.every(v => !v.gate));
}
console.log('\nPatrones de arpegio, latch, ritmos y looper:');
for (let pi = 0; pi < ARP_PATTERNS.length; pi++) {
  const core = makeCore();
  set(core, 'arp.on', 1); set(core, 'arp.pattern', pi); set(core, 'arp.rate', 3); set(core, 'arp.octaves', 2);
  core.noteOn(60, 1); core.noteOn(64, 1); core.noteOn(67, 1);
  const seen = new Set(); let steps = 0, last = -1;
  const r = render(core, 1);
  for (let b = 0; b < 500; b++) { render(core, 1); if (core.arp.step !== last) { steps++; last = core.arp.step; } for (const nn of core.arp.cur) seen.add(nn); }
  const r2 = render(core, 50);
  check(`Patrón ${ARP_PATTERNS[pi].name}`, !r2.nan && steps > 8 && seen.size >= 2 && r2.rms > 0.005, `pasos=${steps} notas=${[...seen].sort((a, b) => a - b).join(',')}`);
}
{
  const core = makeCore();
  set(core, 'arp.on', 1); set(core, 'arp.hold', 1); set(core, 'arp.rate', 3);
  core.noteOn(60, 1); core.noteOn(64, 1); core.noteOff(60); core.noteOff(64);
  render(core, 300);
  check('Latch mantiene el arpegio al soltar', core.arp.held.length === 2 && core.arp.cur.length > 0);
  core.noteOn(72, 1); render(core, 10);
  check('Nueva frase reemplaza la anterior', core.arp.held.length === 1 && core.arp.held[0].note === 72);
}
{
  const core = makeCore();
  set(core, 'drum.on', 1); set(core, 'drum.pattern', 4); set(core, 'a.on', 0);
  const r = render(core, 800); // ~2 s a 120 bpm = 1 compás
  check('Caja de ritmos suena (Reggaetón)', !r.nan && r.rms > 0.02 && r.peak < 1.01, `rms=${r.rms.toFixed(3)} peak=${r.peak.toFixed(3)}`);
  for (let kit = 0; kit < 4; kit++) {
    const c2 = makeCore(); set(c2, 'a.on', 0); set(c2, 'drum.kit', kit);
    for (let inst = 0; inst < 8; inst++) c2.handleMessage({ type: 'drum', inst, vel: 1 });
    const r2 = render(c2, 200);
    check(`Kit ${kit} (8 golpes manuales)`, !r2.nan && r2.rms > 0.02 && r2.peak < 1.05, `rms=${r2.rms.toFixed(3)} peak=${r2.peak.toFixed(3)}`);
  }
}
{
  const core = makeCore();
  set(core, 'loop.bars', 0); // 1 compás = 2 s a 120 bpm
  core.handleMessage({ type: 'loop', cmd: 'rec' });
  core.noteOn(60, 1);
  render(core, 400); core.noteOff(60);
  render(core, 400); // 800 bloques = 102400 muestras > 96000 → capa confirmada
  const st = core.looper.status(core.clock);
  check('Looper graba una capa de 1 compás', st.layers.length === 1 && st.state === 'playing', `estado=${st.state} capas=${st.layers.length} len=${core.looper.len}`);
  set(core, 'a.on', 0);
  const r = render(core, 400);
  check('Looper reproduce la capa con el sinte apagado', r.rms > 0.01, `rms=${r.rms.toFixed(3)}`);
  core.handleMessage({ type: 'loop', cmd: 'rec' }); set(core, 'a.on', 1); core.noteOn(67, 1);
  render(core, 900); core.noteOff(67); render(core, 800);
  check('Segunda capa alineada al inicio del loop', core.looper.layers.length === 2, `capas=${core.looper.layers.length}`);
  core.handleMessage({ type: 'loop', cmd: 'mute', arg: 0 });
  check('Mute de capa', core.looper.layers[0].mute === true);
  core.handleMessage({ type: 'loop', cmd: 'undo' });
  check('Undo quita la última capa', core.looper.layers.length === 1);
  core.handleMessage({ type: 'loop', cmd: 'clear' });
  check('Clear vacía el looper', core.looper.state === 'empty' && core.looper.len === 0);
}
{
  const core = makeCore();
  const buf = new Float32Array(SR);
  for (let i = 0; i < SR; i++) buf[i] = Math.sin(i * 0.05) * Math.exp(-i / SR * 3);
  core.handleMessage({ type: 'sample', data: buf, root: 261.63 });
  set(core, 'a.type', 6); set(core, 'a.smp.source', 4); set(core, 'a.smp.loop', 1); set(core, 'a.smp.loopLen', 0.3);
  core.noteOn(60, 1); const r = render(core, 300); check('Sample cargado en loop', !r.nan && r.rms > 0.01, `rms=${r.rms.toFixed(3)}`);
  set(core, 'a.type', 3); set(core, 'a.gran.source', 4); set(core, 'a.gran.density', 100); set(core, 'a.gran.size', 300); set(core, 'a.gran.spray', 1); set(core, 'a.gran.pitchRnd', 12);
  core.noteOn(67, 1); const r2 = render(core, 300); check('Granular sobre sample cargado', !r2.nan && r2.rms > 0.01 && r2.peak < 1.01, `rms=${r2.rms.toFixed(3)} peak=${r2.peak.toFixed(3)}`);
}

console.log('\nRendimiento: 8 voces, 2 motores (WT+Granular), 2 filtros, 4 FX');
{
  const core = makeCore();
  set(core, 'a.type', 1); set(core, 'a.wt.unison', 3); set(core, 'b.on', 1); set(core, 'b.type', 3);
  set(core, 'fx1.type', 4); set(core, 'fx2.type', 6); set(core, 'fx3.type', 7); set(core, 'fx4.type', 8);
  for (const n of [48, 52, 55, 59, 60, 64, 67, 71]) core.noteOn(n, 0.8);
  render(core, 50);
  const t1 = process.hrtime.bigint();
  const blocks = 2000;
  render(core, blocks);
  const ms = Number(process.hrtime.bigint() - t1) / 1e6;
  const audioMs = blocks * BLOCK / SR * 1000;
  check('Tiempo real', ms < audioMs, `${ms.toFixed(0)} ms de CPU para ${audioMs.toFixed(0)} ms de audio (${(100 * ms / audioMs).toFixed(0)}% CPU)`);
}

console.log('\nNotas trabadas al cambiar de modo de voz:');
{
  const core = makeCore();
  for (const n of [60, 64, 67, 72, 76]) core.noteOn(n, 1);
  render(core, 10);
  set(core, 'master.poly', 2); // legato mientras suenan 5 voces
  render(core, 10);
  for (const n of [60, 64, 67, 72, 76]) core.noteOff(n);
  render(core, 600);
  const stuck = core.voices.filter(v => v.gate).length;
  check('Ninguna voz queda con gate al pasar a legato y soltar', stuck === 0, `gate=${stuck}`);
}
console.log(failures ? `\n${failures} fallo(s)` : '\nTodo OK');
process.exit(failures ? 1 : 0);
