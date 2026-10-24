// Prueba de punta a punta de los adaptadores contra servidores falsos que imitan los protocolos
// documentados de Alpaca y Massive (REST + WebSocket).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { Engine } from '../src/engine/engine';
import { etWallToTs, previousTradingDays, sessionDate } from '../src/engine/time';
import type { ProviderStatus } from '../src/engine/types';
import { AlpacaProvider } from '../server/alpaca';
import { MassiveProvider } from '../server/massive';
import type { ProviderContext } from '../server/provider';

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
    });
    await provider.start(ctx);
    // Universo: RUNR ($2) entra; BIGG ($250) queda afuera por precio; BAD1 se descarta del lote.
    expect([...ctx.universe]).toEqual(['RUNR']);
    const runr = engine.get('RUNR')!;
    expect(runr.prevClose).toBe(2.0);
    expect(runr.ref.avgVolume).toBeGreaterThan(1_000_000);
    expect(runr.ref.name).toBe('Runner Inc');
    // Velas del día cargadas (máximo de pre-market y volumen).
    expect(runr.pmHigh).toBe(3.1);
    expect(runr.volume).toBe(200_000);
    await waitFor(() => engine.halts.has('RUNR') && engine.news.some((n) => n.id === 'alp-99'));
    expect(subscribed).toMatchObject({ bars: ['*'], statuses: ['*'], lulds: ['*'] });
    expect(runr.last).toBe(3.2);
    expect(engine.get('BIGG')).toBeUndefined();
    expect(engine.halts.get('RUNR')).toMatchObject({ halted: true, reason: 'T1', reasonText: 'Noticia pendiente' });
    expect(seen).toContain('/v2/stocks/bars:1Min');
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
