// Resuelve la ambigüedad de la vela de entrada con las operaciones reales (ticks) de ese minuto: cuando la vela de
// 1 min que dispara la orden stop también toca el stop de pérdida, solo la secuencia de operaciones dice qué pasó
// primero. Baja las operaciones del minuto (Alpaca SIP) para cada entrada ambigua y las guarda en data/ticks.
// Uso: npx tsx research/orb/ticks.ts [inplay|inplay-paper] [contar|bajar] [k1,k2,...=0.1,0.25,0.5]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type Bar, ROOT_DIR as ROOT, etOffset } from './fetch';
import { type Variant, simulate } from './backtest';

const INPLAY = process.argv[2] ?? 'inplay';
const MODE = process.argv[3] ?? 'contar';
const KS = (process.argv[4] ?? '0.1,0.25,0.5').split(',').map(Number);
const load = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8')) as T;

const env = Object.fromEntries(
  readFileSync(join(dirname(new URL(import.meta.url).pathname), '..', '..', '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const times: number[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`https://data.alpaca.markets${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    const now = Date.now();
    while (times.length && now - times[0] > 60_000) times.shift();
    if (times.length >= 180) await sleep(60_000 - (now - times[0]) + 50);
    times.push(Date.now());
    const res = await fetch(url, { headers: { 'APCA-API-KEY-ID': env.ALPACA_KEY_ID, 'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY } });
    if (res.status === 429 || res.status >= 500) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${await res.text()} ${url}`);
    return res.json();
  }
}

/** Archivo de ticks del minuto `min` (desde las 9:30) de `sym` el día `day`: lista de [hora, precio, tamaño, condiciones]. */
export const tickFile = (day: string, sym: string, min: number) => join(ROOT, 'ticks', day, `${sym}-${min}.json`);
export type Tick = [string, number, number, string];
export function loadTicks(day: string, sym: string, min: number): Tick[] | null {
  const f = tickFile(day, sym, min);
  return existsSync(f) ? load<Tick[]>(f) : null;
}

async function fetchTicks(day: string, sym: string, min: number): Promise<void> {
  const f = tickFile(day, sym, min);
  if (existsSync(f)) return;
  const off = etOffset(day);
  const hh = String(9 + Math.floor((30 + min) / 60)).padStart(2, '0');
  const mm = String((30 + min) % 60).padStart(2, '0');
  const out: Tick[] = [];
  let token: string | undefined;
  do {
    const j = await get(`/v2/stocks/${sym}/trades`, { start: `${day}T${hh}:${mm}:00${off}`, end: `${day}T${hh}:${mm}:59.999999${off}`, feed: 'sip', limit: '10000', ...(token ? { page_token: token } : {}) });
    for (const t of j.trades ?? []) out.push([t.t, t.p, t.s, (t.c ?? []).join('')]);
    token = j.next_page_token ?? undefined;
  } while (token);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(out));
}

export interface Ambiguous {
  day: string;
  sym: string;
  min: number;
}

/** Entradas cuya vela de 1 min toca el stop sin cerrar más allá: la lectura pesimista y la optimista difieren. */
export function ambiguous(inplay: string, ks: number[]): Ambiguous[] {
  const days = readdirSync(join(ROOT, inplay)).map((f) => f.slice(0, 10)).filter((d) => existsSync(join(ROOT, 'min', `${d}.json`))).sort();
  const seen = new Set<string>();
  const out: Ambiguous[] = [];
  for (const day of days) {
    const top = load<Array<{ sym: string }>>(join(ROOT, inplay, `${day}.json`));
    const open = load<Record<string, Bar>>(join(ROOT, 'open5', `${day}.json`));
    const mins = load<Record<string, Bar[]>>(join(ROOT, 'min', `${day}.json`));
    for (const { sym } of top) {
      const o = open[sym];
      const m = mins[sym];
      if (!o || !m) continue;
      for (const k of ks) {
        const base: Variant = { name: '', stop: 'atr', k, targetR: 0, entryUntil: 390, side: 'both', beAtR: 0 };
        const p = simulate(day, sym, o, m, { ...base, fill: 'pesimista' });
        const q = simulate(day, sym, o, m, { ...base, fill: 'optimista' });
        if (!p || !q || (p.reason === q.reason && p.exit === q.exit)) continue;
        const key = `${day}/${sym}/${p.entryMin}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ day, sym, min: p.entryMin });
      }
    }
  }
  return out;
}

async function main() {
  const list = ambiguous(INPLAY, KS);
  const missing = list.filter((a) => !existsSync(tickFile(a.day, a.sym, a.min)));
  console.log(`${list.length} entradas ambiguas en ${INPLAY} para stops ${KS.join('/')}×ATR; ${missing.length} sin ticks bajados`);
  if (MODE !== 'bajar') return;
  let n = 0;
  for (const a of missing) {
    await fetchTicks(a.day, a.sym, a.min);
    if (++n % 100 === 0) console.log(`${n}/${missing.length}`);
  }
  console.log('listo');
}

if (process.argv[1]?.endsWith('ticks.ts'))
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
