// Configuración por variables de entorno (archivo pulso/.env; ver .env.example).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { log, ROOT } from './util';

export type ProviderName = 'demo' | 'alpaca' | 'massive';
export type MassivePlan = 'basic' | 'starter' | 'developer' | 'advanced';

export interface Config {
  provider: ProviderName;
  port: number;
  host: string;
  universeMin: number;
  universeMax: number;
  haltsRss: boolean;
  secUserAgent?: string;
  fmpKey?: string;
  floatCsv: string;
  alpaca: {
    keyId?: string;
    secret?: string;
    /** `auto`: al arrancar se prueba el SIP y, si el plan no lo permite, se usa el gratis en capas. */
    feed: 'auto' | 'sip' | 'iex' | 'delayed_sip';
    tradingUrl: string;
    dataUrl: string;
    /** Solo si se fuerza por variable de entorno (si no, depende del feed detectado). */
    streamUrl?: string;
    newsStreamUrl: string;
    /** 0 = según el plan (25 con IEX, 400 con SIP). */
    hotLimit: number;
    /** Plan gratis: cada cuánto se piden al mercado completo (demorado) los datos de todo el universo. */
    delayedPollMs: number;
    /** Plan gratis: cada cuánto se completan las velas consolidadas de los símbolos calientes. */
    hotRefreshMs: number;
  };
  massive: {
    key?: string;
    plan: MassivePlan;
    restUrl: string;
    socketUrl: string;
  };
}

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

function num(name: string, fallback: number): number {
  const v = Number(env(name));
  return Number.isFinite(v) && env(name) !== undefined ? v : fallback;
}

export function loadConfig(): Config {
  const envFile = join(ROOT, '.env');
  if (existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch (e) {
      log('warn', `No se pudo leer .env: ${(e as Error).message}`);
    }
  }

  const alpacaKey = env('ALPACA_KEY_ID') ?? env('APCA_API_KEY_ID');
  const alpacaSecret = env('ALPACA_SECRET_KEY') ?? env('APCA_API_SECRET_KEY');
  const massiveKey = env('MASSIVE_API_KEY') ?? env('POLYGON_API_KEY');
  const massivePlan = (env('MASSIVE_PLAN') ?? 'advanced').toLowerCase() as MassivePlan;
  const feed = (env('ALPACA_FEED') ?? 'auto').toLowerCase() as Config['alpaca']['feed'];

  let provider = (env('DATA_PROVIDER') ?? 'auto').toLowerCase() as ProviderName | 'auto';
  if (provider === 'auto') {
    if (alpacaKey && alpacaSecret) provider = 'alpaca';
    else if (massiveKey && massivePlan !== 'basic') provider = 'massive';
    else provider = 'demo';
  }
  if (provider === 'alpaca' && !(alpacaKey && alpacaSecret)) {
    log('warn', 'DATA_PROVIDER=alpaca pero faltan ALPACA_KEY_ID / ALPACA_SECRET_KEY: uso el modo demo.');
    provider = 'demo';
  }
  if (provider === 'massive' && !massiveKey) {
    log('warn', 'DATA_PROVIDER=massive pero falta MASSIVE_API_KEY: uso el modo demo.');
    provider = 'demo';
  }

  const realtimeMassive = massivePlan === 'advanced';
  return {
    provider,
    port: num('PORT', 8787),
    host: env('HOST') ?? '127.0.0.1',
    universeMin: num('UNIVERSE_MIN_PRICE', 0.2),
    universeMax: num('UNIVERSE_MAX_PRICE', 60),
    haltsRss: env('HALTS_RSS') !== 'false',
    secUserAgent: env('SEC_USER_AGENT'),
    fmpKey: env('FMP_API_KEY'),
    floatCsv: env('FLOAT_CSV') ?? join(ROOT, 'data', 'float.csv'),
    alpaca: {
      keyId: alpacaKey,
      secret: alpacaSecret,
      feed: ['auto', 'sip', 'iex', 'delayed_sip'].includes(feed) ? feed : 'auto',
      tradingUrl: env('ALPACA_TRADING_URL') ?? 'https://paper-api.alpaca.markets',
      dataUrl: env('ALPACA_DATA_URL') ?? 'https://data.alpaca.markets',
      streamUrl: env('ALPACA_STREAM_URL'),
      newsStreamUrl: env('ALPACA_NEWS_URL') ?? 'wss://stream.data.alpaca.markets/v1beta1/news',
      hotLimit: num('ALPACA_HOT_SYMBOLS', 0),
      delayedPollMs: num('ALPACA_DELAYED_POLL_SEC', 60) * 1000,
      hotRefreshMs: num('ALPACA_HOT_REFRESH_SEC', 300) * 1000,
    },
    massive: {
      key: massiveKey,
      plan: ['basic', 'starter', 'developer', 'advanced'].includes(massivePlan) ? massivePlan : 'advanced',
      restUrl: env('MASSIVE_REST_URL') ?? 'https://api.massive.com',
      socketUrl: env('MASSIVE_SOCKET_URL') ?? (realtimeMassive ? 'wss://socket.massive.com/stocks' : 'wss://delayed.massive.com/stocks'),
    },
  };
}
