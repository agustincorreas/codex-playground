import { describe, expect, it } from 'vitest';
import { Engine, mergeDetail } from '../src/engine/engine';
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
    expect(st.volumeScale).toBe(1); // sin vela consolidada del minuto no hay calibración
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

  it('las velas de 10 s se completan hacia atrás y, tras una caída, rellenan el hueco del medio', () => {
    const engine = new Engine({ accept: () => true });
    engine.setReference([{ sym: 'RUNR', prevClose: 2 }]);
    engine.ingest({ kind: 'trade', sym: 'RUNR', ts: 1_000_000, price: 3, size: 100, updatesPrice: true });
    const sec = (ts: number, c: number): Bar => ({ t: ts, o: c, h: c, l: c, c, v: 10, pv: c * 10, n: 1 });
    engine.setSecBars('RUNR', [sec(900_000, 2.9), sec(910_000, 2.95), sec(1_000_000, 3)]);
    const st = engine.get('RUNR')!;
    expect(st.secBars.map((b) => b.t)).toEqual([900_000, 910_000, 1_000_000]);
    // Prepend no toca lo que ya hay ni rellena huecos; merge sí (y reemplaza la del mismo instante).
    engine.setSecBars('RUNR', [sec(950_000, 2.97)]);
    expect(st.secBars.map((b) => b.t)).toEqual([900_000, 910_000, 1_000_000]);
    engine.mergeSecBars('RUNR', [sec(950_000, 2.97), sec(910_000, 2.96)]);
    expect(st.secBars.map((b) => [b.t, b.c])).toEqual([
      [900_000, 2.9],
      [910_000, 2.96],
      [950_000, 2.97],
      [1_000_000, 3],
    ]);
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
    engine.applyDelayed([{ sym: 'RUNR', ts: t(9 * 60 + 36, 59), last: 3, high: 3, low: 3, volume: 2_000, minute: { t: t(9 * 60 + 36), o: 3, h: 3, l: 3, c: 3, v: 2_000, pv: 6_000, n: 20 } }]);
    engine.ingest({ kind: 'trade', sym: 'RUNR', ts: t(9 * 60 + 38, 10), price: 3, size: 50 });
    engine.tick(now);
    const st = engine.get('RUNR')!;
    expect(st.volumeScale).toBe(20);
    // 5 minutos promedio = 390_000 / 390 * 5 = 5_000. Estimado: 2_000 (consolidado) + 50 × 20 = 3_000.
    expect(engine.row('RUNR')!.rvol5m).toBeCloseTo(3000 / 5000, 5);
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


describe('motor: correcciones de la auditoría', () => {
  it('un agregado con volumen del día pero sin VWAP del día no diluye el VWAP', () => {
    const { engine, trade } = setup();
    trade(at(9, 31), 3.0, 1000);
    engine.ingest({ kind: 'bar', span: 'second', sym: 'TEST', ts: at(9, 45), o: 3.1, h: 3.12, l: 3.1, c: 3.11, v: 500, vw: 3.11, dayVolume: 250_000 });
    const st = engine.get('TEST')!;
    expect(st.volume).toBe(250_000);
    expect(st.vwap).toBeCloseTo(3.0, 6);
  });

  it('el volumen de 5 minutos cuenta 5 velas, no 6', () => {
    const { engine, trade } = setup();
    for (let i = 0; i < 10; i++) trade(at(10, i), 2, 1000);
    const st = engine.get('TEST')!;
    expect(st.volumeSince(at(10, 9, 30), 5)).toBe(5000);
  });

  it('un snapshot con mínimo 0 no clava el mínimo del día en cero', () => {
    const { engine, trade } = setup();
    trade(at(9, 31), 2.0);
    engine.applySnapshot([{ sym: 'TEST', ts: at(9, 31), last: 2.0, prevClose: 2, volume: 1000, high: 2.1, low: 0 }]);
    expect(engine.get('TEST')!.lod).toBe(2.0);
  });

  it('el máximo cargado desde velas históricas lleva su hora (no suena "cerca del máximo" enseguida)', () => {
    const { engine, trade } = setup();
    trade(at(10, 0), 2.0);
    const bars: Bar[] = [];
    for (let i = 0; i < 10; i++) bars.push({ t: at(9, 31 + i), o: 2, h: i === 9 ? 2.5 : 2.1, l: 1.9, c: 2, v: 1000, pv: 2000, n: 1 });
    engine.setBars('TEST', bars);
    const st = engine.get('TEST')!;
    expect(st.hod).toBe(2.5);
    expect(st.hodTs).toBe(at(9, 41) - 1);
  });
});

describe('motor: mejoras tras la auditoría', () => {
  it('detail(sym, since) manda solo lo nuevo y la fusión de dos parciales reproduce la ficha completa', () => {
    const { engine, trade } = setup();
    for (let i = 0; i < 6; i++) {
      trade(at(9, 31 + i, 5), 2 + i * 0.01, 1000);
      trade(at(9, 31 + i, 35), 2.005 + i * 0.01, 500);
    }
    engine.setWatchlist(['TEST']); // con la acción seguida se arman las velas de 10 s y la cinta
    const first = engine.detail('TEST')!;
    expect(first.since).toBeUndefined();
    expect(first.bars).toHaveLength(6);
    const lastT = first.bars[first.bars.length - 1].t;
    const lastSeq = first.tape.length ? first.tape[first.tape.length - 1].seq : 0;
    // Pasa un rato: la vela actual cambia y aparecen dos velas nuevas con sus prints.
    trade(at(9, 36, 50), 2.07, 300);
    trade(at(9, 37, 10), 2.08, 400);
    const p1 = engine.detail('TEST', lastT, lastSeq)!;
    expect(p1.since).toBe(lastT);
    expect(p1.bars.map((b) => b.t)).toEqual([at(9, 36), at(9, 37)]);
    expect(p1.bars[0].v).toBe(1800);
    expect(p1.secBars.every((b) => b.t >= lastT)).toBe(true);
    expect(p1.tape.every((x) => x.seq > lastSeq)).toBe(true);
    expect(p1.tape).toHaveLength(2);
    trade(at(9, 38, 10), 2.09, 100);
    const p2 = engine.detail('TEST', p1.bars[p1.bars.length - 1].t, p1.tape[p1.tape.length - 1].seq)!;
    expect(p2.bars.map((b) => b.t)).toEqual([at(9, 37), at(9, 38)]);
    const merged = mergeDetail(mergeDetail(first, p1), p2)!;
    const full = engine.detail('TEST')!;
    expect(merged.since).toBeUndefined();
    expect(merged.bars).toEqual(full.bars);
    expect(merged.secBars).toEqual(full.secBars);
    expect(merged.tape).toEqual(full.tape);
    expect(merged.row).toEqual(full.row);
    // Un parcial sin base no se puede aplicar; una ficha completa reemplaza.
    expect(mergeDetail(null, p2)).toBeNull();
    expect(mergeDetail(first, full)).toBe(full);
    // Una vela vieja que cambia (consolidada atrasada) sube la revisión: el servidor manda el día entero.
    const rev = engine.get('TEST')!.barsRev;
    engine.applyDelayed([{ sym: 'TEST', ts: at(9, 33, 59), last: 2.02, high: 2.1, low: 2, volume: 0, minute: { t: at(9, 33), o: 2.02, h: 2.1, l: 2, c: 2.03, v: 9000, pv: 18_270, n: 30 } }]);
    expect(engine.get('TEST')!.barsRev).toBeGreaterThan(rev);
  });

  it('newDay deja a cada símbolo de cero conservando los datos de referencia (en demo, el último precio es el cierre anterior)', () => {
    const { engine, alerts, trade } = setup({ float: 100_000 });
    const nextDay = etWallToTs(2026, 10, 26, 4 * 60);
    trade(at(9, 35), 2.0, 60_000);
    trade(at(9, 36), 2.4, 60_000);
    engine.ingest({ kind: 'status', sym: 'TEST', ts: at(9, 37), halted: true, reason: 'LUDP' });
    engine.tick(at(9, 40));
    engine.view();
    const before = engine.get('TEST')!;
    expect(before.hod).toBe(2.4);
    expect(before.rotationLevel).toBe(1);
    expect(before.memo.size).toBeGreaterThan(0);
    expect(alerts.length).toBeGreaterThan(0);
    expect(engine.view().halts).toHaveLength(1);
    // Dos noticias: una del domingo a la noche (sigue vigente el lunes) y una del viernes (ya no).
    engine.ingest({ kind: 'news', item: { id: 'n1', ts: at(9, 0), headline: 'Test Co Announces FDA Approval', symbols: ['TEST'] } });
    engine.ingest({ kind: 'news', item: { id: 'n2', ts: nextDay - 19 * 3_600_000, headline: 'Test Co Signs Distribution Deal', symbols: ['TEST'] } });
    engine.newDay(nextDay, true);
    const st = engine.get('TEST')!;
    expect(st).not.toBe(before);
    expect(st.ref.float).toBe(100_000);
    expect(st.ref.avgVolume).toBe(1_000_000);
    expect(st.prevClose).toBe(2.4);
    expect(st.ref.prevClose).toBe(2.4);
    expect(st.hod).toBe(0);
    expect(st.volume).toBe(0);
    expect(st.bars).toHaveLength(0);
    expect(st.halted).toBe(false);
    expect(st.memo.size).toBe(0);
    expect(st.rotationLevel).toBe(0);
    expect(st.inGappers).toBe(false);
    expect(st.pmHigh).toBe(0);
    expect(engine.alerts).toHaveLength(0);
    expect(engine.view().halts).toHaveLength(0);
    expect(engine.session).toBe('pre');
    // La noticia de hace 19 h sigue dentro de la ventana de 24 h; la del viernes, no.
    expect(st.news.map((n) => n.id)).toEqual(['n2']);
    expect(engine.news.map((n) => n.id)).toEqual(['n2']);
    // Sin demo, el cierre anterior se conserva tal cual.
    const other = setup();
    other.trade(at(9, 35), 3.0, 1000);
    other.engine.newDay(nextDay);
    expect(other.engine.get('TEST')!.prevClose).toBe(2);
  });

  it('un print 8 minutos atrasado va a su vela (o abre una) y suma al volumen del día', () => {
    const { engine, trade } = setup();
    for (let i = 0; i < 10; i++) trade(at(10, i), 2, 1000);
    const st = engine.get('TEST')!;
    expect(st.volume).toBe(10_000);
    // A una vela que existe: 10:01, ocho minutos antes de la última (10:09).
    trade(at(10, 1, 30), 2.5, 700);
    expect(st.bars).toHaveLength(10);
    expect(st.bars[1]).toMatchObject({ t: at(10, 1), v: 1700, h: 2.5, c: 2 });
    expect(st.volume).toBe(10_700);
    expect(st.last).toBe(2.5); // el precio sí se actualiza (el feed lo manda como print nuevo)
    // A un minuto sin vela (9:55): se inserta en su lugar, en orden.
    trade(at(9, 55, 10), 1.9, 300);
    expect(st.bars).toHaveLength(11);
    expect(st.bars[0]).toMatchObject({ t: at(9, 55), v: 300, o: 1.9 });
    expect(st.bars.every((b, i) => i === 0 || b.t > st.bars[i - 1].t)).toBe(true);
    expect(st.volume).toBe(11_000);
    // La suma de las velas sigue siendo el volumen del día.
    expect(st.bars.reduce((v, b) => v + b.v, 0)).toBe(st.volume);
    // Lo mismo con las velas de 10 s (la acción seguida las arma).
    engine.setWatchlist(['TEST']);
    trade(at(10, 10, 0), 2, 100);
    trade(at(10, 10, 20), 2, 100);
    trade(at(10, 10, 5), 2, 50);
    expect(st.secBars.map((b) => [b.t, b.v])).toEqual([
      [at(10, 10, 0), 150],
      [at(10, 10, 20), 100],
    ]);
    // Tras el print atrasado, los cierres de velas nuevas siguen bien (el índice de cierre no se desfasa).
    const closedBefore = st.lastClosedBarT;
    trade(at(10, 11), 2, 100);
    expect(st.lastClosedBarT).toBe(at(10, 10));
    expect(closedBefore).toBe(at(10, 9));
  });

  it('volumePerMinute reparte las últimas velas en los minutos reales que abarcan (acción fina)', () => {
    const { engine, trade } = setup();
    // Opera cada 5 minutos: 5 velas cerradas de 1.000 acciones cubren 21 minutos.
    for (const m of [0, 5, 10, 15, 20]) trade(at(10, m), 2, 1000);
    trade(at(10, 25), 2, 1000);
    const st = engine.get('TEST')!;
    expect(st.volumePerMinute()).toBeCloseTo(5000 / 21, 6);
    expect(engine.quote('TEST')!.volPerMin).toBeCloseTo(5000 / 21, 6);
    // Una acción que opera todos los minutos: el promedio de siempre.
    const dense = setup();
    for (let i = 0; i < 7; i++) dense.trade(at(11, i), 2, 1000 + i * 100);
    expect(dense.engine.get('TEST')!.volumePerMinute()).toBeCloseTo((1100 + 1200 + 1300 + 1400 + 1500) / 5, 6);
  });

  it('la calibración de la escala ignora velas con menos de 100 acciones y promedia todas las muestras', () => {
    const engine = new Engine({ allSecBars: true });
    engine.setReference([{ sym: 'RUNR', prevClose: 2, avgVolume: 390_000 }]);
    const t = (m: number, s = 0) => etWallToTs(2026, 10, 23, m) + s * 1000;
    const minute = (m: number, v: number) => ({ t: t(m), o: 3, h: 3, l: 3, c: 3, v, pv: 3 * v, n: 10 });
    engine.ingest({ kind: 'trade', sym: 'RUNR', ts: t(9 * 60 + 30, 5), price: 3, size: 20 });
    engine.ingest({ kind: 'trade', sym: 'RUNR', ts: t(9 * 60 + 31, 5), price: 3, size: 200 });
    engine.ingest({ kind: 'trade', sym: 'RUNR', ts: t(9 * 60 + 32, 5), price: 3, size: 100 });
    const st = engine.get('RUNR')!;
    // 20 acciones en el feed: la relación (100x) sería ruido y no cuenta.
    engine.applyDelayed([{ sym: 'RUNR', ts: t(9 * 60 + 30, 59), last: 3, high: 3, low: 3, volume: 0, minute: minute(9 * 60 + 30, 2000) }]);
    expect(st.scaleSamples).toBe(0);
    expect(st.volumeScale).toBe(1);
    engine.applyDelayed([{ sym: 'RUNR', ts: t(9 * 60 + 31, 59), last: 3, high: 3, low: 3, volume: 0, minute: minute(9 * 60 + 31, 2000) }]);
    expect(st.scaleSamples).toBe(1);
    expect(st.volumeScale).toBe(10);
    engine.applyDelayed([{ sym: 'RUNR', ts: t(9 * 60 + 32, 59), last: 3, high: 3, low: 3, volume: 0, minute: minute(9 * 60 + 32, 3000) }]);
    expect(st.scaleSamples).toBe(2);
    expect(st.volumeScale).toBe((10 + 30) / 2);
    // La vela consolidada se ubicó con findBarAt (sin recorrer el día).
    expect(st.findBarAt(t(9 * 60 + 31))).toBe(1);
    expect(st.findBarAt(t(9 * 60 + 29))).toBe(-1);
    expect(st.bars[1].v).toBe(2000);
  });

  it('los indicadores incrementales coinciden con las series en lote, también tras un relleno', () => {
    const { engine, trade } = setup();
    for (let i = 0; i < 40; i++) trade(at(10, i), 2 + Math.sin(i / 3) * 0.2, 1000);
    const st = engine.get('TEST')!;
    const closes = () => st.bars.map((b) => b.c);
    const check = () => {
      const c = closes();
      const closed = c.slice(0, -1);
      expect(st.lastClosedBarT).toBe(st.bars[st.bars.length - 2].t);
      expect(st.ema9.value).toBeCloseTo(emaSeries(closed, 9)[closed.length - 1], 10);
      expect(st.ema20.value).toBeCloseTo(emaSeries(closed, 20)[closed.length - 1], 10);
      expect(st.ema9.peek(st.last)).toBeCloseTo(emaSeries(c, 9)[c.length - 1], 10);
      const m = macdSeries(c);
      const live = st.macd.peek(st.last);
      expect(live.macd).toBeCloseTo(m.macd[c.length - 1], 10);
      expect(live.signal).toBeCloseTo(m.signal[c.length - 1], 10);
      expect(live.hist).toBeCloseTo(m.hist[c.length - 1], 10);
    };
    check();
    // Relleno con velas consolidadas distintas: resetIndicators recalcula y vuelve a coincidir.
    const bars: Bar[] = [];
    for (let i = 5; i < 15; i++) bars.push({ t: at(10, i), o: 2, h: 2.3, l: 1.9, c: 2.1 + i * 0.01, v: 5000, pv: 10_500, n: 20 });
    engine.mergeBars('TEST', bars);
    expect(st.bars[5].c).toBe(2.15);
    check();
    for (let i = 40; i < 45; i++) trade(at(10, i), 2.1, 1000);
    check();
  });
});
