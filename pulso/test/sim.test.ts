import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/engine';
import { lastTradingDay, MarketSim } from '../src/sim/simulator';
import type { Alert } from '../src/engine/types';

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
