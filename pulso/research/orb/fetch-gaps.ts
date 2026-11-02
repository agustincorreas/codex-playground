// Todos los gaps al alza grandes del universo elegible (no solo las 20 más en juego): con las primeras velas de
// 5 min ya bajadas (open5) y las diarias, arma data/gappers/{día}.json con {sym, rvol, gap} para gap ≥ mínimo y
// completa las velas de 1 min de esas acciones. Uso: npx tsx research/orb/fetch-gaps.ts [contar|bajar] [minGap=0.04]
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR as ROOT, type Bar, minuteBars, save } from './fetch';

const MODE = process.argv[2] ?? 'contar';
const MIN_GAP = Number(process.argv[3] ?? 0.04);
const load = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8')) as T;
const dailyCache = new Map<string, Bar[]>();
function prevClose(sym: string, day: string): number {
  let d = dailyCache.get(sym);
  if (!d) {
    const f = join(ROOT, 'daily', `${sym}.json`);
    d = existsSync(f) ? load<Bar[]>(f) : [];
    dailyCache.set(sym, d);
  }
  const idx = d.findIndex((b) => b.t.slice(0, 10) >= day);
  const prev = idx < 0 ? d[d.length - 1] : d[idx - 1];
  return prev?.c ?? 0;
}

async function main() {
  mkdirSync(join(ROOT, 'gappers'), { recursive: true });
  const days = readdirSync(join(ROOT, 'inplay-paper')).map((f) => f.slice(0, 10)).sort();
  let total = 0;
  let missing = 0;
  for (const day of days) {
    const open = load<Record<string, Bar>>(join(ROOT, 'open5', `${day}.json`));
    const inplay = load<Array<{ sym: string; rvol: number }>>(join(ROOT, 'inplay-paper', `${day}.json`));
    const rv = new Map(inplay.map((x) => [x.sym, x.rvol]));
    const list: Array<{ sym: string; rvol: number; gap: number }> = [];
    for (const [sym, b] of Object.entries(open)) {
      const pc = prevClose(sym, day);
      if (!pc || b.o < 5) continue;
      const gap = b.o / pc - 1;
      if (Math.abs(gap) >= MIN_GAP) list.push({ sym, rvol: rv.get(sym) ?? 0, gap });
    }
    list.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
    save(join(ROOT, 'gappers', `${day}.json`), list);
    total += list.length;
    const mins = existsSync(join(ROOT, 'min', `${day}.json`)) ? load<Record<string, Bar[]>>(join(ROOT, 'min', `${day}.json`)) : {};
    const need = list.filter((x) => !(x.sym in mins)).map((x) => x.sym);
    missing += need.length;
    if (MODE === 'bajar' && need.length) {
      await minuteBars(day, need);
      if (days.indexOf(day) % 20 === 0) console.log(`${day}: ${days.indexOf(day)}/${days.length}`);
    }
  }
  console.log(`gaps ≥ ${MIN_GAP * 100} %: ${total} acción-días (${(total / days.length).toFixed(1)} por día); sin velas de 1 min: ${missing}`);
  if (MODE === 'bajar') console.log('listo');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
