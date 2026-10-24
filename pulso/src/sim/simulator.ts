// Mercado simulado para el modo demo: ~150 acciones ficticias con gappers de pre-market, runners
// que arrancan con una noticia (subida con volumen, pullbacks, halts LULD, fade o flush) y ruido de
// fondo. Genera los mismos eventos que un proveedor real, así que el motor no distingue la diferencia.
import type { MarketEvent, ReferenceData } from '../engine/types';
import { etParts, etWallToTs, isTradingDay, PRE_OPEN, REG_CLOSE, REG_OPEN } from '../engine/time';
import { headline, makeCompanies, NEWS_SOURCES } from './names';

const SEC = 1000;
const MIN = 60_000;

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

interface SimSym {
  ref: ReferenceData;
  name: string;
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
  bar?: WarmBar;
}

export interface SimOptions {
  seed?: number;
  /** Minuto del día (ET) en que arranca la simulación en vivo. Por defecto 9:27. */
  startMinutes?: number;
  /** Un instante del día a simular (por defecto, el último día hábil). */
  dayTs?: number;
  count?: number;
}

export class MarketSim {
  now: number;
  readonly refs: ReferenceData[] = [];
  readonly dayStart: number;
  readonly openTs: number;
  readonly closeTs: number;
  readonly startTs: number;
  private readonly syms: SimSym[] = [];
  private readonly rnd: () => number;
  private carry = 0;
  private seq = 0;
  private live = false;
  private nextRunnerAt = 0;
  private nextNoiseNewsAt = 0;
  private scheduled: Array<{ at: number; fn: () => void }> = [];

  constructor(
    private readonly emit: (ev: MarketEvent) => void,
    opts: SimOptions = {},
  ) {
    this.rnd = mulberry32(opts.seed ?? Math.floor(Math.random() * 2 ** 31));
    const day = lastTradingDay(opts.dayTs ?? Date.now());
    this.dayStart = etWallToTs(day.y, day.mo, day.d, PRE_OPEN);
    this.openTs = etWallToTs(day.y, day.mo, day.d, REG_OPEN);
    this.closeTs = etWallToTs(day.y, day.mo, day.d, REG_CLOSE);
    this.startTs = etWallToTs(day.y, day.mo, day.d, opts.startMinutes ?? 9 * 60 + 27);
    this.now = this.dayStart;
    this.buildUniverse(opts.count ?? 150);
  }

  // ------------------------------------------------------------------ azar

  private u(a: number, b: number): number {
    return a + (b - a) * this.rnd();
  }

  private logU(a: number, b: number): number {
    return Math.exp(this.u(Math.log(a), Math.log(b)));
  }

  private gauss(): number {
    const u = Math.max(1e-12, this.rnd());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rnd());
  }

  private pick<T>(xs: T[]): T {
    return xs[Math.floor(this.rnd() * xs.length)];
  }

  private tick(p: number): number {
    return p >= 1 ? Math.round(p * 100) / 100 : Math.round(p * 10000) / 10000;
  }

  // ------------------------------------------------------------------ universo

  private buildUniverse(count: number): void {
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
        tradeSize: prevClose < 2 ? 1500 : prevClose < 5 ? 700 : prevClose < 20 ? 300 : 120,
        legs: [],
        legT: 0,
        legBase: open,
        idleVol: 1,
        role: large ? 'large' : 'quiet',
        busy: false,
        halted: false,
        haltUntil: 0,
      });
    });
  }

  private smallCaps(filter: (s: SimSym) => boolean): SimSym[] {
    return this.syms.filter((s) => s.role === 'quiet' && !s.busy && !s.halted && filter(s));
  }

  // ------------------------------------------------------------------ guiones

  private news(s: SimSym, sentiment: 'bullish' | 'bearish' | 'neutral', ts = this.now): void {
    this.emit({
      kind: 'news',
      item: {
        id: `demo-${++this.seq}`,
        ts,
        headline: headline(s.name, sentiment, this.rnd),
        source: this.pick(NEWS_SOURCES),
        symbols: [s.ref.sym],
        sentiment,
      },
    });
  }

  private runnerLegs(firstBoost = 1): Leg[] {
    const legs: Leg[] = [];
    const n = 2 + Math.floor(this.rnd() * 3);
    for (let i = 0; i < n; i++) {
      const gain = this.u(0.07, 0.22) * (i === 0 ? 1.4 * firstBoost : 1);
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

  private startRunner(s: SimSym): void {
    s.role = 'runner';
    s.busy = true;
    s.legs = this.runnerLegs();
    s.legT = 0;
    this.news(s, 'bullish');
  }

  private setupGappers(): void {
    const pool = this.smallCaps((s) => s.ref.prevClose! >= 1 && s.ref.prevClose! <= 15);
    pool.sort((a, b) => a.ref.float! - b.ref.float!);
    const lowFloat = pool.slice(0, Math.ceil(pool.length * 0.35));
    const chosen = new Set<SimSym>();
    while (chosen.size < 7 && chosen.size < pool.length) {
      chosen.add(this.rnd() < 0.7 ? this.pick(lowFloat) : this.pick(pool));
    }
    for (const s of chosen) {
      s.role = 'gapper';
      s.busy = true;
      s.openPlan = this.rnd() < 0.55 ? 'go' : 'fade';
      const overnight = this.rnd() < 0.35;
      const newsAt = overnight
        ? this.dayStart - this.u(8, 11) * 3_600_000
        : this.dayStart + this.u(5, 270) * MIN;
      const start = Math.max(newsAt, this.dayStart + MIN);
      this.schedule(start, () => {
        this.news(s, 'bullish', newsAt);
        const gap = this.u(0.18, 1.1);
        s.legs = [
          { kind: 'gap', dur: this.u(240, 900), ret: Math.log(1 + gap), vol: this.u(60, 160), sigma: this.u(0.003, 0.0055) },
          { kind: 'pullback', dur: this.u(600, 1500), ret: -Math.log(1 + gap) * this.u(0.15, 0.35), vol: this.u(10, 25), sigma: 0.003 },
          { kind: 'chop', dur: 6 * 3600, ret: Math.log(1 + this.u(-0.05, 0.1)), vol: this.u(6, 15), sigma: 0.0025 },
        ];
        s.legT = 0;
      });
      this.schedule(this.openTs, () => {
        s.legT = 0;
        if (s.openPlan === 'go') s.legs = this.runnerLegs(0.8);
        else {
          s.legs = [
            { kind: 'fade', dur: this.u(600, 1500), ret: Math.log(1 - this.u(0.15, 0.35)), vol: this.u(40, 90), sigma: 0.005 },
            { kind: 'chop', dur: this.u(600, 1200), ret: Math.log(1 + this.u(-0.05, 0.05)), vol: this.u(10, 20), sigma: 0.003 },
          ];
        }
      });
    }
    // Un par de acciones con noticia negativa (oferta) que abren en baja.
    for (const s of this.smallCaps(() => true).slice(0, 2)) {
      s.busy = true;
      this.schedule(this.dayStart + this.u(30, 200) * MIN, () => {
        this.news(s, 'bearish');
        s.legs = [
          { kind: 'drop', dur: this.u(300, 900), ret: Math.log(1 - this.u(0.15, 0.4)), vol: this.u(30, 80), sigma: 0.004 },
          { kind: 'chop', dur: 4 * 3600, ret: 0, vol: this.u(5, 10), sigma: 0.002 },
        ];
        s.legT = 0;
      });
    }
  }

  private schedule(at: number, fn: () => void): void {
    this.scheduled.push({ at, fn });
    this.scheduled.sort((a, b) => a.at - b.at);
  }

  private maybeRunner(regular: boolean): void {
    if (this.now < this.nextRunnerAt) return;
    const minutes = (this.now - this.dayStart) / MIN + PRE_OPEN;
    if (minutes < 7 * 60) {
      this.nextRunnerAt = this.now + 10 * MIN;
      return;
    }
    const pool = this.smallCaps((s) => s.price >= 1 && s.price <= 20 && s.ref.float! < 30e6);
    if (pool.length) {
      const weighted = pool.filter((s) => s.ref.float! < 10e6);
      this.startRunner(weighted.length && this.rnd() < 0.7 ? this.pick(weighted) : this.pick(pool));
    }
    this.nextRunnerAt = this.now + (regular ? this.u(150, 330) : this.u(300, 600)) * SEC;
  }

  private maybeNoiseNews(): void {
    if (this.now < this.nextNoiseNewsAt) return;
    const s = this.pick(this.syms);
    this.news(s, this.rnd() < 0.7 ? 'neutral' : 'bullish');
    this.nextNoiseNewsAt = this.now + this.u(90, 260) * SEC;
  }

  // ------------------------------------------------------------------ simulación

  /** Genera el pre-market (en velas de 1 minuto) hasta la hora de inicio. */
  warmup(): void {
    this.setupGappers();
    this.live = false;
    this.nextRunnerAt = this.dayStart + 3 * 3600 * SEC;
    this.nextNoiseNewsAt = this.dayStart + 2 * 3600 * SEC;
    while (this.now < this.startTs) this.step();
    for (const s of this.syms) this.flushBar(s);
    this.live = true;
    this.nextRunnerAt = this.now + 20 * SEC;
  }

  /** Avanza el reloj virtual `ms` milisegundos. */
  advance(ms: number): void {
    this.carry += ms;
    while (this.carry >= SEC) {
      this.carry -= SEC;
      this.step();
    }
  }

  private step(): void {
    this.now += SEC;
    while (this.scheduled.length && this.scheduled[0].at <= this.now) this.scheduled.shift()!.fn();
    const regular = this.now >= this.openTs && this.now < this.closeTs;
    this.maybeRunner(regular);
    if (this.now >= this.dayStart + 2 * 3600 * SEC) this.maybeNoiseNews();
    const minuteEdge = this.now % MIN === 0;
    for (const s of this.syms) {
      if (s.halted) {
        if (this.now >= s.haltUntil) this.resume(s);
        else continue;
      }
      if (!this.live && !s.busy && !s.legs.length) {
        if (minuteEdge) this.stepSym(s, 60, regular);
        continue;
      }
      this.stepSym(s, 1, regular);
    }
  }

  private stepSym(s: SimSym, dt: number, regular: boolean): void {
    const leg = s.legs[0];
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
      vol = s.idleVol;
      if (s.idleVol > 1) s.idleVol = Math.max(1, s.idleVol * 0.998);
    }
    const session = regular ? 1 : leg || s.role === 'gapper' ? 0.5 : 0.04;
    const p0 = s.price;
    const p1 = Math.max(0.05, p0 * Math.exp(mu * dt + sigma * Math.sqrt(dt) * this.gauss()));
    const shares = s.baseShares * vol * session * dt * Math.exp(0.6 * this.gauss() - 0.18);
    this.prints(s, p0, p1, shares, dt);
    s.price = p1;
    if (leg) {
      s.legT += dt;
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

  private prints(s: SimSym, p0: number, p1: number, shares: number, dt: number): void {
    const expected = shares / s.tradeSize;
    const n = expected >= 1 ? Math.min(40, Math.round(expected)) : this.rnd() < expected ? 1 : 0;
    if (!n) return;
    const per = shares / n;
    const t0 = this.now - dt * SEC;
    for (let i = 0; i < n; i++) {
      const f = (i + 1) / n;
      const px = this.tick(Math.max(0.01, p0 + (p1 - p0) * f + p0 * 0.0008 * this.gauss()));
      let size = Math.max(1, Math.round(per * Math.exp(0.7 * this.gauss() - 0.245)));
      if (size >= 100) size = Math.round(size / 100) * 100;
      const ts = t0 + Math.floor(f * dt * SEC) - 1;
      if (this.live) this.emit({ kind: 'trade', sym: s.ref.sym, ts, price: px, size });
      else this.addWarm(s, ts, px, size);
    }
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
    s.haltUntil = this.now + 5 * MIN;
    this.emit({
      kind: 'status',
      sym: s.ref.sym,
      ts: this.now,
      halted: true,
      reason: 'LUDP',
      resumeTs: s.haltUntil,
      source: 'demo',
    });
  }

  private resume(s: SimSym): void {
    s.halted = false;
    this.emit({ kind: 'status', sym: s.ref.sym, ts: this.now, halted: false, reason: 'LUDP', source: 'demo' });
    s.price = this.tick(s.price * (1 + this.u(-0.12, 0.25)));
    const size = Math.round((s.baseShares * 600) / 100) * 100 || 100;
    if (this.live) this.emit({ kind: 'trade', sym: s.ref.sym, ts: this.now, price: s.price, size });
    else this.addWarm(s, this.now, s.price, size);
  }
}
