// Análisis offline: forma de onda en 3 bandas, BPM, beatgrid y ganancia sugerida.
const SR = 22050;

export async function analyzeBuffer(buffer, { binsPerSec = 100 } = {}) {
  const duration = buffer.duration;
  const off = new OfflineAudioContext(3, Math.ceil(duration * SR) + 1, SR);
  const src = off.createBufferSource(); src.buffer = buffer;
  const merger = off.createChannelMerger(3);
  const lp = off.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 0.7;
  const bp = off.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 0.35;
  const hp = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000; hp.Q.value = 0.7;
  src.connect(lp); lp.connect(merger, 0, 0);
  src.connect(bp); bp.connect(merger, 0, 1);
  src.connect(hp); hp.connect(merger, 0, 2);
  merger.connect(off.destination);
  src.start(0);
  const r = await off.startRendering();
  const ch = [r.getChannelData(0), r.getChannelData(1), r.getChannelData(2)];
  const hop = SR / binsPerSec;
  const bins = Math.max(1, Math.ceil(duration * binsPerSec));
  const low = new Float32Array(bins), mid = new Float32Array(bins), high = new Float32Array(bins);
  let peak = 1e-6, sumSq = 0;
  for (let b = 0; b < bins; b++) {
    const s = Math.floor(b * hop), e = Math.min(r.length, Math.floor((b + 1) * hop));
    let a0 = 0, a1 = 0, a2 = 0;
    for (let i = s; i < e; i++) { a0 += ch[0][i] * ch[0][i]; a1 += ch[1][i] * ch[1][i]; a2 += ch[2][i] * ch[2][i]; }
    const n = Math.max(1, e - s);
    low[b] = Math.sqrt(a0 / n); mid[b] = Math.sqrt(a1 / n); high[b] = Math.sqrt(a2 / n);
    const tot = low[b] * low[b] + mid[b] * mid[b] + high[b] * high[b];
    sumSq += tot; if (tot > peak) peak = tot;
  }
  const norm = 1 / Math.sqrt(peak);
  for (let b = 0; b < bins; b++) { low[b] *= norm; mid[b] *= norm; high[b] *= norm; }
  const rmsDb = 20 * Math.log10(Math.sqrt(sumSq / bins) + 1e-9);
  const gainDb = Math.max(-12, Math.min(12, -14 - rmsDb));

  const { bpm, beatOffset, confidence } = detectTempo(low, mid, high, binsPerSec);
  return { binsPerSec, bins, low, mid, high, duration, bpm, beatOffset, confidence, gainDb };
}

function detectTempo(low, mid, high, fps) {
  const n = low.length;
  if (n < fps * 8) return { bpm: null, beatOffset: 0, confidence: 0 };
  // flujo espectral (onsets) ponderando graves
  const flux = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const d = 2.5 * Math.max(0, low[i] - low[i - 1]) + 1.2 * Math.max(0, mid[i] - mid[i - 1]) + Math.max(0, high[i] - high[i - 1]);
    flux[i] = d;
  }
  // quitar media local
  const win = Math.round(fps * 0.5);
  const env = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += flux[i]; if (i >= win) acc -= flux[i - win]; env[i] = Math.max(0, flux[i] - acc / win); }
  // autocorrelación en rango 60–200 BPM
  const minLag = Math.floor(fps * 60 / 200), maxLag = Math.ceil(fps * 60 / 60);
  const ac = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0; for (let i = lag; i < n; i++) s += env[i] * env[i - lag];
    ac[lag] = s / (n - lag);
  }
  // combinar armónicos y preferir el rango típico
  let best = -1, bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 * fps / lag;
    let s = ac[lag];
    if (lag * 2 <= maxLag) s += 0.5 * ac[lag * 2];
    if (Math.round(lag / 2) >= minLag) s += 0.35 * ac[Math.round(lag / 2)];
    const pref = bpm >= 84 && bpm <= 160 ? 1 : bpm < 84 ? 0.8 : 0.85;
    s *= pref;
    if (s > best) { best = s; bestLag = lag; }
  }
  if (!bestLag || best <= 0) return { bpm: null, beatOffset: 0, confidence: 0 };
  // refinar con peine (comb) alrededor del candidato
  let coarse = 60 * fps / bestLag;
  while (coarse < 70) coarse *= 2;
  while (coarse > 180) coarse /= 2;
  let bestScore = -1, bestBpm = coarse, bestOff = 0;
  for (const c of [coarse, coarse * 2, coarse / 2]) {
    if (c < 60 || c > 200) continue;
    for (let b = c - 2; b <= c + 2; b += 0.05) {
      const { score, offset } = combScore(env, fps, b);
      const pref = b >= 84 && b <= 160 ? 1 : 0.85;
      if (score * pref > bestScore) { bestScore = score * pref; bestBpm = b; bestOff = offset; }
    }
  }
  // score relativo: qué tan concentrada está la energía en el grid
  let total = 0; for (let i = 0; i < n; i++) total += env[i];
  const confidence = total > 0 ? Math.min(1, bestScore / (total / (n / (fps * 60 / bestBpm))) / 2) : 0;
  return { bpm: Math.round(bestBpm * 100) / 100, beatOffset: bestOff, confidence };
}

function combScore(env, fps, bpm) {
  const period = fps * 60 / bpm; // bins
  const n = env.length;
  const steps = 24;
  let best = -1, bestOff = 0;
  for (let s = 0; s < steps; s++) {
    const off = period * s / steps;
    let sum = 0, k = 0;
    for (let p = off; p < n; p += period) { const i = Math.round(p); if (i < n) sum += env[i] + 0.5 * (env[i - 1] || 0) + 0.5 * (env[i + 1] || 0); k++; }
    if (k && sum > best) { best = sum; bestOff = off; }
  }
  // desplazar el offset al primer beat con energía (evita empezar en silencio)
  return { score: best, offset: bestOff / fps };
}
