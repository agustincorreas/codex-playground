// Servidor de Pulso: conecta con el proveedor de datos, corre el motor y transmite las vistas a la
// interfaz por WebSocket. Las claves quedan en el servidor: el navegador nunca las ve.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { Engine } from '../src/engine/engine';
import { sessionDate, tradingDayStart } from '../src/engine/time';
import type { Alert, NewsItem, ProviderStatus, Settings } from '../src/engine/types';
import { AlpacaProvider } from './alpaca';
import { loadConfig, type Config } from './config';
import { fmpFloat, loadFloatCsv, massiveFloat, massiveShortInterest } from './fundamentals';
import { HaltsPoller } from './halts';
import { MassiveProvider } from './massive';
import { DemoProvider, type Provider, type ProviderContext } from './provider';
import { SecData } from './sec';
import { log, RateLimiter, recentLogs, ROOT } from './util';

const cfg = loadConfig();
const DIST = join(ROOT, 'dist');

interface Client {
  ws: WebSocket;
  selected: string | null;
}

const clients = new Set<Client>();
const universe = new Set<string>();
let settings: Settings | null = null;
let watch: string[] = [];
let engine = makeEngine();
let provider: Provider = makeProvider(cfg);
let sessionKey = sessionDate(Date.now()).dateKey;
let status: ProviderStatus = {
  mode: cfg.provider === 'demo' ? 'demo' : 'live',
  provider: provider.label,
  connected: false,
  realtime: provider.realtime,
  badge: provider.badge,
  message: 'Iniciando…',
};
let pendingAlerts: Alert[] = [];
let pendingNews: NewsItem[] = [];
const backfilled = new Set<string>();
const sec = cfg.secUserAgent && cfg.provider !== 'demo' ? new SecData(cfg.secUserAgent, log) : null;
const secRequested = new Set<string>();

function makeEngine(): Engine {
  const e = new Engine({ accept: (sym) => universe.has(sym) || watch.includes(sym) });
  if (settings) e.setSettings(settings);
  e.setWatchlist(watch);
  e.onAlert((a) => pendingAlerts.push(a));
  e.onNews((n) => pendingNews.push(n));
  return e;
}

function makeProvider(c: Config): Provider {
  if (c.provider === 'alpaca') return new AlpacaProvider(c.alpaca);
  if (c.provider === 'massive') return new MassiveProvider(c.massive);
  return new DemoProvider();
}

function setStatus(s: Partial<ProviderStatus>): void {
  status = { ...status, ...s };
  if (s.message) log('info', `Estado: ${s.message}`);
  broadcast({ t: 'status', status });
}

const ctx: ProviderContext = {
  engine: () => engine,
  log,
  setStatus,
  universe,
  universeMin: cfg.universeMin,
  universeMax: cfg.universeMax,
};

function send(c: Client, msg: unknown): void {
  if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
}

function broadcast(msg: unknown): void {
  if (!clients.size) return;
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
}

function hello(c: Client): void {
  send(c, { t: 'hello', status, alerts: engine.alerts.slice(-400), news: engine.news.slice(0, 200), serverTime: provider.now() });
  send(c, { t: 'view', view: engine.view() });
}

// ------------------------------------------------------------------ arranque del proveedor

async function startProvider(): Promise<void> {
  try {
    await provider.start(ctx);
    log('info', `Proveedor listo: ${provider.label}.`);
    if (cfg.provider !== 'demo') void loadFundamentals();
  } catch (e) {
    const msg = (e as Error).message;
    log('error', `No se pudo iniciar ${provider.label}: ${msg}`);
    setStatus({ connected: false, message: `Error al iniciar ${provider.label}: ${msg.slice(0, 200)}` });
  }
}

/** Float, short interest y acciones en circulación (en segundo plano: los escáneres ya funcionan). */
async function loadFundamentals(): Promise<void> {
  const day = sessionKey;
  const csv = await loadFloatCsv(cfg.floatCsv);
  let massive = new Map<string, number>();
  let short = new Map<string, number>();
  if (cfg.massive.key) {
    const limiter = cfg.massive.plan === 'basic' ? new RateLimiter(5, 61_000) : new RateLimiter(20, 1000);
    massive = await massiveFloat(cfg.massive.restUrl, cfg.massive.key, limiter, day, log);
    short = await massiveShortInterest(cfg.massive.restUrl, cfg.massive.key, limiter, day, log);
  }
  const fmp = cfg.fmpKey ? await fmpFloat(cfg.fmpKey, day, log) : new Map<string, { float: number; outstanding?: number }>();
  let secShares = new Map<string, number>();
  if (sec) {
    try {
      await sec.init(day);
      secShares = await sec.sharesOutstanding(day);
    } catch (e) {
      log('warn', `SEC: ${(e as Error).message}`);
    }
  }
  let withFloat = 0;
  for (const sym of universe) {
    const c = csv.get(sym);
    const f = c?.float ?? massive.get(sym) ?? fmp.get(sym)?.float;
    const so = c?.sharesOutstanding ?? fmp.get(sym)?.outstanding ?? secShares.get(sym);
    const source = c?.float ? 'CSV' : massive.has(sym) ? 'Massive' : fmp.has(sym) ? 'FMP' : so ? 'SEC (en circulación)' : undefined;
    if (f) withFloat++;
    if (f || so || short.has(sym)) {
      engine.updateReference(sym, { float: f, sharesOutstanding: so, shortInterest: short.get(sym), floatSource: source });
    }
  }
  log('info', `Fundamentales: float para ${withFloat} de ${universe.size} acciones.`);
  if (!withFloat) {
    log('warn', 'Sin datos de float: cargá MASSIVE_API_KEY (el plan gratis alcanza), FMP_API_KEY o data/float.csv.');
  }
}

// ------------------------------------------------------------------ ciclos

setInterval(() => engine.tick(provider.now()), 250);

setInterval(() => {
  if (pendingAlerts.length) {
    broadcast({ t: 'alerts', alerts: pendingAlerts });
    pendingAlerts = [];
  }
  if (pendingNews.length) {
    broadcast({ t: 'news', items: pendingNews });
    pendingNews = [];
  }
}, 250);

let lastView: ReturnType<Engine['view']> | null = null;
setInterval(() => {
  if (!clients.size) return;
  lastView = engine.view();
  broadcast({ t: 'view', view: lastView });
  for (const c of clients) if (c.selected) send(c, { t: 'detail', detail: engine.detail(c.selected) });
}, 1000);

// Símbolos calientes: los que están en algún escáner, la watchlist y los seleccionados.
setInterval(() => {
  const view = lastView ?? engine.view();
  const hot: string[] = [];
  const add = (s: string) => !hot.includes(s) && hot.push(s);
  watch.forEach(add);
  for (const c of clients) if (c.selected) add(c.selected);
  for (const rows of Object.values(view.scanners)) for (const r of rows) add(r.sym);
  provider.setHot(hot);
  if (sec?.ready) {
    for (const sym of hot.slice(0, 80)) {
      if (secRequested.has(sym)) continue;
      secRequested.add(sym);
      void sec.flags(sym, sessionKey).then((flags) => {
        if (flags) engine.updateReference(sym, { flags });
      });
    }
  }
}, 10_000);

// Reinicio diario: a las 4:00 ET empieza una sesión nueva (cierres anteriores nuevos).
setInterval(() => {
  const key = sessionDate(Date.now()).dateKey;
  if (key === sessionKey || cfg.provider === 'demo') return;
  log('info', `Nueva sesión ${key}: reinicio del proveedor y del motor.`);
  sessionKey = key;
  provider.stop();
  universe.clear();
  backfilled.clear();
  secRequested.clear();
  engine = makeEngine();
  provider = makeProvider(cfg);
  for (const c of clients) hello(c);
  void startProvider();
}, 30_000);

// ------------------------------------------------------------------ HTTP + WebSocket

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function json(res: ServerResponse, body: unknown, code = 200): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  if (!existsSync(DIST)) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>Falta compilar la interfaz</h1><p>Corré <code>npm start</code> (compila y arranca) en la carpeta <code>pulso</code>.</p>');
    return;
  }
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = normalize(join(DIST, path));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
  res.end(readFileSync(file));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/health') {
    return json(res, {
      app: 'pulso',
      mode: status.mode,
      provider: provider.label,
      realtime: provider.realtime,
      connected: status.connected,
      message: status.message,
      symbols: universe.size,
    });
  }
  if (url.pathname === '/api/search') return json(res, engine.search(url.searchParams.get('q') ?? ''));
  if (url.pathname === '/api/logs') return json(res, recentLogs());
  serveStatic(req, res);
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  const client: Client = { ws, selected: null };
  clients.add(client);
  hello(client);
  ws.on('message', (raw) => {
    let msg: { t: string; sym?: string | null; settings?: Settings; syms?: string[] };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.t === 'select') {
      client.selected = msg.sym ? String(msg.sym).toUpperCase() : null;
      const sym = client.selected;
      if (sym) {
        send(client, { t: 'detail', detail: engine.detail(sym) });
        void maybeBackfill(sym, client);
      }
    } else if (msg.t === 'settings' && msg.settings) {
      settings = msg.settings;
      engine.setSettings(msg.settings);
    } else if (msg.t === 'tracked' && Array.isArray(msg.syms)) {
      engine.setTracked(msg.syms.map((x) => String(x).toUpperCase()).slice(0, 100));
    } else if (msg.t === 'watchlist' && Array.isArray(msg.syms)) {
      watch = msg.syms.map((s) => String(s).toUpperCase()).slice(0, 200);
      engine.setWatchlist(watch);
    }
  });
  ws.on('close', () => clients.delete(client));
});

/** Si el motor no tiene las velas del día completas de un símbolo, se piden al proveedor. */
async function maybeBackfill(sym: string, client: Client): Promise<void> {
  if (backfilled.has(sym) || cfg.provider === 'demo') return;
  const st = engine.get(sym);
  if (!st) return;
  const sessionStart = tradingDayStart(Date.parse(`${sessionKey}T16:00:00Z`));
  if (st.bars.length && st.bars[0].t <= sessionStart + 30 * 60_000) return;
  backfilled.add(sym);
  try {
    const bars = await provider.backfill(sym);
    if (bars?.length) {
      engine.setBars(sym, bars);
      send(client, { t: 'detail', detail: engine.detail(sym) });
    }
  } catch (e) {
    log('warn', `Velas de ${sym}: ${(e as Error).message}`);
  }
}

server.listen(cfg.port, cfg.host, () => {
  const where = `http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port}`;
  log('info', `Pulso escuchando en ${where} · proveedor: ${provider.label}`);
  if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') {
    log('warn', `HOST=${cfg.host}: cualquier equipo de tu red puede ver el escáner (las claves nunca salen del servidor).`);
  }
  if (cfg.provider !== 'demo' && !cfg.secUserAgent) {
    log('info', 'Sugerencia: definí SEC_USER_AGENT="Tu Nombre tu@email.com" para sumar alertas de dilución de la SEC.');
  }
});

if (cfg.haltsRss && cfg.provider !== 'demo') new HaltsPoller(() => engine, () => sessionKey, log).start();

void startProvider();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log('info', 'Cerrando Pulso…');
    provider.stop();
    server.close();
    process.exit(0);
  });
}
