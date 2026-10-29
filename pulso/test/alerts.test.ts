// Alertas del motor que no tenían cobertura: cada escenario se arma con prints (`engine.ingest`).
import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/engine';
import { etWallToTs } from '../src/engine/time';
import type { Alert } from '../src/engine/types';

// Viernes 23/10/2026 (día hábil).
const at = (h: number, m: number, s = 0) => etWallToTs(2026, 10, 23, h * 60 + m + s / 60);

function setup(extra: Partial<{ prevClose: number; float: number; avgVolume: number }> = {}) {
  const engine = new Engine();
  engine.setReference([{ sym: 'TEST', prevClose: extra.prevClose ?? 2, avgVolume: extra.avgVolume ?? 1_000_000, float: extra.float ?? 5_000_000 }]);
  const alerts: Alert[] = [];
  engine.onAlert((a) => alerts.push(a));
  const trade = (ts: number, price: number, size = 1000) => engine.ingest({ kind: 'trade', sym: 'TEST', ts, price, size });
  const of = (type: Alert['type']) => alerts.filter((a) => a.type === type);
  return { engine, alerts, trade, of };
}

describe('alertas: VWAP', () => {
  it('recupera el VWAP después de estar al menos 2 minutos debajo', () => {
    const { trade, of } = setup();
    trade(at(9, 35), 2.4, 30_000); // VWAP ≈ 2,40
    trade(at(9, 36), 2.2, 1000); // debajo (−8 %)
    trade(at(9, 37), 2.3, 1000);
    trade(at(9, 38), 2.35, 1000);
    expect(of('vwapReclaim')).toHaveLength(0);
    // Tres minutos después vuelve arriba del VWAP (sin nuevo máximo ni subida de 5 % en 2 min, que tienen prioridad).
    trade(at(9, 39), 2.398, 1000);
    const a = of('vwapReclaim');
    expect(a).toHaveLength(1);
    expect(a[0].text).toMatch(/Recupera VWAP \(\$2\.3\d\)/);
    expect(a[0].tone).toBe('up');
  });

  it('pierde el VWAP después de estar al menos 3 minutos arriba, y no avisa si estuvo menos', () => {
    const { trade, of } = setup({ prevClose: 1.9 });
    trade(at(9, 35), 2.2, 30_000);
    trade(at(9, 36), 2.4, 1000); // arriba
    trade(at(9, 37), 2.1, 1000); // abajo al minuto: no cuenta
    expect(of('vwapLoss')).toHaveLength(0);
    trade(at(9, 38), 2.4, 1000); // arriba otra vez
    trade(at(9, 42), 2.1, 1000); // 4 minutos después, abajo
    const a = of('vwapLoss');
    expect(a).toHaveLength(1);
    expect(a[0].text).toMatch(/Pierde VWAP/);
    expect(a[0].tone).toBe('warn');
  });
});

describe('alertas: cierre anterior, pre-market y niveles', () => {
  it('pasa de rojo a verde tras 3 minutos debajo del cierre anterior y con volumen relativo', () => {
    const { trade, of } = setup();
    trade(at(9, 35), 1.9, 150_000);
    trade(at(9, 37), 1.92, 100_000);
    trade(at(9, 39), 2.05, 100_000);
    const a = of('redToGreen');
    expect(a).toHaveLength(1);
    expect(a[0].text).toMatch(/rojo a verde \(cierre anterior \$2\.00\)/);
    // Vuelve a caer y cruza enseguida: cooldown de 15 minutos.
    trade(at(9, 41), 1.95, 10_000);
    trade(at(9, 45), 2.1, 10_000);
    expect(of('redToGreen')).toHaveLength(1);
  });

  it('sin 3 minutos en rojo no es "rojo a verde"', () => {
    const { trade, of } = setup();
    trade(at(9, 35), 1.9, 150_000);
    trade(at(9, 36), 2.05, 100_000);
    expect(of('redToGreen')).toHaveLength(0);
  });

  it('rompe el máximo del pre-market en la rueda regular (una sola vez)', () => {
    const { engine, trade, of } = setup();
    trade(at(8, 0), 2.3, 30_000);
    trade(at(8, 30), 2.2, 1000);
    expect(engine.get('TEST')!.pmHigh).toBe(2.3);
    trade(at(9, 31), 2.25, 1000); // en regular, debajo del máximo del pre
    expect(of('pmhBreak')).toHaveLength(0);
    trade(at(9, 32), 2.35, 1000);
    const a = of('pmhBreak');
    expect(a).toHaveLength(1);
    expect(a[0].text).toMatch(/máximo del pre-market \(\$2\.30\)/);
    trade(at(9, 33), 2.28, 1000);
    trade(at(9, 34), 2.4, 1000);
    expect(of('pmhBreak')).toHaveLength(1);
  });

  it('rompe medio dólar y dólar entero según el precio', () => {
    const { trade, of } = setup();
    trade(at(10, 0), 2.4, 30_000); // +20 %
    trade(at(10, 1), 2.52, 1000);
    expect(of('level').map((a) => a.text)).toEqual(['Rompe $2.50 (medio dólar)']);
    trade(at(10, 2), 2.9, 1000);
    trade(at(10, 3), 3.05, 1000);
    expect(of('level').map((a) => a.text)).toEqual(['Rompe $2.50 (medio dólar)', 'Rompe $3.00 (dólar entero)']);
    // El mismo nivel no se repite por 30 minutos.
    trade(at(10, 4), 2.95, 1000);
    trade(at(10, 5), 3.02, 1000);
    expect(of('level')).toHaveLength(2);
  });
});

describe('alertas: velocidad, volumen, cinta y rotación', () => {
  it('"subiendo rápido": 5 % en 2 minutos en una acción que ya sube en el día', () => {
    const { trade, of } = setup();
    trade(at(9, 40), 2.1, 30_000); // +5 % en el día
    trade(at(9, 41), 2.25, 30_000); // +7 % en 2 minutos
    const a = of('running');
    expect(a).toHaveLength(1);
    expect(a[0].text).toMatch(/Subiendo rápido: \+7\.1% en 2 min/);
    // El rebote de una acción en rojo no cuenta.
    const red = setup();
    red.trade(at(9, 40), 1.5, 30_000);
    red.trade(at(9, 41), 1.65, 30_000);
    expect(red.of('running')).toHaveLength(0);
  });

  it('flush: cae 12 % en 5 minutos desde el máximo de una acción que había subido 15 %', () => {
    const { trade, of } = setup();
    trade(at(10, 0), 2.4, 30_000);
    trade(at(10, 2), 2.1, 30_000);
    const a = of('flush');
    expect(a).toHaveLength(1);
    expect(a[0].text).toMatch(/Flush: -12\.5% en 5 min desde \$2\.40/);
    expect(a[0].tone).toBe('down');
    // Una acción que no había subido no es un flush.
    const flat = setup();
    flat.trade(at(10, 0), 2.2, 30_000);
    flat.trade(at(10, 2), 1.9, 30_000);
    expect(flat.of('flush')).toHaveLength(0);
  });

  it('pico de volumen: una vela con 5 veces el promedio y al menos 30.000 acciones', () => {
    const { trade, of } = setup();
    for (let i = 0; i < 4; i++) trade(at(10, i), 2.2, 1000);
    trade(at(10, 4), 2.2, 60_000);
    const a = of('volume');
    expect(a).toHaveLength(1);
    expect(a[0].text).toMatch(/Pico de volumen: 60K en 1 min \(60x\)/);
    // La misma vela no vuelve a avisar.
    trade(at(10, 4, 30), 2.21, 10_000);
    expect(of('volume')).toHaveLength(1);
  });

  it('compras apiladas: 10 subas seguidas con la acción 5 % arriba', () => {
    const { trade, of } = setup();
    trade(at(10, 0), 2.2, 30_000);
    for (let i = 1; i <= 9; i++) trade(at(10, 0, i), 2.2 + i * 0.001, 100);
    expect(of('stacking')).toHaveLength(0);
    trade(at(10, 0, 10), 2.21, 100);
    const a = of('stacking');
    expect(a).toHaveLength(1);
    expect(a[0].text).toMatch(/Compras apiladas: 10 subas seguidas/);
    // Una baja corta la racha.
    trade(at(10, 0, 11), 2.2, 100);
    for (let i = 12; i <= 20; i++) trade(at(10, 0, i), 2.2 + (i - 11) * 0.001, 100);
    expect(of('stacking')).toHaveLength(1);
  });

  it('rotación del float: avisa cada vez que el volumen completa otra vuelta', () => {
    const { trade, of } = setup({ float: 100_000 });
    trade(at(10, 0), 2.2, 30_000);
    trade(at(10, 1), 2.2, 80_000);
    expect(of('rotation').map((a) => a.text)).toEqual(['Rotó el float 1x (110K acciones)']);
    trade(at(10, 2), 2.2, 50_000);
    expect(of('rotation')).toHaveLength(1);
    trade(at(10, 3), 2.2, 50_000);
    expect(of('rotation').map((a) => a.text)).toEqual(['Rotó el float 1x (110K acciones)', 'Rotó el float 2x (210K acciones)']);
  });

  it('nada suena en una acción fuera del rango de precio', () => {
    const { trade, alerts } = setup({ prevClose: 40 });
    trade(at(10, 0), 48, 100_000);
    trade(at(10, 1), 50, 100_000);
    trade(at(10, 2), 55, 100_000);
    expect(alerts.filter((a) => a.type !== 'news')).toHaveLength(0);
  });
});
