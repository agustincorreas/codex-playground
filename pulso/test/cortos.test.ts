// Ventas en corto en la cuenta de práctica: locate, margen, reglas de la rueda, brackets invertidos,
// P&L con el signo correcto, cierre del día, estados viejos sin lado y el controlador (cubrir, atajos).
import { describe, expect, it } from 'vitest';
import type { Quote, ScanRow, TapePrint } from '../src/engine/types';
import { TrainingController } from '../src/client/training';
import { shortLabel } from '../src/client/lib/hotkeys';
import { resetConfirmForTests, resolveConfirm, withConfirm } from '../src/client/lib/confirm';
import type { DataSource, SourceHandlers } from '../src/client/source/types';
import { Broker, SHORT_MARGIN, type MarketAccess } from '../src/trading/broker';
import { DepthBook } from '../src/trading/depth';
import { describeLocate, locateFor, type Locate } from '../src/trading/locate';
import { breakdown } from '../src/trading/stats';
import type { TrainingStore } from '../src/trading/store';
import { DEFAULT_HOTKEYS, DEFAULT_TRADING, SIM_VERSION, type ActiveSession, type Position, type Trade, type TradingSettings, type TrainingState } from '../src/trading/types';

function session(cash = 1000): ActiveSession {
  return { id: 's1', mode: 'sim', dayKey: '2026-10-23', dayIndex: 1, startedAt: 0, marketStart: 0, startCash: cash, cash, unsettled: 0, positions: [], orders: [], history: [], fills: [], trades: [], seq: 0 };
}

class StaticBook extends DepthBook {
  sync(): void {}
}
const lvl = (price: number, ...sizes: number[]) => ({ price, rows: sizes.map((size, i) => ({ venue: ['NSDQ', 'ARCA', 'EDGX'][i] ?? 'BATS', size })) });

/** Mercado falso con prestables controlados por el test (ETB por defecto). */
function market(bid: number, ask: number) {
  const book = new StaticBook(1);
  book.bids = [lvl(bid, 300, 200), lvl(Math.round((bid - 0.01) * 100) / 100, 500), lvl(Math.round((bid - 0.03) * 100) / 100, 1000)];
  book.asks = [lvl(ask, 200), lvl(Math.round((ask + 0.01) * 100) / 100, 300), lvl(Math.round((ask + 0.05) * 100) / 100, 2000)];
  const quote: Quote = { sym: 'RUN', last: bid, bid, ask, bidSize: 500, askSize: 200, real: true, ts: 0, halted: false, volPerMin: 100_000 };
  const tape: TapePrint[] = [];
  let seq = 0;
  let sess: 'pre' | 'regular' | 'post' | 'closed' = 'regular';
  let locate: Locate = { shortable: 'etb', borrowFee: 0 };
  const m: MarketAccess = {
    quote: () => quote,
    book: () => (quote.halted ? null : book),
    printsSince: (_sym, after) => tape.filter((p) => p.seq > after),
    lastSeq: () => seq,
    session: () => sess,
    locate: () => locate,
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
    setSession(s: typeof sess) {
      sess = s;
    },
    setLocate(l: Locate) {
      locate = l;
    },
    /** Mueve todo el mercado a otro precio (puntas, libro y último). */
    moveTo(px: number) {
      quote.bid = px;
      quote.ask = Math.round((px + 0.01) * 100) / 100;
      quote.last = px;
      book.bids = [lvl(px, 1000), lvl(Math.round((px - 0.01) * 100) / 100, 1000)];
      book.asks = [lvl(quote.ask, 1000), lvl(Math.round((quote.ask + 0.01) * 100) / 100, 1000)];
    },
  };
}

/** Cuenta margen 2x sin tasas (los números de P&L quedan redondos); `regFees` se activa donde se prueban las tasas. */
function setup(settings: Partial<TradingSettings> = {}, cash = 1000, priorDayTrades = 0) {
  const b = new Broker(session(cash), { ...DEFAULT_TRADING, account: 'margin', leverage: 2, regFees: false, latencyMs: 100, ...settings }, {}, () => ({ priorDayTrades }));
  return { b, ...market(3.0, 3.01) };
}

const LAT = 200;

describe('locate', () => {
  it('depende del float y del precio, y es el mismo para el mismo símbolo y día', () => {
    expect(locateFor('BIG', '2026-10-23', { float: 50e6, price: 5 })).toEqual({ shortable: 'etb', borrowFee: 0 });
    const mid = locateFor('MID', '2026-10-23', { float: 8e6, price: 5 });
    expect(mid.shortable).toBe('htb');
    expect(mid.borrowFee).toBeGreaterThanOrEqual(0.005);
    expect(mid.borrowFee).toBeLessThanOrEqual(0.02);
    expect(locateFor('MID', '2026-10-23', { float: 8e6, price: 5 })).toEqual(mid);
    // Float chico: el 40 % de los días no hay acciones; el resto, HTB caro.
    const days = Array.from({ length: 200 }, (_, i) => locateFor('TINY', `2026-01-${String((i % 28) + 1).padStart(2, '0')}-${i}`, { float: 2e6, price: 4 }));
    const none = days.filter((l) => l.shortable === 'none').length;
    expect(none).toBeGreaterThan(50);
    expect(none).toBeLessThan(110);
    for (const l of days) {
      if (l.shortable === 'htb') {
        expect(l.borrowFee).toBeGreaterThanOrEqual(0.01);
        expect(l.borrowFee).toBeLessThanOrEqual(0.05);
      }
    }
    // Precio debajo de US$ 1: como un float chico aunque el float sea grande.
    const cheap = Array.from({ length: 100 }, (_, i) => locateFor(`P${i}`, '2026-10-23', { float: 90e6, price: 0.8 }));
    expect(cheap.some((l) => l.shortable === 'none')).toBe(true);
    expect(describeLocate({ shortable: 'htb', borrowFee: 0.02 })).toBe('HTB · US$ 0,02/acción');
    expect(describeLocate({ shortable: 'none', borrowFee: 0 })).toBe('No prestable hoy');
  });
});

describe('ventas en corto', () => {
  it('una venta sin posición abre un corto; otra lo agranda; las compras lo cubren en parte y del todo con el P&L correcto', () => {
    const { b, m, marks, moveTo } = setup();
    const r = b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 200 }, 0, m, marks);
    expect(r.ok).toBe(true);
    expect(r.order!.role).toBe('entry');
    b.process(LAT, m, marks);
    const p = b.position('RUN')!;
    expect(p).toMatchObject({ side: 'short', shares: 200, avgCost: 3.0, soldShares: 200, soldValue: 600, boughtShares: 0, realized: 0 });
    expect(b.session.cash).toBe(1600);
    // El efectivo subió con lo vendido, pero el equity no: se debe lo mismo que se vendió.
    expect(b.equity(marks)).toBe(1000);
    expect(b.positionValue(marks)).toBe(-600);
    expect(b.shortValue(marks)).toBe(600);
    // Agrandar el corto: otra venta, límite marketable.
    expect(b.place({ sym: 'RUN', side: 'sell', type: 'limit', price: 2.99, shares: 100 }, LAT, m, marks).ok).toBe(true);
    b.process(LAT * 2, m, marks);
    expect(b.position('RUN')).toMatchObject({ side: 'short', shares: 300, avgCost: 3.0, soldShares: 300 });
    // Baja a 2,90: el corto gana 10 centavos por acción.
    moveTo(2.89);
    expect(b.dayPnl(marks)).toBeCloseTo(33, 1);
    const cover = b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100 }, LAT * 2, m, marks);
    expect(cover.ok).toBe(true);
    expect(cover.order!.role).toBe('exit');
    b.process(LAT * 3, m, marks);
    expect(b.position('RUN')).toMatchObject({ side: 'short', shares: 200, boughtShares: 100, boughtCost: 290, realized: 10 });
    expect(b.session.cash).toBeCloseTo(1600 + 300 - 290, 2);
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 200 }, LAT * 3, m, marks);
    b.process(LAT * 4, m, marks);
    expect(b.position('RUN')).toBeUndefined();
    const t = b.session.trades[0];
    expect(t).toMatchObject({ side: 'short', shares: 300, avgEntry: 3.0, avgExit: 2.9, gross: 30, fees: 0, net: 30, exitReason: 'manual' });
    expect(t.returnPct).toBeCloseTo(3.33, 2);
    expect(b.session.cash).toBe(1030);
    expect(b.equity(marks)).toBe(1030);
  });

  it('cobra el locate de una acción HTB al ejecutarse (sumado a las comisiones) y lo avisa al enviar', () => {
    const { b, m, marks, setLocate } = setup({ regFees: true });
    setLocate({ shortable: 'htb', borrowFee: 0.02 });
    const r = b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 100 }, 0, m, marks);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Locate HTB · US\$ 0,02\/acción/);
    expect(r.order!.borrowFee).toBe(0.02);
    const [f] = b.process(LAT, m, marks);
    // 300 vendidos: SEC 0,01 + TAF 0,02 + locate 100 × 0,02 = 2,00.
    expect(f.fee).toBe(2.03);
    expect(b.position('RUN')).toMatchObject({ fees: 2.03, realized: -2.03 });
    expect(b.session.cash).toBe(1000 + 300 - 2.03);
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100 }, LAT, m, marks);
    b.process(LAT * 2, m, marks);
    expect(b.session.trades[0].fees).toBe(2.03);
    expect(b.session.trades[0].net).toBe(-1 - 2.03);
  });

  it('rechaza el corto sin acciones para prestar, en cuenta cash, fuera de la rueda regular, en halt, debajo de US$ 1 y con la pérdida máxima', () => {
    const { b, m, marks, setLocate, setSession, quote, moveTo } = setup();
    setLocate({ shortable: 'none', borrowFee: 0 });
    expect(b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 100 }, 0, m, marks).message).toMatch(/No hay acciones para pedir prestadas de RUN hoy/);
    setLocate({ shortable: 'etb', borrowFee: 0 });
    setSession('pre');
    expect(b.place({ sym: 'RUN', side: 'sell', type: 'limit', price: 3.0, shares: 100 }, 0, m, marks).message).toMatch(/solo se abren en la rueda regular/);
    setSession('post');
    expect(b.place({ sym: 'RUN', side: 'sell', type: 'limit', price: 3.0, shares: 100 }, 0, m, marks).message).toMatch(/solo se abren en la rueda regular/);
    setSession('regular');
    quote.halted = true;
    expect(b.place({ sym: 'RUN', side: 'sell', type: 'limit', price: 3.0, shares: 100 }, 0, m, marks).message).toMatch(/halt/);
    quote.halted = false;
    moveTo(0.95);
    expect(b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 100 }, 0, m, marks).message).toMatch(/debajo de US\$ 1/);
    moveTo(3.0);
    expect(b.shortBlock('RUN', 0, m, marks)).toBeNull();
    expect(b.orders()).toHaveLength(0);

    const cash = setup({ account: 'cash' });
    expect(cash.b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 100 }, 0, cash.m, cash.marks).message).toMatch(/cuenta cash no se vende en corto/);

    const loss = setup({ maxDailyLoss: 20 });
    loss.b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 300 }, 0, loss.m, loss.marks);
    loss.b.process(LAT, loss.m, loss.marks);
    loss.quote.last = 2.9;
    expect(loss.b.shortBlock('RUN', LAT, loss.m, loss.marks)).toMatch(/pérdida máxima/);

    // La regla PDT también cuenta para abrir cortos.
    const pdt = setup({}, 1000, 3);
    expect(pdt.b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 100 }, 0, pdt.m, pdt.marks).message).toMatch(/Regla PDT/);
  });

  it('una venta en corto que quedó esperando no se ejecuta en el after-hours', () => {
    const { b, m, marks, setSession } = setup();
    b.place({ sym: 'RUN', side: 'sell', type: 'limit', price: 3.05, shares: 100 }, 0, m, marks);
    setSession('post');
    b.process(LAT, m, marks);
    expect(b.orders()[0].note).toMatch(/rueda regular/);
    expect(b.position('RUN')).toBeUndefined();
  });

  it('bloquea el 150 % de la venta como poder de compra (y el locate) y nunca mezcla largo con corto en una orden', () => {
    const { b, m, marks } = setup();
    expect(b.buyingPower(marks)).toBe(2000);
    // 2000 / (1,5 × 3,00) = 444 acciones.
    const big = b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 500 }, 0, m, marks);
    expect(big.ok).toBe(false);
    expect(big.message).toMatch(/150 %.*Te alcanza para 444 acciones/);
    b.place({ sym: 'RUN', side: 'sell', type: 'limit', price: 3.0, shares: 200 }, 0, m, marks);
    // Pendiente: reserva el 150 % de lo que va a vender (como una compra límite reserva su costo).
    expect(b.reserved()).toBe(SHORT_MARGIN * 600);
    b.process(LAT, m, marks);
    expect(b.reserved()).toBe(0);
    expect(b.buyingPower(marks)).toBe(2000 - 900);
    expect(b.buyingPowerUsed(marks)).toBe(900);
    expect(b.marginBorrowed(marks)).toBe(0);
    expect(b.leverage(marks)).toBe(2);
    // Cubrir más de lo que se debe: no se pasa a largo.
    expect(b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 300 }, LAT, m, marks).message).toMatch(/pasarte a largo cubrí primero/);
    // Al revés: con un largo, una venta mayor no abre un corto.
    const l = setup();
    l.b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100 }, 0, l.m, l.marks);
    l.b.process(LAT, l.m, l.marks);
    expect(l.b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 150 }, LAT, l.m, l.marks).message).toMatch(/pasarte a corto vendé primero/);
  });

  it('el stop y el objetivo de un corto van invertidos: el stop compra arriba y el objetivo compra la mitad abajo', () => {
    const { b, m, marks, print, quote } = setup();
    // Niveles del lado equivocado: se rechazan.
    expect(b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 100, stop: 2.9 }, 0, m, marks).message).toMatch(/arriba del ask/);
    expect(b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 100, target: 3.2 }, 0, m, marks).message).toMatch(/debajo de tu entrada/);
    b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 100, stop: 3.1, target: 2.8 }, 0, m, marks);
    b.process(LAT, m, marks);
    const stop = b.orders().find((o) => o.role === 'stop')!;
    const target = b.orders().find((o) => o.role === 'target')!;
    expect(stop).toMatchObject({ side: 'buy', type: 'stop', stopPrice: 3.1, shares: 100 });
    expect(target).toMatchObject({ side: 'buy', type: 'limit', price: 2.8, shares: 50 });
    expect(b.position('RUN')).toMatchObject({ stop: 3.1, target: 2.8, initialStop: 3.1 });
    // Baja hasta el objetivo: cubre la mitad; el stop queda por el resto.
    print(2.79, 200, 'bid');
    const f = b.process(LAT + 100, m, marks);
    expect(f[0]).toMatchObject({ role: 'target', side: 'buy', price: 2.8, shares: 50 });
    expect(b.position('RUN')).toMatchObject({ shares: 50, boughtShares: 50, target: undefined });
    expect(b.orders()).toHaveLength(1);
    expect(b.orders()[0]).toMatchObject({ role: 'stop', shares: 50 });
    // Sube hasta el stop: cubre el resto a mercado contra el ask y cierra el trade con R negativa.
    quote.ask = 3.12;
    print(3.11, 100, 'ask');
    b.process(LAT + 200, m, marks);
    expect(b.orders()).toHaveLength(0);
    const t = b.session.trades[0];
    expect(t).toMatchObject({ side: 'short', exitReason: 'stop', shares: 100, risk: 10 });
    expect(t.r).toBeDefined();
    // setBracket también valida invertido.
    const s = setup();
    s.b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 100 }, 0, s.m, s.marks);
    s.b.process(LAT, s.m, s.marks);
    expect(s.b.setBracket('RUN', { stop: 2.9 }, LAT, s.quote).message).toMatch(/arriba del ask/);
    expect(s.b.setBracket('RUN', { target: 3.2 }, LAT, s.quote).message).toMatch(/debajo del bid/);
    expect(s.b.setBracket('RUN', { stop: 3.2, target: 2.7 }, LAT, s.quote).ok).toBe(true);
  });

  it('un stop de compra del ticket sobre un corto es el stop de la posición', () => {
    const { b, m, marks, quote } = setup();
    b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 100 }, 0, m, marks);
    b.process(LAT, m, marks);
    expect(b.place({ sym: 'RUN', side: 'buy', type: 'stop', stopPrice: 2.95, shares: 100 }, LAT, m, marks).message).toMatch(/arriba del ask/);
    const r = b.place({ sym: 'RUN', side: 'buy', type: 'stop', stopPrice: 3.15, shares: 100 }, LAT, m, marks);
    expect(r.ok).toBe(true);
    expect(r.order!.role).toBe('stop');
    expect(b.position('RUN')).toMatchObject({ stop: 3.15, initialStop: 3.15 });
    quote.last = 3.16;
    b.process(LAT * 2, m, marks);
    expect(b.session.trades[0]).toMatchObject({ side: 'short', exitReason: 'stop' });
  });

  it('el cierre del día cubre los cortos (contra el libro, o al último precio sin mercado)', () => {
    const { b, m, marks } = setup();
    b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 100, stop: 3.2 }, 0, m, marks);
    b.process(LAT, m, marks);
    const trades = b.flatten(LAT * 2, m, marks);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ side: 'short', exitReason: 'eod', avgEntry: 3.0, avgExit: 3.01, net: -1 });
    expect(b.session.positions).toHaveLength(0);
    expect(b.orders()).toHaveLength(0);
    const none: MarketAccess = { quote: () => null, book: () => null, printsSince: () => [], lastSeq: () => 0, session: () => 'closed' };
    const d = setup();
    d.b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 100 }, 0, d.m, d.marks);
    d.b.process(LAT, d.m, d.marks);
    const td = d.b.flatten(LAT * 2, none, () => undefined);
    expect(td[0]).toMatchObject({ side: 'short', avgExit: 3.0, net: 0 });
    expect(d.b.session.cash).toBe(1000);
  });

  it('en un trade corto el MFE es cuanto bajó y el MAE cuanto subió', () => {
    const { b, m, marks, quote, moveTo } = setup();
    b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 100 }, 0, m, marks);
    b.process(LAT, m, marks);
    quote.last = 2.7;
    b.process(LAT + 100, m, marks);
    quote.last = 3.15;
    b.process(LAT + 200, m, marks);
    expect(b.position('RUN')).toMatchObject({ high: 3.15, low: 2.7 });
    moveTo(3.0);
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100 }, LAT + 200, m, marks);
    b.process(LAT + 400, m, marks);
    const t = b.session.trades[0];
    expect(t.mfePct).toBe(10);
    expect(t.maePct).toBe(-5);
    expect(breakdown([t, { ...t, id: 'x', side: undefined }], 'lado').map((x) => [x.label, x.trades])).toEqual([
      ['Largo', 1],
      ['Corto', 1],
    ]);
  });

  it('un corto cuenta como day trade para la regla PDT', () => {
    const { b, m, marks } = setup({}, 1000, 2);
    b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 100 }, 0, m, marks);
    b.process(LAT, m, marks);
    b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 100 }, LAT, m, marks);
    b.process(LAT * 2, m, marks);
    expect(b.dayTradeCount()).toBe(3);
    expect(b.place({ sym: 'RUN', side: 'buy', type: 'market', shares: 10 }, LAT * 2, m, marks).message).toMatch(/Regla PDT/);
    expect(b.place({ sym: 'RUN', side: 'sell', type: 'market', shares: 10 }, LAT * 2, m, marks).message).toMatch(/Regla PDT/);
  });

  it('las posiciones guardadas sin lado se normalizan como largas', () => {
    const a = session(700);
    const old = { sym: 'RUN', shares: 100, avgCost: 3, openedAt: 1, boughtShares: 100, boughtCost: 300, soldShares: 0, soldValue: 0, fees: 0, realized: 0, high: 3, low: 3, fills: 1 } as Position;
    a.positions.push(old);
    const b = new Broker(a, { ...DEFAULT_TRADING, account: 'margin' });
    expect(b.position('RUN')!.side).toBe('long');
    expect(b.opens('RUN', 'sell')).toBe(false);
    expect(b.equity(() => 3.5)).toBe(1050);
  });
});

// ------------------------------------------------------------------ controlador

const emptyStore = (): TrainingStore => ({ kind: 'navegador', load: async () => ({ state: null, sessions: [] }), saveState: async () => {}, saveSession: async () => {}, clear: async () => {} });

/** Fuente falsa mínima: una acción con float chico (HTB) y un mercado fijo que el test mueve. */
function fakeSource(float = 8e6) {
  const { m, quote, book, print, setSession, moveTo } = market(3.0, 3.01);
  const row = { sym: 'RUN', price: 3.0, bid: 3.0, ask: 3.01, changePct: 25, gapPct: 20, rvol: 5, rvol5m: 4, volume: 2e6, float, score: 4, hod: 3.2, lod: 2.5 } as unknown as ScanRow;
  let now = 1_000_000;
  const src: DataSource & { tick(ms: number): number } = {
    kind: 'local',
    ready: true,
    depthIsReal: true,
    start: (_h: SourceHandlers) => {},
    stop: () => {},
    select: () => {},
    setSettings: () => {},
    setWatchlist: () => {},
    setTracked: () => {},
    setSpeed: () => {},
    search: async () => [],
    now: () => now,
    quote: (s) => (s === 'RUN' ? quote : null),
    row: (s) => (s === 'RUN' ? row : null),
    reviewBars: () => undefined,
    book: (s) => (s === 'RUN' ? m.book(s) : null),
    printsSince: (s, after) => m.printsSince(s, after),
    lastSeq: () => m.lastSeq(),
    session: (t) => m.session(t),
    tick(ms: number) {
      now += ms;
      return now;
    },
  };
  return { src, quote, book, print, setSession, moveTo };
}

function controller(settings: Partial<TradingSettings> = {}) {
  const c = new TrainingController(emptyStore(), { state: null, sessions: [] }, 'local');
  c.updateSettings({ account: 'margin', leverage: 2, regFees: false, latencyMs: 100, ...settings });
  const f = fakeSource();
  c.attach(f.src);
  const tick = (ms = LAT) => c.onTick(f.src.tick(ms));
  return { c, ...f, tick };
}

describe('controlador con cortos', () => {
  it('informa el locate del día, abre un corto desde el celular y lo cubre con "vender" (espejado a Ask + 0,05)', () => {
    const { c, tick } = controller();
    const l = c.locate('RUN')!;
    expect(l.shortable).toBe('htb');
    expect(c.shortBlock('RUN')).toBeNull();
    expect(c.short('RUN', 100, { stop: 3.2, target: 2.6, setup: 'Otro' }).ok).toBe(true);
    const o = c.broker!.orders('RUN')[0];
    expect(o).toMatchObject({ side: 'sell', type: 'limit', price: 2.95, role: 'entry', borrowFee: l.borrowFee, setup: 'Otro' });
    // Sin stop automático, el stop (arriba) y el objetivo (abajo) quedan como plan, y la entrada lleva el contexto.
    expect(o.plan).toEqual({ stop: 3.2, target: 2.6 });
    expect(o.ctx?.float).toBe(8e6);
    tick();
    const p = c.broker!.position('RUN')!;
    expect(p).toMatchObject({ side: 'short', shares: 100, planStop: 3.2, planTarget: 2.6, initialStop: 3.2 });
    expect(c.unrealized('RUN')).toMatchObject({ pnl: 0 });
    expect(c.summary().shortValue).toBe(300);
    expect(c.summary().positionValue).toBe(-300);
    // "Vender la mitad" con un corto cubre la mitad comprando a Ask + 0,05.
    expect(c.sell('RUN', 0.5).ok).toBe(true);
    expect(c.broker!.orders('RUN')[0]).toMatchObject({ side: 'buy', type: 'limit', price: 3.06, shares: 50, role: 'exit' });
    tick();
    expect(c.broker!.position('RUN')!.shares).toBe(50);
    // El atajo "vender todo a Bid − 0,05" y "cover" hacen lo mismo.
    const sellAll = DEFAULT_HOTKEYS.find((h) => h.id === 'sell-all')!;
    expect(c.hotkey(sellAll, 'RUN', { shares: 100 })!.ok).toBe(true);
    expect(c.broker!.orders('RUN')[0]).toMatchObject({ side: 'buy', price: 3.06, shares: 50 });
    tick();
    expect(c.broker!.position('RUN')).toBeUndefined();
    expect(c.active!.trades[0]).toMatchObject({ side: 'short', shares: 100 });
    // Sin posición, "vender" y "cubrir" no abren un corto.
    expect(c.sell('RUN', 1).ok).toBe(false);
    expect(c.cover('RUN', 1).ok).toBe(false);
    expect(c.broker!.orders('RUN')).toHaveLength(0);
  });

  it('en cuenta cash el controlador explica por qué no se puede, y el atajo de compra con un corto abierto cubre', () => {
    const { c, tick } = controller({ account: 'cash' });
    expect(c.shortBlock('RUN')).toMatch(/cuenta cash/);
    c.updateSettings({ account: 'margin' });
    expect(c.short('RUN', 100).ok).toBe(true);
    tick();
    const buy = DEFAULT_HOTKEYS.find((h) => h.id === 'buy-500')!;
    expect(c.hotkey(buy, 'RUN', { shares: 100 })!.ok).toBe(true);
    expect(c.broker!.orders('RUN')[0]).toMatchObject({ side: 'buy', shares: 100, role: 'exit' });
  });

  it('las etiquetas de los atajos se espejan con un corto abierto', () => {
    const sellAll = DEFAULT_HOTKEYS.find((h) => h.id === 'sell-all')!;
    expect(shortLabel(sellAll, 100)).toBe('Vende todo Bid−.05');
    expect(shortLabel(sellAll, 100, 'short')).toBe('Cubre todo Ask+.05');
    const buy = DEFAULT_HOTKEYS.find((h) => h.id === 'buy-ticket')!;
    expect(shortLabel(buy, 100, 'short')).toBe('Cubre 100 Ask+.05');
  });

  it('el primer corto de la sesión pide confirmación aunque el modo esté apagado; el segundo ya no', () => {
    resetConfirmForTests();
    const runs: string[] = [];
    withConfirm({ sym: 'RUN', side: 'sell', kind: 'short', shares: 100, type: 'limit', price: 2.95 }, () => runs.push('a'));
    expect(runs).toEqual([]);
    resolveConfirm(true);
    expect(runs).toEqual(['a']);
    withConfirm({ sym: 'RUN', side: 'sell', kind: 'short', shares: 100, type: 'limit', price: 2.95 }, () => runs.push('b'));
    expect(runs).toEqual(['a', 'b']);
    // Cancelar el aviso no lo da por aceptado.
    resetConfirmForTests();
    withConfirm({ sym: 'RUN', side: 'sell', kind: 'short', shares: 100, type: 'limit' }, () => runs.push('c'));
    resolveConfirm(false);
    withConfirm({ sym: 'RUN', side: 'sell', kind: 'short', shares: 100, type: 'limit' }, () => runs.push('d'));
    expect(runs).toEqual(['a', 'b']);
    resolveConfirm(true);
    expect(runs).toEqual(['a', 'b', 'd']);
  });

  it('un estado guardado sin lado se normaliza (posiciones y trades largos) y se archiva devolviendo el corto a su venta', () => {
    const old = { sym: 'RUN', shares: 100, avgCost: 3, openedAt: 1, boughtShares: 100, boughtCost: 300, soldShares: 0, soldValue: 0, fees: 0, realized: 0, high: 3, low: 3, fills: 1 } as Position;
    const trade = { id: 't1', sessionId: 'd1', sym: 'RUN', openedAt: 1, closedAt: 2, shares: 100, avgEntry: 3, avgExit: 3.1, gross: 10, fees: 0, net: 10, returnPct: 3.3, mfePct: 4, maePct: -1, exitReason: 'manual', fills: 2 } as Trade;
    const a: ActiveSession = { id: 'd1', mode: 'sim', seed: 7, simVersion: SIM_VERSION, dayTs: Date.now(), startMinutes: 565, dayKey: '2026-10-23', dayIndex: 1, startedAt: 1, marketStart: 1, startCash: 1000, cash: 700, unsettled: 0, positions: [old], orders: [], history: [], fills: [], trades: [trade], seq: 0 };
    const st: TrainingState = { version: 1, settings: { ...DEFAULT_TRADING, account: 'margin' }, balance: 1000, dayIndex: 1, dayTrades: [], active: a, updatedAt: 1 };
    const c = new TrainingController(emptyStore(), { state: st, sessions: [] }, 'local');
    expect(c.active!.positions[0].side).toBe('long');
    expect(c.active!.trades[0].side).toBe('long');
    // Un día de otra versión con un corto abierto: al archivarlo, lo vendido vuelve a su precio de venta.
    const short: Position = { ...old, side: 'short', boughtShares: 0, boughtCost: 0, soldShares: 100, soldValue: 300 };
    const stale: ActiveSession = { ...a, id: 'd2', simVersion: SIM_VERSION - 1, cash: 1300, positions: [short], trades: [] };
    const c2 = new TrainingController(emptyStore(), { state: { ...st, active: stale }, sessions: [] }, 'local');
    expect(c2.state.balance).toBe(1000);
  });
});
