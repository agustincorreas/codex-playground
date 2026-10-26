// Historia inventada para el simulador y el modo demo: velas diarias de los últimos años, por hora de
// los últimos meses y de 1 minuto de los últimos días, que terminan en el cierre anterior del símbolo.
// Es determinista por símbolo, así el gráfico muestra siempre lo mismo.
import type { HistoryTf } from '../engine/history';
import { etWallToTs, POST_CLOSE, PRE_OPEN, previousTradingDays, sessionDate, volumeIntensity } from '../engine/time';
import type { Bar } from '../engine/types';
import { mulberry32 } from './simulator';

function hashSym(sym: string): number {
  let h = 2166136261;
  for (const ch of sym) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function gaussian(rnd: () => number): () => number {
  return () => {
    let u = 0;
    while (u === 0) u = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };
}

const tick = (p: number) => Math.max(0.01, Math.round(p * 100) / 100);

/** Velas diarias (las más viejas primero) que terminan en `prevClose` el último día hábil anterior. */
function dailyBars(sym: string, prevClose: number, avgVolume: number, now: number, count: number): Bar[] {
  const rnd = mulberry32(hashSym(sym));
  const g = gaussian(rnd);
  const days = previousTradingDays(sessionDate(now), count);
  // Hacia atrás desde el cierre anterior: una small cap suele venir cayendo (los precios viejos eran más altos).
  const closes: number[] = [];
  let c = prevClose;
  for (let i = 0; i < days.length; i++) {
    closes.push(tick(c));
    const spike = rnd() < 0.01 ? Math.abs(g()) * 0.3 : 0;
    c = c / Math.exp(g() * 0.04 - 0.0008 - spike);
  }
  const out: Bar[] = [];
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    const close = closes[i];
    const prev = closes[i + 1] ?? close;
    const o = tick(prev * Math.exp(g() * 0.025));
    const range = Math.abs(g()) * 0.03 + 0.01;
    const h = tick(Math.max(o, close) * (1 + range));
    const l = tick(Math.min(o, close) * (1 - range));
    const v = Math.round(avgVolume * Math.exp(g() * 0.6) * (1 + Math.abs(close / prev - 1) * 20));
    out.push({ t: etWallToTs(d.y, d.mo, d.d, 0), o, h, l, c: close, v, pv: ((o + h + l + close) / 4) * v, n: Math.max(1, Math.round(v / 150)) });
  }
  return out;
}

/** Reparte una vela diaria en velas intradía (puente browniano entre la apertura y el cierre). */
function intraday(day: Bar, stepMin: number, rnd: () => number): Bar[] {
  const g = gaussian(rnd);
  const n = (POST_CLOSE - PRE_OPEN) / stepMin;
  const walk: number[] = [0];
  for (let k = 1; k <= n; k++) walk.push(walk[k - 1] + g());
  const sigma = (day.h - day.l) / (2.5 * Math.sqrt(n));
  const path: number[] = [];
  for (let k = 0; k <= n; k++) path.push(day.o + ((day.c - day.o) * k) / n + sigma * (walk[k] - (k / n) * walk[n]));
  const weights: number[] = [];
  let total = 0;
  for (let k = 0; k < n; k++) {
    const w = volumeIntensity(PRE_OPEN + k * stepMin) + 0.02;
    weights.push(w);
    total += w;
  }
  const out: Bar[] = [];
  const dayStart = day.t + PRE_OPEN * 60_000;
  for (let k = 0; k < n; k++) {
    const o = tick(path[k]);
    const c = tick(path[k + 1]);
    const wig = Math.abs(g()) * sigma * 0.5;
    const h = tick(Math.min(day.h, Math.max(o, c) + wig));
    const l = tick(Math.max(day.l, Math.min(o, c) - wig));
    const v = Math.max(0, Math.round((day.v * weights[k]) / total));
    out.push({ t: dayStart + k * stepMin * 60_000, o, h, l, c, v, pv: ((o + h + l + c) / 4) * v, n: Math.max(1, Math.round(v / 120)) });
  }
  return out;
}

/** La historia de un símbolo simulado para la temporalidad pedida (velas ordenadas, las viejas primero). */
export function synthHistory(sym: string, prevClose: number | undefined, avgVolume: number | undefined, tf: HistoryTf, now: number): Bar[] {
  if (!prevClose || prevClose <= 0) return [];
  const avg = avgVolume && avgVolume > 0 ? avgVolume : 400_000;
  if (tf === 'day') return dailyBars(sym, prevClose, avg, now, 600);
  const days = dailyBars(sym, prevClose, avg, now, tf === 'hour' ? 90 : 5);
  const rnd = mulberry32(hashSym(sym) ^ (tf === 'hour' ? 0x9e37 : 0x85eb));
  return days.flatMap((d) => intraday(d, tf === 'hour' ? 60 : 1, rnd));
}
