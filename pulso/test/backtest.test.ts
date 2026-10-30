// Backtest del IA Trader sin navegador: un día entero del simulador con el perfil agresivo hace trades
// (lo mismo que mide scripts/ia-dia.ts), los días recientes salen con la semilla de "Mercado ahora" y
// el resumen de varios días junta bien los números.
import { describe, expect, it } from 'vitest';
import { recentDays, runBacktestDay, summarizeBacktest, summarizeDay, type BacktestDayResult } from '../src/client/lib/backtest';
import { seedForDay } from '../src/sim/simulator';
import type { Trade } from '../src/trading/types';

const trade = (i: number, net: number, r?: number): Trade =>
  ({ id: `t${i}`, sessionId: 's', sym: 'RUN', side: 'long', openedAt: i, closedAt: i + 1, shares: 100, avgEntry: 3, avgExit: 3.1, gross: net, fees: 0, net, returnPct: 1, r, mfePct: 1, maePct: 0, exitReason: 'manual', fills: 2, bars: [[1, 2, 3, 4, 5, 6]] }) as Trade;

describe('runBacktestDay', () => {
  it(
    'con la semilla 3, agresivo y margen de US$ 30.000 hace trades y devuelve la curva del día',
    async () => {
      const progress: number[] = [];
      const r = await runBacktestDay({ seed: 3, dayTs: Date.parse('2026-10-23T15:00:00Z'), profile: 'agresivo', account: 'margin', balance: 30_000, consult: false, onProgress: (f) => progress.push(f) });
      expect(r.seed).toBe(3);
      expect(r.dayKey).toBe('2026-10-23');
      expect(r.trades.length).toBeGreaterThan(0);
      expect(r.equityCurve).toHaveLength(r.trades.length + 1);
      expect(r.equityCurve[0]).toBe(30_000);
      expect(r.equityCurve[r.equityCurve.length - 1]).toBeCloseTo(30_000 + r.net, 2);
      expect(r.net).toBeCloseTo(r.trades.reduce((a, t) => a + t.net, 0), 2);
      expect(r.wins).toBe(r.trades.filter((t) => t.net > 0).length);
      // Las velas de revisión no viajan con el resultado.
      expect(r.trades.every((t) => t.bars === undefined)).toBe(true);
      expect(progress[0]).toBeLessThan(0.1);
      expect(progress[progress.length - 1]).toBe(1);
    },
    120_000,
  );

  it('se puede cancelar antes de arrancar', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(runBacktestDay({ seed: 3, profile: 'agresivo', account: 'margin', balance: 30_000, consult: false, signal: ctl.signal })).rejects.toThrow(/cancelado/);
  });
});

describe('recentDays', () => {
  it('devuelve los últimos días hábiles, del más viejo al más nuevo, con la semilla de "Mercado ahora"', () => {
    // Sábado 24 de octubre de 2026 a la noche (ET): el último día hábil es el viernes 23.
    const days = recentDays(5, Date.parse('2026-10-25T02:00:00Z'));
    expect(days.map((d) => d.dayKey)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
    for (const d of days) expect(d.seed).toBe(seedForDay(d.dayKey));
    expect(new Set(days.map((d) => d.seed)).size).toBe(5);
    expect(recentDays(1, Date.parse('2026-10-25T02:00:00Z')).map((d) => d.dayKey)).toEqual(['2026-10-23']);
  });
});

describe('resumen', () => {
  it('summarizeDay ordena por cierre y arma la curva desde el saldo', () => {
    const r = summarizeDay(7, '2026-10-23', [trade(2, -50, -1), trade(1, 100, 2)], 1000);
    expect(r.trades.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(r.equityCurve).toEqual([1000, 1100, 1050]);
    expect(r.net).toBe(50);
    expect(r.wins).toBe(1);
    expect(r.avgR).toBe(0.5);
    expect(r.maxDrawdown).toBe(50);
    expect(r.trades[0].bars).toBeUndefined();
  });

  it('summarizeBacktest junta los días: aciertos, R, mejor y peor día, racha de pérdidas y drawdown', () => {
    const days: BacktestDayResult[] = [
      summarizeDay(1, '2026-10-21', [trade(1, 100, 2), trade(2, -40, -1)], 1000),
      summarizeDay(2, '2026-10-22', [trade(3, -30, -1), trade(4, -20, -1), trade(5, 10, 0.5)], 1000),
      summarizeDay(3, '2026-10-23', [], 1000),
    ];
    const s = summarizeBacktest(days, 1000);
    expect(s.days).toBe(3);
    expect(s.trades).toBe(5);
    expect(s.wins).toBe(2);
    expect(s.winRate).toBe(40);
    expect(s.avgR).toBe(-0.1);
    expect(s.net).toBe(20);
    expect(s.bestDay).toEqual({ dayKey: '2026-10-21', net: 60 });
    expect(s.worstDay).toEqual({ dayKey: '2026-10-22', net: -40 });
    expect(s.maxLosingStreak).toBe(3);
    expect(s.equityCurve).toEqual([1000, 1100, 1060, 1030, 1010, 1020]);
    expect(s.maxDrawdown).toBe(90);
  });
});
