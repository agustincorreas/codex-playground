// ¿Dónde está la ventaja? Toma una variante del ORB y agrupa sus trades por volumen relativo, ranking, gap de
// apertura, tamaño de la vela de apertura, precio, minuto de entrada, lado, dirección de SPY en los primeros
// 5 minutos y año; imprime aciertos y R promedio por grupo.
// Uso: npx tsx research/orb/analyze.ts [inplay|inplay-paper] [stop=0.1] [objetivo=0] [fill=pesimista|optimista] [costo=real|paper]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Bar, ROOT_DIR as ROOT, bars, loadJson, save } from './fetch';
import { type Trade, type Variant, atr14, simulate, stats } from './backtest';

const INPLAY = process.argv[2] ?? 'inplay';
const K = Number(process.argv[3] ?? 0.1);
const TARGET = Number(process.argv[4] ?? 0);
const FILL = (process.argv[5] ?? 'pesimista') as Variant['fill'];
const COST = (process.argv[6] ?? 'real') as Variant['cost'];
const load = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8')) as T;

async function spyOpen(): Promise<Record<string, Bar>> {
  const file = join(ROOT, 'spy5.json');
  const cached = loadJson<Record<string, Bar>>(file);
  if (cached) return cached;
  const got = await bars(['SPY'], '5Min', '2021-01-01T00:00:00Z', '2026-12-31T23:59:59Z');
  const out: Record<string, Bar> = {};
  for (const b of got.SPY ?? []) {
    const d = new Date(b.t);
    const h = d.getUTCHours() * 60 + d.getUTCMinutes();
    // 9:30 NY = 13:30 UTC en verano, 14:30 en invierno; nos quedamos con la primera vela del día.
    const day = b.t.slice(0, 10);
    if ((h === 13 * 60 + 30 || h === 14 * 60 + 30) && !out[day]) out[day] = b;
  }
  save(file, out);
  return out;
}

interface Row {
  t: Trade;
  rvol: number;
  rank: number;
  gap: number;
  rangeAtr: number;
  price: number;
  spyAligned: boolean | null;
}

function prevClose(sym: string, day: string): number {
  const f = join(ROOT, 'daily', `${sym}.json`);
  if (!existsSync(f)) return 0;
  const d = load<Bar[]>(f);
  const idx = d.findIndex((b) => b.t.slice(0, 10) >= day);
  const prev = idx < 0 ? d[d.length - 1] : d[idx - 1];
  return prev?.c ?? 0;
}

async function main() {
  const spy = await spyOpen();
  const v: Variant = { name: 'base', stop: 'atr', k: K, targetR: TARGET, entryUntil: 390, side: 'both', beAtR: 0, fill: FILL, cost: COST };
  const days = readdirSync(join(ROOT, INPLAY)).map((f) => f.slice(0, 10)).filter((d) => existsSync(join(ROOT, 'min', `${d}.json`))).sort();
  const rows: Row[] = [];
  for (const day of days) {
    const top = load<Array<{ sym: string; rvol: number }>>(join(ROOT, INPLAY, `${day}.json`));
    const open = load<Record<string, Bar>>(join(ROOT, 'open5', `${day}.json`));
    const mins = load<Record<string, Bar[]>>(join(ROOT, 'min', `${day}.json`));
    top.forEach(({ sym, rvol }, rank) => {
      const o = open[sym];
      const m = mins[sym];
      if (!o || !m) return;
      const t = simulate(day, sym, o, m, v);
      if (!t) return;
      const pc = prevClose(sym, day);
      const atr = atr14(sym, day);
      const s = spy[day];
      const spyUp = s ? (s.c > s.o ? true : s.c < s.o ? false : null) : null;
      rows.push({ t, rvol, rank, gap: pc ? (o.o - pc) / pc : 0, rangeAtr: atr ? (o.h - o.l) / atr : 0, price: o.o, spyAligned: spyUp === null ? null : spyUp === (t.side === 'long') });
    });
  }
  console.log(`# Dónde está la ventaja · selección ${INPLAY} · stop ${K}×ATR · ${TARGET ? `objetivo ${TARGET}R` : 'al cierre'} · entrada ${FILL} · costos ${COST} · ${rows.length} trades\n`);
  const group = (title: string, key: (r: Row) => string, order?: string[]) => {
    const g = new Map<string, Trade[]>();
    for (const r of rows) (g.get(key(r)) ?? g.set(key(r), []).get(key(r))!).push(r.t);
    const keys = order ?? [...g.keys()].sort();
    console.log(`\n## ${title}\n\n| Grupo | Trades | Aciertos | R prom. | Factor |\n|---|---|---|---|---|`);
    for (const k of keys) {
      const t = g.get(k);
      if (!t?.length) continue;
      const s = stats(t, 1);
      console.log(`| ${k} | ${t.length} | ${(100 * s.winRate).toFixed(0)} % | ${s.avgR.toFixed(2)} | ${Number.isFinite(s.pf) ? s.pf.toFixed(2) : '∞'} |`);
    }
  };
  const bucket = (v: number, edges: number[], labels: string[]) => labels[edges.findIndex((e) => v < e) < 0 ? labels.length - 1 : edges.findIndex((e) => v < e)];
  const rv = ['< 1.5×', '1.5–2×', '2–3×', '3–5×', '5–10×', '10–30×', '≥ 30×'];
  group('Volumen relativo de la primera vela', (r) => bucket(r.rvol, [1.5, 2, 3, 5, 10, 30], rv), rv);
  const rk = ['1–5', '6–10', '11–20'];
  group('Ranking del día', (r) => bucket(r.rank, [5, 10], rk), rk);
  const gp = ['gap en contra ≥ 5 %', 'gap en contra 2–5 %', 'gap en contra < 2 %', 'gap a favor < 2 %', 'gap a favor 2–5 %', 'gap a favor 5–10 %', 'gap a favor ≥ 10 %'];
  group('Gap de apertura respecto del lado del trade', (r) => bucket((r.t.side === 'long' ? 1 : -1) * r.gap, [-0.05, -0.02, 0, 0.02, 0.05, 0.1], gp), gp);
  const rg = ['< 0.1 ATR', '0.1–0.25 ATR', '0.25–0.5 ATR', '0.5–1 ATR', '≥ 1 ATR'];
  group('Tamaño de la vela de apertura', (r) => bucket(r.rangeAtr, [0.1, 0.25, 0.5, 1], rg), rg);
  const px = ['< $10', '$10–30', '$30–100', '≥ $100'];
  group('Precio', (r) => bucket(r.price, [10, 30, 100], px), px);
  const mn = ['9:35–9:45', '9:45–10:00', '10:00–10:30', '10:30–11:30', '11:30–16:00'];
  group('Minuto de entrada', (r) => bucket(r.t.entryMin, [15, 30, 60, 120], mn), mn);
  group('Lado', (r) => r.t.side, ['long', 'short']);
  group('SPY en los primeros 5 min', (r) => (r.spyAligned === null ? 'sin dato' : r.spyAligned ? 'a favor' : 'en contra'), ['a favor', 'en contra', 'sin dato']);
  group('Año', (r) => r.t.day.slice(0, 4));
  const cross = ['rvol ≥ 5× y gap a favor ≥ 2 %', 'rvol ≥ 5× y SPY a favor', 'rvol ≥ 10× y gap a favor ≥ 2 % y SPY a favor', 'long · rvol ≥ 5× · gap ≥ 2 %', 'short · rvol ≥ 5× · gap ≤ −2 %'];
  group('Combinaciones', (r) => {
    const g = (r.t.side === 'long' ? 1 : -1) * r.gap;
    if (r.rvol >= 10 && g >= 0.02 && r.spyAligned) return cross[2];
    if (r.rvol >= 5 && g >= 0.02) return r.t.side === 'long' ? cross[3] : cross[4];
    if (r.rvol >= 5 && r.spyAligned) return cross[1];
    return 'resto';
  }, [...cross, 'resto']);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
