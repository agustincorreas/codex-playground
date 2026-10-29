// Bróker de práctica: stop y objetivo con ejecuciones parciales, cierre del día sin liquidez, y la
// conservación del dinero (efectivo + posiciones al costo − resultados = lo que había) en cada paso.
import { describe, expect, it } from 'vitest';
import type { Quote, TapePrint } from '../src/engine/types';
import { Broker, type MarketAccess } from '../src/trading/broker';
import { DepthBook } from '../src/trading/depth';
import { DEFAULT_TRADING, type ActiveSession, type TradingSettings } from '../src/trading/types';

function session(cash = 1000): ActiveSession {
  return { id: 's1', mode: 'sim', dayKey: '2026-10-23', dayIndex: 1, startedAt: 0, marketStart: 0, startCash: cash, cash, unsettled: 0, positions: [], orders: [], history: [], fills: [], trades: [], seq: 0 };
}

class StaticBook extends DepthBook {
  sync(): void {}
}
const lvl = (price: number, ...sizes: number[]) => ({ price, rows: sizes.map((size, i) => ({ venue: ['NSDQ', 'ARCA', 'EDGX'][i] ?? 'BATS', size })) });

function market(bid: number, ask: number) {
  const book = new StaticBook(1);
  book.bids = [lvl(bid, 300, 200), lvl(Math.round((bid - 0.01) * 100) / 100, 500), lvl(Math.round((bid - 0.03) * 100) / 100, 1000)];
  book.asks = [lvl(ask, 200), lvl(Math.round((ask + 0.01) * 100) / 100, 300), lvl(Math.round((ask + 0.05) * 100) / 100, 2000)];
  const quote: Quote = { sym: 'RUN', last: bid, bid, ask, bidSize: 500, askSize: 200, real: true, ts: 0, halted: false, volPerMin: 100_000 };
  const tape: TapePrint[] = [];
  let seq = 0;
  let noBook = false;
  const m: MarketAccess = {
    quote: () => quote,
    book: () => (quote.halted || noBook ? null : book),
    printsSince: (_sym, after) => tape.filter((p) => p.seq > after),
    lastSeq: () => seq,
    session: () => 'regular',
  };
  return {
    m,
    book,
    quote,
    marks: () => quote.last,
    print(price: number, size: number, side: TapePrint['side']) {
      tape.push({ seq: ++seq, ts: 0, price, size, side });
      quote.last = price;
    },
    withoutBook() {
      noBook = true;
    },
  };
}

function setup(settings: Partial<TradingSettings> = {}, cash = 1000) {
  const b = new Broker(session(cash), { ...DEFAULT_TRADING, latencyMs: 100, ...settings }, {}, () => ({ priorDayTrades: 0 }));
  return { b, ...market(3.0, 3.01) };
}

const LAT = 200;

/** Efectivo + posiciones al costo − resultado realizado (parciales y trades cerrados) = efectivo inicial. */
function conserved(b: Broker): number {
  const s = b.session;
  const held = s.positions.reduce((v, p) => v + p.shares * p.avgCost - p.realized, 0);
  const closed = s.trades.reduce((v, t) => v + t.net, 0);
  return s.cash + held - closed;
}

describe('stop y objetivo con ejecuciones parciales', () => {
  it('el bracket acompaña cada ejecución parcial de la compra y el objetivo vende la mitad de lo que hay', () => {
    const { b, m, marks, print } = setup({}, 5000);
    // Solo 200 en el ask hasta mi límite: la compra queda parcial y espera el resto en la cola.
    b.place({ sym: 'RUN', side: 'buy', type: 'limit', price: 3.01, shares: 400, stop: 2.9, target: 3.21 }, 0, m, marks);
    b.process(LAT, m, marks);
    expect(b.position('RUN')!.shares).toBe(200);
    expect(b.orders().find((o) => o.side === 'buy')).toMatchObject({ status: 'partial', filled: 200 });
    expect(b.orders().find((o) => o.role === 'stop')!.shares).toBe(200);
    expect(b.orders().find((o) => o.role === 'target')!.shares).toBe(100);
    // Un print por debajo de mi precio: me tocaba a mí, se completa la compra y el bracket se rehace.
    print(3.0, 500, 'bid');
    b.process(LAT + 100, m, marks);
    expect(b.position('RUN')!.shares).toBe(400);
    expect(b.orders().filter((o) => o.side === 'buy')).toHaveLength(0);
    expect(b.orders().find((o) => o.role === 'stop')!.shares).toBe(400);
    expect(b.orders().find((o) => o.role === 'target')!.shares).toBe(200);
    // El objetivo se ejecuta en partes: cada parte achica el stop; al completarse, el stop queda por la mitad.
    print(3.21, 50, 'ask');
    b.process(LAT + 200, m, marks);
    expect(b.position('RUN')!.shares).toBe(350);
    expect(b.orders().find((o) => o.role === 'target')).toMatchObject({ status: 'partial', filled: 50 });
    expect(b.orders().find((o) => o.role === 'stop')!.shares).toBe(350);
    print(3.22, 500, 'ask');
    b.process(LAT + 300, m, marks);
    expect(b.position('RUN')).toMatchObject({ shares: 200, soldShares: 200, target: undefined });
    expect(b.orders()).toHaveLength(1);
    expect(b.orders()[0]).toMatchObject({ role: 'stop', shares: 200 });
    expect(conserved(b)).toBeCloseTo(5000, 1);
  });

  it('un stop de venta del ticket que cubre la posición es el stop de la posición (rol y riesgo)', () => {
    const { b, m, marks, print, quote } = setup();
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100 }, 0, m, marks);
    b.process(LAT, m, marks);
    const r = b.place({ sym: 'RUN', side: 'sell', type: 'stop', stopPrice: 2.9, shares: 100 }, LAT, m, marks);
    expect(r.ok).toBe(true);
    expect(r.order!.role).toBe('stop');
    expect(b.position('RUN')).toMatchObject({ stop: 2.9, initialStop: 2.9 });
    quote.bid = 2.88;
    print(2.89, 300, 'bid');
    b.process(LAT * 2, m, marks);
    expect(b.session.trades[0]).toMatchObject({ exitReason: 'stop' });
    expect(b.session.trades[0].r).toBeLessThan(0);
  });

  it('una compra stop acepta un stop de pérdida entre el bid y la entrada', () => {
    const { b, m, marks } = setup();
    expect(b.place({ sym: 'RUN', side: 'buy', type: 'stop', stopPrice: 3.1, shares: 100, stop: 3.05, target: 3.3 }, 0, m, marks).ok).toBe(true);
    expect(b.place({ sym: 'RUN', side: 'buy', type: 'stop', stopPrice: 3.1, shares: 100, stop: 3.1 }, 0, m, marks).message).toMatch(/debajo de tu entrada/);
    expect(b.place({ sym: 'RUN', side: 'buy', type: 'limit', price: 3.01, shares: 100, stop: 3.005 }, 0, m, marks).message).toMatch(/debajo del bid/);
  });

  it('una compra a mercado descuenta la comisión al ver cuánto alcanza: el efectivo no queda negativo', () => {
    const { b, m, marks, book, quote } = setup({ commissionPerShare: 0.01, minCommission: 1, regFees: false }, 306);
    expect(b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100 }, 0, m, marks).ok).toBe(true);
    // Antes de que llegue, el ask se va a 3,06: con la comisión ya no alcanza para las 100.
    quote.ask = 3.06;
    book.asks = [lvl(3.06, 2000)];
    b.process(LAT, m, marks);
    expect(b.position('RUN')!.shares).toBe(99);
    expect(b.session.cash).toBeGreaterThanOrEqual(0);
    expect(conserved(b)).toBeCloseTo(306, 1);
  });
});

describe('cierre del día', () => {
  it('sin libro ni liquidez cierra al último precio, nunca a $0 ni dejando la posición viva', () => {
    const a = setup();
    a.b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100, stop: 2.9 }, 0, a.m, a.marks);
    a.b.process(LAT, a.m, a.marks);
    a.quote.last = 3.05;
    a.withoutBook();
    const trades = a.b.flatten(LAT * 2, a.m, a.marks);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ exitReason: 'eod', avgExit: 3.05 });
    expect(a.b.session.positions).toHaveLength(0);
    expect(a.b.orders()).toHaveLength(0);

    // Libro con menos acciones que la posición: lo que no se pudo vender se cierra al último precio.
    const c = setup({}, 10_000);
    c.b.place({ sym: 'RUN', side: 'buy', type: 'limit', price: 3.06, shares: 2000 }, 0, c.m, c.marks);
    c.b.process(LAT, c.m, c.marks);
    expect(c.b.position('RUN')!.shares).toBe(2000);
    c.book.bids = [lvl(3.0, 100)];
    c.quote.last = 3.0;
    const t = c.b.flatten(LAT * 2, c.m, c.marks);
    expect(t).toHaveLength(1);
    expect(t[0].shares).toBe(2000);
    expect(c.b.session.positions).toHaveLength(0);
    expect(conserved(c.b)).toBeCloseTo(10_000, 1);

    // Sin cotización (sin fuente de datos): al costo.
    const d = setup();
    d.b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100 }, 0, d.m, d.marks);
    d.b.process(LAT, d.m, d.marks);
    const none: MarketAccess = { quote: () => null, book: () => null, printsSince: () => [], lastSeq: () => 0, session: () => 'closed' };
    const td = d.b.flatten(LAT * 2, none, () => undefined);
    expect(td[0].avgExit).toBe(d.b.session.trades[0].avgEntry);
    expect(d.b.session.positions).toHaveLength(0);
  });
});

describe('conservación del dinero', () => {
  it('efectivo + posiciones al costo − resultados queda igual a través de compras, ventas parciales, tasas y cierre', () => {
    const { b, m, marks, print, quote } = setup({ commissionPerShare: 0.005, minCommission: 1, regFees: true }, 20_000);
    const check = () => expect(conserved(b)).toBeCloseTo(20_000, 1);
    let now = 0;
    const step = () => {
      now += LAT;
      b.process(now, m, marks);
      check();
    };
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 700 }, now, m, marks);
    step();
    b.place({ sym: 'RUN', side: 'buy', type: 'limit', price: 3.0, shares: 300 }, now, m, marks);
    step();
    print(2.99, 1000, 'bid');
    step();
    expect(b.position('RUN')!.shares).toBe(1000);
    b.setBracket('RUN', { stop: 2.8, target: 3.3 }, now, quote);
    step();
    b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 250 }, now, m, marks);
    step();
    print(3.31, 200, 'ask');
    step();
    print(3.32, 1000, 'ask');
    step();
    expect(b.position('RUN')!.soldShares).toBeGreaterThan(250);
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 400 }, now, m, marks);
    step();
    quote.bid = 2.79;
    print(2.79, 100, 'bid');
    step();
    step();
    if (b.position('RUN')) {
      b.flatten(now, m, marks);
      check();
    }
    expect(b.session.positions).toHaveLength(0);
    expect(b.session.trades.length).toBeGreaterThanOrEqual(1);
    expect(b.session.fills.reduce((v, f) => v + f.fee, 0)).toBeGreaterThan(0);
    check();
  });
});
