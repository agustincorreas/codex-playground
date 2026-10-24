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

  it('usa el último día hábil (un sábado simula el viernes)', () => {
    expect(lastTradingDay(Date.parse('2026-10-24T15:00:00Z'))).toEqual({ y: 2026, mo: 10, d: 23 });
  });
});
