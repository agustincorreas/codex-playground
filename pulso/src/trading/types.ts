// Tipos del bróker de práctica: órdenes, ejecuciones, posiciones, trades, cuenta y sesiones.

export type OrderSide = 'buy' | 'sell';
/** `stop` es un stop a mercado; fuera de la rueda regular se dispara como límite (como en los brókers). */
export type OrderType = 'market' | 'limit' | 'stop';
export type OrderRole = 'entry' | 'exit' | 'stop' | 'target' | 'eod';
/** DAY: solo en la rueda regular. DAY+: también en pre-market y after-hours. */
export type Tif = 'DAY' | 'DAY+';
export type OrderStatus = 'sent' | 'open' | 'partial' | 'filled' | 'canceled' | 'rejected';

export interface Order {
  id: string;
  sym: string;
  side: OrderSide;
  type: OrderType;
  shares: number;
  /** Precio límite. */
  price?: number;
  /** Precio de disparo de una orden stop. */
  stopPrice?: number;
  tif: Tif;
  /** Ruta elegida (se muestra en el Level 2 cuando la orden espera en el libro). */
  route: string;
  role: OrderRole;
  /** Grupo OCO: al ejecutarse una orden del grupo se cancelan las demás (stop + objetivo). */
  oco?: string;
  status: OrderStatus;
  /** Hora de mercado del envío. */
  createdAt: number;
  /** Hora en que la orden llega al mercado (envío + latencia). */
  activeAt: number;
  updatedAt: number;
  filled: number;
  /** Precio promedio de lo ejecutado. */
  avgPrice: number;
  /** Acciones delante en la cola a ese precio (órdenes límite que esperan su turno). */
  queueAhead?: number;
  /** Último print de la cinta ya revisado para esta orden. */
  tapeSeq?: number;
  /** Orden stop ya disparada. */
  triggered?: boolean;
  /** Motivo de rechazo, cancelación o espera. */
  note?: string;
  /** En compras: stop y objetivo que se colocan cuando la orden se ejecuta. */
  bracket?: { stop?: number; target?: number };
  /** En compras sin stop automático: el stop y el objetivo del plan (no se envían como órdenes). */
  plan?: { stop?: number; target?: number };
  setup?: string;
  ctx?: EntryContext;
}

export interface Fill {
  id: string;
  orderId: string;
  sym: string;
  side: OrderSide;
  shares: number;
  /** Precio promedio de la ejecución (redondeado a 4 decimales). */
  price: number;
  /** Monto exacto (acciones × precio de cada porción). */
  value?: number;
  /** Comisión más tasas regulatorias de esta ejecución. */
  fee: number;
  ts: number;
  role: OrderRole;
}

/** Contexto de la acción al entrar (para las estadísticas por precio, float, horario, gap y volumen). */
export interface EntryContext {
  price: number;
  changePct: number;
  /** Gap de apertura (o del pre-market) contra el cierre anterior, en %. */
  gapPct?: number;
  rvol: number;
  /** Volumen relativo de los últimos 5 minutos. */
  rvol5m?: number;
  /** Volumen del día al entrar. */
  volume?: number;
  float?: number;
  score: number;
  /** Minutos desde la medianoche ET. */
  minutes: number;
}

export interface Position {
  sym: string;
  shares: number;
  avgCost: number;
  openedAt: number;
  boughtShares: number;
  boughtCost: number;
  soldShares: number;
  soldValue: number;
  fees: number;
  /** Ganancia o pérdida ya realizada con ventas parciales. */
  realized: number;
  /** Stop al momento de entrar: define el riesgo (1R) del trade. */
  initialStop?: number;
  /** Stop y objetivo como órdenes (OCO) puestas en el mercado. */
  stop?: number;
  target?: number;
  /** Stop y objetivo del plan, sin órdenes: las salidas las ejecuta el usuario. */
  planStop?: number;
  planTarget?: number;
  /** Máximo y mínimo del precio mientras la posición estuvo abierta (MFE / MAE). */
  high: number;
  low: number;
  setup?: string;
  ctx?: EntryContext;
  fills: number;
}

export type ExitReason = 'manual' | 'stop' | 'target' | 'eod';

export interface Trade {
  id: string;
  sessionId: string;
  sym: string;
  openedAt: number;
  closedAt: number;
  shares: number;
  avgEntry: number;
  avgExit: number;
  gross: number;
  fees: number;
  net: number;
  returnPct: number;
  /** Resultado en múltiplos del riesgo inicial (solo si se puso stop al entrar). */
  r?: number;
  risk?: number;
  /** Máxima ganancia y máxima pérdida flotante durante el trade, en %. */
  mfePct: number;
  maePct: number;
  exitReason: ExitReason;
  setup?: string;
  note?: string;
  ctx?: EntryContext;
  fills: number;
  /** Velas de 1 min alrededor del trade para revisarlo: [t, o, h, l, c, v]. */
  bars?: number[][];
  /** Ejecuciones para marcar en el gráfico: [ts, lado, precio, acciones]. */
  marks?: Array<[number, 'B' | 'S', number, number]>;
}

/** Qué hace un atajo de teclado (o botón rápido) del ticket. */
export type HotkeyAction =
  /** Compra límite al precio de referencia más un desplazamiento (ej. Ask + 0,05). */
  | { kind: 'buy'; shares: number | 'risk' | 'ticket'; ref: 'ask' | 'bid' | 'last'; offset: number }
  /** Vende una fracción de la posición, límite a la referencia más el desplazamiento (ej. Bid − 0,05). */
  | { kind: 'sell'; fraction: number; ref: 'ask' | 'bid' | 'last'; offset: number }
  | { kind: 'cancel' }
  | { kind: 'breakeven' };

export interface Hotkey {
  id: string;
  label: string;
  /** Tecla física (KeyboardEvent.code: 'Digit1', 'KeyQ', 'Escape'...) y modificadores. */
  code: string;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  enabled: boolean;
  /** Mostrar como botón rápido en el ticket. */
  button: boolean;
  action: HotkeyAction;
}

export interface TradingSettings {
  /** Efectivo con el que arranca (o se reinicia) la cuenta. */
  startingBalance: number;
  /** Cash: sin regla PDT, pero el dinero de las ventas se libera al día siguiente (T+1). */
  account: 'cash' | 'margin';
  /** Apalancamiento de la cuenta margen: 2x (Reg T); 4x intradía solo con US$ 25.000 o más. */
  leverage: number;
  /** Cuenta cash: aplicar la liquidación T+1. */
  settlement: boolean;
  /** Cuenta margen con menos de US$ 25.000: aplicar la regla PDT (3 day trades cada 5 días). */
  pdt: boolean;
  /** Comisión por acción (0 = sin comisiones, como la mayoría de los brókers). */
  commissionPerShare: number;
  minCommission: number;
  /** Tasas regulatorias en las ventas (SEC y FINRA TAF). */
  regFees: boolean;
  /** Demora desde que mandás la orden hasta que llega al mercado. */
  latencyMs: number;
  /** Pérdida máxima del día: bloquea nuevas compras (0 = sin límite). */
  maxDailyLoss: number;
  /**
   * Cómo se calculan las acciones y el riesgo por defecto: 'cuenta' = un porcentaje del valor de la
   * cuenta (crecen y bajan con ella); 'fijo' = `defaultShares` y `defaultRisk` tal cual.
   */
  sizing: 'cuenta' | 'fijo';
  /** Riesgo por trade como % de la cuenta (sizing 'cuenta'). */
  riskPct: number;
  /** Tamaño de una posición por defecto como % de la cuenta (sizing 'cuenta'). */
  sizePct: number;
  defaultShares: number;
  /** Riesgo en US$ para el tamaño "por riesgo" (acciones = riesgo / (entrada − stop)). */
  defaultRisk: number;
  /** Hora ET (en minutos) a la que arranca cada día simulado. */
  startMinutes: number;
  /**
   * Reloj de los días nuevos: 'ny' = "Mercado ahora" (la hora real de Nueva York, con pre-market y
   * after-hours); 'practice' = un día simulado a la hora y fecha que elijas.
   */
  clock: 'practice' | 'ny';
  defaultTif: Tif;
  /**
   * Al comprar, colocar el stop y el objetivo del ticket como órdenes OCO. Apagado, quedan como plan
   * (para el tamaño por riesgo, la R y las líneas del gráfico) y las salidas las hace el usuario.
   */
  autoBracket: boolean;
  /** Sonidos al ejecutarse, quedar en espera, cancelarse o rechazarse una orden. */
  orderSounds: boolean;
  hotkeys: Hotkey[];
}

const hk = (id: string, label: string, code: string, action: HotkeyAction, extra: Partial<Hotkey> = {}): Hotkey => ({
  id,
  label,
  code,
  shift: true,
  ctrl: false,
  alt: false,
  enabled: true,
  button: false,
  action,
  ...extra,
});

/** Atajos por defecto, al estilo de los de Ross Cameron (comprar en el ask + 5 centavos, vender en el bid − 5). */
export const DEFAULT_HOTKEYS: Hotkey[] = [
  hk('buy-ticket', 'Comprar las acciones del ticket a Ask + 0,05', 'Digit1', { kind: 'buy', shares: 'ticket', ref: 'ask', offset: 0.05 }, { button: true }),
  hk('buy-risk', 'Comprar por riesgo (hasta el stop) a Ask + 0,05', 'Digit2', { kind: 'buy', shares: 'risk', ref: 'ask', offset: 0.05 }),
  hk('buy-100', 'Comprar 100 a Ask + 0,05', 'Digit3', { kind: 'buy', shares: 100, ref: 'ask', offset: 0.05 }),
  hk('buy-500', 'Comprar 500 a Ask + 0,05', 'Digit4', { kind: 'buy', shares: 500, ref: 'ask', offset: 0.05 }),
  hk('sell-q', 'Vender ¼ de la posición a Bid − 0,05', 'KeyQ', { kind: 'sell', fraction: 0.25, ref: 'bid', offset: -0.05 }),
  hk('sell-h', 'Vender ½ de la posición a Bid − 0,05', 'KeyW', { kind: 'sell', fraction: 0.5, ref: 'bid', offset: -0.05 }),
  hk('sell-all', 'Vender toda la posición a Bid − 0,05', 'KeyE', { kind: 'sell', fraction: 1, ref: 'bid', offset: -0.05 }, { button: true }),
  hk('sell-h-ask', 'Vender ½ de la posición en el Ask', 'KeyR', { kind: 'sell', fraction: 0.5, ref: 'ask', offset: 0 }),
  hk('sell-all-ask', 'Vender toda la posición en el Ask', 'KeyT', { kind: 'sell', fraction: 1, ref: 'ask', offset: 0 }),
  hk('breakeven', 'Mover el stop al precio de entrada', 'KeyB', { kind: 'breakeven' }),
  hk('cancel', 'Cancelar las órdenes de la acción', 'Escape', { kind: 'cancel' }, { shift: false }),
];

export const DEFAULT_TRADING: TradingSettings = {
  startingBalance: 1000,
  account: 'cash',
  leverage: 2,
  settlement: true,
  pdt: true,
  commissionPerShare: 0,
  minCommission: 0,
  regFees: true,
  latencyMs: 150,
  maxDailyLoss: 0,
  sizing: 'cuenta',
  riskPct: 2,
  sizePct: 25,
  defaultShares: 100,
  defaultRisk: 20,
  startMinutes: 9 * 60 + 25,
  clock: 'practice',
  defaultTif: 'DAY+',
  autoBracket: false,
  orderSounds: true,
  hotkeys: DEFAULT_HOTKEYS,
};

/** Versión del mercado simulado: un día guardado con otra versión no se puede reanudar igual. */
export const SIM_VERSION = 3;

export interface ActiveSession {
  id: string;
  mode: 'sim' | 'live';
  /** Semilla y día del simulador (para reanudar exactamente el mismo mercado). */
  seed?: number;
  simVersion?: number;
  dayTs?: number;
  startMinutes?: number;
  /** 'ny' = "Mercado ahora": el reloj es el de Nueva York y el día termina con el after-hours. */
  clock?: 'ny';
  /** Clima del día simulado (más o menos gappers y corridas). */
  heat?: 'cold' | 'normal' | 'hot';
  dayKey: string;
  /** Número de día de práctica (calendario para la liquidación T+1 y la regla PDT). */
  dayIndex: number;
  startedAt: number;
  marketStart: number;
  /** Última hora de mercado guardada (punto de reanudación). */
  simNow?: number;
  startCash: number;
  cash: number;
  /** Dinero de ventas de hoy que todavía no se liquidó (cuenta cash, T+1). */
  unsettled: number;
  positions: Position[];
  /** Órdenes vivas (enviadas, abiertas o con ejecución parcial). */
  orders: Order[];
  /** Órdenes terminadas del día (ejecutadas, canceladas o rechazadas), la más nueva al final. */
  history: Order[];
  fills: Fill[];
  trades: Trade[];
  seq: number;
}

/** Día terminado, como queda en el historial. */
export interface SessionRecord {
  id: string;
  mode: 'sim' | 'live';
  /** Semilla, hora de inicio y reloj del día simulado (para repetirlo igual). */
  seed?: number;
  simVersion?: number;
  startMinutes?: number;
  clock?: 'ny';
  heat?: 'cold' | 'normal' | 'hot';
  dayKey: string;
  dayIndex?: number;
  startedAt: number;
  endedAt: number;
  marketStart: number;
  marketEnd: number;
  startCash: number;
  endCash: number;
  trades: Trade[];
}

export interface TrainingState {
  version: 1;
  settings: TradingSettings;
  /** Efectivo de la cuenta entre sesiones. */
  balance: number;
  /**
   * Plata puesta en la cuenta: el saldo inicial más los cambios de saldo (depósitos y retiros). El
   * resultado total es el equity menos esto. Sin el dato, el saldo inicial de los ajustes.
   */
  capital?: number;
  /** Último día de práctica empezado (crece de a uno con cada día nuevo). */
  dayIndex: number;
  /** Day trades de los días anteriores: el número de día de cada uno (para la regla PDT). */
  dayTrades: number[];
  active?: ActiveSession;
  updatedAt: number;
}

export const SETUPS = [
  'Bull flag',
  'Micro pullback',
  'Ruptura de máximo',
  'Ruptura pre-market',
  'Recupera VWAP',
  'Rojo a verde',
  'Reanudación de halt',
  'Medio / dólar entero',
  'Otro',
] as const;
