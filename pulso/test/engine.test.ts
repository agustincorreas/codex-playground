import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/engine';
import { aggregateBars, emaSeries, macdSeries, vwapSeries } from '../src/engine/indicators';
import { etWallToTs } from '../src/engine/time';
import type { Alert, Bar } from '../src/engine/types';

// Viernes 23/10/2026 (día hábil, horario de verano: ET = UTC−4).
const at = (h: number, m: number, s = 0) => etWallToTs(2026, 10, 23, h * 60 + m + s / 60);
const MIN = 60_000;

function setup(extra: Partial<{ prevClose: number; float: number; avgVolume: number }> = {}) {
  const engine = new Engine();
  engine.setReference([{ sym: 'TEST', prevClose: extra.prevClose ?? 2, avgVolume: extra.avgVolume ?? 1_000_000, float: extra.float ?? 5_000_000 }]);
  const alerts: Alert[] = [];
  engine.onAlert((a) => alerts.push(a));
  const trade = (ts: number, price: number, size = 1000) => engine.ingest({ kind: 'trade', sym: 'TEST', ts, price, size });
  return { engine, alerts, trade };
}

describe('motor: precio, volumen y VWAP', () => {
  it('acumula volumen, VWAP, máximo del día y % de cambio', () => {
    const { engine, trade } = setup();
    trade(at(9, 31), 2.0, 1000);
    trade(at(9, 31, 20), 2.2, 3000);
    trade(at(9, 32), 2.1, 1000);
    const st = engine.get('TEST')!;
    expect(st.volume).toBe(5000);
    expect(st.vwap).toBeCloseTo((2.0 * 1000 + 2.2 * 3000 + 2.1 * 1000) / 5000, 6);
    expect(st.hod).toBe(2.2);
    expect(st.changePct).toBeCloseTo(5, 6);
    expect(st.bars).toHaveLength(2);
    expect(st.bars[0]).toMatchObject({ o: 2.0, h: 2.2, l: 2.0, c: 2.2, v: 4000 });
  });

  it('la vela oficial de 1 minuto reemplaza a la propia y corrige el volumen del día', () => {
    const { engine, trade } = setup();
    trade(at(9, 40, 5), 2.0, 600);
    trade(at(9, 40, 30), 2.05, 400);
    engine.ingest({ kind: 'bar', span: 'minute', sym: 'TEST', ts: at(9, 40), o: 2.0, h: 2.06, l: 1.99, c: 2.05, v: 1500, vw: 2.03 });
    const st = engine.get('TEST')!;
    expect(st.volume).toBe(1500);
    expect(st.bars).toHaveLength(1);
    expect(st.bars[0].h).toBe(2.06);
    expect(st.vwap).toBeCloseTo(2.03, 6);
  });

  it('los agregados por segundo usan el volumen acumulado del proveedor', () => {
    const { engine } = setup();
    engine.ingest({ kind: 'bar', span: 'second', sym: 'TEST', ts: at(9, 45), o: 2.1, h: 2.12, l: 2.1, c: 2.11, v: 500, vw: 2.11, dayVolume: 250_000, dayVwap: 2.05 });
    const st = engine.get('TEST')!;
    expect(st.volume).toBe(250_000);
    expect(st.vwap).toBeCloseTo(2.05, 6);
    expect(st.last).toBe(2.11);
  });

  it('los prints que no actualizan precio suman volumen pero no mueven el máximo', () => {
    const { engine, trade } = setup();
    trade(at(9, 50), 2.0);
    engine.ingest({ kind: 'trade', sym: 'TEST', ts: at(9, 50, 5), price: 3.5, size: 50, updatesPrice: false });
    const st = engine.get('TEST')!;
    expect(st.hod).toBe(2.0);
    expect(st.volume).toBe(1050);
  });
});

describe('motor: pilares y escáneres', () => {
  it('calcula los 5 pilares y arma las listas', () => {
    const { engine, trade } = setup();
    engine.ingest({ kind: 'news', item: { id: 'n1', ts: at(9, 0), headline: 'Test Co Announces FDA Approval', symbols: ['TEST'] } });
    for (let i = 0; i < 20; i++) trade(at(9, 31 + i), 2 + i * 0.03, 20_000);
    engine.tick(at(9, 51));
    const view = engine.view();
    const row = view.scanners.gappers.find((r) => r.sym === 'TEST')!;
    expect(row).toBeDefined();
    expect(row.changePct).toBeGreaterThan(25);
    expect(row.pillars).toMatchObject({ price: true, change: true, news: true, float: true });
    // 400K acciones a las 9:51 contra ~16% de 1M esperable a esa hora → RVOL ≈ 2.5x (no llega a 5x).
    expect(row.rvol).toBeGreaterThan(2);
    expect(row.pillars.rvol).toBe(false);
    expect(row.score).toBe(4);
    expect(view.scanners.pillars.map((r) => r.sym)).toContain('TEST');
  });

  it('el float desconocido queda como dato faltante, no como incumplido', () => {
    const engine = new Engine();
    engine.setReference([{ sym: 'NOFL', prevClose: 3, avgVolume: 500_000 }]);
    engine.ingest({ kind: 'trade', sym: 'NOFL', ts: at(10, 0), price: 3.6, size: 100_000 });
    engine.tick(at(10, 0, 30));
    const row = engine.view().scanners.gappers.find((r) => r.sym === 'NOFL')!;
    expect(row.pillars.float).toBeNull();
  });
});

describe('motor: alertas', () => {
  it('avisa nuevo máximo del día y squeeze', () => {
    const { alerts, trade } = setup();
    trade(at(9, 35), 2.0, 50_000);
    trade(at(9, 36), 2.1, 50_000);
    trade(at(9, 37), 2.2, 50_000);
    trade(at(9, 38), 2.35, 80_000);
    const types = alerts.map((a) => a.type);
    expect(types).toContain('hod');
    expect(types).toContain('squeeze');
    const sq = alerts.find((a) => a.type === 'squeeze')!;
    expect(sq.text).toMatch(/\+10%/);
  });

  it('registra halt y reanudación con la comparación contra el precio del halt', () => {
    const { engine, alerts, trade } = setup();
    trade(at(10, 0), 2.5, 100_000);
    engine.ingest({ kind: 'status', sym: 'TEST', ts: at(10, 1), halted: true, reason: 'LUDP' });
    const view = engine.view();
    expect(view.halts[0]).toMatchObject({ sym: 'TEST', halted: true, reasonText: 'Pausa por volatilidad (LULD)' });
    expect(view.halts[0].resumeTs).toBe(at(10, 6));
    engine.ingest({ kind: 'status', sym: 'TEST', ts: at(10, 6), halted: false, reason: 'LUDP' });
    trade(at(10, 6, 2), 2.75, 50_000);
    const resume = alerts.find((a) => a.type === 'resume')!;
    expect(resume.text).toMatch(/\+10\.0% vs\. precio del halt/);
    expect(engine.view().halts[0].halted).toBe(false);
  });

  it('un halt repetido por el RSS no reabre uno ya reanudado', () => {
    const { engine, trade } = setup();
    trade(at(11, 0), 2.4);
    engine.ingest({ kind: 'status', sym: 'TEST', ts: at(11, 1), halted: true, reason: 'LUDP' });
    engine.ingest({ kind: 'status', sym: 'TEST', ts: at(11, 6), halted: false, reason: 'LUDP' });
    engine.ingest({ kind: 'status', sym: 'TEST', ts: at(11, 1), halted: true, reason: 'LUDP' });
    expect(engine.get('TEST')!.halted).toBe(false);
  });

  it('arma un bull flag y dispara en la primera vela que hace nuevo máximo', () => {
    const { engine, alerts } = setup();
    const bar = (m: number, o: number, h: number, l: number, c: number, v: number) =>
      engine.ingest({ kind: 'bar', span: 'minute', sym: 'TEST', ts: at(9, m), o, h, l, c, v, vw: (h + l + c) / 3 });
    // Base para que el VWAP quede debajo y el motor tenga velas previas.
    bar(31, 2.0, 2.02, 1.99, 2.01, 20_000);
    bar(32, 2.01, 2.03, 2.0, 2.02, 20_000);
    // Palo: tres velas verdes con volumen.
    bar(33, 2.02, 2.12, 2.02, 2.11, 150_000);
    bar(34, 2.11, 2.22, 2.1, 2.21, 160_000);
    bar(35, 2.21, 2.32, 2.2, 2.3, 170_000);
    // Retroceso: dos velas rojas con poco volumen, sin devolver más del 50%.
    bar(36, 2.3, 2.31, 2.24, 2.25, 40_000);
    bar(37, 2.25, 2.27, 2.22, 2.23, 30_000);
    // La vela siguiente abre y supera el máximo de la anterior (2.27).
    engine.ingest({ kind: 'trade', sym: 'TEST', ts: at(9, 38, 5), price: 2.24, size: 5000 });
    expect(engine.detail('TEST')!.setup.flag).toMatchObject({ entry: 2.28, stop: 2.21 });
    engine.ingest({ kind: 'trade', sym: 'TEST', ts: at(9, 38, 20), price: 2.29, size: 20_000 });
    const flag = alerts.find((a) => a.type === 'bullFlag');
    expect(flag).toBeDefined();
    expect(flag!.plan).toMatchObject({ entry: 2.28, stop: 2.21 });
    expect(flag!.plan!.target).toBeCloseTo(2.42, 6);
  });

  it('las alertas de máximo respetan el cooldown', () => {
    const { alerts, trade } = setup();
    trade(at(9, 31), 2.2, 100_000);
    trade(at(9, 32), 2.25, 100_000);
    for (let i = 1; i <= 10; i++) trade(at(9, 32, i), 2.25 + i * 0.001, 1000);
    expect(alerts.filter((a) => a.type === 'hod').length).toBeLessThanOrEqual(2);
  });
});

describe('indicadores', () => {
  const bars: Bar[] = [1, 2, 3, 4, 5].map((c, i) => ({ t: i * MIN, o: c, h: c, l: c, c, v: 10, pv: c * 10, n: 1 }));

  it('EMA, VWAP y MACD', () => {
    const e = emaSeries([1, 2, 3], 2);
    expect(e[0]).toBe(1);
    // k = 2/3: e1 = 2·k + 1·(1−k) = 5/3; e2 = 3·k + e1·(1−k).
    expect(e[1]).toBeCloseTo(5 / 3, 6);
    expect(e[2]).toBeCloseTo(3 * (2 / 3) + (5 / 3) * (1 / 3), 6);
    expect(vwapSeries(bars)[4]).toBeCloseTo(3, 6);
    const m = macdSeries(bars.map((b) => b.c));
    expect(m.macd[4]).toBeGreaterThan(0);
  });

  it('agrega velas de 1 a 5 minutos', () => {
    const agg = aggregateBars(bars, 5);
    expect(agg).toHaveLength(1);
    expect(agg[0]).toMatchObject({ o: 1, h: 5, l: 1, c: 5, v: 50 });
  });
});

describe('motor: feed parcial en vivo + mercado completo demorado', () => {
  const t = (m: number, s = 0) => etWallToTs(2026, 10, 23, m) + s * 1000;
  function make() {
    const engine = new Engine({ allSecBars: true });
    engine.setReference([{ sym: 'RUNR', prevClose: 2, avgVolume: 390_000 }]);
    return engine;
  }

  it('el volumen del día pasa a ser el consolidado más lo del feed después, sin tocar el precio en vivo', () => {
    const engine = make();
    engine.ingest({ kind: 'trade', sym: 'RUNR', ts: t(9 * 60 + 30, 10), price: 3, size: 600 });
    engine.ingest({ kind: 'trade', sym: 'RUNR', ts: t(9 * 60 + 31, 10), price: 3.1, size: 400 });
    const st = engine.get('RUNR')!;
    expect(st.volume).toBe(1000);
    engine.applyDelayed([{ sym: 'RUNR', ts: t(9 * 60 + 30, 59), last: 3.05, high: 3.4, low: 2.9, volume: 30_000, vwap: 3.02 }]);
    expect(st.last).toBe(3.1); // el feed en vivo tiene un print más nuevo: manda
    expect(st.volume).toBe(30_400); // consolidado hasta las 9:30 + lo del feed en 9:31
    expect(st.volumeScale).toBe(50);
    expect(st.hod).toBe(3.4); // el máximo consolidado se completa sin alerta
    expect(st.lod).toBe(2.9);
    // Un tramo consolidado posterior al último print del feed trae el último precio real de ese momento.
    engine.applyDelayed([{ sym: 'RUNR', ts: t(9 * 60 + 31, 59), last: 3.05, high: 3.4, low: 2.9, volume: 50_000, vwap: 3.02 }]);
    expect(st.last).toBe(3.05);
    expect(st.volume).toBe(50_000);
    // Lo que el feed ve después del tramo consolidado se suma.
    engine.ingest({ kind: 'trade', sym: 'RUNR', ts: t(9 * 60 + 33, 5), price: 3.2, size: 100 });
    expect(st.volume).toBe(50_100);
    // Un snapshot viejo no pisa nada; uno más nuevo con menos volumen tampoco baja el total.
    engine.applyDelayed([{ sym: 'RUNR', ts: t(9 * 60 + 31), last: 2, high: 3, low: 2.9, volume: 10 }]);
    expect(st.volume).toBe(50_100);
    engine.applyDelayed([{ sym: 'RUNR', ts: t(9 * 60 + 33, 59), last: 3.15, high: 3.4, low: 2.9, volume: 55_000, vwap: 3.05 }]);
    expect(st.volume).toBe(55_000);
    expect(st.consolidatedTs).toBe(t(9 * 60 + 33, 59));
  });

  it('la vela consolidada del minuto reemplaza a la del feed y calibra la escala (también en pre-market)', () => {
    const engine = make();
    engine.ingest({ kind: 'trade', sym: 'RUNR', ts: t(8 * 60 + 10, 5), price: 3, size: 200 });
    engine.ingest({ kind: 'trade', sym: 'RUNR', ts: t(8 * 60 + 11, 5), price: 3.1, size: 100 });
    // Pre-market: el snapshot demorado todavía no trae volumen del día, pero sí la vela del minuto.
    engine.applyDelayed([{ sym: 'RUNR', ts: t(8 * 60 + 10, 59), last: 3.02, high: 3.05, low: 2.95, volume: 0, minute: { t: t(8 * 60 + 10), o: 2.98, h: 3.05, l: 2.95, c: 3.02, v: 8_000, pv: 24_000, n: 60 } }]);
    const st = engine.get('RUNR')!;
    expect(st.bars.map((b) => [b.t, b.v])).toEqual([
      [t(8 * 60 + 10), 8_000],
      [t(8 * 60 + 11), 100],
    ]);
    expect(st.volume).toBe(8_100);
    expect(st.volumeScale).toBe(40);
    expect(st.lod).toBe(2.95);
  });

  it('una vela consolidada muchos minutos atrás reemplaza a la del feed, sin duplicarla', () => {
    const engine = make();
    for (let i = 0; i < 30; i++) engine.ingest({ kind: 'trade', sym: 'RUNR', ts: t(9 * 60 + 30 + i, 5), price: 3, size: 10 });
    const st = engine.get('RUNR')!;
    expect(st.bars).toHaveLength(30);
    engine.applyDelayed([{ sym: 'RUNR', ts: t(9 * 60 + 44, 59), last: 3, high: 3, low: 3, volume: 0, minute: { t: t(9 * 60 + 44), o: 3, h: 3, l: 3, c: 3, v: 5_000, pv: 15_000, n: 40 } }]);
    expect(st.bars).toHaveLength(30);
    expect(st.bars.filter((b) => b.t === t(9 * 60 + 44)).map((b) => b.v)).toEqual([5_000]);
    expect(st.volume).toBe(29 * 10 + 5_000);
    engine.mergeBars('RUNR', [{ t: t(9 * 60 + 31), o: 3, h: 3.5, l: 3, c: 3, v: 7_000, pv: 21_000, n: 50 }]);
    expect(st.bars).toHaveLength(30);
    expect(st.volume).toBe(28 * 10 + 5_000 + 7_000);
    expect(st.hod).toBe(3.5);
  });

  it('sin calibración propia, la escala arranca en la del feed y la primera muestra la reemplaza', () => {
    const engine = make();
    engine.feedScale = 35;
    engine.ingest({ kind: 'trade', sym: 'RUNR', ts: t(8 * 60 + 12, 5), price: 3, size: 100 });
    engine.applyDelayed([{ sym: 'RUNR', ts: t(8 * 60 + 10, 59), last: 3, high: 3, low: 3, volume: 0 }]);
    const st = engine.get('RUNR')!;
    expect(st.volumeScale).toBe(35);
    expect(st.volumeSinceEstimated(t(8 * 60 + 13), 5)).toBe(3500);
    engine.applyDelayed([{ sym: 'RUNR', ts: t(8 * 60 + 12, 59), last: 3, high: 3, low: 3, volume: 0, minute: { t: t(8 * 60 + 12), o: 3, h: 3, l: 3, c: 3, v: 2_000, pv: 6_000, n: 20 } }]);
    expect(st.volumeScale).toBe(20);
  });

  it('sin prints en el feed, el último precio demorado vale más que nada', () => {
    const engine = make();
    engine.applyDelayed([{ sym: 'RUNR', ts: t(9 * 60 + 40), last: 2.8, high: 2.9, low: 2.1, volume: 120_000, open: 2.3 }]);
    const st = engine.get('RUNR')!;
    expect(st.last).toBe(2.8);
    expect(st.changePct).toBeCloseTo(40);
    expect(st.dayOpen).toBe(2.3);
  });

  it('el volumen de 5 minutos escala lo que vio el feed parcial y respeta lo ya consolidado', () => {
    const engine = make();
    const now = t(9 * 60 + 40, 30);
    engine.ingest({ kind: 'trade', sym: 'RUNR', ts: t(9 * 60 + 36, 10), price: 3, size: 100 });
    engine.applyDelayed([{ sym: 'RUNR', ts: t(9 * 60 + 36, 59), last: 3, high: 3, low: 3, volume: 2_000 }]);
    engine.ingest({ kind: 'trade', sym: 'RUNR', ts: t(9 * 60 + 38, 10), price: 3, size: 50 });
    engine.tick(now);
    const st = engine.get('RUNR')!;
    expect(st.volumeScale).toBe(20);
    // 5 minutos promedio = 390_000 / 390 * 5 = 5_000. Estimado: 100 (consolidado) + 50 × 20 = 1_100.
    expect(engine.row('RUNR')!.rvol5m).toBeCloseTo(1100 / 5000, 5);
  });

  it('las velas consolidadas reemplazan a las del feed y el volumen se recalcula', () => {
    const engine = make();
    engine.ingest({ kind: 'trade', sym: 'RUNR', ts: t(9 * 60 + 30, 10), price: 3, size: 600 });
    engine.ingest({ kind: 'trade', sym: 'RUNR', ts: t(9 * 60 + 50, 10), price: 3.1, size: 400 });
    engine.mergeBars('RUNR', [
      { t: t(9 * 60 + 29), o: 2.9, h: 2.95, l: 2.85, c: 2.9, v: 20_000, pv: 58_000, n: 50 },
      { t: t(9 * 60 + 30), o: 2.9, h: 3.3, l: 2.9, c: 3.2, v: 80_000, pv: 248_000, n: 300 },
    ]);
    const st = engine.get('RUNR')!;
    expect(st.bars.map((b) => [b.t, b.v])).toEqual([
      [t(9 * 60 + 29), 20_000],
      [t(9 * 60 + 30), 80_000],
      [t(9 * 60 + 50), 400],
    ]);
    expect(st.volume).toBe(100_400);
    expect(st.hod).toBe(3.3);
    expect(st.consolidatedTs).toBe(t(9 * 60 + 31) - 1);
  });
});

