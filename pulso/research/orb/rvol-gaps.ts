// Completa el volumen relativo de cada gap grande (data/gappers) con las primeras velas de 5 min de los 14 días
// previos (data/open5), para separar "gap con volumen" de "gap sin volumen". Uso: npx tsx research/orb/rvol-gaps.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR as ROOT, type Bar, save } from './fetch';
const load = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8')) as T;
const days = readdirSync(join(ROOT, 'gappers')).map((f) => f.slice(0, 10)).sort();
const history = new Map<string, number[]>();
let n = 0;
for (const day of days) {
  const open = load<Record<string, Bar>>(join(ROOT, 'open5', `${day}.json`));
  const list = load<Array<{ sym: string; rvol: number; gap: number }>>(join(ROOT, 'gappers', `${day}.json`));
  for (const g of list) {
    const h = history.get(g.sym) ?? [];
    const b = open[g.sym];
    g.rvol = h.length >= 5 && b ? b.v / (h.reduce((a, v) => a + v, 0) / h.length) : 0;
    n++;
  }
  save(join(ROOT, 'gappers', `${day}.json`), list);
  for (const [sym, b] of Object.entries(open)) {
    const h = history.get(sym) ?? [];
    h.push(b.v);
    if (h.length > 14) h.shift();
    history.set(sym, h);
  }
}
console.log(`${n} gaps con volumen relativo`);
