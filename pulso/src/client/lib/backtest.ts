// Backtest del IA Trader: un día entero del simulador sin pantalla (el mismo recorrido que
// `scripts/ia-dia.ts`): se arma el mercado de una semilla, se avanza el reloj de a un segundo y el IA
// Trader en automático, solo con las reglas (sin Claude), opera una cuenta de práctica nueva. Al final
// se miden sus trades. Corre en un Worker, en el hilo principal en tandas (página única del demo) y en
// Node (pruebas): no usa `window`, `document` ni `localStorage`.
import { DEFAULT_SETTINGS } from '../../engine/types';
import type { Engine } from '../../engine/engine';
import { etWallToTs, PRE_OPEN, previousTradingDays, sessionDate } from '../../engine/time';
import type { MarketSim } from '../../sim/simulator';
import { seedForDay } from '../../sim/simulator';
import type { AiProfile, PlaybookRules } from '../../trading/playbook';
import type { TrainingStore } from '../../trading/store';
import type { Trade } from '../../trading/types';
import { AiTrader } from '../aitrader';
import { LocalSource } from '../source/local';
import { TrainingController } from '../training';

const MIN = 60_000;
/** Hora ET (minutos) desde la que se simula, como un día de práctica: justo antes de la apertura. */
export const DEFAULT_START = 9 * 60 + 25;
/** Después del horario de entradas del perfil se sigue este rato para que cierre lo que quedó abierto. */
const AFTER_WINDOW = 10;

export interface BacktestDay {
  seed: number;
  /** AAAA-MM-DD del día hábil simulado. */
  dayKey: string;
  /** Un instante de ese día (para el simulador). */
  dayTs: number;
}

export interface BacktestSetup {
  profile: AiProfile;
  /** Reglas a mano (perfil "personalizado"); con otro perfil se ignoran, porque el perfil las fija. */
  rules?: PlaybookRules;
  account: 'cash' | 'margin';
  /** Saldo con el que arranca cada día (los días no se acumulan: cada uno parte del mismo saldo). */
  balance: number;
  /** Sin Claude: solo las reglas. Así el resultado es repetible y no cuesta consultas. */
  consult: false;
  /** Hora ET (minutos) desde la que se simula; por defecto 9:25. */
  startMinutes?: number;
}

export interface BacktestOptions extends BacktestSetup {
  seed: number;
  /** Un instante del día a simular (por defecto, el último día hábil). */
  dayTs?: number;
  /** Avance del día, de 0 a 1 (cada minuto simulado). */
  onProgress?: (fraction: number) => void;
  /** Trabajo seguido (ms) antes de ceder el hilo: en el hilo principal evita congelar la interfaz. */
  sliceMs?: number;
  signal?: AbortSignal;
}

export interface BacktestDayResult {
  seed: number;
  dayKey: string;
  trades: Trade[];
  net: number;
  wins: number;
  /** R promedio de los trades que tuvieron stop (0 si ninguno). */
  avgR: number;
  /** Mayor caída desde un máximo de la curva del día, en US$. */
  maxDrawdown: number;
  /** Saldo después de cada trade, empezando por el saldo inicial. */
  equityCurve: number[];
}

export interface BacktestSummary {
  days: number;
  trades: number;
  wins: number;
  /** Porcentaje de trades ganadores (0 a 100). */
  winRate: number;
  avgR: number;
  net: number;
  bestDay: { dayKey: string; net: number } | null;
  worstDay: { dayKey: string; net: number } | null;
  /** Perdedores seguidos, el peor tramo (a través de los días). */
  maxLosingStreak: number;
  maxDrawdown: number;
  /** Saldo trade a trade a través de todos los días, desde el saldo inicial. */
  equityCurve: number[];
}

/** Lo que el Worker (o la corrida en el hilo principal) va contando mientras simula. */
export type BacktestMessage =
  | { type: 'progress'; day: number; total: number; fraction: number }
  | { type: 'day'; day: number; total: number; result: BacktestDayResult }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type BacktestRequest = { type: 'run'; days: BacktestDay[]; setup: BacktestSetup };

const money = (v: number) => Math.round(v * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Los últimos `n` días hábiles (el más viejo primero) con la semilla de "Mercado ahora" de cada fecha:
 * el mismo mercado que tuvo la página ese día, así el backtest responde "cómo le habría ido a la IA".
 */
export function recentDays(n: number, now = Date.now()): BacktestDay[] {
  const last = sessionDate(now);
  const days = n > 1 ? [...previousTradingDays(last, n - 1).reverse(), last] : [last];
  return days.map((d) => {
    const dayKey = `${d.y}-${pad(d.mo)}-${pad(d.d)}`;
    return { seed: seedForDay(dayKey), dayKey, dayTs: etWallToTs(d.y, d.mo, d.d, 12 * 60) };
  });
}

/** Cede el hilo (una vuelta del reloj) para que la interfaz respire. */
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Backtest cancelado.');
}

/**
 * Hace una cosa que guarda en localStorage sin dejar rastro: el IA Trader del backtest guarda sus
 * ajustes al configurarse (como el de la página) y no tiene que pisar los del usuario. En un Worker o
 * en Node no hay localStorage y no hace falta nada.
 */
function withoutSaving(key: string, fn: () => void): void {
  let before: string | null | undefined;
  try {
    before = localStorage.getItem(key);
  } catch {
    before = undefined;
  }
  fn();
  if (before === undefined) return;
  try {
    if (before === null) localStorage.removeItem(key);
    else localStorage.setItem(key, before);
  } catch {
    // Sin almacenamiento: no había nada que proteger.
  }
}

/** Un día del simulador con el IA Trader en automático: sus trades y la curva del día. */
export async function runBacktestDay(opts: BacktestOptions): Promise<BacktestDayResult> {
  throwIfAborted(opts.signal);
  const startMinutes = opts.startMinutes ?? DEFAULT_START;
  const dayTs = opts.dayTs ?? Date.now();
  const src = new LocalSource(DEFAULT_SETTINGS, [], { sessionId: 'backtest', seed: opts.seed, dayTs, startMinutes });
  const noop = () => {};
  // start() genera el día y avisa con la primera vista; después se para su reloj: el tiempo lo movemos acá.
  await new Promise<void>((resolve) => src.start({ onView: () => resolve(), onDetail: noop, onAlerts: noop, onNews: noop, onStatus: noop }));
  src.stop();
  throwIfAborted(opts.signal);
  const { sim, engine } = src as unknown as { sim: MarketSim; engine: Engine };

  const store: TrainingStore = { kind: 'navegador', load: async () => ({ state: null, sessions: [] }), saveState: async () => {}, saveSession: async () => {}, clear: async () => {} };
  const c = new TrainingController(store, { state: null, sessions: [] }, 'local');
  c.updateSettings({ account: opts.account, latencyMs: 100 });
  c.setBalance(opts.balance);
  // El día de la cuenta es el mismo que el del mercado (fecha y semilla), como al repetir un día.
  c.newDay({ clock: 'practice', date: sim.dateKey, startMinutes, seed: opts.seed });
  c.attach(src);

  const t = new AiTrader(c, noop, { instructions: false });
  t.attach(src);
  const custom = opts.profile === 'personalizado' && opts.rules ? { rules: opts.rules } : {};
  withoutSaving('pulso:ai-settings', () => t.update({ mode: 'auto', consult: false, follow: false, profile: opts.profile, ...custom }));

  const start = sim.now;
  const windowEnd = sim.dayStart + (t.settings.rules.entryTo + AFTER_WINDOW - PRE_OPEN) * MIN;
  const hardEnd = sim.closeTs;
  const held = () => (c.active?.positions.length ?? 0) > 0;
  let sliceStart = Date.now();
  let lastMinute = -1;
  while (sim.now < windowEnd || (held() && sim.now < hardEnd)) {
    sim.advance(1000);
    const now = sim.now;
    engine.tick(now);
    c.onTick(now);
    t.setView(engine.view(), DEFAULT_SETTINGS);
    t.step(now);
    const minute = Math.floor((now - start) / MIN);
    if (minute !== lastMinute) {
      lastMinute = minute;
      opts.onProgress?.(Math.min(1, (now - start) / (windowEnd - start)));
      if (opts.sliceMs && Date.now() - sliceStart >= opts.sliceMs) {
        await breathe();
        sliceStart = Date.now();
        throwIfAborted(opts.signal);
      }
    }
  }
  opts.onProgress?.(1);
  t.detach();
  c.detach(src);
  return summarizeDay(opts.seed, sim.dateKey, c.active?.trades ?? [], opts.balance);
}

/** Resumen de un día a partir de sus trades (sin las velas de revisión, que pesan y acá no se usan). */
export function summarizeDay(seed: number, dayKey: string, trades: Trade[], balance: number): BacktestDayResult {
  const slim = [...trades]
    .sort((a, b) => a.closedAt - b.closedAt)
    .map((t) => {
      const copy = { ...t };
      delete copy.bars;
      delete copy.marks;
      return copy;
    });
  const equityCurve = [balance];
  let eq = balance;
  for (const t of slim) {
    eq = money(eq + t.net);
    equityCurve.push(eq);
  }
  const withR = slim.filter((t) => t.r !== undefined);
  return {
    seed,
    dayKey,
    trades: slim,
    net: money(slim.reduce((a, t) => a + t.net, 0)),
    wins: slim.filter((t) => t.net > 0).length,
    avgR: withR.length ? Math.round((withR.reduce((a, t) => a + t.r!, 0) / withR.length) * 100) / 100 : 0,
    maxDrawdown: maxDrawdownOf(equityCurve),
    equityCurve,
  };
}

/** Mayor caída desde un máximo anterior, en las unidades de la curva. */
export function maxDrawdownOf(curve: number[]): number {
  let peak = -Infinity;
  let dd = 0;
  for (const v of curve) {
    peak = Math.max(peak, v);
    dd = Math.max(dd, peak - v);
  }
  return money(dd);
}

/** Junta varios días (en el orden dado) en un solo resultado. */
export function summarizeBacktest(results: BacktestDayResult[], balance: number): BacktestSummary {
  const trades = results.flatMap((r) => r.trades);
  const wins = trades.filter((t) => t.net > 0).length;
  const withR = trades.filter((t) => t.r !== undefined);
  const equityCurve = [balance];
  let eq = balance;
  let streak = 0;
  let maxLosingStreak = 0;
  for (const t of trades) {
    eq = money(eq + t.net);
    equityCurve.push(eq);
    streak = t.net < 0 ? streak + 1 : 0;
    maxLosingStreak = Math.max(maxLosingStreak, streak);
  }
  const byNet = [...results].sort((a, b) => b.net - a.net);
  const pick = (r?: BacktestDayResult) => (r ? { dayKey: r.dayKey, net: r.net } : null);
  return {
    days: results.length,
    trades: trades.length,
    wins,
    winRate: trades.length ? Math.round((wins / trades.length) * 1000) / 10 : 0,
    avgR: withR.length ? Math.round((withR.reduce((a, t) => a + t.r!, 0) / withR.length) * 100) / 100 : 0,
    net: money(trades.reduce((a, t) => a + t.net, 0)),
    bestDay: pick(byNet[0]),
    worstDay: pick(byNet[byNet.length - 1]),
    maxLosingStreak,
    maxDrawdown: maxDrawdownOf(equityCurve),
    equityCurve,
  };
}

/**
 * Corre varios días seguidos avisando el avance y cada día terminado. Lo usan el Worker y la corrida en
 * el hilo principal (con `sliceMs`, para ceder el hilo cada tanto).
 */
export async function runBacktest(days: BacktestDay[], setup: BacktestSetup, emit: (m: BacktestMessage) => void, extra: { sliceMs?: number; signal?: AbortSignal } = {}): Promise<BacktestDayResult[]> {
  const results: BacktestDayResult[] = [];
  try {
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      emit({ type: 'progress', day: i, total: days.length, fraction: 0 });
      const result = await runBacktestDay({ ...setup, seed: d.seed, dayTs: d.dayTs, sliceMs: extra.sliceMs, signal: extra.signal, onProgress: (fraction) => emit({ type: 'progress', day: i, total: days.length, fraction }) });
      results.push(result);
      emit({ type: 'day', day: i, total: days.length, result });
      // Entre día y día, que la interfaz pinte lo que llegó.
      if (extra.sliceMs) await breathe();
    }
    emit({ type: 'done' });
  } catch (e) {
    emit({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
  return results;
}
