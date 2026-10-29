// Servidor de Pulso: conecta con el proveedor de datos, corre el motor y transmite las vistas a la
// interfaz por WebSocket. Las claves quedan en el servidor: el navegador nunca las ve.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { Engine } from '../src/engine/engine';
import { sessionDate, tradingDayStart } from '../src/engine/time';
import type { HistoryTf } from '../src/engine/history';
import type { Alert, Bar, NewsItem, ProviderStatus, Settings } from '../src/engine/types';
import { AccountStore, isSessionRecord, isTrainingState } from './account';
import { askClaude } from './ai';
import { AlpacaProvider } from './alpaca';
import { loadConfig, type Config } from './config';
import { fmpFloat, loadFloatCsv, massiveFloat, massiveShortInterest } from './fundamentals';
import { HaltsPoller } from './halts';
import { authorized, isAsset, isLoopback, randomToken, staticPath, tokenOf } from './http';
import { MassiveProvider } from './massive';
import { DemoProvider, type Provider, type ProviderContext } from './provider';
import { SecData } from './sec';
import { SectorLookup } from './sector';
import { log, RateLimiter, recentLogs, ROOT } from './util';

const cfg = loadConfig();
/** El servidor sigue vivo ante un error inesperado: queda en el registro y se sigue. */
process.on('uncaughtException', (e) => log('error', `Error inesperado: ${(e as Error)?.stack ?? String(e)}`));
process.on('unhandledRejection', (e) => log('error', `Promesa sin atender: ${(e as Error)?.stack ?? String(e)}`));
const LOCAL_ONLY = cfg.host === '127.0.0.1' || cfg.host === 'localhost' || cfg.host === '::1';
/** Lo que tiene que traer otro equipo de la red (el celular) para entrar: viene en la dirección que da la app. */
const TOKEN = LOCAL_ONLY ? undefined : cfg.token || randomToken();
/** Un solo limitador para todo lo que se le pide a Massive (el plan Basic admite 5 consultas por minuto). */
const massiveLimiter = cfg.massive.plan === 'basic' ? new RateLimiter(5, 61_000) : new RateLimiter(20, 1000);
/** Con el plan Basic, los sectores esperan a que terminen float y short interest (comparten la cuota). */
let fundamentalsDone = cfg.massive.plan !== 'basic';
/** Interfaz compilada (la app de escritorio la ubica con PULSO_DIST_DIR). */
const DIST = process.env.PULSO_DIST_DIR?.trim() || join(ROOT, 'dist');
/** Datos propios (la cuenta de práctica); la app de escritorio los ubica con PULSO_DATA_DIR. */
const DATA_DIR = process.env.PULSO_DATA_DIR?.trim() || join(ROOT, 'data');
/** La cuenta de práctica: una sola para todos los dispositivos que abran este servidor. */
const account = new AccountStore(join(DATA_DIR, 'cuenta-de-practica.json'));

interface Client {
  ws: WebSocket;
  selected: string | null;
  /** Identificador que manda la página: al que cambió la cuenta no se le avisa. */
  id?: string;
  /** Símbolo que mira el IA Trader de esa página (recibe su ficha aparte de la seleccionada). */
  focus?: string | null;
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
/** Sector de cada acción (Massive o SEC), pedido al elegirla y de a poco para las calientes. */
const sectors =
  cfg.provider === 'demo'
    ? null
    : new SectorLookup(
        cfg.massive.key ? { restUrl: cfg.massive.restUrl, key: cfg.massive.key, limiter: massiveLimiter } : null,
        sec,
        log,
      );
const sectorRequested = new Set<string>();

/** Pide el sector de un símbolo (una vez) y lo pone en los datos de referencia. */
function wantSector(sym: string): void {
  if (!sectors?.available || sectorRequested.has(sym) || !engine.get(sym)) return;
  sectorRequested.add(sym);
  void sectors.get(sym).then((industry) => {
    if (!industry) return;
    engine.updateReference(sym, { industry });
    for (const c of clients) if (c.selected === sym) send(c, { t: 'detail', detail: engine.detail(sym) });
  });
}
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

/** Desde cuándo está caída la conexión con el proveedor (para rellenar el hueco al volver). */
let downSince: number | undefined;
function setStatus(s: Partial<ProviderStatus>): void {
  const was = status.connected;
  status = { ...status, ...s };
  if (s.message) log('info', `Estado: ${s.message}`);
  broadcast({ t: 'status', status });
  if (was && s.connected === false) downSince = Date.now();
  if (!was && s.connected === true && downSince !== undefined) {
    const gap = Date.now() - downSince;
    downSince = undefined;
    if (gap > 60_000) {
      log('info', `Conexión recuperada tras ${Math.round(gap / 1000)} s: se rellenan las velas de lo que se mostró.`);
      backfilled.clear();
      for (const c of clients) if (c.selected) void maybeBackfill(c.selected, c, true);
    }
  }
}

/** Cada arranque del proveedor tiene su número: uno viejo (reinicio diario, reintento) abandona solo. */
let generation = 0;
function makeCtx(gen: number): ProviderContext {
  return {
    engine: () => engine,
    log,
    setStatus: (s) => {
      if (gen === generation) setStatus(s);
    },
    universe,
    universeMin: cfg.universeMin,
    universeMax: cfg.universeMax,
    alive: () => gen === generation,
  };
}

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

let retryTimer: ReturnType<typeof setTimeout> | undefined;
async function startProvider(attempt = 0): Promise<void> {
  const gen = ++generation;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = undefined;
  const p = provider;
  try {
    await p.start(makeCtx(gen));
    if (gen !== generation) return;
    log('info', `Proveedor listo: ${p.label}.`);
    if (cfg.provider !== 'demo') void loadFundamentals();
  } catch (e) {
    if (gen !== generation) return;
    const msg = (e as Error).message;
    // Sin internet, o el proveedor caído: se vuelve a intentar con esperas crecientes (30 s … 10 min).
    const wait = Math.min(30_000 * 2 ** Math.min(attempt, 5), 600_000);
    log('error', `No se pudo iniciar ${p.label}: ${msg}. Se reintenta en ${Math.round(wait / 1000)} s.`);
    setStatus({ connected: false, message: `Error al iniciar ${p.label}: ${msg.slice(0, 200)} · reintento en ${Math.round(wait / 1000)} s` });
    p.stop();
    retryTimer = setTimeout(() => {
      if (gen !== generation) return;
      provider = makeProvider(cfg);
      void startProvider(attempt + 1);
    }, wait);
  }
}

/** Float, short interest y acciones en circulación (en segundo plano: los escáneres ya funcionan). */
async function loadFundamentals(): Promise<void> {
  const day = sessionKey;
  const csv = await loadFloatCsv(cfg.floatCsv);
  let massive = new Map<string, number>();
  let short = new Map<string, number>();
  if (cfg.massive.key) {
    massive = await massiveFloat(cfg.massive.restUrl, cfg.massive.key, massiveLimiter, day, log);
    short = await massiveShortInterest(cfg.massive.restUrl, cfg.massive.key, massiveLimiter, day, log);
  }
  fundamentalsDone = true;
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

setInterval(() => {
  try {
    engine.tick(provider.now());
  } catch (e) {
    log('error', `Motor: ${(e as Error).stack ?? String(e)}`);
  }
}, 250);

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
  for (const c of clients) {
    if (c.selected) send(c, { t: 'detail', detail: engine.detail(c.selected) });
    if (c.focus && c.focus !== c.selected) send(c, { t: 'detail', detail: engine.detail(c.focus), focus: true });
  }
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
  // El sector de las calientes, de a una por vez (el plan gratis de Massive admite pocas consultas).
  if (sectors?.available && fundamentalsDone) {
    const next = hot.find((s) => !sectorRequested.has(s) && !sectors.has(s));
    if (next) wantSector(next);
    for (const s of hot) if (sectors.has(s) && !sectorRequested.has(s)) wantSector(s);
  }
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
  sectorRequested.clear();
  historyCache.clear();
  sec?.reset();
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

const MB = 1024 * 1024;
/** Error con el código HTTP con el que se responde. */
class ReqError extends Error {
  constructor(
    readonly status: number,
    msg: string,
  ) {
    super(msg);
  }
}
/** Cuerpo JSON de un pedido, con un tope por ruta (el historial lleva las velas de cada trade: es grande). */
function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers['content-length']);
  if (declared > maxBytes) return Promise.reject(new ReqError(413, 'demasiado grande'));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > maxBytes) {
        done = true;
        reject(new ReqError(413, 'demasiado grande'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ReqError(400, 'JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function fail(res: ServerResponse, e: unknown): void {
  const err = e as Partial<ReqError>;
  const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (res.headersSent) {
    res.end();
    return;
  }
  // Un cuerpo que superó el tope no se lee entero: se responde y se cierra la conexión.
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' });
  res.end(JSON.stringify({ error: String(err?.message ?? e).slice(0, 300) }), () => res.destroy());
}

/** La cuenta cambió: aviso a los demás dispositivos (no al que la cambió) para que la vuelvan a leer. */
function accountChanged(rev: number, origin: string | undefined): void {
  for (const c of clients) if (!origin || c.id !== origin) send(c, { t: 'account', rev, origin });
}

/** Historia para el gráfico, con caché en memoria (la diaria cambia poco; la de minutos, cada rato). */
const historyCache = new Map<string, { at: number; bars: Promise<Bar[]> }>();
function history(sym: string, tf: HistoryTf): Promise<Bar[]> {
  const key = `${sym}:${tf}`;
  const ttl = tf === 'day' ? 30 * 60_000 : 5 * 60_000;
  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.bars;
  const bars = provider.history ? provider.history(sym, tf).then((b) => b ?? []) : Promise.resolve([]);
  historyCache.set(key, { at: Date.now(), bars });
  bars.catch(() => historyCache.delete(key));
  if (historyCache.size > 400) historyCache.delete(historyCache.keys().next().value!);
  return bars;
}

/** GET/PUT/DELETE de la cuenta de práctica. Devuelve false si la ruta no es de la cuenta. */
function handleAccount(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  const origin = typeof req.headers['x-pulso-client'] === 'string' ? req.headers['x-pulso-client'] : undefined;
  const write = (fn: (body: unknown) => number | string, maxBytes: number, checkRev = false) => {
    void readJson(req, maxBytes)
      .then((body) => {
        // Otro dispositivo guardó antes: se le devuelve la cuenta actual (409) en vez de pisarla.
        const ifMatch = req.headers['if-match'];
        if (checkRev && typeof ifMatch === 'string' && ifMatch.trim() !== '' && Number(ifMatch.replace(/"/g, '')) !== account.rev) {
          return json(res, account.snapshot(), 409);
        }
        const out = fn(body);
        if (typeof out === 'string') return json(res, { error: out }, 400);
        accountChanged(out, origin);
        json(res, { rev: out });
      })
      .catch((e: Error) => {
        log('warn', `Cuenta de práctica: ${e.message}`);
        fail(res, e);
      });
  };
  if (pathname === '/api/account') {
    if (req.method === 'GET') return json(res, account.snapshot()), true;
    if (req.method === 'DELETE') {
      const rev = account.clear();
      accountChanged(rev, origin);
      return json(res, { rev }), true;
    }
    return false;
  }
  if (pathname === '/api/account/state' && req.method === 'PUT') return write((b) => (isTrainingState(b) ? account.saveState(b) : 'estado inválido'), 16 * MB, true), true;
  if (pathname === '/api/account/session' && req.method === 'PUT') return write((b) => (isSessionRecord(b) ? account.saveSession(b) : 'día inválido'), 64 * MB), true;
  return false;
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  if (!existsSync(DIST)) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>Falta compilar la interfaz</h1><p>Corré <code>npm start</code> (compila y arranca) en la carpeta <code>pulso</code>.</p>');
    return;
  }
  let file = staticPath(DIST, req.url ?? '/');
  if (!file) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Dirección inválida');
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  const headers: Record<string, string> = { 'Content-Type': type, 'Cache-Control': isAsset(DIST, file) ? 'public, max-age=31536000, immutable' : 'no-cache' };
  // El celular entra con `?t=` una vez; la cookie lo deja entrar después sin el token en la dirección.
  if (TOKEN && !isLoopback(req) && tokenOf(req) === TOKEN && !req.headers.cookie?.includes(`pulso_t=${TOKEN}`)) {
    headers['Set-Cookie'] = `pulso_t=${TOKEN}; Path=/; Max-Age=31536000; SameSite=Strict; HttpOnly`;
  }
  res.writeHead(200, headers);
  res.end(readFileSync(file));
}

function forbidden(res: ServerResponse, api: boolean): void {
  if (api) return json(res, { error: 'Sin permiso: abrí Pulso con la dirección que da la app (lleva el token).' }, 403);
  res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>Pulso</h1><p>Para entrar desde otro equipo, abrí la dirección que da la app de Pulso en la computadora (lleva el token al final).</p>');
}

/** Pedidos al IA Trader por minuto (la clave de Claude cuesta: nadie de la red la puede gastar sin límite). */
const aiStamps: number[] = [];
function aiAllowed(): boolean {
  const now = Date.now();
  while (aiStamps.length && now - aiStamps[0] > 60_000) aiStamps.shift();
  if (aiStamps.length >= 30) return false;
  aiStamps.push(now);
  return true;
}

const server = createServer((req, res) => {
  try {
    handle(req, res);
  } catch (e) {
    log('error', `HTTP ${req.method} ${req.url}: ${(e as Error).stack ?? String(e)}`);
    fail(res, e);
  }
  // Un pedido respondido sin leer su cuerpo se drena: si no, el cliente queda trabado mandándolo.
  if (!req.listenerCount('data')) req.resume();
});

function handle(req: IncomingMessage, res: ServerResponse): void {
  let url: URL;
  try {
    url = new URL(req.url ?? '/', 'http://localhost');
  } catch {
    return fail(res, new ReqError(400, 'dirección inválida'));
  }
  const api = url.pathname.startsWith('/api/');
  if (!authorized(req, TOKEN)) return forbidden(res, api);
  if (url.pathname === '/api/health') {
    return json(res, {
      app: 'pulso',
      mode: status.mode,
      provider: provider.label,
      realtime: provider.realtime,
      connected: status.connected,
      message: status.message,
      symbols: universe.size,
      ai: !!cfg.anthropicKey,
    });
  }
  if (url.pathname === '/api/search') return json(res, engine.search(url.searchParams.get('q') ?? ''));
  if (url.pathname === '/api/history') {
    const sym = (url.searchParams.get('sym') ?? '').toUpperCase();
    const tf = url.searchParams.get('tf') as HistoryTf;
    if (!sym || !['minute', 'hour', 'day'].includes(tf)) return json(res, { error: 'faltan sym o tf (minute, hour, day)' }, 400);
    void history(sym, tf)
      .then((bars) => json(res, bars))
      .catch((e: Error) => {
        log('warn', `Historia de ${sym} (${tf}): ${e.message}`);
        json(res, { error: e.message }, 502);
      });
    return;
  }
  if (url.pathname === '/api/symbol') {
    // Diagnóstico de una acción: cómo se combinan el feed en vivo y el mercado completo demorado.
    const st = engine.get((url.searchParams.get('sym') ?? '').toUpperCase());
    if (!st) return json(res, { error: 'símbolo desconocido' }, 404);
    return json(res, {
      sym: st.sym,
      last: st.last,
      lastTs: st.lastTs,
      volume: st.volume,
      feedVolume: st.feedVolume,
      volumeScale: st.volumeScale,
      consolidatedTs: st.consolidatedTs,
      avgVolume: st.ref.avgVolume,
      float: st.ref.float,
      bars: st.bars.length,
      lastBars: st.bars.slice(-8).map((b) => [new Date(b.t).toISOString().slice(11, 16), b.v]),
      rvol5m: engine.row(st.sym)?.rvol5m,
    });
  }
  if (url.pathname === '/api/logs') return json(res, recentLogs());
  if (url.pathname.startsWith('/api/account') && handleAccount(req, res, url.pathname)) return;
  if (url.pathname === '/api/ai' && req.method === 'POST') {
    if (!cfg.anthropicKey) return json(res, { error: 'Sin clave de Anthropic en el servidor (ANTHROPIC_API_KEY).' }, 503);
    if (!aiAllowed()) return json(res, { error: 'Demasiadas consultas al IA Trader por minuto; probá en un rato.' }, 429);
    void readJson(req, MB)
      .then(async (body) => {
        const b = body as { system?: string; prompt?: string };
        if (!b || typeof b.prompt !== 'string' || !b.prompt.trim()) return json(res, { error: 'falta prompt' }, 400);
        const text = await askClaude(cfg.anthropicKey!, cfg.anthropicModel, String(b.system ?? ''), b.prompt);
        json(res, { text });
      })
      .catch((e: Error) => {
        log('warn', `IA: ${e.message}`);
        if ((e as Partial<ReqError>).status) return fail(res, e);
        json(res, { error: e.message.slice(0, 300) }, 502);
      });
    return;
  }
  if (api) return json(res, { error: 'ruta desconocida' }, 404);
  serveStatic(req, res);
}

const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 256 * 1024,
  verifyClient: (info: { req: IncomingMessage }) => authorized(info.req, TOKEN),
});
wss.on('error', (e) => log('error', `WebSocket: ${e.message}`));
wss.on('connection', (ws) => {
  const client: Client = { ws, selected: null };
  clients.add(client);
  hello(client);
  ws.on('error', (e) => log('warn', `Cliente WebSocket: ${e.message}`));
  ws.on('message', (raw) => {
    let msg: { t: string; sym?: string | null; settings?: Settings; syms?: string[]; id?: string };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.t === 'client' && typeof msg.id === 'string') {
      client.id = msg.id.slice(0, 64);
    } else if (msg.t === 'focus') {
      client.focus = msg.sym ? String(msg.sym).toUpperCase() : null;
      if (client.focus) {
        send(client, { t: 'detail', detail: engine.detail(client.focus), focus: true });
        wantSector(client.focus);
        void maybeBackfill(client.focus, client);
      }
    } else if (msg.t === 'select') {
      client.selected = msg.sym ? String(msg.sym).toUpperCase() : null;
      const sym = client.selected;
      if (sym) {
        send(client, { t: 'detail', detail: engine.detail(sym) });
        wantSector(sym);
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

/**
 * Al elegir un símbolo: si el motor no tiene las velas del día completas se piden al proveedor, y las
 * velas de 10 s de las últimas horas se arman con las operaciones históricas (una vez por símbolo).
 */
async function maybeBackfill(sym: string, client: Client, refill = false): Promise<void> {
  if (backfilled.has(sym) || cfg.provider === 'demo') return;
  const st = engine.get(sym);
  if (!st) return;
  backfilled.add(sym);
  const sessionStart = tradingDayStart(Date.parse(`${sessionKey}T16:00:00Z`));
  // Tras una caída, las velas del día se vuelven a pedir enteras y reemplazan las que haya (rellenan el hueco).
  if (refill || !(st.bars.length && st.bars[0].t <= sessionStart + 30 * 60_000)) {
    try {
      const bars = await provider.backfill(sym);
      if (bars?.length) {
        if (refill) engine.mergeBars(sym, bars);
        else engine.setBars(sym, bars);
        send(client, { t: 'detail', detail: engine.detail(sym) });
      }
    } catch (e) {
      log('warn', `Velas de ${sym}: ${(e as Error).message}`);
    }
  }
  if (provider.backfillSec) {
    try {
      const push = (bars: Bar[]) => {
        if (refill) engine.mergeSecBars(sym, bars);
        else engine.setSecBars(sym, bars);
        if (client.selected === sym) send(client, { t: 'detail', detail: engine.detail(sym) });
      };
      const sec = await provider.backfillSec(sym, push);
      if (sec?.length) push(sec);
    } catch (e) {
      log('warn', `Velas de 10 s de ${sym}: ${(e as Error).message}`);
    }
  }
}

server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') log('error', `El puerto ${cfg.port} ya está en uso (¿otro Pulso abierto?). Cerralo o cambiá PORT.`);
  else log('error', `Servidor: ${e.message}`);
  process.exit(1);
});
server.listen(cfg.port, cfg.host, () => {
  const where = `http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port}`;
  log('info', `Pulso escuchando en ${where} · proveedor: ${provider.label}`);
  if (TOKEN) {
    log('info', `Desde otro equipo de tu red: http://<ip-de-esta-computadora>:${cfg.port}/?t=${TOKEN} (las claves nunca salen del servidor).`);
    if (!cfg.token) log('info', 'El token cambia en cada arranque; para uno fijo, definí PULSO_TOKEN en el .env.');
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
