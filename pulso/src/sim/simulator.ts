// Mercado simulado para el modo demo: ~150 acciones ficticias con gappers de pre-market, runners
// que arrancan con una noticia (subida con volumen, pullbacks, halts LULD, fade o flush), ofertas de
// acciones que las hunden y ruido de fondo, con el volumen de cada hora (pre-market, rueda regular y
// after-hours). Genera los mismos eventos que un proveedor real, así que el motor no distingue la
// diferencia.
//
// El camino de cada acción (precio y volumen) depende solo de la semilla y del día, no de la hora a la
// que se empieza a mirar: cada acción tiene su propio azar, las tranquilas avanzan de a un minuto y los
// cambios de ritmo caen en el minuto justo. Así el mercado se puede rearmar en cualquier momento (al
// reanudar o al volver al modo "Mercado ahora") y es el mismo que ya viste. El detalle de cada operación
// (puntas, tamaños, cinta) usa un azar aparte que no toca ese camino.
import type { MarketEvent, ReferenceData } from '../engine/types';
import { etParts, etWallToTs, isTradingDay, POST_CLOSE, PRE_OPEN, REG_CLOSE, REG_OPEN, regularCloseMinutes, volumeIntensity } from '../engine/time';
import { earningsHeadline, headline, makeCompanies, NEWS_SOURCES, offeringHeadline } from './names';

const SEC = 1000;
const MIN = 60_000;
/** Minutos previos a la hora de inicio que se simulan con cinta completa. */
const TAPE_WARM = 3 * MIN;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Último día hábil (ET) que contiene o precede a `ts`. */
export function lastTradingDay(ts: number): { y: number; mo: number; d: number } {
  let probe = ts;
  for (let i = 0; i < 10; i++) {
    const p = etParts(probe);
    if (isTradingDay(p)) return { y: p.y, mo: p.mo, d: p.d };
    probe -= 24 * 3_600_000;
  }
  const p = etParts(ts);
  return { y: p.y, mo: p.mo, d: p.d };
}

/** Semilla del modo "Mercado ahora": la misma para todos ese día, como un mercado de verdad. */
export function seedForDay(dateKey: string): number {
  let h = 2166136261;
  for (const ch of `pulso-ny-${dateKey}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function heatOf(x: number): DayHeat {
  return x < 0.25 ? 'cold' : x < 0.75 ? 'normal' : 'hot';
}

/** Clima del día que genera una semilla (sin armar el mercado). */
export function dayHeat(seed: number): DayHeat {
  return heatOf(mulberry32(seed >>> 0)());
}

function uni(r: () => number, a: number, b: number): number {
  return a + (b - a) * r();
}

function normal(r: () => number): number {
  const u = Math.max(1e-12, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Interpolación lineal en una tabla [minuto, valor]. */
function curve(table: Array<[number, number]>, m: number): number {
  if (m <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [m1, v1] = table[i];
    if (m <= m1) {
      const [m0, v0] = table[i - 1];
      return v0 + ((v1 - v0) * (m - m0)) / (m1 - m0);
    }
  }
  return table[table.length - 1][1];
}

/**
 * Atención de los traders de momentum según la hora (rueda regular): una acción en juego opera más en
 * la primera hora, se apaga al mediodía y repunta un poco a la tarde.
 */
const ATTENTION: Array<[number, number]> = [
  [REG_OPEN, 1.25],
  [10 * 60, 1.1],
  [11 * 60, 0.9],
  [12 * 60, 0.75],
  [14 * 60, 0.72],
  [15 * 60, 0.85],
  [REG_CLOSE, 0.9],
];

/** Clima del día: en un día caliente hay más gappers, corridas más grandes y más seguidas. */
export type DayHeat = 'cold' | 'normal' | 'hot';

const HEAT: Record<DayHeat, { gappers: [number, number]; gap: number; gain: number; every: number; go: number }> = {
  cold: { gappers: [3, 4], gap: 0.7, gain: 0.75, every: 1.8, go: 0.4 },
  normal: { gappers: [6, 8], gap: 1, gain: 1, every: 1, go: 0.55 },
  hot: { gappers: [9, 12], gap: 1.3, gain: 1.25, every: 0.65, go: 0.7 },
};

interface Leg {
  kind: string;
  dur: number;
  /** Retorno logarítmico total del tramo. */
  ret: number;
  /** Multiplicador de volumen sobre el normal. */
  vol: number;
  sigma: number;
  halt?: boolean;
}

interface WarmBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  pv: number;
  n: number;
}

/** Minuto planeado de una acción tranquila: de dónde a dónde va el precio y cuánto opera. */
interface MinutePlan {
  from: number;
  p0: number;
  p1: number;
  shares: number;
  /** Se generó antes de la cinta (ya está en las velas): en vivo no se vuelve a imprimir. */
  warm: boolean;
}

interface SimSym {
  ref: ReferenceData;
  name: string;
  /** Precio del camino. En una acción tranquila, el del final del minuto planeado. */
  price: number;
  anchor: number;
  sigma: number;
  /** Acciones por segundo en rueda regular sin eventos. */
  baseShares: number;
  tradeSize: number;
  legs: Leg[];
  legT: number;
  /** Precio al empezar el tramo actual (el camino planeado se mide desde acá). */
  legBase: number;
  idleVol: number;
  role: 'quiet' | 'gapper' | 'runner' | 'large';
  busy: boolean;
  halted: boolean;
  haltUntil: number;
  openPlan?: 'go' | 'fade';
  /** Ya anunció una oferta de acciones hoy. */
  offered?: boolean;
  bar?: WarmBar;
  /** Azar del camino (precio y volumen) y azar del detalle (puntas, tamaños y cinta). */
  rng: () => number;
  micro: () => number;
  /** Avanza de a un segundo (con tramos o en halt); si no, de a un minuto. Cambia solo en el minuto justo. */
  fine: boolean;
  /** Tramos que arrancan en el próximo minuto (una acción tranquila cambia de ritmo en el minuto justo). */
  nextLegs?: Leg[];
  plan?: MinutePlan;
  /** Valor justo del camino segundo a segundo dentro del minuto planeado (en vivo). */
  path: number;
  /** Mejor compra y mejor venta (NBBO) con su tamaño. 0 = sin cotización (halt o antes de empezar). */
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  /** Valor justo del último print y lado del último agresor (1 compra, −1 venta). */
  fair: number;
  lastSide: number;
  /** Multiplicador del spread (más ancho justo después de reanudar un halt). */
  wide: number;
}

export interface SimOptions {
  seed?: number;
  /** Minuto del día (ET) en que arranca la simulación en vivo. Por defecto 9:27. */
  startMinutes?: number;
  /** Instante exacto en que arranca en vivo (gana sobre `startMinutes`). */
  startTs?: number;
  /** Un instante del día a simular (por defecto, el último día hábil). */
  dayTs?: number;
  count?: number;
}

export class MarketSim {
  /** Reloj publicado: todos los eventos hasta esta hora ya se emitieron. */
  now: number;
  readonly refs: ReferenceData[] = [];
  readonly dateKey: string;
  readonly dayStart: number;
  readonly openTs: number;
  readonly closeTs: number;
  /** Fin del after-hours (20:00, o 17:00 en los días de cierre anticipado). */
  readonly postTs: number;
  readonly startTs: number;
  readonly heat: DayHeat;
  /** Primer día después de un fin de semana o un feriado: se juntaron noticias y hay más gappers. */
  readonly afterBreak: boolean;
  /**
   * Solo estas acciones generan cinta y puntas (al ponerse al día con órdenes abiertas); el resto sigue
   * su camino sin publicar nada. `null` = todas.
   */
  only: Set<string> | null = null;
  private readonly closeMinutes: number;
  private readonly syms: SimSym[] = [];
  private readonly rnd: () => number;
  /** Reloj de generación: el mercado se genera de a un segundo y se publica a medida que pasa el tiempo. */
  private t: number;
  private pending: Array<{ at: number; ev: MarketEvent }> = [];
  private head = 0;
  private seq = 0;
  private live = false;
  private nextRunnerAt = 0;
  private nextNoiseNewsAt = 0;
  private scheduled: Array<{ at: number; fn: () => void }> = [];

  constructor(
    private readonly emit: (ev: MarketEvent) => void,
    opts: SimOptions = {},
  ) {
    const seed = (opts.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
    this.rnd = mulberry32(seed);
    const day = lastTradingDay(opts.dayTs ?? Date.now());
    this.dateKey = `${day.y}-${String(day.mo).padStart(2, '0')}-${String(day.d).padStart(2, '0')}`;
    this.closeMinutes = regularCloseMinutes(this.dateKey);
    this.dayStart = etWallToTs(day.y, day.mo, day.d, PRE_OPEN);
    this.openTs = etWallToTs(day.y, day.mo, day.d, REG_OPEN);
    this.closeTs = etWallToTs(day.y, day.mo, day.d, this.closeMinutes);
    this.postTs = etWallToTs(day.y, day.mo, day.d, this.closeMinutes === REG_CLOSE ? POST_CLOSE : 17 * 60);
    const start = opts.startTs ?? etWallToTs(day.y, day.mo, day.d, opts.startMinutes ?? 9 * 60 + 27);
    this.startTs = Math.min(Math.max(start, this.dayStart), this.postTs);
    this.t = this.now = this.dayStart;
    this.heat = heatOf(this.rnd());
    const prev = lastTradingDay(this.dayStart - 12 * 3_600_000);
    this.afterBreak = Math.round((Date.UTC(day.y, day.mo - 1, day.d) - Date.UTC(prev.y, prev.mo - 1, prev.d)) / 86_400_000) >= 3;
    this.buildUniverse(opts.count ?? 150, seed);
  }

  // ------------------------------------------------------------------ azar (del día: universo y eventos)

  private u(a: number, b: number): number {
    return uni(this.rnd, a, b);
  }

  private logU(a: number, b: number): number {
    return Math.exp(this.u(Math.log(a), Math.log(b)));
  }

  private gauss(): number {
    return normal(this.rnd);
  }

  private pick<T>(xs: T[]): T {
    return xs[Math.floor(this.rnd() * xs.length)];
  }

  private tick(p: number): number {
    return p >= 1 ? Math.round(p * 100) / 100 : Math.round(p * 10000) / 10000;
  }

  // ------------------------------------------------------------------ universo

  private buildUniverse(count: number, seed: number): void {
    const companies = makeCompanies(count, this.rnd);
    companies.forEach((c, i) => {
      const large = i < Math.round(count * 0.12);
      const prevClose = this.tick(large ? this.logU(25, 400) : this.logU(0.6, 25));
      const float = Math.round(large ? this.logU(80e6, 2e9) : this.logU(0.6e6, 120e6));
      const avgVolume = Math.round(float * (large ? this.u(0.005, 0.03) : this.u(0.01, 0.12)));
      const flags: string[] = [];
      if (!large) {
        if (this.rnd() < 0.25) flags.push('Shelf S-3');
        if (this.rnd() < 0.3) flags.push('Pérdidas');
        if (this.rnd() < 0.1) flags.push('Warrants');
      }
      const ref: ReferenceData = {
        sym: c.sym,
        name: c.name,
        exchange: c.exchange,
        prevClose,
        avgVolume,
        float,
        floatSource: 'demo',
        sharesOutstanding: Math.round(float * this.u(1.05, 1.8)),
        shortInterest: Math.round(float * this.u(0.01, 0.25)),
        flags,
      };
      this.refs.push(ref);
      const open = this.tick(prevClose * Math.exp(this.gauss() * 0.01));
      this.syms.push({
        ref,
        name: c.name,
        price: open,
        anchor: open,
        sigma: large ? this.u(0.0002, 0.0005) : this.u(0.0006, 0.0016),
        baseShares: avgVolume / 23_400,
        tradeSize: prevClose < 2 ? 600 : prevClose < 5 ? 300 : prevClose < 20 ? 150 : 80,
        legs: [],
        legT: 0,
        legBase: open,
        idleVol: 1,
        role: large ? 'large' : 'quiet',
        busy: false,
        halted: false,
        haltUntil: 0,
        rng: mulberry32((seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0),
        micro: mulberry32((seed + Math.imul(i + 1, 0x85ebca6b) + 0x6a09e667) >>> 0),
        fine: false,
        path: open,
        bid: 0,
        ask: 0,
        bidSize: 0,
        askSize: 0,
        fair: open,
        lastSide: 1,
        wide: 1,
      });
    });
  }

  private smallCaps(filter: (s: SimSym) => boolean): SimSym[] {
    return this.syms.filter((s) => s.role === 'quiet' && !s.busy && !s.halted && filter(s));
  }

  // ------------------------------------------------------------------ guiones

  private news(s: SimSym, sentiment: 'bullish' | 'bearish' | 'neutral', ts = this.t, text?: string): void {
    this.out({
      kind: 'news',
      item: {
        id: `demo-${++this.seq}`,
        ts,
        headline: text ?? headline(s.name, sentiment, this.rnd),
        source: this.pick(NEWS_SOURCES),
        symbols: [s.ref.sym],
        sentiment,
      },
    });
  }

  /** Emite un evento: en vivo pasa por la cola y se publica cuando el reloj llega a `at`. */
  private out(ev: MarketEvent, at = this.t): void {
    if (!this.live) this.emit(ev);
    else this.pending.push({ at, ev });
  }

  /** ¿Esta acción publica cinta y puntas ahora? */
  private shows(s: SimSym): boolean {
    return !this.only || this.only.has(s.ref.sym);
  }

  /** Nuevos tramos: si la acción ya avanza de a un segundo, ya; si no, desde el próximo minuto. */
  private assign(s: SimSym, legs: Leg[]): void {
    if (s.fine) {
      s.legs = legs;
      s.legT = 0;
      s.nextLegs = undefined;
    } else s.nextLegs = legs;
  }

  private runnerLegs(firstBoost = 1): Leg[] {
    const legs: Leg[] = [];
    const n = 2 + Math.floor(this.rnd() * 3);
    for (let i = 0; i < n; i++) {
      const gain = this.u(0.07, 0.22) * (i === 0 ? 1.4 * firstBoost : 1) * HEAT[this.heat].gain;
      legs.push({
        kind: 'up',
        dur: this.u(60, 200),
        ret: Math.log(1 + gain),
        vol: i === 0 ? this.u(90, 220) : this.u(40, 120),
        sigma: this.u(0.004, 0.0065),
        halt: gain > 0.15 && this.rnd() < 0.3,
      });
      if (i < n - 1) {
        legs.push({
          kind: 'pullback',
          dur: this.u(60, 150),
          ret: -Math.log(1 + gain) * this.u(0.25, 0.45),
          vol: this.u(12, 30),
          sigma: this.u(0.0025, 0.0035),
        });
      }
    }
    const end = this.rnd();
    if (end < 0.45) {
      legs.push({ kind: 'fade', dur: this.u(300, 700), ret: Math.log(1 - this.u(0.12, 0.3)), vol: this.u(15, 40), sigma: 0.004 });
    } else if (end < 0.8) {
      legs.push({ kind: 'flush', dur: this.u(60, 120), ret: Math.log(1 - this.u(0.12, 0.22)), vol: this.u(40, 90), sigma: 0.006 });
      legs.push({ kind: 'chop', dur: this.u(300, 600), ret: Math.log(1 + this.u(-0.05, 0.08)), vol: this.u(10, 20), sigma: 0.003 });
    } else {
      legs.push({ kind: 'chop', dur: this.u(400, 900), ret: Math.log(1 + this.u(-0.04, 0.06)), vol: this.u(12, 25), sigma: 0.003 });
    }
    return legs;
  }

  /** Una acción que arranca con una noticia (en el after-hours, casi siempre un balance). */
  private startRunner(s: SimSym, earnings = false): void {
    s.role = 'runner';
    s.busy = true;
    this.assign(s, this.runnerLegs(earnings ? 0.8 : 1));
    if (earnings) this.news(s, 'bullish', this.t, earningsHeadline(s.name, Number(this.dateKey.slice(5, 7)), this.rnd));
    else this.news(s, 'bullish');
    this.maybeOffering(s);
  }

  /**
   * Oferta de acciones (dilución): una empresa que necesita plata aprovecha la suba para vender
   * acciones nuevas y la acción se desploma. Más probable si tiene un shelf (S-3) o warrants.
   */
  private maybeOffering(s: SimSym): void {
    const flags = s.ref.flags ?? [];
    const p = 0.04 + (flags.includes('Shelf S-3') ? 0.1 : 0) + (flags.includes('Warrants') ? 0.05 : 0);
    if (this.rnd() >= p) return;
    this.schedule(this.t + this.u(8, 45) * MIN, () => this.offering(s));
  }

  private offering(s: SimSym, tries = 0): void {
    if (s.halted) {
      // La noticia sale cuando se reanuda la operatoria.
      if (tries < 3) this.schedule(s.haltUntil + 5 * SEC, () => this.offering(s, tries + 1));
      return;
    }
    if (s.offered || s.price / s.ref.prevClose! - 1 < 0.4 || this.t >= this.postTs - 10 * MIN) return;
    s.offered = true;
    s.busy = true;
    this.news(s, 'bearish', this.t, offeringHeadline(s.name, this.rnd));
    const regular = this.t >= this.openTs && this.t < this.closeTs;
    this.assign(s, [
      { kind: 'offering', dur: this.u(60, 240), ret: Math.log(1 - this.u(0.18, 0.4)), vol: this.u(60, 150), sigma: 0.006, halt: regular && this.rnd() < 0.25 },
      { kind: 'chop', dur: this.u(600, 1500), ret: Math.log(1 + this.u(-0.05, 0.03)), vol: this.u(10, 25), sigma: 0.003 },
    ]);
  }

  private setupGappers(): void {
    const heat = HEAT[this.heat];
    const pool = this.smallCaps((s) => s.ref.prevClose! >= 1 && s.ref.prevClose! <= 15);
    pool.sort((a, b) => a.ref.float! - b.ref.float!);
    const lowFloat = pool.slice(0, Math.ceil(pool.length * 0.35));
    const [lo, hi] = heat.gappers;
    const count = lo + Math.floor(this.rnd() * (hi - lo + 1)) + (this.afterBreak ? 2 : 0);
    const chosen = new Set<SimSym>();
    while (chosen.size < count && chosen.size < pool.length) {
      chosen.add(this.rnd() < 0.7 ? this.pick(lowFloat) : this.pick(pool));
    }
    for (const s of chosen) {
      s.role = 'gapper';
      s.busy = true;
      s.openPlan = this.rnd() < heat.go ? 'go' : 'fade';
      const overnight = this.rnd() < 0.35;
      const newsAt = overnight
        ? this.dayStart - this.u(8, 11) * 3_600_000
        : this.dayStart + this.u(5, 270) * MIN;
      const start = Math.max(newsAt, this.dayStart + MIN);
      this.schedule(start, () => {
        this.news(s, 'bullish', newsAt);
        const gap = this.u(0.18, 1.1) * heat.gap;
        this.assign(s, [
          { kind: 'gap', dur: this.u(240, 900), ret: Math.log(1 + gap), vol: this.u(60, 160), sigma: this.u(0.003, 0.0055) },
          { kind: 'pullback', dur: this.u(600, 1500), ret: -Math.log(1 + gap) * this.u(0.15, 0.35), vol: this.u(10, 25), sigma: 0.003 },
          { kind: 'chop', dur: 6 * 3600, ret: Math.log(1 + this.u(-0.05, 0.1)), vol: this.u(6, 15), sigma: 0.0025 },
        ]);
        this.maybeOffering(s);
      });
      this.schedule(this.openTs, () => {
        // Con una oferta en el pre-market, la apertura ya no tiene fuerza.
        if (s.openPlan === 'go' && !s.offered) this.assign(s, this.runnerLegs(0.8));
        else {
          this.assign(s, [
            { kind: 'fade', dur: this.u(600, 1500), ret: Math.log(1 - this.u(0.15, 0.35)), vol: this.u(40, 90), sigma: 0.005 },
            { kind: 'chop', dur: this.u(600, 1200), ret: Math.log(1 + this.u(-0.05, 0.05)), vol: this.u(10, 20), sigma: 0.003 },
          ]);
        }
      });
    }
    // Un par de acciones con noticia negativa (oferta) que abren en baja.
    for (const s of this.smallCaps(() => true).slice(0, 2)) {
      s.busy = true;
      this.schedule(this.dayStart + this.u(30, 200) * MIN, () => {
        this.news(s, 'bearish');
        this.assign(s, [
          { kind: 'drop', dur: this.u(300, 900), ret: Math.log(1 - this.u(0.15, 0.4)), vol: this.u(30, 80), sigma: 0.004 },
          { kind: 'chop', dur: 4 * 3600, ret: 0, vol: this.u(5, 10), sigma: 0.002 },
        ]);
      });
    }
  }

  private schedule(at: number, fn: () => void): void {
    this.scheduled.push({ at, fn });
    this.scheduled.sort((a, b) => a.at - b.at);
  }

  private maybeRunner(regular: boolean, minutes: number): void {
    if (this.t < this.nextRunnerAt) return;
    const every = HEAT[this.heat].every;
    if (minutes < 7 * 60) {
      this.nextRunnerAt = this.t + 10 * MIN;
      return;
    }
    if (this.t >= this.postTs - 15 * MIN) {
      this.nextRunnerAt = Infinity;
      return;
    }
    const pool = this.smallCaps((s) => s.price >= 1 && s.price <= 20 && s.ref.float! < 30e6);
    const choose = () => {
      const weighted = pool.filter((s) => s.ref.float! < 10e6);
      return weighted.length && this.rnd() < 0.7 ? this.pick(weighted) : this.pick(pool);
    };
    if (this.t >= this.closeTs) {
      // After-hours: casi todo son balances, de vez en cuando y sobre todo en la primera hora.
      const early = this.t < this.closeTs + 60 * MIN;
      if (pool.length && this.rnd() < (early ? 0.55 : 0.2)) this.startRunner(choose(), true);
      this.nextRunnerAt = this.t + (early ? this.u(900, 1500) : this.u(1800, 3000)) * SEC * every;
      return;
    }
    if (pool.length) this.startRunner(choose());
    const gap = regular ? this.u(150, 330) / curve(ATTENTION, minutes) : this.u(300, 600);
    this.nextRunnerAt = this.t + gap * SEC * every;
  }

  /** Noticias de fondo: seguido durante el día, cada vez menos después del cierre. */
  private maybeNoiseNews(): void {
    if (this.t < this.nextNoiseNewsAt) return;
    const s = this.pick(this.syms);
    this.news(s, this.rnd() < 0.7 ? 'neutral' : 'bullish');
    const late = this.t < this.closeTs ? 1 : this.t < this.closeTs + 60 * MIN ? 3 : 7;
    this.nextNoiseNewsAt = this.t + this.u(90, 260) * SEC * late;
  }

  // ------------------------------------------------------------------ volumen por hora

  /** Minuto del día (ET) del reloj de generación. */
  private minuteOf(ts: number): number {
    return PRE_OPEN + (ts - this.dayStart) / MIN;
  }

  /** En los días de cierre anticipado, la curva de volumen se corre al cierre de las 13:00. */
  private curveMinute(m: number): number {
    const close = this.closeMinutes;
    if (close === REG_CLOSE) return m;
    if (m >= close) return REG_CLOSE + (m - close);
    if (m >= close - 30) return REG_CLOSE - 30 + (m - (close - 30));
    return m;
  }

  /**
   * Cuánto opera una acción a esta hora (1 = un minuto normal de la rueda). Las tranquilas siguen la
   * curva en "U" del mercado; las que están en juego (con noticia o subiendo fuerte) operan mucho más
   * en el pre-market, sobre todo cerca de la apertura, y siguen un rato en el after-hours.
   */
  private activity(hot: boolean, regular: boolean, m: number): number {
    if (this.t >= this.postTs) return 0;
    if (!hot) return volumeIntensity(this.curveMinute(m));
    if (regular) return curve(ATTENTION, this.curveMinute(m));
    if (this.t < this.openTs) return m < 7 * 60 ? 0.2 + (0.1 * (m - PRE_OPEN)) / 180 : 0.4 + 0.4 * Math.min(1, (m - 7 * 60) / 150);
    return 0.06 + 0.3 * Math.exp(-(m - this.closeMinutes) / 25);
  }

  /** Volumen sin eventos: piso más alto si la acción está en juego, y lo que sobra se apaga de a poco. */
  private idle(s: SimSym, inPlay: boolean, up: number, dt: number): number {
    const vol = s.idleVol;
    const floor = inPlay ? 6 + 30 * Math.min(1, (up - 0.15) / 0.85) : 1;
    s.idleVol = s.idleVol > floor ? Math.max(floor, s.idleVol * Math.pow(0.998, dt)) : floor;
    return vol;
  }

  // ------------------------------------------------------------------ simulación

  /**
   * Genera el día (en velas de 1 minuto) hasta la hora de inicio. Los últimos minutos ya se simulan
   * operación por operación, así la cinta (Time & Sales) arranca con historia, como al abrir un
   * símbolo en una plataforma real.
   */
  warmup(): void {
    this.setupGappers();
    this.live = false;
    this.nextRunnerAt = this.dayStart + 3 * 3600 * SEC;
    this.nextNoiseNewsAt = this.dayStart + 2 * 3600 * SEC;
    // La cinta empieza en un minuto justo: el último minuto planeado en velas termina ahí.
    const tapeFrom = Math.max(this.t, Math.floor((this.startTs - TAPE_WARM) / MIN) * MIN);
    while (this.t + SEC < tapeFrom) this.step();
    for (const s of this.syms) this.flushBar(s);
    this.live = true;
    // Cotización inicial de cada acción.
    const regular = this.t >= this.openTs && this.t < this.closeTs;
    for (const s of this.syms) {
      s.fair = s.path = s.price;
      if (this.shows(s)) this.requote(s, s.price, this.t, regular, true);
    }
    while (this.t < this.startTs) this.step();
    this.now = this.t;
    this.release(this.now);
  }

  /** Avanza el reloj virtual `ms` milisegundos y publica los eventos de ese lapso, en orden. */
  advance(ms: number): void {
    const target = this.now + ms;
    while (this.t < target) this.step();
    this.release(target);
    this.now = target;
  }

  /** Precio del camino de cada acción (para comprobar que el mercado no depende de la hora de inicio). */
  pathPrices(): Record<string, number> {
    return Object.fromEntries(this.syms.map((s) => [s.ref.sym, s.price]));
  }

  private release(target: number): void {
    const q = this.pending;
    while (this.head < q.length && q[this.head].at <= target) this.emit(q[this.head++].ev);
    if (this.head > 4096) {
      this.pending = q.slice(this.head);
      this.head = 0;
    }
  }

  private step(): void {
    this.t += SEC;
    const from = this.pending.length;
    while (this.scheduled.length && this.scheduled[0].at <= this.t) this.scheduled.shift()!.fn();
    if (this.t > this.postTs) return;
    const regular = this.t >= this.openTs && this.t < this.closeTs;
    const minutes = this.minuteOf(this.t);
    this.maybeRunner(regular, minutes);
    if (this.t >= this.dayStart + 2 * 3600 * SEC) this.maybeNoiseNews();
    const edge = this.t % MIN === 0;
    for (const s of this.syms) {
      // El último segundo del minuto planeado se imprime antes de planear el siguiente.
      if (this.live && !s.fine) this.microStep(s, regular);
      if (edge) {
        if (s.nextLegs) {
          s.legs = s.nextLegs;
          s.nextLegs = undefined;
          s.legT = 0;
        }
        s.fine = s.legs.length > 0 || s.halted;
      }
      if (s.halted) {
        if (this.t >= s.haltUntil) this.resume(s, regular);
        else continue;
      }
      if (s.fine) this.stepSym(s, regular, minutes);
      else if (edge) this.planMinute(s, regular, minutes);
    }
    // Los eventos de este segundo se publican en orden de hora (dentro de cada acción ya lo están).
    if (this.pending.length - from > 1) {
      const batch = this.pending.splice(from);
      batch.sort((a, b) => a.at - b.at);
      for (const e of batch) this.pending.push(e);
    }
  }

  /** Un segundo de una acción con tramos (o que termina el minuto después de sus tramos). */
  private stepSym(s: SimSym, regular: boolean, minutes: number): void {
    const leg = s.legs[0];
    // "En juego": sube 15% o más en el día. Sigue operando con volumen alto (más cuanto más sube)
    // aunque ya no esté corriendo, como cualquier acción con noticia y volumen relativo alto.
    const up = s.price / s.ref.prevClose! - 1;
    const inPlay = s.role !== 'large' && up >= 0.15;
    let mu: number;
    let sigma: number;
    let vol: number;
    if (leg) {
      if (s.legT === 0) s.legBase = s.price;
      // Deriva del tramo + atracción al camino planeado (si no, la varianza se acumula sin límite).
      const target = s.legBase * Math.exp(leg.ret * Math.min(1, s.legT / leg.dur));
      mu = leg.ret / leg.dur - 0.01 * Math.log(s.price / target);
      sigma = leg.sigma;
      vol = leg.vol;
    } else {
      mu = -0.003 * Math.log(s.price / s.anchor);
      sigma = s.sigma;
      vol = this.idle(s, inPlay, up, 1);
    }
    const p0 = s.price;
    const p1 = Math.max(0.05, p0 * Math.exp(mu + sigma * normal(s.rng)));
    const shares = s.baseShares * vol * this.activity(!!leg || inPlay, regular, minutes) * Math.exp(0.6 * normal(s.rng) - 0.18);
    if (!this.live) this.prints(s, p0, p1, shares, this.t - SEC, 1);
    else if (this.shows(s)) this.livePrints(s, p0, p1, shares, regular);
    s.price = s.path = p1;
    if (s.wide > 1) s.wide = 1 + (s.wide - 1) * 0.97;
    if (leg) {
      s.legT += 1;
      if (s.legT >= leg.dur) {
        s.legs.shift();
        s.legT = 0;
        if (leg.halt && regular) this.halt(s);
        if (!s.legs.length) {
          s.busy = false;
          s.anchor = s.price;
          s.idleVol = 4;
          if (s.role === 'runner' || s.role === 'gapper') s.role = 'quiet';
        }
      }
    }
  }

  /** Acción tranquila: en el minuto justo se decide adónde llega el precio y cuánto opera en el minuto. */
  private planMinute(s: SimSym, regular: boolean, minutes: number): void {
    const up = s.price / s.ref.prevClose! - 1;
    const inPlay = s.role !== 'large' && up >= 0.15;
    const mu = -0.003 * Math.log(s.price / s.anchor);
    const vol = this.idle(s, inPlay, up, 60);
    const p0 = s.price;
    const p1 = Math.max(0.05, p0 * Math.exp(mu * 60 + s.sigma * Math.sqrt(60) * normal(s.rng)));
    const shares = s.baseShares * vol * this.activity(inPlay, regular, minutes + 0.5) * 60 * Math.exp(0.6 * normal(s.rng) - 0.18);
    s.price = p1;
    s.path = p0;
    s.plan = { from: this.t, p0, p1, shares, warm: !this.live };
    if (!this.live) this.prints(s, p0, p1, shares, this.t, 60);
  }

  /** En vivo, cada segundo del minuto planeado: el precio recorre un puente browniano hasta el cierre. */
  private microStep(s: SimSym, regular: boolean): void {
    const plan = s.plan;
    if (!plan || plan.warm) return;
    const k = (this.t - plan.from) / SEC;
    if (k < 1 || k > 60) return;
    const left = 61 - k;
    const m = s.micro;
    const sd = plan.p0 * s.sigma;
    const from = s.path;
    const to = k === 60 ? plan.p1 : Math.max(0.01, from + (plan.p1 - from) / left + sd * Math.sqrt((left - 1) / left) * normal(m));
    s.path = to;
    if (s.wide > 1) s.wide = 1 + (s.wide - 1) * 0.97;
    if (!this.shows(s)) return;
    const shares = (plan.shares / 60) * Math.exp(0.5 * normal(m) - 0.125);
    this.livePrints(s, from, to, shares, regular);
  }

  /** Antes de la cinta: solo hacen falta las velas de 1 minuto. */
  private prints(s: SimSym, p0: number, p1: number, shares: number, t0: number, dt: number): void {
    const m = s.micro;
    const expected = shares / s.tradeSize;
    const n = expected >= 1 ? Math.min(40, Math.round(expected)) : m() < expected ? 1 : 0;
    if (!n) return;
    const per = shares / n;
    for (let i = 0; i < n; i++) {
      const f = (i + 1) / n;
      const px = this.tick(Math.max(0.01, p0 + (p1 - p0) * f + p0 * 0.0008 * normal(m)));
      let size = Math.max(1, Math.round(per * Math.exp(0.7 * normal(m) - 0.245)));
      if (size >= 100) size = Math.round(size / 100) * 100;
      const ts = t0 + Math.floor(f * dt * SEC) - 1;
      this.addWarm(s, ts, px, size);
    }
  }

  /**
   * En vivo, cada operación tiene un agresor: la compra paga el ask y la venta toma el bid. El valor
   * justo (el camino del precio) mueve las puntas, y las órdenes grandes se comen el tamaño de la
   * mejor punta y barren los niveles siguientes. Algunas operaciones son lotes impares o se cruzan
   * en el medio del spread (dark pools), como en la cinta real.
   */
  private livePrints(s: SimSym, p0: number, p1: number, shares: number, regular: boolean): void {
    const m = s.micro;
    const expected = shares / s.tradeSize;
    const n = expected >= 1 ? Math.min(40, Math.round(expected)) : m() < expected ? 1 : 0;
    const t0 = this.t - SEC;
    if (!n) {
      this.requote(s, p1, t0 + Math.floor(m() * SEC), regular);
      s.fair = p1;
      return;
    }
    const per = shares / n;
    let prev = s.fair;
    for (let i = 0; i < n; i++) {
      const f = (i + 1) / n;
      const fair = Math.max(0.01, p0 + (p1 - p0) * f + p0 * 0.0008 * normal(m));
      const ts = t0 + Math.floor(f * SEC) - 1;
      this.requote(s, fair, ts, regular);
      let size = Math.max(1, Math.round(per * Math.exp(0.7 * normal(m) - 0.245)));
      if (m() < 0.27) size = 1 + Math.floor(m() * 99);
      else if (size >= 100) size = Math.round(size / 100) * 100;
      const tick = tickOf(fair);
      const d = fair - prev;
      prev = fair;
      const buy = Math.abs(d) < tick * 0.3 ? m() < (s.lastSide > 0 ? 0.62 : 0.38) : m() < (d > 0 ? 0.8 : 0.2);
      s.lastSide = buy ? 1 : -1;
      const width = Math.round((s.ask - s.bid) / tick);
      if (width >= 2 && m() < 0.05) {
        const mid = roundTo(s.bid + Math.floor(width / 2) * tick, tick);
        this.out({ kind: 'trade', sym: s.ref.sym, ts, price: mid, size }, ts);
        continue;
      }
      this.take(s, buy, size, ts);
    }
    s.fair = prev;
  }

  /** Una orden agresiva: consume la mejor punta y, si no alcanza, barre el nivel siguiente. */
  private take(s: SimSym, buy: boolean, size: number, ts: number): void {
    let left = size;
    let moved = false;
    for (let guard = 0; left > 0 && guard < 6; guard++) {
      const px = buy ? s.ask : s.bid;
      const avail = buy ? s.askSize : s.bidSize;
      const q = Math.min(left, Math.max(1, avail));
      this.out({ kind: 'trade', sym: s.ref.sym, ts, price: px, size: q }, ts);
      left -= q;
      const tick = tickOf(px);
      const jump = (s.micro() < 0.2 ? 2 : 1) * tick;
      if (buy) {
        s.askSize -= q;
        if (s.askSize <= 0) {
          s.ask = roundTo(s.ask + jump, tick);
          s.askSize = this.touchSize(s);
          moved = true;
        }
      } else {
        s.bidSize -= q;
        if (s.bidSize <= 0) {
          s.bid = roundTo(Math.max(tick, s.bid - jump), tick);
          s.bidSize = this.touchSize(s);
          moved = true;
        }
      }
    }
    if (moved) {
      if (s.bid >= s.ask) {
        // El barrido cruzó la otra punta: se reacomoda a un tick.
        const tick = tickOf(s.ask);
        if (buy) s.bid = roundTo(s.ask - tick, tick);
        else s.ask = roundTo(s.bid + tick, tick);
      }
      this.out(this.quoteEvent(s, ts), ts);
    }
  }

  /** Spread objetivo en ticks: más ancho en acciones baratas, volátiles y fuera de la rueda. */
  private targetSpread(s: SimSym, price: number, regular: boolean): number {
    const leg = s.legs[0];
    const sigma = leg ? leg.sigma : s.sigma;
    const large = s.role === 'large';
    const pct = (large ? 0.00008 : 0.0011) + sigma * 1.4 + (regular ? 0 : large ? 0.0004 : 0.0035) + (price < 2 ? 0.0015 : 0);
    const ticks = (price * pct * s.wide) / tickOf(price);
    return Math.max(1, Math.min(80, Math.round(ticks * Math.exp(0.35 * normal(s.micro)))));
  }

  /** Tamaño en la mejor punta: lotes redondos, a veces una orden grande ("pared"). */
  private touchSize(s: SimSym): number {
    const m = s.micro;
    const big = m() < 0.06 ? uni(m, 5, 20) : 1;
    return Math.max(100, Math.round((s.tradeSize * Math.exp(uni(m, Math.log(0.4), Math.log(3.5))) * big) / 100) * 100);
  }

  /**
   * Las puntas siguen al valor justo: si el precio sale del spread se reacomodan alrededor; si el
   * spread quedó demasiado ancho, alguien mejora el lado más lejano. Si no, quedan donde están.
   */
  private requote(s: SimSym, fair: number, ts: number, regular: boolean, force = false): void {
    const tick = tickOf(fair);
    const target = this.targetSpread(s, fair, regular);
    const idealBid = roundTo(Math.max(tick, Math.floor((fair - (target * tick) / 2) / tick + 1e-9) * tick), tick);
    const idealAsk = roundTo(idealBid + target * tick, tick);
    let { bid, ask } = s;
    if (force || !(bid > 0 && ask > bid) || fair >= ask || fair <= bid) {
      bid = idealBid;
      ask = idealAsk;
    } else if ((ask - bid) / tick > target * 1.6 + 1) {
      if (ask - fair > fair - bid) ask = Math.max(roundTo(bid + tick, tick), idealAsk);
      else bid = Math.min(roundTo(ask - tick, tick), idealBid);
    }
    if (bid === s.bid && ask === s.ask) return;
    if (bid !== s.bid) s.bidSize = this.touchSize(s);
    if (ask !== s.ask) s.askSize = this.touchSize(s);
    s.bid = bid;
    s.ask = ask;
    this.out(this.quoteEvent(s, ts), ts);
  }

  private quoteEvent(s: SimSym, ts: number): MarketEvent {
    return { kind: 'quote', sym: s.ref.sym, ts, bid: s.bid, ask: s.ask, bidSize: s.bidSize, askSize: s.askSize };
  }

  private addWarm(s: SimSym, ts: number, px: number, size: number): void {
    const t = Math.floor(ts / MIN) * MIN;
    const b = s.bar;
    if (b && b.t === t) {
      if (px > b.h) b.h = px;
      if (px < b.l) b.l = px;
      b.c = px;
      b.v += size;
      b.pv += px * size;
      b.n++;
      return;
    }
    this.flushBar(s);
    s.bar = { t, o: px, h: px, l: px, c: px, v: size, pv: px * size, n: 1 };
  }

  private flushBar(s: SimSym): void {
    const b = s.bar;
    if (!b) return;
    s.bar = undefined;
    this.emit({ kind: 'bar', span: 'minute', sym: s.ref.sym, ts: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, vw: b.pv / b.v, n: b.n });
  }

  private halt(s: SimSym): void {
    s.halted = true;
    s.haltUntil = this.t + 5 * MIN;
    s.bid = s.ask = s.bidSize = s.askSize = 0;
    this.out({
      kind: 'status',
      sym: s.ref.sym,
      ts: this.t,
      halted: true,
      reason: 'LUDP',
      resumeTs: s.haltUntil,
      source: 'demo',
    });
  }

  /** Reanudación: subasta de apertura con un print grande y spreads anchos los primeros minutos. */
  private resume(s: SimSym, regular: boolean): void {
    s.halted = false;
    this.out({ kind: 'status', sym: s.ref.sym, ts: this.t, halted: false, reason: 'LUDP', source: 'demo' });
    s.price = s.path = this.tick(s.price * (1 + uni(s.rng, -0.12, 0.25)));
    const size = Math.round((s.baseShares * 600) / 100) * 100 || 100;
    if (!this.live) {
      this.addWarm(s, this.t, s.price, size);
      return;
    }
    s.fair = s.price;
    s.wide = 3;
    if (!this.shows(s)) return;
    this.requote(s, s.price, this.t, regular, true);
    this.out({ kind: 'trade', sym: s.ref.sym, ts: this.t, price: s.price, size });
  }
}

/** Variación mínima de precio: un centavo, o una centésima de centavo debajo de US$ 1. */
export function tickOf(price: number): number {
  return price >= 1 ? 0.01 : 0.0001;
}

function roundTo(p: number, tick: number): number {
  const v = Math.round(p / tick) * tick;
  return tick >= 0.01 ? Math.round(v * 100) / 100 : Math.round(v * 10000) / 10000;
}
