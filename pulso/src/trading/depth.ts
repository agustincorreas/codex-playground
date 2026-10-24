// Profundidad del libro (Level 2) por venue, anclada al NBBO del mercado: los niveles persisten y
// cambian con el tiempo, aparecen paredes en dólares enteros y medios, y la liquidez que toman tus
// órdenes desaparece unos segundos. Sirve para mostrar el Level 2 y para ejecutar órdenes recorriendo
// el libro (las grandes pagan varios niveles, como en un bróker real).
import type { Quote } from '../engine/types';

export interface BookRow {
  venue: string;
  price: number;
  size: number;
  /** Orden propia que espera en el libro. */
  own?: boolean;
}

/** Una porción de una ejecución: precio y acciones tomadas a ese precio. */
export interface Part {
  price: number;
  size: number;
}

interface Level {
  price: number;
  rows: Array<{ venue: string; size: number }>;
}

export const VENUES = ['NSDQ', 'ARCA', 'EDGX', 'BATS', 'MEMX', 'EPRL', 'NYSE', 'EDGA', 'BATY', 'IEX', 'AMEX', '24X'];
/** Niveles de precio por lado. */
const DEPTH = 20;
/** Cuánto tarda el mercado en reponer la liquidez que tomó una orden propia. */
const REFILL_MS = 6000;

export function tickOf(price: number): number {
  return price >= 1 ? 0.01 : 0.0001;
}

export function roundPx(p: number, tick = tickOf(p)): number {
  const v = Math.round(p / tick) * tick;
  return tick >= 0.01 ? Math.round(v * 100) / 100 : Math.round(v * 10000) / 10000;
}

function prng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSym(sym: string, seed = 0): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < sym.length; i++) h = Math.imul(h ^ sym.charCodeAt(i), 16777619);
  return h >>> 0;
}

const EPS = 1e-9;

export class DepthBook {
  /** Mejor precio primero en cada lado. */
  bids: Level[] = [];
  asks: Level[] = [];
  private t = 0;
  private readonly rnd: () => number;
  /** Liquidez tomada por órdenes propias: lado:precio → acciones y cuándo. */
  private consumed = new Map<string, { shares: number; at: number }>();

  constructor(seed: number) {
    this.rnd = prng(seed);
  }

  // ------------------------------------------------------------------ azar

  private gauss(): number {
    const u = Math.max(1e-12, this.rnd());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rnd());
  }

  private lot(q: Quote): number {
    return Math.max(100, Math.min(10_000, Math.round(q.volPerMin / 80 / 100) * 100));
  }

  private size(lot: number): number {
    return Math.max(100, Math.round((lot * Math.exp(0.9 * this.gauss() - 0.3)) / 100) * 100);
  }

  /** Separación en ticks entre niveles: 1 en acciones líquidas, varios en las finas. */
  private gap(price: number, q: Quote): number {
    const thin = Math.max(0.3, Math.min(8, 30_000 / (q.volPerMin + 3_000)));
    const max = Math.max(1, Math.min(30, Math.round(((price * 0.0015) / tickOf(price)) * thin)));
    return 1 + Math.floor(this.rnd() ** 2 * max);
  }

  private rows(total: number, lot: number): Array<{ venue: string; size: number }> {
    const n = Math.max(1, Math.min(VENUES.length, 1 + Math.floor(this.rnd() * (total > 4 * lot ? 6 : 3))));
    const pool = [...VENUES];
    const out: Array<{ venue: string; size: number }> = [];
    let left = Math.max(100, Math.round(total / 100) * 100);
    for (let i = 0; i < n && left > 0; i++) {
      const venue = pool.splice(Math.floor(this.rnd() * pool.length), 1)[0];
      const share = i === n - 1 ? left : Math.max(100, Math.round((left * (0.25 + 0.5 * this.rnd())) / 100) * 100);
      const s = Math.min(left, share);
      out.push({ venue, size: s });
      left -= s;
    }
    return out.sort((a, b) => b.size - a.size);
  }

  private level(price: number, lot: number, side: 'bid' | 'ask'): Level {
    const rows = this.rows(this.size(lot) * (1 + Math.floor(this.rnd() * 2)), lot);
    // Paredes en números redondos: vendedores grandes en el dólar entero o el medio dólar.
    const cents = Math.round(price * 100);
    const round = price >= 1 && cents % 50 === 0;
    if (round && this.rnd() < (side === 'ask' ? 0.45 : 0.2)) {
      const venue = VENUES[Math.floor(this.rnd() * VENUES.length)];
      rows.unshift({ venue, size: Math.round((lot * (8 + this.rnd() * 40)) / 100) * 100 });
    }
    return { price, rows };
  }

  // ------------------------------------------------------------------ sincronización

  /** Lleva el libro al NBBO actual y lo hace evolucionar según el tiempo transcurrido. */
  sync(q: Quote, now: number): void {
    const dt = this.t ? Math.max(0, Math.min(15_000, now - this.t)) : 0;
    this.t = now;
    for (const [k, c] of this.consumed) if (now - c.at > REFILL_MS) this.consumed.delete(k);
    if (q.halted || !(q.bid > 0 && q.ask > q.bid)) {
      this.bids = [];
      this.asks = [];
      return;
    }
    const lot = this.lot(q);
    const tick = tickOf(q.ask);
    this.bids = this.bids.filter((l) => l.price <= q.bid + EPS);
    this.asks = this.asks.filter((l) => l.price >= q.ask - EPS);
    this.top(this.bids, 'bid', q.bid, q.real ? q.bidSize : 0, lot, now);
    this.top(this.asks, 'ask', q.ask, q.real ? q.askSize : 0, lot, now);
    if (dt > 0) this.churn(dt, lot);
    this.fill(this.bids, 'bid', q, tick, lot);
    this.fill(this.asks, 'ask', q, tick, lot);
  }

  /** El mejor nivel tiene el tamaño publicado (menos lo que tomaron tus órdenes hace un momento). */
  private top(levels: Level[], side: 'bid' | 'ask', price: number, published: number, lot: number, now: number): void {
    const taken = this.consumed.get(`${side}:${price}`);
    const want = published > 0 ? Math.max(0, published - (taken && now - taken.at <= REFILL_MS ? taken.shares : 0)) : 0;
    let l = levels[0];
    if (!l || Math.abs(l.price - price) > EPS) {
      if (published > 0 && want <= 0) return;
      l = { price, rows: this.rows(want || this.size(lot), lot) };
      levels.unshift(l);
      return;
    }
    if (!(published > 0)) return;
    if (want <= 0) {
      levels.shift();
      return;
    }
    let total = l.rows.reduce((s, r) => s + r.size, 0);
    if (total < want) {
      const r = this.rnd() < 0.5 && l.rows.length ? l.rows[Math.floor(this.rnd() * l.rows.length)] : undefined;
      if (r) r.size += want - total;
      else l.rows.push(...this.rows(want - total, lot));
    } else {
      for (let i = l.rows.length - 1; i >= 0 && total > want; i--) {
        const cut = Math.min(l.rows[i].size, total - want);
        l.rows[i].size -= cut;
        total -= cut;
      }
      l.rows = l.rows.filter((r) => r.size > 0);
    }
    l.rows.sort((a, b) => b.size - a.size);
  }

  /** Completa la profundidad: agrega niveles al fondo y rellena huecos grandes cerca de la punta. */
  private fill(levels: Level[], side: 'bid' | 'ask', q: Quote, tick: number, lot: number): void {
    const dir = side === 'bid' ? -1 : 1;
    for (let i = 0; i + 1 < levels.length && i < 4; i++) {
      const a = levels[i].price;
      const b = levels[i + 1].price;
      const gapTicks = Math.round(Math.abs(b - a) / tick);
      if (gapTicks > this.gap(a, q) * 2 + 1) {
        const p = roundPx(a + dir * this.gap(a, q) * tick, tick);
        if ((dir < 0 && p > b + EPS) || (dir > 0 && p < b - EPS)) levels.splice(i + 1, 0, this.level(p, lot, side));
      }
    }
    if (!levels.length) return;
    let guard = 0;
    while (levels.length < DEPTH && guard++ < DEPTH * 2) {
      const last = levels[levels.length - 1].price;
      const p = roundPx(last + dir * this.gap(last, q) * tick, tick);
      if (!(p > 0)) break;
      levels.push(this.level(p, lot, side));
    }
  }

  /** Los niveles que no son la mejor punta cambian: entran y se cancelan órdenes. */
  private churn(dt: number, lot: number): void {
    const p = 1 - Math.exp(-dt / 5000);
    for (const levels of [this.bids, this.asks]) {
      for (let i = levels.length - 1; i >= 1; i--) {
        if (this.rnd() > p) continue;
        const l = levels[i];
        const roll = this.rnd();
        if (roll < 0.45 && l.rows.length) {
          const r = l.rows[Math.floor(this.rnd() * l.rows.length)];
          r.size = Math.max(100, Math.round((r.size * (0.4 + 1.4 * this.rnd())) / 100) * 100);
        } else if (roll < 0.7) {
          if (l.rows.length > 1) l.rows.splice(Math.floor(this.rnd() * l.rows.length), 1);
          else if (i > 2) levels.splice(i, 1);
        } else {
          const used = new Set(l.rows.map((r) => r.venue));
          const free = VENUES.filter((v) => !used.has(v));
          if (free.length) l.rows.push({ venue: free[Math.floor(this.rnd() * free.length)], size: this.size(lot) });
        }
        l.rows.sort((a, b) => b.size - a.size);
      }
    }
  }

  // ------------------------------------------------------------------ lectura

  /** Filas del Level 2 de un lado (mejor precio primero), con tus órdenes que esperan. */
  view(side: 'bid' | 'ask', own: Array<{ price: number; shares: number; route: string }> = [], max = 40): BookRow[] {
    const levels = side === 'bid' ? this.bids : this.asks;
    const out: BookRow[] = [];
    for (const l of levels) for (const r of l.rows) out.push({ venue: r.venue, price: l.price, size: r.size });
    for (const o of own) out.push({ venue: o.route, price: o.price, size: o.shares, own: true });
    out.sort((a, b) => (side === 'bid' ? b.price - a.price : a.price - b.price) || Number(!!b.own) - Number(!!a.own) || b.size - a.size);
    return out.slice(0, max);
  }

  /** Acciones visibles a un precio exacto de un lado (la cola delante de una orden nueva). */
  sizeAt(side: 'bid' | 'ask', price: number): number {
    const l = (side === 'bid' ? this.bids : this.asks).find((x) => Math.abs(x.price - price) < EPS);
    return l ? l.rows.reduce((s, r) => s + r.size, 0) : 0;
  }

  /**
   * Recorre el libro para una orden agresiva: compra contra las ofertas (de la más barata a la más
   * cara), venta contra las demandas. Con límite, no pasa de ese precio. Sin límite (a mercado), si
   * se acaba lo visible sigue con niveles cada vez peores, como pasa en una acción fina.
   */
  walk(side: 'buy' | 'sell', shares: number, limit?: number, refPrice?: number): Part[] {
    const levels = side === 'buy' ? this.asks : this.bids;
    const out: Part[] = [];
    let left = shares;
    let lastPx = refPrice ?? levels[0]?.price ?? 0;
    for (const l of levels) {
      if (left <= 0) break;
      if (limit !== undefined && (side === 'buy' ? l.price > limit + EPS : l.price < limit - EPS)) break;
      const avail = l.rows.reduce((s, r) => s + r.size, 0);
      const q = Math.min(left, avail);
      if (q > 0) out.push({ price: l.price, size: q });
      left -= q;
      lastPx = l.price;
    }
    if (left > 0 && limit === undefined && lastPx > 0) {
      const tick = tickOf(lastPx);
      const step = Math.max(1, Math.round((lastPx * 0.002) / tick));
      for (let guard = 0; left > 0 && guard < 60; guard++) {
        lastPx = roundPx(side === 'buy' ? lastPx + step * tick : Math.max(tick, lastPx - step * tick), tick);
        const q = Math.min(left, 500 + guard * 200);
        out.push({ price: lastPx, size: q });
        left -= q;
      }
    }
    return out;
  }

  /** Saca del libro la liquidez que tomó una orden propia (el mercado la repone en unos segundos). */
  take(side: 'buy' | 'sell', parts: Part[], now: number): void {
    const levels = side === 'buy' ? this.asks : this.bids;
    const key = side === 'buy' ? 'ask' : 'bid';
    for (const part of parts) {
      const c = this.consumed.get(`${key}:${part.price}`);
      this.consumed.set(`${key}:${part.price}`, { shares: (c?.shares ?? 0) + part.size, at: now });
      const l = levels.find((x) => Math.abs(x.price - part.price) < EPS);
      if (!l) continue;
      let left = part.size;
      for (const r of l.rows) {
        const cut = Math.min(r.size, left);
        r.size -= cut;
        left -= cut;
        if (left <= 0) break;
      }
      l.rows = l.rows.filter((r) => r.size > 0);
    }
    const kept = levels.filter((l) => l.rows.length);
    if (side === 'buy') this.asks = kept;
    else this.bids = kept;
  }
}

/** Un libro por símbolo, sincronizado al pedirlo. */
export class MarketBooks {
  private readonly books = new Map<string, DepthBook>();

  constructor(private readonly seed: number) {}

  get(sym: string, q: Quote | null, now: number): DepthBook | null {
    if (!q) return null;
    let b = this.books.get(sym);
    if (!b) {
      b = new DepthBook(hashSym(sym, this.seed));
      this.books.set(sym, b);
    }
    b.sync(q, now);
    return b;
  }

  /** Libros que ya no se miran (para no acumular memoria). */
  prune(keep: Set<string>): void {
    for (const sym of this.books.keys()) if (!keep.has(sym)) this.books.delete(sym);
  }
}
