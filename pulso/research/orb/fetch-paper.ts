// Universo exacto del paper (Zarattini, Barbon y Aziz 2024), rodante día por día: precio > $5, volumen promedio de
// 14 días ≥ 1.000.000 de acciones, ATR de 14 días > $0,50, volumen relativo de la primera vela ≥ 1, y las 20 de mayor
// volumen relativo entre TODAS las elegibles (no solo entre las 1.000 de mayor volumen en dólares del año).
// Guarda la selección en data/inplay-paper/{día}.json y completa open5 y min. Reanudable.
// Uso: npx tsx research/orb/fetch-paper.ts [desde=2021-01-01] [hasta=2026-10-30] [top=20]
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR as ROOT, type Bar, dailyFor, minuteBars, openingBars, save, tradableAssets, tradingDays } from './fetch';

const FROM = process.argv[2] ?? '2021-01-01';
const TO = process.argv[3] ?? '2026-10-30';
const TOP = Number(process.argv[4] ?? 20);

interface DayStats {
  avgVol: number;
  atr: number;
  close: number;
}

/** Por símbolo: estadísticas al cierre de cada día (para usarlas el día siguiente). */
function statsOf(sym: string): Map<string, DayStats> {
  const f = join(ROOT, 'daily', `${sym}.json`);
  const out = new Map<string, DayStats>();
  if (!existsSync(f)) return out;
  const bars = JSON.parse(readFileSync(f, 'utf8')) as Bar[];
  for (let i = 14; i < bars.length; i++) {
    const w = bars.slice(i - 13, i + 1);
    let vol = 0;
    let tr = 0;
    for (let j = 0; j < w.length; j++) {
      vol += w[j].v;
      const pc = bars[i - 13 + j - 1].c;
      tr += Math.max(w[j].h - w[j].l, Math.abs(w[j].h - pc), Math.abs(w[j].l - pc));
    }
    out.set(bars[i].t.slice(0, 10), { avgVol: vol / 14, atr: tr / 14, close: bars[i].c });
  }
  return out;
}

async function main() {
  mkdirSync(join(ROOT, 'inplay-paper'), { recursive: true });
  const assets = tradableAssets();
  console.log(`${assets.length} símbolos operables (sin fondos)`);
  const days = await tradingDays(FROM, TO);
  const firstYear = Number(days[0].slice(0, 4));
  await dailyFor(assets, `${firstYear - 1}-11-01`, TO);
  console.log('diarias completas; calculando elegibles por día');
  // Elegibles por día: con las estadísticas del día hábil anterior.
  const eligible = new Map<string, string[]>();
  let loaded = 0;
  for (const sym of assets) {
    const st = statsOf(sym);
    if (!st.size) continue;
    let prev: DayStats | undefined;
    for (const day of days) {
      if (prev && prev.avgVol >= 1e6 && prev.atr > 0.5 && prev.close > 5) (eligible.get(day) ?? eligible.set(day, []).get(day)!).push(sym);
      prev = st.get(day) ?? prev;
    }
    if (++loaded % 1000 === 0) console.log(`estadísticas: ${loaded}/${assets.length}`);
  }
  const sizes = days.map((d) => eligible.get(d)?.length ?? 0);
  console.log(`elegibles por día: mín ${Math.min(...sizes)}, prom ${Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length)}, máx ${Math.max(...sizes)}`);
  const history = new Map<string, number[]>();
  let done = 0;
  for (const day of days) {
    const syms = eligible.get(day) ?? [];
    const open = await openingBars(day, syms);
    const ranked: Array<{ sym: string; rvol: number }> = [];
    for (const sym of syms) {
      const b = open[sym];
      if (!b) continue;
      const h = history.get(sym) ?? [];
      if (h.length >= 5 && b.o > 5) {
        const avg = h.reduce((a, v) => a + v, 0) / h.length;
        if (avg > 0 && b.v / avg >= 1) ranked.push({ sym, rvol: b.v / avg });
      }
      h.push(b.v);
      if (h.length > 14) h.shift();
      history.set(sym, h);
    }
    ranked.sort((a, b) => b.rvol - a.rvol);
    const top = ranked.slice(0, TOP);
    save(join(ROOT, 'inplay-paper', `${day}.json`), top);
    if (top.length) await minuteBars(day, top.map((x) => x.sym));
    if (++done % 20 === 0) console.log(`${day}: ${done}/${days.length} días; elegibles ${syms.length}; en juego: ${top.slice(0, 5).map((x) => `${x.sym} ${x.rvol.toFixed(1)}x`).join(', ')}`);
  }
  console.log('listo');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
