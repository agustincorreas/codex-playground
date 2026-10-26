// Tipos compartidos por el motor, los feeds (simulado / Alpaca / Massive) y la interfaz.

export type Session = 'closed' | 'pre' | 'regular' | 'post';

/** Vela de 1 minuto. `t` = inicio del minuto (ms epoch), `pv` = Σ precio·volumen (para VWAP). */
export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  pv: number;
  n: number;
}

/** Datos de referencia por símbolo: se cargan al arrancar y se completan en forma diferida. */
export interface ReferenceData {
  sym: string;
  name?: string;
  exchange?: string;
  prevClose?: number;
  /** Volumen diario promedio (≈30 ruedas). */
  avgVolume?: number;
  /** Acciones en float (libres para operar). */
  float?: number;
  floatSource?: string;
  sharesOutstanding?: number;
  shortInterest?: number;
  /** Etiquetas de contexto: "Shelf S-3", "Oferta 424B", "Pérdidas", etc. */
  flags?: string[];
  /** Sector o industria ("Farmacéutica", "Software"…). */
  industry?: string;
}

/** Estado del día al arrancar a mitad de rueda (snapshot del proveedor). */
export interface DaySnapshot {
  sym: string;
  ts: number;
  last: number;
  open?: number;
  high: number;
  low: number;
  volume: number;
  vwap?: number;
  prevClose?: number;
}

/**
 * Estado del día de un símbolo según el mercado completo pero con demora (por ejemplo, el SIP con 15
 * minutos de atraso del plan gratis de Alpaca). Complementa a un feed parcial en tiempo real.
 */
export interface DelayedSnapshot {
  sym: string;
  /** Hora hasta la que llegan estos datos. */
  ts: number;
  last: number;
  high: number;
  low: number;
  volume: number;
  vwap?: number;
  open?: number;
  /** Última vela de 1 minuto consolidada (reemplaza a la del feed parcial de ese minuto). */
  minute?: Bar;
}

export interface NewsItem {
  id: string;
  ts: number;
  headline: string;
  summary?: string;
  source?: string;
  url?: string;
  symbols: string[];
  sentiment?: 'bullish' | 'bearish' | 'neutral';
}

export type MarketEvent =
  | {
      kind: 'trade';
      sym: string;
      ts: number;
      price: number;
      size: number;
      /** false para prints que no deben mover último/máximo (odd lots, precio promedio, etc.). */
      updatesPrice?: boolean;
    }
  | {
      kind: 'bar';
      sym: string;
      /** Inicio del período del agregado (ms). */
      ts: number;
      o: number;
      h: number;
      l: number;
      c: number;
      v: number;
      vw?: number;
      n?: number;
      /** 'second' = agregado parcial que se acumula; 'minute' = vela oficial que reemplaza a la propia. */
      span: 'second' | 'minute';
      /** Volumen acumulado del día según el proveedor (corrige el propio). */
      dayVolume?: number;
      /** VWAP del día según el proveedor. */
      dayVwap?: number;
    }
  | {
      kind: 'status';
      sym: string;
      ts: number;
      halted: boolean;
      reason: string;
      reasonText?: string;
      /** Hora estimada / anunciada de reanudación. */
      resumeTs?: number;
      source?: string;
    }
  | { kind: 'luld'; sym: string; ts: number; up: number; down: number }
  | { kind: 'news'; item: NewsItem }
  /** Mejor compra y venta del mercado (NBBO) con su tamaño. */
  | { kind: 'quote'; sym: string; ts: number; bid: number; ask: number; bidSize: number; askSize: number };

/** Dónde se hizo un print respecto de las puntas de ese momento (los colores de la cinta). */
export type TapeSide = 'below' | 'bid' | 'mid' | 'ask' | 'above';

/** Un print de la cinta (Time & Sales). */
export interface TapePrint {
  /** Número de orden (crece de a uno en cada print del motor). */
  seq: number;
  ts: number;
  price: number;
  size: number;
  side: TapeSide;
}

export type AlertType =
  | 'hod'
  | 'nearHod'
  | 'running'
  | 'squeeze'
  | 'volume'
  | 'halt'
  | 'resume'
  | 'vwapReclaim'
  | 'vwapLoss'
  | 'pmhBreak'
  | 'level'
  | 'redToGreen'
  | 'bullFlag'
  | 'news'
  | 'stacking'
  | 'flush'
  | 'gapper'
  | 'rotation'
  /** El precio cruzó una línea con alerta que dibujaste en el gráfico. */
  | 'priceLine';

export type Tone = 'up' | 'down' | 'info' | 'warn';

export interface Alert {
  id: string;
  ts: number;
  sym: string;
  type: AlertType;
  text: string;
  price: number;
  changePct: number;
  volume: number;
  rvol: number;
  float?: number;
  /** Pilares cumplidos (0-5) al momento de la alerta. */
  score: number;
  tone: Tone;
  /** true si se generó durante el precalentamiento (no suena). */
  warmup?: boolean;
  plan?: TradePlan;
}

export interface TradePlan {
  entry: number;
  stop: number;
  target: number;
}

export interface Pillars {
  price: boolean;
  change: boolean;
  rvol: boolean;
  news: boolean;
  /** null = float desconocido. */
  float: boolean | null;
  score: number;
}

export interface ScanRow {
  sym: string;
  name?: string;
  price: number;
  prevClose: number;
  changePct: number;
  gapPct: number;
  volume: number;
  rvol: number;
  rvol5m: number;
  float?: number;
  /** true si el float es una estimación (acciones en circulación). */
  floatEst?: boolean;
  rotation?: number;
  chg1m: number;
  chg5m: number;
  chg15m: number;
  vol5m: number;
  hod: number;
  lod: number;
  pctFromHod: number;
  vwap: number;
  hasNews: boolean;
  halted: boolean;
  score: number;
  pillars: Pillars;
  /** Punta compradora / vendedora estimadas (spread sintético según precio y volatilidad). */
  bid: number;
  ask: number;
  ticks: number;
  flags?: string[];
  lastTs: number;
  dir: 1 | -1 | 0;
}

export type ScannerId = 'gappers' | 'pillars' | 'running' | 'lowFloat' | 'rvol' | 'fades';

export interface HaltRow {
  sym: string;
  ts: number;
  halted: boolean;
  reason: string;
  reasonText: string;
  resumeTs?: number;
  resumedAt?: number;
  price: number;
  changePct: number;
  /** Precio al momento del halt (para comparar la reanudación). */
  haltPrice: number;
  count: number;
}

export interface ViewModel {
  ts: number;
  session: Session;
  scanners: Record<ScannerId, ScanRow[]>;
  watch: ScanRow[];
  /** Filas de los símbolos con posición u órdenes abiertas (para el bróker de práctica). */
  tracked: ScanRow[];
  hodBoard: ScanRow[];
  halts: HaltRow[];
  stats: { tracked: number; active: number; eventsPerSec: number };
}

export interface SetupHealth {
  aboveVwap: boolean;
  aboveEma9: boolean;
  aboveEma20: boolean;
  macdBullish: boolean;
  /** Bull flag armado: entrada en la primera vela que haga nuevo máximo. */
  flag?: TradePlan & { poleHigh: number; armedAt: number };
  nextLevel: number;
}

/** Cotización para simular órdenes. */
export interface Quote {
  sym: string;
  last: number;
  bid: number;
  ask: number;
  /** Acciones en la mejor punta (0 si el spread es estimado). */
  bidSize: number;
  askSize: number;
  /** true si las puntas vienen del mercado; false si se estiman a partir del precio. */
  real: boolean;
  ts: number;
  halted: boolean;
  /** Volumen típico por minuto (promedio de las últimas velas): mide la liquidez. */
  volPerMin: number;
}

export interface SymbolDetail {
  sym: string;
  ref: ReferenceData;
  row: ScanRow;
  bars: Bar[];
  /** Velas de 10 segundos (para los gráficos de 10 s y 30 s). */
  secBars: Bar[];
  /** Últimos prints (Time & Sales), el más nuevo al final. */
  tape: TapePrint[];
  quote: Quote | null;
  open: number;
  pmHigh: number;
  lod: number;
  ema9: number;
  ema20: number;
  macd: { macd: number; signal: number; hist: number };
  news: NewsItem[];
  halt?: HaltRow;
  luld?: { up: number; down: number };
  setup: SetupHealth;
}

export interface Settings {
  /** Pilar 1: rango de precio. */
  priceMin: number;
  priceMax: number;
  /** Pilar 2: ya sube al menos este % en el día. */
  minChangePct: number;
  /** Pilar 3: volumen relativo mínimo. */
  minRvol: number;
  /** Pilar 5: float máximo ideal. */
  maxFloat: number;
  /** Float máximo aceptable (scanner "Low float"). */
  maxFloatSoft: number;
  /** Pilar 4: ventana para considerar que hay noticia. */
  newsWindowHours: number;
  /** Volumen mínimo del día para aparecer en los escáneres. */
  minVolume: number;
  /** % mínimo para la lista de gappers. */
  gapperMinPct: number;
  /** % mínimo en 5 minutos para "Subiendo ahora". */
  runMinPct5m: number;
  /** % mínimo del día para que suenen las alertas de máximo del día. */
  hodMinChangePct: number;
  /** Pilares mínimos para la lista "5 pilares". */
  pillarsMinScore: number;
}

export const DEFAULT_SETTINGS: Settings = {
  priceMin: 1,
  priceMax: 20,
  minChangePct: 10,
  minRvol: 5,
  maxFloat: 10_000_000,
  maxFloatSoft: 20_000_000,
  newsWindowHours: 24,
  minVolume: 50_000,
  gapperMinPct: 5,
  runMinPct5m: 3,
  hodMinChangePct: 5,
  pillarsMinScore: 4,
};

/** Mensajes que la UI recibe desde una fuente de datos (local o servidor). */
export interface ProviderStatus {
  mode: 'demo' | 'live';
  provider: string;
  connected: boolean;
  message: string;
  realtime: boolean;
  /** Texto de la etiqueta del encabezado (si no, se arma con `realtime` y `provider`). */
  badge?: string;
  /** Velocidad de la simulación (solo demo). */
  speed?: number;
}
