import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/engine';
import { dayHeat, lastTradingDay, MarketSim, seedForDay } from '../src/sim/simulator';
import { etParts, etWallToTs, volumeIntensity } from '../src/engine/time';
import type { Alert } from '../src/engine/types';

const FRIDAY = Date.parse('2026-10-23T15:00:00Z');

/** Arma el mercado con la cinta empezando a `start` (minutos ET) y lo avanza en vivo hasta `until`. */
function market(seed: number, start: number, until = start, only?: string[]) {
  const engine = new Engine({ allSecBars: true });
  const sim = new MarketSim((ev) => engine.ingest(ev), { seed, dayTs: FRIDAY, startMinutes: start });
  engine.setReference(sim.refs);
  if (only) sim.only = new Set(only);
  engine.warmup = true;
  sim.warmup();
  engine.tick(sim.now);
  engine.warmup = false;
  const target = sim.dayStart + (until - 240) * 60_000;
  while (sim.now < target) {
    sim.advance(Math.min(5000, target - sim.now));
    engine.tick(sim.now);
  }
  return { sim, engine };
}

describe('simulador + motor', () => {
  it('genera un día de demo con gappers, alertas, halts y noticias', () => {
    const engine = new Engine();
    const sim = new MarketSim((ev) => engine.ingest(ev), { seed: 42, dayTs: Date.parse('2026-10-23T15:00:00Z') });
    engine.setReference(sim.refs);
    engine.warmup = true;
    sim.warmup();
    engine.warmup = false;
    const live: Alert[] = [];
    engine.onAlert((a) => live.push(a));
    for (let i = 0; i < 45 * 60; i++) {
      sim.advance(1000);
      engine.tick(sim.now);
      if (i % 60 === 0) engine.view();
    }
    const view = engine.view();
    expect(view.session).toBe('regular');
    expect(view.scanners.gappers.length).toBeGreaterThan(3);
    expect(view.scanners.pillars.length).toBeGreaterThan(0);
    const types = new Set(live.map((a) => a.type));
    for (const t of ['hod', 'squeeze', 'news', 'halt', 'resume'] as const) expect(types).toContain(t);
    expect(engine.news.length).toBeGreaterThan(5);
    // Las alertas del pre-market quedaron marcadas como historial.
    expect(engine.alerts.some((a) => a.warmup)).toBe(true);
    expect(live.every((a) => !a.warmup)).toBe(true);
  });

  it('con la misma semilla reanuda el mismo mercado aunque avance en tramos distintos', () => {
    const opts = { seed: 7, dayTs: Date.parse('2026-10-23T15:00:00Z'), startMinutes: 9 * 60 + 25 };
    const run = (chunks: number[]) => {
      const engine = new Engine({ allSecBars: true });
      const sim = new MarketSim((ev) => engine.ingest(ev), opts);
      engine.setReference(sim.refs);
      sim.warmup();
      for (const ms of chunks) {
        sim.advance(ms);
        engine.tick(sim.now);
      }
      const top = engine.view().scanners.gappers.slice(0, 5);
      return { now: sim.now, top: top.map((r) => [r.sym, r.price, r.volume]) };
    };
    // En vivo: pasos chicos e irregulares (el reloj real); al reanudar: tramos de 5 minutos.
    const live = run(Array.from({ length: 2400 }, (_, i) => (i % 3 === 0 ? 70 : 115) * 5));
    const total = live.now - run([]).now;
    const resumed = run([5 * 60_000, 5 * 60_000, total - 10 * 60_000]);
    expect(resumed.now).toBe(live.now);
    expect(resumed.top).toEqual(live.top);
  });

  it('usa el último día hábil (un sábado simula el viernes)', () => {
    expect(lastTradingDay(Date.parse('2026-10-24T15:00:00Z'))).toEqual({ y: 2026, mo: 10, d: 23 });
  });
});

describe('el mismo mercado a cualquier hora', () => {
  it('a las 11:00 es igual si empezaste a las 10:30, a las 10:50 o recién a las 11:00', () => {
    const a = market(7, 10 * 60 + 30, 11 * 60);
    const b = market(7, 10 * 60 + 50, 11 * 60);
    const c = market(7, 11 * 60);
    expect(b.sim.now).toBe(a.sim.now);
    expect(c.sim.now).toBe(a.sim.now);
    expect(b.sim.pathPrices()).toEqual(a.sim.pathPrices());
    expect(c.sim.pathPrices()).toEqual(a.sim.pathPrices());
    const news = (e: Engine) => e.news.map((n) => `${n.ts} ${n.headline}`).sort();
    expect(news(c.engine)).toEqual(news(a.engine));
  }, 20_000);

  it('publicando solo tus acciones (al ponerse al día) el resto sigue el mismo camino', () => {
    const full = market(11, 9 * 60 + 30, 10 * 60 + 30);
    const sym = full.sim.refs[40].sym;
    const only = market(11, 9 * 60 + 30, 10 * 60 + 30, [sym]);
    expect(only.sim.pathPrices()).toEqual(full.sim.pathPrices());
    const traded = only.engine.view().stats;
    expect(traded.tracked).toBeGreaterThan(0);
    const other = full.sim.refs.find((r) => r.sym !== sym && (full.engine.get(r.sym)?.tape.length ?? 0) > 0)!;
    expect(only.engine.get(other.sym)?.tape.length ?? 0).toBe(0);
  }, 20_000);
});

describe('velas de 10 segundos con historia', () => {
  it('las acciones en juego arrancan con velas de 10 s de las últimas dos horas', () => {
    const { engine } = market(42, 9 * 60 + 29);
    const top = engine.view().scanners.gappers[0];
    const st = engine.get(top.sym)!;
    expect(st.secBars.length).toBeGreaterThan(300);
    // Desde que empezó a moverse (o desde dos horas antes del inicio, lo que sea más tarde).
    expect(st.secBars[0].t).toBeLessThanOrEqual(etWallToTs(2026, 10, 23, 9 * 60));
    // Las velas de 1 minuto se arman con las de 10 s: el mismo volumen por minuto.
    const minute = st.bars.find((b) => b.t === etWallToTs(2026, 10, 23, 9 * 60))!;
    const fromSec = st.secBars.filter((b) => b.t >= minute.t && b.t < minute.t + 60_000).reduce((v, b) => v + b.v, 0);
    expect(fromSec).toBe(minute.v);
  }, 20_000);
});

describe('volumen por hora', () => {
  it('curva en U: la apertura es lo más fuerte, el mediodía flojo y el after-hours muy fino', () => {
    expect(volumeIntensity(9 * 60 + 35)).toBeGreaterThan(2);
    expect(volumeIntensity(12 * 60 + 30)).toBeLessThan(0.7);
    expect(volumeIntensity(15 * 60 + 45)).toBeGreaterThan(volumeIntensity(12 * 60 + 30) * 2);
    expect(volumeIntensity(15 * 60 + 45)).toBeLessThan(volumeIntensity(9 * 60 + 35));
    expect(volumeIntensity(16 * 60 + 30)).toBeLessThan(0.2);
    expect(volumeIntensity(18 * 60)).toBeLessThan(volumeIntensity(16 * 60 + 30));
    expect(volumeIntensity(5 * 60)).toBeLessThan(0.02);
    expect(volumeIntensity(20 * 60)).toBe(0);
  });

  it('las acciones tranquilas operan según la hora y el día sigue hasta el fin del after-hours', () => {
    const { sim, engine } = market(42, 19 * 60 + 50);
    // Las grandes (las primeras del universo) no tienen noticias que las muevan: siguen la curva.
    const large = sim.refs.slice(0, 18).map((r) => r.sym);
    const perMinute = (m0: number, m1: number) => {
      let v = 0;
      for (const sym of large) for (const b of engine.get(sym)!.bars) if (etParts(b.t).minutes >= m0 && etParts(b.t).minutes < m1) v += b.v;
      return v / (m1 - m0);
    };
    const open = perMinute(9 * 60 + 30, 10 * 60);
    const noon = perMinute(12 * 60, 13 * 60);
    const after = perMinute(17 * 60, 19 * 60 + 30);
    expect(open).toBeGreaterThan(noon * 2);
    expect(perMinute(4 * 60, 7 * 60)).toBeLessThan(noon * 0.05);
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(noon * 0.1);
    expect(etParts(sim.postTs).h).toBe(20);
  }, 20_000);
});

describe('días distintos', () => {
  it('hay días fríos, normales y calientes, y los calientes traen más gappers', () => {
    const heats = Array.from({ length: 40 }, (_, i) => dayHeat(i + 1));
    for (const h of ['cold', 'normal', 'hot'] as const) expect(heats).toContain(h);
    const seeds = (h: string) => heats.map((x, i) => (x === h ? i + 1 : 0)).filter(Boolean).slice(0, 2);
    const gappers = (h: string) =>
      seeds(h).reduce((n, seed) => {
        const { sim, engine } = market(seed, 9 * 60 + 29);
        expect(sim.heat).toBe(h);
        return n + engine.view().scanners.gappers.filter((r) => r.gapPct >= 20).length;
      }, 0);
    expect(gappers('hot')).toBeGreaterThan(gappers('cold') * 1.5);
  }, 20_000);

  it('después de un fin de semana o un feriado se juntan noticias; los días de cierre anticipado terminan antes', () => {
    const day = (d: string) => new MarketSim(() => {}, { seed: 1, dayTs: Date.parse(`${d}T16:00:00Z`) });
    expect(day('2026-10-26').afterBreak).toBe(true); // lunes
    expect(day('2026-10-27').afterBreak).toBe(false);
    expect(day('2026-01-20').afterBreak).toBe(true); // martes después del feriado de MLK
    const half = day('2026-11-27');
    expect(etParts(half.closeTs).h).toBe(13);
    expect(etParts(half.postTs).h).toBe(17);
  });

  it('una oferta de acciones hunde a la acción que venía subiendo', () => {
    const { engine } = market(42, 16 * 60 + 50);
    const offers = engine.news.filter((n) => n.sentiment === 'bearish' && /Offering|Placement/.test(n.headline) && etParts(n.ts).minutes >= 9 * 60 + 30);
    expect(offers.length).toBeGreaterThan(0);
    for (const n of offers) {
      const bars = engine.get(n.symbols[0])!.bars;
      const hi = Math.max(...bars.filter((b) => b.t >= n.ts - 3 * 60_000 && b.t <= n.ts).map((b) => b.h));
      const lo = Math.min(...bars.filter((b) => b.t >= n.ts && b.t < n.ts + 6 * 60_000).map((b) => b.l));
      expect(lo / hi).toBeLessThan(0.88);
    }
  }, 20_000);

  it('en el after-hours salen balances que mueven a la acción', () => {
    const { engine } = market(42, 19 * 60);
    // Es octubre: se reporta el tercer trimestre.
    const earnings = engine.news.filter((n) => etParts(n.ts).minutes >= 16 * 60 && /Third Quarter (Revenue|Results)|Profit in Third Quarter/.test(n.headline));
    expect(earnings.length).toBeGreaterThan(0);
    const n = earnings[0];
    const bars = engine.get(n.symbols[0])!.bars.filter((b) => b.t >= n.ts && b.t < n.ts + 20 * 60_000);
    expect(Math.max(...bars.map((b) => b.h)) / bars[0].o).toBeGreaterThan(1.1);
  }, 20_000);

  it('"Mercado ahora": la semilla sale de la fecha (el mismo mercado para todos ese día)', () => {
    expect(seedForDay('2026-10-26')).toBe(seedForDay('2026-10-26'));
    expect(seedForDay('2026-10-26')).not.toBe(seedForDay('2026-10-27'));
  });
});

