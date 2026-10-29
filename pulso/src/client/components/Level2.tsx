// Ventana "Nivel 2 y órdenes", como la del simulador de Warrior Trading y el montage de DAS: el libro
// por venues con un color por nivel de precio, la cinta (Time & Sales) y el ticket de órdenes con
// botones rápidos. Tus órdenes que esperan aparecen en el libro con la ruta que elegiste.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { formatCountdown, formatEtTime } from '../../engine/time';
import type { Quote, SymbolDetail, TapePrint } from '../../engine/types';
import { roundPx, tickOf, type BookRow } from '../../trading/depth';
import { SETUPS, type Hotkey, type OrderType, type Tif } from '../../trading/types';
import { useTrainingVersion, type TrainingController } from '../training';
import type { DataSource } from '../source/types';
import { fmtInt, fmtMoney, fmtPrice, fmtVolume } from '../lib/format';
import { hotkeyLabel, shortLabel } from '../lib/hotkeys';
import { useNow } from '../lib/now';

export interface TicketForm {
  /** Símbolo para el que se armaron los valores. */
  sym: string | null;
  type: OrderType;
  price: string;
  shares: string;
  route: string;
  tif: Tif;
  /** Stop y objetivo del plan (y de las órdenes OCO si están activadas en los ajustes). */
  stop: string;
  target: string;
  setup: string;
  /** El usuario cambió precio, stop u objetivo de este símbolo: no se pisan con la sugerencia. */
  edited: boolean;
  /** El usuario escribió stop u objetivo: ya no acompañan los cambios de precio. */
  levelsEdited?: boolean;
}

export const ROUTES = ['SMRT', 'NSDQ', 'ARCA', 'EDGX', 'BATS', 'MEMX'];

export const num = (s: string) => {
  const v = Number(String(s).replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : undefined;
};

/**
 * Stop un tick debajo del mínimo de la vela de 1 minuto anterior y la actual, y debajo del bid. Nunca
 * más pegado que el rango típico de una vela (1,5 % como mínimo): más cerca, el ruido normal lo saca.
 */
export function pullbackStop(detail: SymbolDetail, entry: number, bid: number): number {
  const tick = tickOf(entry);
  const recent = detail.bars.slice(-2);
  const low = recent.length ? Math.min(...recent.map((b) => b.l)) - tick : entry * 0.97;
  const last5 = detail.bars.slice(-5);
  const range = last5.length ? last5.reduce((a, b) => a + b.h - b.l, 0) / last5.length : entry * 0.02;
  const cap = Math.min(entry - Math.max(3 * tick, entry * 0.015, range), (bid || entry) - tick);
  return roundPx(Math.min(cap, Math.max(entry * 0.9, low)));
}

/** Precio, stop y objetivo sugeridos: los del bull flag armado o el mínimo del retroceso, con objetivo a 2R. */
export function suggestTicket(detail: SymbolDetail, q: Quote | null): Pick<TicketForm, 'price' | 'stop' | 'target'> {
  const flag = detail.setup.flag;
  const ask = q?.ask || detail.row.ask || detail.row.price;
  const bid = q?.bid || detail.row.bid || detail.row.price;
  const entry = flag ? Math.max(flag.entry, ask) : ask;
  let stop = flag ? flag.stop : pullbackStop(detail, entry, bid);
  if (stop >= bid) stop = pullbackStop(detail, entry, bid);
  return { price: fmtPrice(ask), stop: fmtPrice(stop), target: fmtPrice(roundPx(entry + 2 * Math.max(tickOf(entry), entry - stop))) };
}

interface Props {
  c: TrainingController;
  source: DataSource | null;
  detail: SymbolDetail | null;
  quote: Quote | null;
  ticket: TicketForm;
  setTicket: (patch: Partial<TicketForm>) => void;
  onSymbol: (sym: string) => void;
  search: (prefix: string) => Promise<string[]>;
  onHotkey: (h: Hotkey) => void;
  /** Para el celular: menos filas del libro y de la cinta. */
  compact?: boolean;
  /** Abre el diálogo para elegir el próximo día. */
  onNewDay?: () => void;
}

const NO_ROWS: BookRow[] = [];

const SIDE_CLASS: Record<TapePrint['side'], string> = { below: 'ts-below', bid: 'ts-bid', mid: 'ts-mid', ask: 'ts-ask', above: 'ts-above' };

function BookSide({ rows, side, onPick, max }: { rows: BookRow[]; side: 'bid' | 'ask'; onPick: (price: number) => void; max: number }) {
  // Un color por nivel de precio (1, 2, 3 y 4 o más), contando desde la mejor punta.
  let level = 0;
  let last = NaN;
  const shown = rows.slice(0, max);
  return (
    <table className={`l2-side l2-${side}`}>
      <thead>
        <tr>
          <th>Maker</th>
          <th className={`num l2-head-${side}`}>{side === 'bid' ? 'Bid' : 'Ask'}</th>
          <th className="num">Size</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((r, i) => {
          if (r.price !== last) {
            level++;
            last = r.price;
          }
          return (
            <tr key={`${r.venue}-${r.price}-${i}`} className={`l2-lv${Math.min(level, 4)} ${r.own ? 'is-own' : ''}`} onClick={() => onPick(r.price)} title={r.own ? 'Tu orden' : `Usar ${fmtPrice(r.price)} como precio`}>
              <td>{r.own ? `▸${r.venue}` : r.venue}</td>
              <td className="num">{fmtPrice(r.price)}</td>
              <td className="num">{fmtInt(r.size)}</td>
            </tr>
          );
        })}
        {Array.from({ length: Math.max(0, Math.min(max, 6) - shown.length) }, (_, i) => (
          <tr key={`empty-${i}`} className="l2-empty">
            <td colSpan={3}>&nbsp;</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** "Reanuda en 03:12" de un halt: lo único del Nivel 2 que avanza con el reloj. */
function HaltResume({ at }: { at: number }) {
  const now = useNow(1000);
  return <span> · reanuda en {formatCountdown(Math.max(0, at - now))}</span>;
}

function Level2View({ c, source, detail, quote, ticket, setTicket, onSymbol, search, onHotkey, compact, onNewDay }: Props) {
  // La ventana está memorizada: se suscribe a la cuenta de práctica para enterarse de órdenes y posiciones.
  const version = useTrainingVersion(c);
  const sym = detail?.sym ?? null;
  const [symText, setSymText] = useState(sym ?? '');
  const [hits, setHits] = useState<string[]>([]);
  useEffect(() => setSymText(sym ?? ''), [sym]);
  // Sugerencias del campo de símbolo: 150 ms después de la última tecla.
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  // Valores sugeridos al cambiar de acción y con cada vela nueva, mientras no los edites.
  const barKey = detail?.bars[detail.bars.length - 1]?.t;
  const pos = sym ? c.broker?.position(sym) : undefined;
  useEffect(() => {
    if (!detail) return;
    if (ticket.sym !== detail.sym) {
      // Las acciones por defecto dependen del precio y del tamaño de la cuenta.
      setTicket({ sym: detail.sym, edited: false, levelsEdited: false, ...suggestTicket(detail, quote), shares: String(c.defaultShares(quote?.ask || detail.row.price)) });
      return;
    }
    if (!ticket.edited && !pos) setTicket(suggestTicket(detail, quote));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.sym, barKey, !!pos]);
  // Con posición abierta, stop y objetivo muestran los de la posición (órdenes o plan).
  const posStop = pos?.stop ?? pos?.planStop;
  const posTarget = pos?.target ?? pos?.planTarget;
  useEffect(() => {
    if (posStop !== undefined) setTicket({ stop: fmtPrice(posStop) });
    if (posTarget !== undefined) setTicket({ target: fmtPrice(posTarget) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, posStop, posTarget]);

  // Libro y cinta: se arman cuando llega una ficha nueva (una por segundo) o cambia la cuenta, no en cada dibujo.
  const { bids, asks, tape } = useMemo(() => {
    const book = sym && source ? source.book(sym) : null;
    const working = sym ? (c.broker?.orders(sym) ?? []) : [];
    const own = (side: 'buy' | 'sell') =>
      working.filter((o) => o.side === side && o.type === 'limit' && o.status !== 'sent').map((o) => ({ price: o.price!, shares: o.shares - o.filled, route: o.route }));
    const tape: TapePrint[] = sym && source ? source.printsSince(sym, 0).slice(-120).reverse() : [];
    return { bids: book ? book.view('bid', own('buy')) : NO_ROWS, asks: book ? book.view('ask', own('sell')) : NO_ROWS, tape };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, source, detail, version, c]);
  // El libro muestra tantos niveles como entren en la ventana (más en una pantalla grande).
  const bookRef = useRef<HTMLDivElement>(null);
  const [bookRows, setBookRows] = useState(14);
  useEffect(() => {
    const el = bookRef.current;
    if (!el || compact) return;
    const fit = () => {
      const row = el.querySelector('tbody tr')?.getBoundingClientRect().height || 21;
      const head = el.querySelector('thead')?.getBoundingClientRect().height || 24;
      setBookRows(Math.max(6, Math.min(60, Math.floor((el.clientHeight - head) / row))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [compact]);
  const rowsMax = compact ? 8 : bookRows;

  const settings = c.state.settings;
  const bp = c.broker ? c.broker.buyingPower(c.marks) : 0;
  const price = num(ticket.price);
  const shares = Math.floor(Number(ticket.shares) || 0);
  const auto = settings.autoBracket;
  const stopV = num(ticket.stop);
  const targetV = num(ticket.target);
  const entry = ticket.type === 'market' ? (quote?.ask ?? 0) : (price ?? 0);
  const risk = stopV && entry > stopV ? (entry - stopV) * shares : 0;
  const reward = targetV && entry ? (targetV - entry) * shares : 0;
  const cost = entry * shares;
  const maxShares = entry > 0 ? Math.max(0, Math.floor((bp * 0.995) / entry)) : 0;
  const short = shares > 0 && entry > 0 && cost > bp;
  const halted = !!quote?.halted;
  const un = sym ? c.unrealized(sym) : null;
  const buttons = settings.hotkeys.filter((h) => h.enabled && h.button);
  const r = detail?.row;

  const edit = (patch: Partial<TicketForm>) => setTicket({ ...patch, edited: true });
  const editLevels = (patch: Partial<TicketForm>) => setTicket({ ...patch, edited: true, levelsEdited: true });
  // Al mover el precio, el stop sugerido lo acompaña (debajo de la entrada y del bid) y el objetivo sigue a 2R.
  const editPrice = (value: string, patch: Partial<TicketForm> = {}) => {
    const p = num(value);
    // Con posición y stop/objetivo puestos, los campos muestran esos niveles reales: no se tocan.
    const posLevels = posStop !== undefined || posTarget !== undefined;
    if (ticket.levelsEdited || posLevels || !detail || !p) return edit({ ...patch, price: value });
    const bid = quote?.bid || detail.row.bid || detail.row.price;
    const flag = detail.setup.flag;
    const stop = flag && flag.stop < p && flag.stop < bid ? flag.stop : pullbackStop(detail, p, bid);
    edit({ ...patch, price: value, stop: fmtPrice(stop), target: fmtPrice(roundPx(p + 2 * Math.max(tickOf(p), p - stop))) });
  };
  const step = (field: 'price' | 'shares', dir: 1 | -1) => {
    if (field === 'shares') return setTicket({ shares: String(Math.max(1, shares + dir * 100)) });
    const base = price ?? quote?.ask ?? 0;
    editPrice(fmtPrice(Math.max(tickOf(base), roundPx(base + dir * tickOf(base)))));
  };
  const send = (side: 'buy' | 'sell') => {
    if (!sym) return;
    const isStop = ticket.type === 'stop';
    c.place({
      sym,
      side,
      type: ticket.type,
      shares,
      price: ticket.type === 'limit' ? price : undefined,
      stopPrice: isStop ? price : undefined,
      tif: ticket.tif,
      route: ticket.route,
      stop: side === 'buy' ? stopV : undefined,
      target: side === 'buy' ? targetV : undefined,
      setup: side === 'buy' ? ticket.setup : undefined,
    });
  };
  const sizeByRisk = () => {
    if (!(stopV && entry > stopV)) return c.notify('Para calcular el tamaño por riesgo poné un stop debajo de la entrada.', 'error');
    setTicket({ shares: String(Math.max(1, Math.floor(c.riskAmount() / (entry - stopV)))) });
  };

  const onSymInput = (v: string) => {
    const up = v.toUpperCase().replace(/[^A-Z.]/g, '');
    setSymText(up);
    clearTimeout(searchTimer.current);
    if (!up) return setHits([]);
    searchTimer.current = setTimeout(() => void search(up).then((r) => setHits(r)), 150);
  };

  return (
    <div className={`l2 ${compact ? 'is-compact' : ''}`}>
      <div className="l2-top">
        <form
          className="l2-symbox"
          onSubmit={(e) => {
            e.preventDefault();
            const target = hits[0] ?? symText;
            if (target) onSymbol(target);
            setHits([]);
          }}
        >
          <input id="l2-symbol" value={symText} onChange={(e) => onSymInput(e.target.value)} onBlur={() => setTimeout(() => setHits([]), 150)} aria-label="Símbolo" autoComplete="off" spellCheck={false} />
          {hits.length > 0 && (
            <ul className="l2-hits">
              {hits.map((h) => (
                <li key={h}>
                  <button type="button" onMouseDown={() => (onSymbol(h), setHits([]))}>
                    {h}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
        {r && (
          <span className={`l2-chg ${r.changePct >= 0 ? 'up' : 'down'}`}>
            {r.changePct >= 0 ? '↑' : '↓'} {Math.abs(r.changePct).toFixed(2)}%
          </span>
        )}
        {r && detail && (
          <span className="l2-facts">
            Exch <b>{(detail.ref.exchange ?? 'NSDQ').replace('NASDAQ', 'NSDQ').slice(0, 4)}</b>{' '}
            {detail.ref.industry && (
              <>
                Sector <b title={detail.ref.industry}>{detail.ref.industry.length > 22 ? `${detail.ref.industry.slice(0, 21)}…` : detail.ref.industry}</b>{' '}
              </>
            )}
            Float <b>{r.float !== undefined ? fmtVolume(r.float) : '—'}</b> Vol <b>{fmtVolume(r.volume)}</b> High <b>{fmtPrice(r.hod)}</b> Low <b>{fmtPrice(r.lod)}</b>
          </span>
        )}
      </div>

      <div className="l2-grid">
        <div className="l2-book" ref={bookRef}>
          {halted ? (
            <div className="l2-halt">
              <b>HALT</b> {detail?.halt?.reasonText ?? 'Pausa por volatilidad (LULD)'}
              {detail?.halt?.resumeTs ? <HaltResume at={detail.halt.resumeTs} /> : null}
            </div>
          ) : (
            <>
              <BookSide rows={bids} side="bid" max={rowsMax} onPick={(p) => editPrice(fmtPrice(p), { type: ticket.type === 'market' ? 'limit' : ticket.type })} />
              <BookSide rows={asks} side="ask" max={rowsMax} onPick={(p) => editPrice(fmtPrice(p), { type: ticket.type === 'market' ? 'limit' : ticket.type })} />
            </>
          )}
          {!c.depthIsReal && !halted && <p className="l2-note">Con datos reales este escáner no recibe el Level 2: el libro es una estimación para ejecutar las órdenes.</p>}
        </div>

        <div className="l2-tape" aria-label="Time & Sales">
          <table>
            <thead>
              <tr>
                <th className="num">Price</th>
                <th className="num">Size</th>
                <th className="num">Time</th>
              </tr>
            </thead>
            <tbody>
              {tape.slice(0, compact ? 30 : 80).map((p) => (
                <tr key={p.seq} className={SIDE_CLASS[p.side]}>
                  <td className="num">{fmtPrice(p.price)}</td>
                  <td className="num">{fmtInt(p.size)}</td>
                  <td className="num">{formatEtTime(p.ts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="l2-entry">
          {!c.active || !c.broker ? (
            <div className="oe-ended">
              <p>
                {c.lastEnded
                  ? 'Terminaste el día. Revisá el resultado en Métricas o empezá otro.'
                  : c.nyClosedUntil !== null
                    ? 'Nueva York está cerrado: el día arranca solo con el pre-market.'
                    : 'Preparando el día de práctica…'}
              </p>
              {(c.lastEnded || c.nyClosedUntil !== null) && (
                <button className="btn primary" onClick={() => (onNewDay ? onNewDay() : c.newDay())}>
                  Empezar otro día
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="oe-row">
                <select id="oe-type" value={ticket.type} onChange={(e) => setTicket({ type: e.target.value as OrderType })} aria-label="Tipo de orden">
                  <option value="limit">Limit</option>
                  <option value="market">Market</option>
                  <option value="stop">Stop</option>
                </select>
                <div className="spin">
                  <input id="oe-price" inputMode="decimal" value={ticket.type === 'market' ? 'MKT' : ticket.price} disabled={ticket.type === 'market'} onChange={(e) => editPrice(e.target.value)} aria-label={ticket.type === 'stop' ? 'Precio de disparo' : 'Precio límite'} />
                  <span className="spin-btns">
                    <button type="button" onClick={() => step('price', 1)} aria-label="Subir precio" disabled={ticket.type === 'market'}>
                      ▴
                    </button>
                    <button type="button" onClick={() => step('price', -1)} aria-label="Bajar precio" disabled={ticket.type === 'market'}>
                      ▾
                    </button>
                  </span>
                </div>
              </div>
              <div className="oe-row">
                <div className="spin">
                  <input id="oe-shares" inputMode="numeric" value={ticket.shares} onChange={(e) => setTicket({ shares: e.target.value.replace(/[^0-9]/g, '') })} aria-label="Acciones" />
                  <span className="spin-btns">
                    <button type="button" onClick={() => step('shares', 1)} aria-label="Más acciones">
                      ▴
                    </button>
                    <button type="button" onClick={() => step('shares', -1)} aria-label="Menos acciones">
                      ▾
                    </button>
                  </span>
                </div>
                <button type="button" className="oe-p" onClick={() => pos && setTicket({ shares: String(pos.shares) })} title="Acciones de tu posición" disabled={!pos}>
                  P
                </button>
                <select id="oe-route" value={ticket.route} onChange={(e) => setTicket({ route: e.target.value })} aria-label="Ruta">
                  {ROUTES.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <select id="oe-tif" value={ticket.tif} onChange={(e) => setTicket({ tif: e.target.value as Tif })} aria-label="Vigencia (TIF)" title="DAY+: también en pre-market y after-hours. DAY: solo en la rueda regular.">
                  <option value="DAY+">DAY+</option>
                  <option value="DAY">DAY</option>
                </select>
              </div>
              {/* Mismo criterio que la barra del celular: sin posición no se vende; sin poder de compra no se compra. */}
              <div className="oe-row oe-sides">
                <button type="button" className="btn-sell" onClick={() => send('sell')} disabled={!pos} title={pos ? undefined : 'No tenés posición en esta acción'}>
                  VENDER
                </button>
                <button type="button" className="btn-buy" onClick={() => send('buy')} disabled={shares <= 0 || short} title={short ? `Te alcanza para ${fmtInt(maxShares)} acciones` : undefined}>
                  COMPRAR
                </button>
              </div>
              {buttons.length > 0 && (
                <div className="oe-row oe-hot">
                  {buttons.map((h) => (
                    <button key={h.id} type="button" className={h.action.kind === 'buy' ? 'hot-buy' : h.action.kind === 'sell' ? 'hot-sell' : 'hot-other'} onClick={() => onHotkey(h)} title={`${h.label} (${hotkeyLabel(h)})`}>
                      {shortLabel(h, shares)}
                    </button>
                  ))}
                </div>
              )}

              <label className="check-inline oe-auto" title="Activado: al comprar se ponen el stop y el objetivo como órdenes OCO. Apagado: quedan como plan (tamaño por riesgo, R y líneas punteadas en el gráfico) y las salidas las hacés vos.">
                <input id="oe-bracket" type="checkbox" checked={auto} onChange={(e) => c.updateSettings({ autoBracket: e.target.checked })} />
                Stop y objetivo automáticos (OCO)
              </label>
              <div className="oe-row oe-bracket">
                <label className="mini-field" title={auto ? 'Se coloca como orden stop al comprar' : 'Tu stop mental: no se envía, lo ejecutás vos'}>
                  {auto ? 'Stop' : 'Stop plan'}
                  <input id="oe-stop" inputMode="decimal" value={ticket.stop} onChange={(e) => editLevels({ stop: e.target.value })} />
                </label>
                <label className="mini-field" title={auto ? 'Se coloca como venta límite al comprar' : 'Tu objetivo: no se envía, lo ejecutás vos'}>
                  {auto ? 'Objetivo' : 'Obj. plan'}
                  <input id="oe-target" inputMode="decimal" value={ticket.target} onChange={(e) => editLevels({ target: e.target.value })} />
                </label>
                <button
                  type="button"
                  className="chip"
                  onClick={() => detail && setTicket({ edited: false, levelsEdited: false, ...suggestTicket(detail, quote) })}
                  title="Stop un tick debajo del mínimo de la vela anterior (o del bull flag) y objetivo a 2R. Se renueva con cada vela hasta que lo cambiás."
                >
                  Sugerir
                </button>
                <select id="oe-setup" className="oe-setup" value={ticket.setup} onChange={(e) => setTicket({ setup: e.target.value })} aria-label="Setup">
                  {SETUPS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>

              <p className="oe-plan">
                {ticket.type === 'market' ? 'A mercado' : `${ticket.type === 'stop' ? 'Stop' : 'Límite'} ${price ? fmtPrice(price) : '—'}`} · costo <span className={short ? 't-down' : ''}>{fmtMoney(cost)}</span>
                {short && <span className="t-down"> · te alcanza para {fmtInt(maxShares)}</span>}
                {risk > 0 && (
                  <>
                    {' '}
                    · riesgo <span className="t-down">{fmtMoney(risk)}</span>
                    {reward > 0 && <span className="t-up"> · {(reward / risk).toFixed(1)}R</span>}
                  </>
                )}
                {stopV !== undefined && quote && stopV >= quote.bid && <span className="t-down"> · el stop quedó arriba del bid: tocá Sugerir</span>}
                {!auto && <span className="t-muted"> · salidas manuales</span>}
                {' · '}
                <button type="button" className="link" onClick={sizeByRisk} title={`Acciones para arriesgar ${fmtMoney(c.riskAmount())} hasta el stop${settings.sizing === 'cuenta' ? ` (${settings.riskPct} % de la cuenta)` : ''}`}>
                  tamaño por riesgo
                </button>
              </p>

              {pos && (
                <div className="oe-pos">
                  <span>
                    <b>{pos.shares}</b> a <b>{fmtPrice(pos.avgCost)}</b>
                    {un && (
                      <span className={un.pnl >= 0 ? 't-up' : 't-down'}>
                        {' '}
                        {un.pnl >= 0 ? '+' : ''}
                        {fmtMoney(un.pnl)}
                      </span>
                    )}
                    {pos.initialStop && un ? <span className="t-muted"> · {(un.pnl / ((pos.avgCost - pos.initialStop) * pos.shares || 1)).toFixed(1)}R</span> : null}
                    <span className="t-muted">
                      {' '}
                      · stop {pos.stop ? fmtPrice(pos.stop) : pos.planStop ? `${fmtPrice(pos.planStop)} (plan)` : '—'} · obj.{' '}
                      {pos.target ? fmtPrice(pos.target) : pos.planTarget ? `${fmtPrice(pos.planTarget)} (plan)` : '—'}
                    </span>
                  </span>
                  <span className="oe-pos-actions">
                    <button type="button" className="chip" onClick={() => c.setBracket(pos.sym, pos.avgCost, pos.target)} title="Mover el stop al precio de entrada">
                      Stop a BE
                    </button>
                    <button type="button" className="chip" onClick={() => c.setBracket(pos.sym, num(ticket.stop), num(ticket.target))} title="Poner el stop y el objetivo del ticket como órdenes OCO">
                      Poner stop/obj.
                    </button>
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Memorizada: la cuenta de práctica la actualiza por suscripción; el resto, por props. */
export const Level2 = memo(Level2View);
