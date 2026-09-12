// Prisma Synth — definición compartida de parámetros, fuentes de modulación,
// tipos de efectos y colores. Este módulo se importa desde la UI y se pasa
// al AudioWorklet vía processorOptions (por eso es puro dato / funciones puras).

export const COLORS = {
  a: '#19c3ff',      // Motor A (cian)
  b: '#ff8a3d',      // Motor B (naranja)
  filter: '#b76bff', // Filtros (violeta)
  env: '#4fe38a',    // Envolventes (verde)
  lfo: '#ffd23f',    // LFOs (amarillo)
  macro: '#ff4f9a',  // Macros (rosa)
  fx: '#ff6b6b',     // Efectos (coral)
  key: '#9aa5b1',    // Teclado / rendimiento (gris)
  master: '#c9d1d9',
  arp: '#63e6be',
};

export const ENGINE_TYPES = ['va', 'wt', 'fm', 'gran', 'harm', 'modal', 'smp'];
export const ENGINE_NAMES = ['Analog', 'Wavetable', 'FM', 'Granular', 'Harmonic', 'Modal', 'Sample'];

export const WAVETABLE_NAMES = ['Basic', 'Harmonics', 'PWM', 'Formant', 'Bell', 'Digital', 'Organ', 'Vox'];
export const SAMPLE_SOURCES = ['Choir', 'Bell', 'Piano', 'Texture', 'Loaded'];
export const LFO_DIVS = ['4/1', '2/1', '1/1', '1/2', '1/4', '1/8', '1/16', '1/32', '1/4T', '1/8T'];
export const LFO_DIV_BEATS = [16, 8, 4, 2, 1, 0.5, 0.25, 0.125, 2 / 3, 1 / 3];
export const ARP_DIVS = ['1/2', '1/4', '1/8', '1/16', '1/32', '1/8T', '1/16T'];
export const ARP_DIV_BEATS = [2, 1, 0.5, 0.25, 0.125, 1 / 3, 1 / 6];

// Fuentes de modulación. bipolar: rango -1..1, si no 0..1.
export const MOD_SOURCES = [
  { id: 'env1', name: 'Env 1 (Amp)', short: 'ENV1', color: COLORS.env, bipolar: false },
  { id: 'env2', name: 'Env 2', short: 'ENV2', color: COLORS.env, bipolar: false },
  { id: 'env3', name: 'Env 3', short: 'ENV3', color: COLORS.env, bipolar: false },
  { id: 'lfo1', name: 'LFO 1', short: 'LFO1', color: COLORS.lfo, bipolar: true },
  { id: 'lfo2', name: 'LFO 2', short: 'LFO2', color: COLORS.lfo, bipolar: true },
  { id: 'lfo3', name: 'LFO 3', short: 'LFO3', color: COLORS.lfo, bipolar: true },
  { id: 'macro1', name: 'Macro 1', short: 'M1', color: COLORS.macro, bipolar: false },
  { id: 'macro2', name: 'Macro 2', short: 'M2', color: COLORS.macro, bipolar: false },
  { id: 'macro3', name: 'Macro 3', short: 'M3', color: COLORS.macro, bipolar: false },
  { id: 'macro4', name: 'Macro 4', short: 'M4', color: COLORS.macro, bipolar: false },
  { id: 'velocity', name: 'Velocity', short: 'VEL', color: COLORS.key, bipolar: false },
  { id: 'keytrack', name: 'Key Track', short: 'KEY', color: COLORS.key, bipolar: true },
  { id: 'modwheel', name: 'Mod Wheel', short: 'MW', color: COLORS.key, bipolar: false },
  { id: 'bend', name: 'Pitch Bend', short: 'PB', color: COLORS.key, bipolar: true },
  { id: 'random', name: 'Random', short: 'RND', color: COLORS.key, bipolar: false },
];
export const SRC_INDEX = Object.fromEntries(MOD_SOURCES.map((s, i) => [s.id, i]));

// ---- Tipos de efectos: cada slot tiene 6 parámetros genéricos p0..p5 cuyo
// significado depende del tipo (como en Pigments cada slot define sus controles).
const fxp = (name, min, max, def, curve = 'lin', unit = '', opts = null) => ({ name, min, max, def, curve, unit, opts });
export const FX_TYPES = [
  { id: 'none', name: 'None', params: [] },
  {
    id: 'corroder', name: 'Corroder', params: [
      fxp('Freq', 20, 4000, 180, 'exp', 'Hz'),
      fxp('Depth', 0, 1, 0.5),
      fxp('Grain', 0, 1, 0.35),
      fxp('Rate', 1, 400, 60, 'exp', 'Hz'),
      fxp('Tone', 200, 20000, 6000, 'exp', 'Hz'),
      fxp('Feedback', 0, 1, 0.2),
    ],
  },
  {
    id: 'distortion', name: 'Distortion', params: [
      fxp('Drive', 0, 1, 0.4),
      fxp('Type', 0, 3, 0, 'enum', '', ['Soft', 'Hard', 'Fold', 'Crush']),
      fxp('Tone', 200, 20000, 8000, 'exp', 'Hz'),
      fxp('Bias', 0, 1, 0),
      fxp('Low Cut', 20, 2000, 20, 'exp', 'Hz'),
      fxp('Output', 0, 1, 0.7),
    ],
  },
  {
    id: 'filter', name: 'Multi Filter', params: [
      fxp('Cutoff', 20, 20000, 2000, 'exp', 'Hz'),
      fxp('Resonance', 0, 1, 0.3),
      fxp('Type', 0, 3, 0, 'enum', '', ['LP', 'HP', 'BP', 'Notch']),
      fxp('Drive', 0, 1, 0),
      fxp('Slope', 0, 1, 0, 'enum', '', ['12 dB', '24 dB']),
      fxp('Env Follow', 0, 1, 0),
    ],
  },
  {
    id: 'chorus', name: 'Chorus', params: [
      fxp('Rate', 0.05, 10, 0.6, 'exp', 'Hz'),
      fxp('Depth', 0, 1, 0.5),
      fxp('Delay', 1, 40, 12, 'exp', 'ms'),
      fxp('Feedback', 0, 0.9, 0.1),
      fxp('Spread', 0, 1, 0.7),
      fxp('Voices', 0, 2, 1, 'enum', '', ['1', '2', '3']),
    ],
  },
  {
    id: 'phaser', name: 'Phaser', params: [
      fxp('Rate', 0.02, 10, 0.3, 'exp', 'Hz'),
      fxp('Depth', 0, 1, 0.7),
      fxp('Center', 100, 6000, 800, 'exp', 'Hz'),
      fxp('Feedback', 0, 0.95, 0.4),
      fxp('Stages', 0, 3, 1, 'enum', '', ['2', '4', '6', '8']),
      fxp('Spread', 0, 1, 0.5),
    ],
  },
  {
    id: 'delay', name: 'Delay', params: [
      fxp('Time', 1, 2000, 375, 'exp', 'ms'),
      fxp('Feedback', 0, 0.98, 0.45),
      fxp('Damp', 200, 20000, 5000, 'exp', 'Hz'),
      fxp('Ping Pong', 0, 1, 0.5),
      fxp('Sync', 0, 6, 0, 'enum', '', ['Free', '1/16', '1/8', '1/8D', '1/4', '1/4D', '1/2']),
      fxp('Low Cut', 20, 2000, 120, 'exp', 'Hz'),
    ],
  },
  {
    id: 'reverb', name: 'Reverb', params: [
      fxp('Size', 0, 1, 0.7),
      fxp('Damp', 0, 1, 0.4),
      fxp('Predelay', 0, 200, 20, 'lin', 'ms'),
      fxp('Width', 0, 1, 1),
      fxp('Low Cut', 20, 2000, 150, 'exp', 'Hz'),
      fxp('Shimmer', 0, 1, 0),
    ],
  },
  {
    id: 'eq', name: 'EQ', params: [
      fxp('Low Gain', -15, 15, 0, 'lin', 'dB'),
      fxp('Low Freq', 40, 1000, 150, 'exp', 'Hz'),
      fxp('Mid Gain', -15, 15, 0, 'lin', 'dB'),
      fxp('Mid Freq', 200, 8000, 1200, 'exp', 'Hz'),
      fxp('High Gain', -15, 15, 0, 'lin', 'dB'),
      fxp('High Freq', 1500, 16000, 6000, 'exp', 'Hz'),
    ],
  },
  {
    id: 'compressor', name: 'Compressor', params: [
      fxp('Threshold', -60, 0, -18, 'lin', 'dB'),
      fxp('Ratio', 1, 20, 4, 'exp', ':1'),
      fxp('Attack', 0.1, 100, 5, 'exp', 'ms'),
      fxp('Release', 10, 1000, 120, 'exp', 'ms'),
      fxp('Makeup', 0, 24, 3, 'lin', 'dB'),
      fxp('Knee', 0, 1, 0.5),
    ],
  },
];
export const FX_NAMES = FX_TYPES.map(f => f.name);
export const FX_INDEX = Object.fromEntries(FX_TYPES.map((f, i) => [f.id, i]));
export const FX_SLOTS = 4;

// ---- Tabla de parámetros
export function buildParams() {
  const P = [];
  const add = (id, name, group, min, max, def, curve = 'lin', extra = {}) => {
    P.push({ id, name, group, min, max, def, curve, unit: '', ...extra, index: P.length });
  };
  const en = (opts) => ({ opts });

  // Master
  add('master.volume', 'Volume', 'master', 0, 1, 0.75);
  add('master.tempo', 'Tempo', 'master', 40, 240, 120, 'lin', { unit: 'bpm', nomod: true });
  add('master.glide', 'Glide', 'master', 0, 2, 0, 'lin', { unit: 's' });
  add('master.poly', 'Voice Mode', 'master', 0, 2, 0, 'enum', { ...en(['Poly', 'Mono', 'Legato']), nomod: true });
  add('master.voices', 'Voices', 'master', 1, 16, 8, 'int', { nomod: true });
  add('master.bend', 'Bend Range', 'master', 0, 24, 2, 'int', { unit: 'st', nomod: true });

  // Motores A y B
  for (const X of ['a', 'b']) {
    const g = X;
    add(`${X}.on`, 'On', g, 0, 1, X === 'a' ? 1 : 0, 'enum', { ...en(['Off', 'On']), nomod: true });
    add(`${X}.type`, 'Engine', g, 0, ENGINE_TYPES.length - 1, X === 'a' ? 0 : 1, 'enum', { ...en(ENGINE_NAMES), nomod: true });
    add(`${X}.level`, 'Level', g, 0, 1, 0.8);
    add(`${X}.pan`, 'Pan', g, -1, 1, 0);
    add(`${X}.octave`, 'Octave', g, -3, 3, 0, 'int');
    add(`${X}.semi`, 'Semi', g, -12, 12, 0, 'int', { unit: 'st' });
    add(`${X}.fine`, 'Fine', g, -100, 100, 0, 'lin', { unit: 'ct' });
    add(`${X}.filter`, 'To Filter', g, 0, 3, X === 'a' ? 0 : 1, 'enum', { ...en(['F1', 'F2', 'F1+F2', 'Bypass']), nomod: true });
    // Analog (VA)
    add(`${X}.va.wave`, 'Wave', g, 0, 3, 2, 'enum', en(['Sine', 'Triangle', 'Saw', 'Pulse']));
    add(`${X}.va.pw`, 'Pulse Width', g, 0.05, 0.95, 0.5);
    add(`${X}.va.unison`, 'Unison', g, 1, 7, 1, 'int');
    add(`${X}.va.detune`, 'Detune', g, 0, 100, 15, 'lin', { unit: 'ct' });
    add(`${X}.va.spread`, 'Spread', g, 0, 1, 0.5);
    add(`${X}.va.sub`, 'Sub', g, 0, 1, 0);
    add(`${X}.va.subWave`, 'Sub Wave', g, 0, 1, 0, 'enum', en(['Sine', 'Square']));
    add(`${X}.va.noise`, 'Noise', g, 0, 1, 0);
    add(`${X}.va.sync`, 'Sync', g, 1, 4, 1, 'lin');
    // Wavetable
    add(`${X}.wt.table`, 'Table', g, 0, WAVETABLE_NAMES.length - 1, 0, 'enum', en(WAVETABLE_NAMES));
    add(`${X}.wt.pos`, 'Position', g, 0, 1, 0);
    add(`${X}.wt.warp`, 'Warp', g, 0, 1, 0);
    add(`${X}.wt.warpMode`, 'Warp Mode', g, 0, 3, 0, 'enum', en(['Bend', 'Sync', 'Fold', 'Mirror']));
    add(`${X}.wt.unison`, 'Unison', g, 1, 7, 1, 'int');
    add(`${X}.wt.detune`, 'Detune', g, 0, 100, 12, 'lin', { unit: 'ct' });
    add(`${X}.wt.spread`, 'Spread', g, 0, 1, 0.5);
    // FM
    add(`${X}.fm.alg`, 'Algorithm', g, 0, 3, 0, 'enum', en(['3›2›1', '2+3›1', '3›2, 1+2', '1+2+3']));
    add(`${X}.fm.ratio2`, 'Ratio 2', g, 0.25, 16, 2, 'exp');
    add(`${X}.fm.index2`, 'Index 2', g, 0, 12, 2.5);
    add(`${X}.fm.ratio3`, 'Ratio 3', g, 0.25, 16, 1, 'exp');
    add(`${X}.fm.index3`, 'Index 3', g, 0, 12, 0);
    add(`${X}.fm.feedback`, 'Feedback', g, 0, 1, 0);
    add(`${X}.fm.shape`, 'Shape', g, 0, 1, 0);
    // Granular
    add(`${X}.gran.source`, 'Source', g, 0, SAMPLE_SOURCES.length - 1, 0, 'enum', en(SAMPLE_SOURCES));
    add(`${X}.gran.size`, 'Grain Size', g, 5, 500, 90, 'exp', { unit: 'ms' });
    add(`${X}.gran.density`, 'Density', g, 1, 200, 24, 'exp', { unit: '/s' });
    add(`${X}.gran.pos`, 'Position', g, 0, 1, 0.2);
    add(`${X}.gran.spray`, 'Spray', g, 0, 1, 0.1);
    add(`${X}.gran.pitchRnd`, 'Pitch Rnd', g, 0, 12, 0, 'lin', { unit: 'st' });
    add(`${X}.gran.shape`, 'Shape', g, 0, 1, 0.6);
    add(`${X}.gran.scan`, 'Scan', g, -2, 2, 0);
    // Harmonic (aditivo)
    add(`${X}.harm.partials`, 'Partials', g, 1, 32, 16);
    add(`${X}.harm.tilt`, 'Tilt', g, 0, 3, 1);
    add(`${X}.harm.oddEven`, 'Odd/Even', g, -1, 1, 0);
    add(`${X}.harm.stretch`, 'Stretch', g, 0, 1, 0);
    add(`${X}.harm.comb`, 'Comb', g, 0, 1, 0);
    add(`${X}.harm.detune`, 'Shimmer', g, 0, 1, 0);
    // Modal
    add(`${X}.modal.material`, 'Material', g, 0, 1, 0);
    add(`${X}.modal.modes`, 'Modes', g, 1, 16, 8, 'int');
    add(`${X}.modal.decay`, 'Decay', g, 0.05, 10, 2, 'exp', { unit: 's' });
    add(`${X}.modal.damp`, 'Damping', g, 0, 1, 0.5);
    add(`${X}.modal.pos`, 'Position', g, 0.02, 0.98, 0.3);
    add(`${X}.modal.exciter`, 'Exciter', g, 0, 2, 0, 'enum', en(['Click', 'Noise', 'Sustain']));
    add(`${X}.modal.exLen`, 'Exc. Length', g, 1, 500, 12, 'exp', { unit: 'ms' });
    add(`${X}.modal.bright`, 'Brightness', g, 0, 1, 0.6);
    // Sample
    add(`${X}.smp.source`, 'Source', g, 0, SAMPLE_SOURCES.length - 1, 0, 'enum', en(SAMPLE_SOURCES));
    add(`${X}.smp.start`, 'Start', g, 0, 1, 0);
    add(`${X}.smp.loop`, 'Loop', g, 0, 1, 1, 'enum', en(['Off', 'On']));
    add(`${X}.smp.loopLen`, 'Loop Length', g, 0.01, 1, 1);
    add(`${X}.smp.tone`, 'Tone', g, 200, 20000, 20000, 'exp', { unit: 'Hz' });
  }

  // Filtros
  for (const F of ['f1', 'f2']) {
    add(`${F}.type`, 'Type', 'filter', 0, 7, 0, 'enum', en(['LP12', 'LP24', 'HP12', 'HP24', 'BP', 'Notch', 'Comb', 'Formant']));
    add(`${F}.cutoff`, 'Cutoff', 'filter', 20, 20000, F === 'f1' ? 6000 : 12000, 'exp', { unit: 'Hz' });
    add(`${F}.res`, 'Resonance', 'filter', 0, 1, 0.2);
    add(`${F}.drive`, 'Drive', 'filter', 0, 1, 0);
    add(`${F}.keytrack`, 'Key Track', 'filter', 0, 1, 0);
  }
  add('filter.routing', 'Routing', 'filter', 0, 1, 0, 'enum', { ...en(['Parallel', 'Series']), nomod: true });

  // Envolventes
  for (const E of ['env1', 'env2', 'env3']) {
    add(`${E}.attack`, 'Attack', 'env', 0.001, 10, E === 'env1' ? 0.005 : 0.01, 'exp', { unit: 's' });
    add(`${E}.decay`, 'Decay', 'env', 0.001, 10, 0.3, 'exp', { unit: 's' });
    add(`${E}.sustain`, 'Sustain', 'env', 0, 1, E === 'env1' ? 0.8 : 0.5);
    add(`${E}.release`, 'Release', 'env', 0.001, 10, 0.3, 'exp', { unit: 's' });
    add(`${E}.curve`, 'Curve', 'env', -1, 1, 0);
  }

  // LFOs
  for (const L of ['lfo1', 'lfo2', 'lfo3']) {
    add(`${L}.shape`, 'Shape', 'lfo', 0, 5, 0, 'enum', en(['Sine', 'Triangle', 'Saw', 'Square', 'S&H', 'Drift']));
    add(`${L}.rate`, 'Rate', 'lfo', 0.01, 50, 2, 'exp', { unit: 'Hz' });
    add(`${L}.sync`, 'Sync', 'lfo', 0, 1, 0, 'enum', { ...en(['Free', 'Sync']), nomod: true });
    add(`${L}.div`, 'Division', 'lfo', 0, LFO_DIVS.length - 1, 4, 'enum', { ...en(LFO_DIVS), nomod: true });
    add(`${L}.phase`, 'Phase', 'lfo', 0, 1, 0);
    add(`${L}.retrig`, 'Retrig', 'lfo', 0, 1, 1, 'enum', { ...en(['Free', 'Retrig']), nomod: true });
    add(`${L}.smooth`, 'Smooth', 'lfo', 0, 1, 0);
  }

  // Macros
  for (let i = 1; i <= 4; i++) add(`macro${i}`, `Macro ${i}`, 'macro', 0, 1, 0, 'lin', { nomod: true });

  // Arpegiador
  add('arp.on', 'Arp', 'arp', 0, 1, 0, 'enum', { ...en(['Off', 'On']), nomod: true });
  add('arp.mode', 'Mode', 'arp', 0, 4, 0, 'enum', { ...en(['Up', 'Down', 'Up/Down', 'Random', 'Order']), nomod: true });
  add('arp.rate', 'Rate', 'arp', 0, ARP_DIVS.length - 1, 3, 'enum', { ...en(ARP_DIVS), nomod: true });
  add('arp.octaves', 'Octaves', 'arp', 1, 4, 1, 'int', { nomod: true });
  add('arp.gate', 'Gate', 'arp', 0.05, 1, 0.5);
  add('arp.swing', 'Swing', 'arp', 0, 0.75, 0);

  // Efectos: 4 slots
  for (let i = 1; i <= FX_SLOTS; i++) {
    add(`fx${i}.type`, 'Effect', 'fx', 0, FX_TYPES.length - 1, 0, 'enum', { ...en(FX_NAMES), nomod: true });
    add(`fx${i}.on`, 'On', 'fx', 0, 1, 1, 'enum', { ...en(['Off', 'On']), nomod: true });
    add(`fx${i}.mix`, 'Mix', 'fx', 0, 1, 1);
    for (let p = 0; p < 6; p++) add(`fx${i}.p${p}`, `P${p + 1}`, 'fx', 0, 1, 0.5, 'lin', { fxParam: p, slot: i });
  }
  return P;
}

export const PARAMS = buildParams();
export const PARAM_INDEX = Object.fromEntries(PARAMS.map(p => [p.id, p.index]));
export const pidx = (id) => {
  const i = PARAM_INDEX[id];
  if (i === undefined) throw new Error('Unknown param ' + id);
  return i;
};

// ---- Conversión normalizado (0..1) <-> valor real
export function denorm(def, n) {
  n = n < 0 ? 0 : n > 1 ? 1 : n;
  switch (def.curve) {
    case 'exp': return def.min * Math.pow(def.max / def.min, n);
    case 'int':
    case 'enum': return Math.round(def.min + n * (def.max - def.min));
    default: return def.min + n * (def.max - def.min);
  }
}
export function norm(def, v) {
  let n;
  if (def.curve === 'exp') n = Math.log(v / def.min) / Math.log(def.max / def.min);
  else n = (v - def.min) / (def.max - def.min);
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
export function isGlobalParam(id) {
  return id.startsWith('fx') || id.startsWith('master') || id.startsWith('arp');
}

export function formatValue(def, v) {
  if (def.opts) return def.opts[Math.round(v)] ?? String(v);
  if (def.curve === 'int') return `${Math.round(v)}${def.unit ? ' ' + def.unit : ''}`;
  const u = def.unit;
  if (u === 'Hz') return v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${v.toFixed(v < 100 ? 2 : 1)} Hz`;
  if (u === 's') return v < 1 ? `${(v * 1000).toFixed(0)} ms` : `${v.toFixed(2)} s`;
  if (u === 'ms') return `${v.toFixed(v < 10 ? 1 : 0)} ms`;
  if (u === 'ct' || u === 'st' || u === 'dB') return `${v > 0 ? '+' : ''}${v.toFixed(u === 'ct' ? 0 : 1)} ${u}`;
  if (u === 'bpm') return `${v.toFixed(0)} bpm`;
  if (u) return `${v.toFixed(2)} ${u}`;
  if (def.min === 0 && def.max === 1) return `${Math.round(v * 100)}%`;
  if (def.min === -1 && def.max === 1) return `${Math.round(v * 100)}%`;
  return v.toFixed(2);
}
