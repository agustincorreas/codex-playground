// Tipos del bróker de práctica: órdenes, ejecuciones, posiciones, trades y sesiones.

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop';
export type OrderRole = 'entry' | 'exit' | 'stop' | 'target' | 'eod';

export interface Order {
  id: string;
  sym: string;
  side: OrderSide;
  type: OrderType;
  shares: number;
  /** Precio límite (órdenes límite) o de activación (órdenes stop). */
  price?: number;
  /** Grupo OCO: al ejecutarse una orden del grupo se cancelan las demás (stop + objetivo). */
  oco?: string;
  role: OrderRole;
  createdAt: number;
  /** En compras: stop y objetivo que se colocan cuando la orden se ejecuta. */
  bracket?: { stop?: number; target?: number };
  setup?: string;
  ctx?: EntryContext;
}

export interface Fill {
  id: string;
  orderId: string;
  sym: string;
  side: OrderSide;
  shares: number;
  price: number;
  fee: number;
  ts: number;
  role: OrderRole;
}

/** Contexto de la acción al entrar (para las estadísticas por precio, float, horario y pilares). */
export interface EntryContext {
  price: number;
  changePct: number;
  rvol: number;
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
  /** Stop al momento de entrar: define el riesgo (1R) del trade. */
  initialStop?: number;
  stop?: number;
  target?: number;
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

export interface TradingSettings {
  startingBalance: number;
  /** Comisión por acción (0 = sin comisiones, como la mayoría de los brókers). */
  commissionPerShare: number;
  minCommission: number;
  /** Simular deslizamiento según el tamaño de la orden contra el volumen. */
  slippage: boolean;
  /** 1 = cuenta cash (sin margen). */
  margin: 1 | 2 | 4;
  /** Pérdida máxima del día: bloquea nuevas compras (0 = sin límite). */
  maxDailyLoss: number;
  defaultShares: number;
  /** Riesgo en US$ para el tamaño "por riesgo" (acciones = riesgo / (entrada − stop)). */
  defaultRisk: number;
  /** Hora ET (en minutos) a la que arranca cada día simulado. */
  startMinutes: number;
}

export const DEFAULT_TRADING: TradingSettings = {
  startingBalance: 1000,
  commissionPerShare: 0,
  minCommission: 0,
  slippage: true,
  margin: 1,
  maxDailyLoss: 0,
  defaultShares: 100,
  defaultRisk: 20,
  startMinutes: 9 * 60 + 25,
};

export interface ActiveSession {
  id: string;
  mode: 'sim' | 'live';
  /** Semilla y día del simulador (para reanudar exactamente el mismo mercado). */
  seed?: number;
  dayTs?: number;
  startMinutes?: number;
  dayKey: string;
  startedAt: number;
  marketStart: number;
  /** Última hora de mercado guardada (punto de reanudación). */
  simNow?: number;
  startCash: number;
  cash: number;
  positions: Position[];
  orders: Order[];
  fills: Fill[];
  trades: Trade[];
  seq: number;
}

/** Día terminado, como queda en el historial. */
export interface SessionRecord {
  id: string;
  mode: 'sim' | 'live';
  seed?: number;
  dayKey: string;
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
