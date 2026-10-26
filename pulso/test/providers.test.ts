// Prueba de punta a punta de los adaptadores contra servidores falsos que imitan los protocolos
// documentados de Alpaca y Massive (REST + WebSocket).
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { Engine } from '../src/engine/engine';
import { etWallToTs, previousTradingDays, sessionDate } from '../src/engine/time';
import type { ProviderStatus } from '../src/engine/types';
import { AlpacaProvider } from '../server/alpaca';
import { MassiveProvider } from '../server/massive';
import type { ProviderContext } from '../server/provider';

// La caché de los proveedores va a una carpeta temporal: la real es la del servidor con datos de verdad.
process.env.PULSO_CACHE_DIR = mkdtempSync(join(tmpdir(), 'pulso-cache-'));

const session = sessionDate(Date.now());
const at = (minutes: number) => etWallToTs(session.y, session.mo, session.d, minutes);
const prevDay = previousTradingDays(session, 1)[0];
const iso = (ts: number) => new Date(ts).toISOString();
const dayIso = (key: string) => new Date(etWallToTs(...(key.split('-').map(Number) as [number, number, number]), 0)).toISOString();

async function waitFor(cond: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout esperando la condición');
    await new Promise((r) => setTimeout(r, 20));
  }
}

function makeCtx() {
  const universe = new Set<string>();
  const engine = new Engine({ accept: (s) => universe.has(s) });
  const statuses: Array<Partial<ProviderStatus>> = [];
  const ctx: ProviderContext = {
    engine: () => engine,
    log: () => undefined,
    setStatus: (s) => statuses.push(s),
    universe,
    universeMin: 0.2,
    universeMax: 60,
  };
  return { ctx, engine, statuses };
}

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

async function listen(s: Server): Promise<number> {
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return (s.address() as AddressInfo).port;
}

describe('AlpacaProvider contra un servidor falso', () => {
  it('arranca por REST, se suscribe y procesa prints, halts y noticias', async () => {
    const seen: string[] = [];
    let subscribed: Record<string, unknown> | null = null;
    server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://x');
      seen.push(url.pathname + (url.searchParams.get('timeframe') ? `:${url.searchParams.get('timeframe')}` : ''));
      if (req.headers['apca-api-key-id'] !== 'KEY') {
        res.writeHead(401, { 'Content-Type': 'text/html' });
        return res.end('<html>401 Authorization Required</html>');
      }
      const send = (body: unknown) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === '/v2/assets') {
        return send([
          { symbol: 'RUNR', name: 'Runner Inc', exchange: 'NASDAQ', tradable: true, status: 'active' },
          { symbol: 'BIGG', name: 'Big Corp', exchange: 'NYSE', tradable: true, status: 'active' },
          { symbol: 'BAD1', name: 'Broken', exchange: 'NASDAQ', tradable: true, status: 'active' },
          { symbol: 'OTCX', name: 'Pink', exchange: 'OTC', tradable: false, status: 'active' },
        ]);
      }
      if (url.pathname === '/v2/stocks/snapshots') {
        const syms = url.searchParams.get('symbols')!.split(',');
        if (syms.includes('BAD1')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ message: 'code=400, message=invalid symbol: BAD1' }));
        }
        return send({
          RUNR: {
            latestTrade: { t: iso(at(8 * 60)), p: 3.0, s: 100 },
            dailyBar: { t: dayIso(prevDay.dateKey), o: 1.9, h: 2.1, l: 1.8, c: 2.0, v: 900_000 },
            prevDailyBar: { t: dayIso(prevDay.dateKey), o: 1.9, h: 2.1, l: 1.8, c: 1.9, v: 800_000 },
          },
          BIGG: {
            latestTrade: { t: iso(at(8 * 60)), p: 250, s: 100 },
            dailyBar: { t: dayIso(prevDay.dateKey), o: 249, h: 251, l: 248, c: 250, v: 9_000_000 },
          },
        });
      }
      if (url.pathname === '/v2/stocks/bars' && url.searchParams.get('timeframe') === '1Day') {
        const bars = Array.from({ length: 10 }, (_, i) => ({ t: dayIso(prevDay.dateKey), o: 2, h: 2, l: 2, c: 2, v: 1_000_000 + i }));
        // Paginado: la primera página trae next_page_token.
        if (!url.searchParams.get('page_token')) return send({ bars: { RUNR: bars.slice(0, 6) }, next_page_token: 'p2' });
        return send({ bars: { RUNR: bars.slice(6) }, next_page_token: null });
      }
      if (url.pathname === '/v2/stocks/bars' && url.searchParams.get('timeframe') === '1Min') {
        return send({
          bars: {
            RUNR: [
              { t: iso(at(7 * 60)), o: 2.2, h: 2.4, l: 2.2, c: 2.35, v: 50_000, vw: 2.3, n: 100 },
              { t: iso(at(7 * 60 + 1)), o: 2.35, h: 3.1, l: 2.3, c: 3.0, v: 150_000, vw: 2.8, n: 300 },
            ],
          },
          next_page_token: null,
        });
      }
      if (url.pathname === '/v1beta1/news') {
        return send({ news: [{ id: 7, headline: 'Runner Inc Signs Deal', created_at: iso(at(6 * 60)), symbols: ['RUNR'], source: 'benzinga', url: null }], next_page_token: null });
      }
      res.writeHead(404);
      res.end();
    });
    const wss = new WebSocketServer({ server });
    wss.on('connection', (ws, req) => {
      const news = req.url?.includes('news');
      ws.send(JSON.stringify([{ T: 'success', msg: 'connected' }]));
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.action === 'auth') {
          ws.send(JSON.stringify(m.key === 'KEY' && m.secret === 'SECRET' ? [{ T: 'success', msg: 'authenticated' }] : [{ T: 'error', code: 402, msg: 'auth failed' }]));
        } else if (m.action === 'subscribe' && news) {
          ws.send(JSON.stringify([{ T: 'subscription', news: ['*'] }]));
          ws.send(JSON.stringify([{ T: 'n', id: 99, headline: 'Runner Inc Wins Contract', created_at: iso(Date.now()), symbols: ['RUNR'], source: 'benzinga' }]));
        } else if (m.action === 'subscribe' && m.bars) {
          subscribed = m;
          ws.send(JSON.stringify([{ T: 'subscription', trades: [], bars: ['*'], statuses: ['*'] }]));
          ws.send(
            JSON.stringify([
              { T: 't', S: 'RUNR', i: 1, x: 'Q', p: 3.2, s: 500, c: ['@'], t: iso(at(8 * 60 + 5)), z: 'C' },
              { T: 't', S: 'BIGG', i: 2, x: 'N', p: 251, s: 100, c: ['@'], t: iso(at(8 * 60 + 5)), z: 'A' },
              { T: 's', S: 'RUNR', sc: 'H', sm: 'Trading Halt', rc: 'T1', rm: 'Halt News Pending', t: iso(at(8 * 60 + 6)), z: 'C' },
            ]),
          );
        }
      });
    });
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}`;
    const { ctx, engine } = makeCtx();
    const provider = new AlpacaProvider({
      keyId: 'KEY',
      secret: 'SECRET',
      feed: 'sip',
      tradingUrl: base,
      dataUrl: base,
      streamUrl: `ws://127.0.0.1:${port}/v2/sip`,
      newsStreamUrl: `ws://127.0.0.1:${port}/v1beta1/news`,
      hotLimit: 10,
      delayedPollMs: 60_000,
      hotRefreshMs: 300_000,
    });
    await provider.start(ctx);
    // Universo: RUNR ($2) entra; BIGG ($250) queda afuera por precio; BAD1 se descarta del lote.
    expect([...ctx.universe]).toEqual(['RUNR']);
    const runr = engine.get('RUNR')!;
    expect(runr.prevClose).toBe(2.0);
    expect(runr.ref.name).toBe('Runner Inc');
    // Velas del día cargadas (máximo de pre-market y volumen).
    expect(runr.pmHigh).toBe(3.1);
    expect(runr.volume).toBe(200_000);
    await waitFor(() => engine.halts.has('RUNR') && engine.news.some((n) => n.id === 'alp-99'));
    expect(subscribed).toMatchObject({ bars: ['*'], statuses: ['*'], lulds: ['*'] });
    expect(runr.last).toBe(3.2);
    expect(engine.get('BIGG')).toBeUndefined();
    expect(engine.halts.get('RUNR')).toMatchObject({ halted: true, reason: 'T1', reasonText: 'Noticia pendiente' });
    // El volumen promedio se carga en segundo plano, después de conectar.
    await waitFor(() => (runr.ref.avgVolume ?? 0) > 1_000_000);
    expect(seen).toContain('/v2/stocks/bars:1Min');
    provider.stop();
  });
});

describe('AlpacaProvider plan gratis en capas (IEX en vivo + mercado completo demorado)', () => {
  it('usa el mercado completo para el universo, lo repasa cada tanto y completa las velas consolidadas', async () => {
    const snapshotFeeds: string[] = [];
    const barEnds: string[] = [];
    let polls = 0;
    server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://x');
      const send = (body: unknown) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === '/v2/assets') return send([{ symbol: 'RUNR', name: 'Runner Inc', exchange: 'NASDAQ', tradable: true, status: 'active' }]);
      if (url.pathname === '/v2/stocks/snapshots') {
        const feed = url.searchParams.get('feed')!;
        snapshotFeeds.push(feed);
        if (feed !== 'delayed_sip') return send({ RUNR: { latestTrade: { t: iso(at(9 * 60 + 40)), p: 3.0, s: 100 }, dailyBar: { t: dayIso(session.dateKey), o: 2.2, h: 3.1, l: 2.1, c: 3.0, v: 40_000 } } });
        // Cada repaso llega un minuto más tarde y con más volumen consolidado.
        const n = polls++;
        return send({
          RUNR: {
            latestTrade: { t: iso(at(9 * 60 + 40 + n)), p: 3.0 + n * 0.01, s: 100 },
            dailyBar: { t: dayIso(session.dateKey), o: 2.2, h: 3.1, l: 2.1, c: 3.0, v: 2_000_000 + n * 100_000, vw: 2.7 },
            prevDailyBar: { t: dayIso(prevDay.dateKey), o: 1.9, h: 2.1, l: 1.8, c: 2.0, v: 800_000 },
          },
        });
      }
      if (url.pathname === '/v2/stocks/bars' && url.searchParams.get('timeframe') === '1Day') {
        return send({ bars: { RUNR: Array.from({ length: 10 }, () => ({ t: dayIso(prevDay.dateKey), o: 2, h: 2, l: 2, c: 2, v: 1_000_000 })) }, next_page_token: null });
      }
      if (url.pathname === '/v2/stocks/bars' && url.searchParams.get('timeframe') === '1Min') {
        barEnds.push(url.searchParams.get('end') ?? '');
        return send({
          bars: { RUNR: [{ t: iso(at(9 * 60 + 30)), o: 2.9, h: 3.3, l: 2.9, c: 3.2, v: 300_000, vw: 3.1, n: 900 }] },
          next_page_token: null,
        });
      }
      if (url.pathname === '/v1beta1/news') return send({ news: [], next_page_token: null });
      res.writeHead(404);
      res.end();
    });
    const wss = new WebSocketServer({ server });
    wss.on('connection', (ws, req) => {
      const news = req.url?.includes('news');
      ws.send(JSON.stringify([{ T: 'success', msg: 'connected' }]));
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.action === 'auth') ws.send(JSON.stringify([{ T: 'success', msg: 'authenticated' }]));
        else if (m.action === 'subscribe' && news) ws.send(JSON.stringify([{ T: 'subscription', news: ['*'] }]));
        else if (m.action === 'subscribe' && m.bars) {
          ws.send(JSON.stringify([{ T: 'subscription', trades: [], bars: ['*'] }]));
          // IEX en vivo: un print nuevo (más nuevo que lo demorado) y poco volumen.
          ws.send(JSON.stringify([{ T: 't', S: 'RUNR', i: 1, x: 'V', p: 3.3, s: 500, c: ['@'], t: iso(at(9 * 60 + 58)), z: 'C' }]));
        }
      });
    });
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}`;
    const { ctx, engine } = makeCtx();
    const provider = new AlpacaProvider({
      keyId: 'KEY',
      secret: 'SECRET',
      feed: 'iex',
      tradingUrl: base,
      dataUrl: base,
      streamUrl: `ws://127.0.0.1:${port}/v2/iex`,
      newsStreamUrl: `ws://127.0.0.1:${port}/v1beta1/news`,
      hotLimit: 10,
      delayedPollMs: 120,
      hotRefreshMs: 600_000,
    });
    expect(provider.realtime).toBe(true);
    expect(provider.badge).toMatch(/IEX/);
    await provider.start(ctx);
    const runr = engine.get('RUNR')!;
    // El universo y el estado inicial salen del mercado completo demorado, no de IEX.
    expect(snapshotFeeds[0]).toBe('delayed_sip');
    expect(runr.prevClose).toBe(2.0);
    expect(runr.volume).toBe(2_000_000);
    expect(runr.consolidatedTs).toBe(at(9 * 60 + 40));
    // El print de IEX manda en el precio; el repaso demorado sube el piso de volumen sin pisarlo.
    await waitFor(() => runr.last === 3.3 && polls >= 3);
    expect(runr.volume).toBeGreaterThanOrEqual(2_100_000 + 500);
    expect(runr.last).toBe(3.3);
    expect(runr.consolidatedTs).toBeGreaterThanOrEqual(at(9 * 60 + 41));
    // Al volverse caliente recibe las velas consolidadas (pedidas hasta hace 16 minutos).
    provider.setHot(['RUNR']);
    await waitFor(() => runr.bars.some((b) => b.t === at(9 * 60 + 30) && b.v === 300_000), 6000);
    expect(barEnds[0]).not.toBe('');
    expect(Date.parse(barEnds[0])).toBeLessThanOrEqual(Date.now() - 15 * 60_000);
    expect(runr.volume).toBeGreaterThanOrEqual(300_000 + 500);
    provider.stop();
  }, 10_000);
});

describe('AlpacaProvider con feed automático', () => {
  // Un servidor mínimo: con `sip` el plan responde 403 a cualquier consulta reciente (plan gratis) o 200 (Plus).
  function fakeAlpaca(plus: boolean, onSubscribe: (m: Record<string, unknown>) => void) {
    const probes: string[] = [];
    server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://x');
      const send = (body: unknown, code = 200) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === '/v2/stocks/bars' && url.searchParams.get('feed') === 'sip' && url.searchParams.get('symbols') === 'SPY') {
        probes.push(url.searchParams.get('start')!);
        return plus ? send({ bars: { SPY: [] }, next_page_token: null }) : send({ message: 'subscription does not permit querying recent SIP data' }, 403);
      }
      if (url.pathname === '/v2/assets') return send([{ symbol: 'RUNR', name: 'Runner Inc', exchange: 'NASDAQ', tradable: true, status: 'active' }]);
      if (url.pathname === '/v2/stocks/snapshots') {
        return send({ RUNR: { latestTrade: { t: iso(at(9 * 60 + 40)), p: 3.0, s: 100 }, dailyBar: { t: dayIso(session.dateKey), o: 2.2, h: 3.1, l: 2.1, c: 3.0, v: 40_000 }, prevDailyBar: { t: dayIso(prevDay.dateKey), o: 1.9, h: 2.1, l: 1.8, c: 2.0, v: 800_000 } } });
      }
      if (url.pathname === '/v2/stocks/bars') return send({ bars: {}, next_page_token: null });
      if (url.pathname === '/v1beta1/news') return send({ news: [], next_page_token: null });
      res.writeHead(404);
      res.end();
    });
    const wss = new WebSocketServer({ server });
    wss.on('connection', (ws, req) => {
      const news = req.url?.includes('news');
      ws.send(JSON.stringify([{ T: 'success', msg: 'connected' }]));
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.action === 'auth') ws.send(JSON.stringify([{ T: 'success', msg: 'authenticated' }]));
        else if (m.action === 'subscribe' && !news) {
          onSubscribe({ ...m, path: req.url });
          if (m.trades) ws.send(JSON.stringify([{ T: 'q', S: 'RUNR', bp: 3.01, bs: 4, ap: 3.03, as: 12, t: iso(Date.now()), z: 'C' }]));
        }
      });
    });
    return probes;
  }

  function autoProvider(port: number) {
    const base = `http://127.0.0.1:${port}`;
    return new AlpacaProvider({
      keyId: 'KEY',
      secret: 'SECRET',
      feed: 'auto',
      tradingUrl: base,
      dataUrl: base,
      streamUrl: undefined,
      newsStreamUrl: `ws://127.0.0.1:${port}/v1beta1/news`,
      hotLimit: 0,
      delayedPollMs: 600_000,
      hotRefreshMs: 600_000,
    });
  }

  it('con el plan gratis queda en capas (IEX)', async () => {
    const subs: Array<Record<string, unknown>> = [];
    const probes = fakeAlpaca(false, (m) => subs.push(m));
    const port = await listen(server!);
    const provider = autoProvider(port);
    // Antes de arrancar no se sabe: se asume el gratis.
    expect(provider.layered).toBe(true);
    const { ctx, statuses } = makeCtx();
    // El servidor falso también atiende el WebSocket: se apunta la URL del stream a él una vez detectado el feed.
    Object.defineProperty(provider, 'streamUrl', { get: () => `ws://127.0.0.1:${port}/v2/${provider.feed}` });
    await provider.start(ctx);
    // Ante el 403 se insiste tres veces (un plan recién contratado tarda en propagarse) y recién ahí se asume el gratis.
    expect(probes).toHaveLength(3);
    expect(Date.now() - Date.parse(probes[0])).toBeLessThan(15 * 60_000);
    expect(provider.feed).toBe('iex');
    expect(provider.layered).toBe(true);
    expect(provider.label).toBe('Alpaca gratis');
    expect(provider['cfg'].hotLimit).toBe(25);
    expect(statuses.some((s) => s.badge?.includes('IEX') && s.provider === 'Alpaca gratis')).toBe(true);
    provider.setHot(['RUNR']);
    await waitFor(() => subs.some((m) => m.trades));
    // Con IEX no se piden cotizaciones (su libro no es el del mercado).
    expect(subs.find((m) => m.trades)).not.toHaveProperty('quotes');
    expect(subs[0].path).toBe('/v2/iex');
    provider.stop();
  });

  it('con Algo Trader Plus usa el SIP en tiempo real y pide la cotización de los calientes', async () => {
    const subs: Array<Record<string, unknown>> = [];
    fakeAlpaca(true, (m) => subs.push(m));
    const port = await listen(server!);
    const provider = autoProvider(port);
    Object.defineProperty(provider, 'streamUrl', { get: () => `ws://127.0.0.1:${port}/v2/${provider.feed}` });
    const { ctx, engine, statuses } = makeCtx();
    await provider.start(ctx);
    expect(provider.feed).toBe('sip');
    expect(provider.layered).toBe(false);
    expect(provider.realtime).toBe(true);
    expect(provider.label).toBe('Alpaca SIP');
    expect(provider.badge).toBeUndefined();
    expect(provider['cfg'].hotLimit).toBe(400);
    expect(statuses.some((s) => s.provider === 'Alpaca SIP' && s.realtime === true)).toBe(true);
    provider.setHot(['RUNR']);
    await waitFor(() => subs.some((m) => m.trades));
    expect(subs.find((m) => m.trades)).toMatchObject({ trades: ['RUNR'], quotes: ['RUNR'] });
    expect(subs[0].path).toBe('/v2/sip');
    // La cotización del stream (tamaños en lotes de 100) llega al motor.
    const runr = engine.get('RUNR')!;
    await waitFor(() => runr.ask === 3.03);
    expect(runr).toMatchObject({ bid: 3.01, ask: 3.03, bidSize: 400, askSize: 1200 });
    provider.stop();
  });
});

describe('MassiveProvider contra un servidor falso', () => {
  it('arranca con cierres agrupados, snapshot y velas, y procesa A.* del websocket', async () => {
    let subscribedTo = '';
    server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://x');
      if (url.searchParams.get('apiKey') !== 'MKEY') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ERROR', error: 'API Key was not provided' }));
      }
      const send = (body: unknown) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (url.pathname.startsWith('/v2/aggs/grouped/')) {
        return send({ results: [{ T: 'RUNR', c: 2.0, v: 1_200_000 }, { T: 'ETFX', c: 30, v: 5_000_000 }, { T: 'BIGG', c: 250, v: 9_000_000 }] });
      }
      if (url.pathname === '/v3/reference/tickers') {
        return send({ results: [{ ticker: 'RUNR', name: 'Runner Inc', type: 'CS', primary_exchange: 'XNAS' }, { ticker: 'ETFX', name: 'Some ETF', type: 'ETF', primary_exchange: 'ARCX' }] });
      }
      if (url.pathname === '/v2/snapshot/locale/us/markets/stocks/tickers') {
        const ns = at(8 * 60) * 1e6;
        return send({
          tickers: [{ ticker: 'RUNR', updated: ns, day: { o: 0, h: 0, l: 0, c: 0, v: 0, vw: 0 }, min: { av: 400_000, c: 3.0, vw: 2.7 }, prevDay: { c: 2.0 }, lastTrade: { p: 3.05, t: ns } }],
        });
      }
      if (url.pathname.startsWith('/v2/aggs/ticker/RUNR/range/1/minute/')) {
        return send({ results: [{ t: at(7 * 60), o: 2.2, h: 3.2, l: 2.2, c: 3.0, v: 400_000, vw: 2.7, n: 900 }] });
      }
      if (url.pathname === '/v2/reference/news') {
        return send({ results: [{ id: 'z1', title: 'Runner Inc Announces Partnership', published_utc: iso(at(6 * 60)), tickers: ['RUNR'], insights: [{ ticker: 'RUNR', sentiment: 'positive' }] }] });
      }
      res.writeHead(404);
      res.end();
    });
    const wss = new WebSocketServer({ server });
    wss.on('connection', (ws) => {
      ws.send(JSON.stringify([{ ev: 'status', status: 'connected', message: 'Connected Successfully' }]));
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.action === 'auth') {
          ws.send(JSON.stringify([{ ev: 'status', status: m.params === 'MKEY' ? 'auth_success' : 'auth_failed', message: '' }]));
        } else if (m.action === 'subscribe') {
          subscribedTo = m.params;
          ws.send(JSON.stringify([{ ev: 'status', status: 'success', message: `subscribed to: ${m.params}` }]));
          const s = at(8 * 60 + 10);
          ws.send(
            JSON.stringify([
              { ev: 'A', sym: 'RUNR', v: 20_000, av: 420_000, op: 0, vw: 3.3, o: 3.25, c: 3.35, h: 3.4, l: 3.25, a: 2.75, z: 300, s, e: s + 1000 },
              { ev: 'A', sym: 'BIGG', v: 100, av: 1000, vw: 251, o: 251, c: 251, h: 251, l: 251, a: 251, z: 100, s, e: s + 1000 },
            ]),
          );
        }
      });
    });
    const port = await listen(server);
    const { ctx, engine } = makeCtx();
    const provider = new MassiveProvider({ key: 'MKEY', plan: 'advanced', restUrl: `http://127.0.0.1:${port}`, socketUrl: `ws://127.0.0.1:${port}/stocks` });
    await provider.start(ctx);
    // ETFX queda afuera por tipo (ETF) y BIGG por precio.
    expect([...ctx.universe]).toEqual(['RUNR']);
    const runr = engine.get('RUNR')!;
    expect(runr.prevClose).toBe(2.0);
    expect(runr.ref.avgVolume).toBe(1_200_000);
    expect(runr.pmHigh).toBe(3.2);
    expect(engine.news[0]).toMatchObject({ id: 'mas-z1', sentiment: 'bullish' });
    await waitFor(() => runr.last === 3.35);
    expect(subscribedTo).toBe('A.*,LULD.*');
    expect(runr.volume).toBe(420_000);
    expect(runr.vwap).toBeCloseTo(2.75, 6);
    expect(runr.hod).toBe(3.4);
    provider.stop();
  });
});
