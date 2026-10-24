import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/engine';
import { etWallToTs, nextSessionChange, previousTradingDays, sessionAt, sessionDate } from '../src/engine/time';
import { alpacaToEvent, fromSnapshot, newsFromAlpaca } from '../server/alpaca';
import { haltEvents, mdyToKey, parseHaltsRss, resolveSymbol } from '../server/halts';
import { massiveToEvents, newsFromMassive, snapshotToDay } from '../server/massive';
import { dilutionFlags } from '../server/sec';
import { toMs } from '../server/util';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('Alpaca', () => {
  it('traduce prints, velas, halts, LULD y noticias del stream', () => {
    // Ejemplos de la documentación oficial.
    const trade = alpacaToEvent({ T: 't', i: 96921, S: 'AAPL', x: 'D', p: 126.55, s: 1, t: '2021-02-22T15:51:44.208Z', c: ['@', 'I'], z: 'C' });
    expect(trade).toMatchObject({ kind: 'trade', sym: 'AAPL', price: 126.55, size: 1, updatesPrice: false, ts: Date.parse('2021-02-22T15:51:44.208Z') });
    const regular = alpacaToEvent({ T: 't', S: 'AAPL', p: 126.6, s: 100, t: '2021-02-22T15:51:45Z', c: ['@'] });
    expect(regular).toMatchObject({ updatesPrice: true });
    const bar = alpacaToEvent({ T: 'b', S: 'SPY', o: 388.985, h: 389.13, l: 388.975, c: 389.12, v: 49378, n: 461, vw: 389.062639, t: '2021-02-22T19:15:00Z' });
    expect(bar).toMatchObject({ kind: 'bar', span: 'minute', sym: 'SPY', v: 49378, vw: 389.062639 });
    const halt = alpacaToEvent({ T: 's', S: 'AAPL', sc: 'H', sm: 'Trading Halt', rc: 'T12', rm: 'Trading Halted; For information requested by NASDAQ', t: '2021-02-22T19:15:00Z', z: 'C' });
    expect(halt).toMatchObject({ kind: 'status', halted: true, reason: 'T12' });
    // Cinta CTA (NYSE/AMEX): "2" = halt con motivo "M" = pausa LULD.
    expect(alpacaToEvent({ T: 's', S: 'XYZ', sc: '2', rc: 'M', t: '2021-02-22T19:15:00Z' })).toMatchObject({ halted: true, reason: 'LUDP' });
    expect(alpacaToEvent({ T: 's', S: 'XYZ', sc: '3', rc: '', t: '2021-02-22T19:20:00Z' })).toMatchObject({ halted: false });
    // Los mensajes de desbalance no son halts.
    expect(alpacaToEvent({ T: 's', S: 'XYZ', sc: '7', rc: '', t: '2021-02-22T19:20:00Z' })).toBeNull();
    expect(alpacaToEvent({ T: 'l', S: 'IONM', u: 3.24, d: 2.65, i: 'B', t: '2023-04-06T13:34:45.565004401Z', z: 'C' })).toMatchObject({ kind: 'luld', up: 3.24, down: 2.65 });
    const news = alpacaToEvent({ T: 'n', id: 24918784, headline: 'Corsair Q3', summary: '', author: 'Benzinga', created_at: '2022-01-05T22:00:37Z', updated_at: '2022-01-05T22:00:38Z', url: 'https://www.benzinga.com/x', content: '', symbols: ['CRSR'], source: 'benzinga' });
    expect(news).toMatchObject({ kind: 'news', item: { id: 'alp-24918784', symbols: ['CRSR'], source: 'Benzinga' } });
    expect(newsFromAlpaca({ id: 1, headline: 'x', created_at: '2022-01-05T22:00:37Z', symbols: [], url: null }).url).toBeUndefined();
  });

  it('antes de la apertura toma el cierre anterior del dailyBar (que todavía es de ayer)', () => {
    const session = { y: 2026, mo: 10, d: 23, dateKey: '2026-10-23' };
    const snap = {
      latestTrade: { t: '2026-10-23T11:15:00Z', p: 3.1, s: 100 },
      dailyBar: { t: '2026-10-22T04:00:00Z', o: 2, h: 2.2, l: 1.9, c: 2.0, v: 900_000 },
      prevDailyBar: { t: '2026-10-21T04:00:00Z', o: 2, h: 2, l: 2, c: 1.95, v: 800_000 },
    };
    const res = fromSnapshot('ABC', snap, session);
    expect(res.prevClose).toBe(2.0);
    expect(res.day).toMatchObject({ last: 3.1, volume: 0, high: 3.1 });
  });

  it('con la rueda abierta usa la vela diaria de hoy y el cierre de ayer', () => {
    const session = { y: 2026, mo: 10, d: 23, dateKey: '2026-10-23' };
    const snap = {
      latestTrade: { t: '2026-10-23T15:00:00Z', p: 3.4, s: 100 },
      dailyBar: { t: '2026-10-23T04:00:00Z', o: 2.6, h: 3.6, l: 2.5, c: 3.4, v: 4_000_000, vw: 3.1 },
      prevDailyBar: { t: '2026-10-22T04:00:00Z', o: 2, h: 2.2, l: 1.9, c: 2.0, v: 900_000 },
    };
    const res = fromSnapshot('ABC', snap, session);
    expect(res.prevClose).toBe(2.0);
    expect(res.day).toMatchObject({ open: 2.6, high: 3.6, low: 2.5, volume: 4_000_000, vwap: 3.1 });
  });
});

describe('Massive', () => {
  it('traduce agregados por segundo y LULD', () => {
    const [a] = massiveToEvents({ ev: 'A', sym: 'SPCE', v: 200, av: 8642007, op: 25.66, vw: 25.3981, o: 25.39, c: 25.39, h: 25.39, l: 25.39, a: 25.3714, z: 50, s: 1610144868000, e: 1610144869000 });
    expect(a).toMatchObject({ kind: 'bar', span: 'second', sym: 'SPCE', dayVolume: 8642007, dayVwap: 25.3714, ts: 1610144868000 });
    const luld = massiveToEvents({ ev: 'LULD', T: 'MSFT', h: 492.99, l: 446.04, i: [17], z: 3, t: 1764086430905642800, q: 5925769 });
    expect(luld[0]).toMatchObject({ kind: 'luld', sym: 'MSFT', up: 492.99, down: 446.04, ts: 1764086430905 });
    expect(luld[1]).toMatchObject({ kind: 'status', halted: true, reason: 'LUDP' });
    expect(massiveToEvents({ ev: 'status', status: 'connected' })).toEqual([]);
  });

  it('snapshot de pre-market: day en cero y el volumen sale de min.av', () => {
    const start = etWallToTs(2026, 10, 23, 240);
    const d = snapshotToDay(
      { ticker: 'BCAT', updated: (start + 3_600_000) * 1e6, day: { o: 0, h: 0, l: 0, c: 0, v: 0, vw: 0 }, min: { av: 350_000, c: 4.2, vw: 4.0 }, prevDay: { c: 3.0 }, lastTrade: { p: 4.25, t: (start + 3_600_000) * 1e6 } },
      start,
    );
    expect(d).toMatchObject({ last: 4.25, volume: 350_000, prevClose: 3.0, open: undefined });
    // Un snapshot de ayer (sin operaciones hoy) se descarta.
    expect(snapshotToDay({ ticker: 'OLD', updated: (start - 3_600_000) * 1e6, lastTrade: { p: 1, t: (start - 3_600_000) * 1e6 } }, start)).toBeNull();
  });

  it('noticias con sentimiento', () => {
    const n = newsFromMassive({ id: 'abc', title: 'Deal', published_utc: '2026-10-23T12:00:00Z', tickers: ['X'], insights: [{ ticker: 'X', sentiment: 'positive' }] });
    expect(n).toMatchObject({ id: 'mas-abc', sentiment: 'bullish', symbols: ['X'] });
  });

  it('normaliza timestamps en s, ms, µs y ns', () => {
    expect(toMs(1610144868)).toBe(1610144868000);
    expect(toMs(1610144868000)).toBe(1610144868000);
    expect(toMs(1610144868000123)).toBe(1610144868000);
    expect(toMs(1610144868000123456)).toBe(1610144868000);
  });
});

describe('halts de Nasdaq (RSS)', () => {
  const halts = parseHaltsRss(fixture('nasdaq-halts.xml'));

  it('lee los campos del RSS (con BOM y elementos vacíos)', () => {
    expect(halts.map((h) => h.symbol)).toEqual(['PASW', 'ITOC', 'TWG', 'AHT-F', 'SVA']);
    expect(halts[1]).toMatchObject({ reason: 'LUDP', haltTime: '15:44:54.566', resumptionTradeTime: '15:49:54' });
    expect(halts[2]).toMatchObject({ reason: 'T1', resumptionDate: '', resumptionTradeTime: '' });
    expect(mdyToKey('10/23/2026')).toBe('2026-10-23');
  });

  it('genera halt + reanudación para los halts de la sesión', () => {
    const evs = haltEvents(halts, '2026-10-23', Date.parse('2026-10-23T23:59:00Z'));
    const itoc = evs.filter((e) => e.sym === 'ITOC');
    expect(itoc).toHaveLength(2);
    expect(itoc[0]).toMatchObject({ halted: true, reason: 'LUDP', ts: Date.parse('2026-10-23T19:44:54.566Z') });
    expect(itoc[1]).toMatchObject({ halted: false, ts: Date.parse('2026-10-23T19:49:54Z') });
    // T1 sin reanudación: solo el halt. Los halts de 2019 no corresponden a la sesión.
    expect(evs.filter((e) => e.sym === 'TWG')).toHaveLength(1);
    expect(evs.some((e) => e.sym === 'SVA')).toBe(false);
  });

  it('resuelve variantes de símbolo (AHT-F → AHT.F)', () => {
    const engine = new Engine();
    engine.setReference([{ sym: 'AHT.F', prevClose: 10 }]);
    expect(resolveSymbol(engine, 'AHT-F')).toBe('AHT.F');
    expect(resolveSymbol(engine, 'NOPE')).toBeNull();
  });
});

describe('SEC: señales de dilución', () => {
  it('detecta S-1, 424B, EFFECT y emisiones 8-K 3.02 recientes', () => {
    const sub = JSON.parse(fixture('sec-submissions-gctk.json'));
    const flags = dilutionFlags(sub.filings.recent, '2026-10-24');
    expect(flags).toEqual(expect.arrayContaining(['S-1 reciente', 'Oferta 424B', 'Emisión (8-K 3.02)']));
  });

  it('ignora presentaciones viejas', () => {
    const flags = dilutionFlags({ form: ['S-1', '424B5', '8-K'], filingDate: ['2024-01-02', '2024-01-02', '2024-01-02'], items: ['', '', '3.02'] }, '2026-10-24');
    expect(flags).toEqual([]);
  });
});

describe('calendario y sesiones (ET)', () => {
  it('distingue pre-market, rueda, after-hours y feriados', () => {
    expect(sessionAt(etWallToTs(2026, 10, 23, 8 * 60))).toBe('pre');
    expect(sessionAt(etWallToTs(2026, 10, 23, 10 * 60))).toBe('regular');
    expect(sessionAt(etWallToTs(2026, 10, 23, 17 * 60))).toBe('post');
    expect(sessionAt(etWallToTs(2026, 10, 24, 10 * 60))).toBe('closed');
    expect(sessionAt(etWallToTs(2026, 11, 26, 10 * 60))).toBe('closed');
    // Cierre anticipado el día después de Acción de Gracias.
    expect(sessionAt(etWallToTs(2026, 11, 27, 14 * 60))).toBe('post');
  });

  it('el fin de semana la sesión vigente es la del viernes', () => {
    expect(sessionDate(etWallToTs(2026, 10, 24, 12 * 60)).dateKey).toBe('2026-10-23');
    expect(sessionDate(etWallToTs(2026, 10, 26, 3 * 60)).dateKey).toBe('2026-10-23');
    expect(sessionDate(etWallToTs(2026, 10, 26, 5 * 60)).dateKey).toBe('2026-10-26');
    expect(previousTradingDays({ y: 2026, mo: 10, d: 26, dateKey: '2026-10-26' }, 2).map((d) => d.dateKey)).toEqual(['2026-10-23', '2026-10-22']);
  });

  it('cuenta regresiva al próximo pre-market durante el fin de semana', () => {
    const next = nextSessionChange(etWallToTs(2026, 10, 24, 12 * 60));
    expect(next.label).toBe('Pre-market en');
    expect(next.at).toBe(etWallToTs(2026, 10, 26, 4 * 60));
  });

  it('respeta el cambio de horario (EDT → EST)', () => {
    expect(new Date(etWallToTs(2026, 10, 30, 9 * 60 + 30)).toISOString()).toBe('2026-10-30T13:30:00.000Z');
    expect(new Date(etWallToTs(2026, 11, 2, 9 * 60 + 30)).toISOString()).toBe('2026-11-02T14:30:00.000Z');
  });
});
