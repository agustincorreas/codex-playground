// Mapas MIDI de fábrica. Claves: note:<canal 0-15>:<nota> | cc:<canal>:<cc>. mode: 'center' = jog con 0x40 en reposo; invert: invierte un control absoluto.
const n = (ch, note, extra = {}) => ({ key: `note:${ch}:${note}`, ...extra });
const cc = (ch, num, extra = {}) => ({ key: `cc:${ch}:${num}`, ...extra });

function wego3() {
  const m = {};
  for (const [d, ch] of [['A', 0], ['B', 1]]) {
    Object.assign(m, {
      [`${d}.play`]: n(ch, 0x0b), [`${d}.cue`]: n(ch, 0x0c), [`${d}.sync`]: n(ch, 0x58),
      [`${d}.loop4`]: n(ch, 0x14), [`${d}.loopHalf`]: n(ch, 0x12), [`${d}.loopDouble`]: n(ch, 0x13),
      [`${d}.pitch`]: cc(ch, 0x00), [`${d}.jog`]: cc(ch, 0x22, { mode: 'center' }), [`${d}.jogRing`]: cc(ch, 0x21, { mode: 'center' }),
      [`${d}.keylock`]: n(ch + 4, 0x43), [`${d}.loop1`]: n(ch + 4, 0x44), [`${d}.loop8`]: n(ch + 4, 0x45), // botones FX 1/2/3
    });
    for (let i = 0; i < 4; i++) { m[`${d}.hotcue${i + 1}`] = n(ch, 0x2e + i); m[`${d}.hotcueDel${i + 1}`] = n(ch, 0x5f + i); }
    [0x3c, 0x3e, 0x40, 0x42].forEach((note, i) => { m[`smp.pad${(d === 'A' ? 0 : 4) + i + 1}`] = n(ch, note); });
  }
  Object.assign(m, {
    'mix.A.high': cc(6, 0x07), 'mix.A.mid': cc(6, 0x0b), 'mix.A.low': cc(6, 0x0f), 'mix.A.fader': cc(6, 0x13),
    'mix.B.high': cc(6, 0x08), 'mix.B.mid': cc(6, 0x0c), 'mix.B.low': cc(6, 0x10), 'mix.B.fader': cc(6, 0x15),
    'mix.xfader': cc(6, 0x1f), 'mix.A.cue': n(6, 0x54), 'mix.B.cue': n(6, 0x55),
    'A.load': n(6, 0x46), 'B.load': n(6, 0x47), 'lib.scroll': cc(6, 0x40), 'lib.loadFree': n(6, 0x41),
  });
  return m;
}

export const MIDI_PRESETS = [
  { id: 'ddj-wego3', name: 'Pioneer DDJ-WeGO3', match: /wego\s*3/i, build: wego3 },
];
export const findPreset = (deviceName) => MIDI_PRESETS.find(p => p.match.test(deviceName || ''));
