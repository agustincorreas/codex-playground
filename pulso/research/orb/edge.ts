// ¿Hay ventaja cruda? Para cada acción "en juego": dirección de la primera vela de 5 min, y el recorrido desde el
// máximo (o mínimo) de esa vela hasta el cierre, en % y en ATR, sin stops. También cuántas rompen el nivel.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = 'research/orb/data';
const load = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const days = readdirSync(join(ROOT, 'inplay')).map((f) => f.slice(0, 10)).filter((d) => existsSync(join(ROOT, 'min', `${d}.json`))).sort();
let n = 0, broke = 0, sumPct = 0, wins = 0, sumAll = 0, nAll = 0, up = 0, nBars = 0;
const byRank: number[][] = Array.from({ length: 20 }, () => []);
for (const day of days) {
  const top = load(join(ROOT, 'inplay', `${day}.json`));
  const open = load(join(ROOT, 'open5', `${day}.json`));
  const mins = load(join(ROOT, 'min', `${day}.json`));
  top.forEach((x: any, rank: number) => {
    const o = open[x.sym]; const m = mins[x.sym];
    if (!o || !m?.length) return;
    nAll++; nBars += m.length;
    const long = o.c > o.o; if (o.c === o.o) return;
    if (long) up++;
    const last = m[m.length - 1].c;
    const sign = long ? 1 : -1;
    sumAll += sign * (last - o.c) / o.c;
    const level = long ? o.h : o.l;
    const hit = m.slice(5).some((b: any) => (long ? b.h >= level : b.l <= level));
    if (!hit) return;
    n++; broke++;
    const r = sign * (last - level) / level;
    sumPct += r; if (r > 0) wins++;
    byRank[rank].push(r);
  });
}
console.log(`días ${days.length}, acción-días ${nAll}, velas por día prom. ${(nBars / nAll).toFixed(0)}, primera vela verde ${(100 * up / nAll).toFixed(0)} %`);
console.log(`recorrido 9:35→cierre en la dirección de la primera vela (sin stop): ${(100 * sumAll / nAll).toFixed(2)} % promedio`);
console.log(`rompen el nivel: ${broke}/${nAll}; desde el nivel al cierre: ${(100 * sumPct / n).toFixed(2)} % promedio, positivos ${(100 * wins / n).toFixed(0)} %`);
console.log('por ranking (1=más en juego), % promedio desde el nivel al cierre:', byRank.map((r, i) => `${i + 1}:${r.length ? (100 * r.reduce((a, b) => a + b, 0) / r.length).toFixed(2) : '-'}`).join(' '));
