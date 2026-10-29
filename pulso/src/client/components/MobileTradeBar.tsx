// Barra de operación del celular: con el teléfono en vertical, el gráfico queda arriba y esta barra
// fija abajo (sobre las pestañas), así comprás y vendés sin perder de vista la acción del precio.
// Muestra el precio, el bid y el ask, tu posición con su resultado en vivo, la cantidad y los botones
// rápidos: compra en el Ask + 0,05 y venta en el Bid − 0,05, como los atajos del escritorio. Sin
// posición, VENDER abre un corto (con el locate del día); con un corto, COMPRAR pasa a CUBRIR.
import type { Quote, ScanRow } from '../../engine/types';
import { roundPx, tickOf } from '../../trading/depth';
import { describeLocate } from '../../trading/locate';
import type { Hotkey } from '../../trading/types';
import { withConfirm } from '../lib/confirm';
import { fmtInt, fmtMoney, fmtPct, fmtPrice } from '../lib/format';
import type { TrainingController } from '../training';
import { num, type TicketForm } from './Level2';

const OFFSET = 0.05;

/** Compra con la cantidad del ticket (y su stop y objetivo como plan, igual que el botón del ticket). */
const BUY: Hotkey = {
  id: 'mobile-buy',
  label: 'Comprar a Ask + 0,05',
  code: '',
  shift: false,
  ctrl: false,
  alt: false,
  enabled: true,
  button: false,
  action: { kind: 'buy', shares: 'ticket', ref: 'ask', offset: OFFSET },
};

/** De a 10 hasta 100 acciones y de a 100 después. */
function stepShares(n: number, dir: 1 | -1): number {
  if (dir > 0) return n < 100 ? Math.floor(n / 10) * 10 + 10 : n + 100;
  return n <= 100 ? Math.max(10, Math.ceil(n / 10) * 10 - 10) : n - 100;
}

interface Props {
  c: TrainingController;
  sym: string | null;
  quote: Quote | null;
  row?: ScanRow;
  ticket: TicketForm;
  setTicket: (patch: Partial<TicketForm>) => void;
  onHotkey: (h: Hotkey) => void;
}

export function MobileTradeBar({ c, sym, quote, row, ticket, setTicket, onHotkey }: Props) {
  if (!sym) {
    return (
      <div className="mtb" role="region" aria-label="Operar">
        <p className="mtb-empty">Elegí una acción en el Escáner o en Alertas para operarla acá.</p>
      </div>
    );
  }
  const ready = c.ready;
  const pos = c.broker?.position(sym);
  const un = c.unrealized(sym);
  const orders = c.broker?.orders(sym) ?? [];
  const shares = Math.max(0, Math.floor(Number(ticket.shares) || 0));
  const halted = !!quote?.halted;
  const buyPx = quote?.ask ? roundPx(quote.ask + OFFSET) : undefined;
  const sellPx = quote?.bid ? roundPx(Math.max(tickOf(quote.bid), quote.bid - OFFSET)) : undefined;
  const sellQty = pos ? Math.min(pos.shares, shares || pos.shares) : 0;
  const cost = buyPx ? buyPx * shares : 0;
  const bp = c.broker ? c.broker.buyingPower(c.marks) : 0;
  const tooBig = cost > bp && shares > 0;
  const setQty = (n: number) => setTicket({ shares: String(Math.max(1, Math.floor(n))) });
  const change = row?.changePct;
  const maxQty = buyPx ? Math.floor((bp * 0.995) / buyPx) : 0;
  // Sin posición, VENDER abre un corto; con un corto, COMPRAR cubre y VENDER lo agranda.
  const short = pos?.side === 'short';
  const opensShort = !pos || short;
  const locate = opensShort ? c.locate(sym) : null;
  const shortBlock = opensShort && ready ? c.shortBlock(sym) : null;
  const shortNeed = sellPx ? sellPx * shares * 1.5 + (locate?.borrowFee ?? 0) * shares : 0;
  const shortTooBig = opensShort && shares > 0 && shortNeed > bp;
  const openShort = () =>
    withConfirm({ sym, side: 'sell', kind: 'short', shares, type: 'limit', price: sellPx, approx: true, borrowFee: locate?.borrowFee }, () =>
      c.short(sym, shares, { stop: num(ticket.stop), target: num(ticket.target), setup: ticket.setup, route: ticket.route, tif: ticket.tif }),
    );
  const coverQty = pos ? Math.min(pos.shares, shares || pos.shares) : 0;
  const cover = () => withConfirm({ sym, side: 'buy', kind: 'cover', shares: coverQty, type: 'limit', price: buyPx, approx: true }, () => c.sell(sym, 1, 'bid', -OFFSET, coverQty));

  return (
    <div className="mtb" role="region" aria-label={`Operar ${sym}`}>
      <div className="mtb-info">
        <b className="mtb-sym">{sym}</b>
        {quote && <span className={`mtb-last mono ${change !== undefined ? (change >= 0 ? 't-up' : 't-down') : ''}`}>{fmtPrice(quote.last)}</span>}
        {change !== undefined && <span className={`mtb-chg mono ${change >= 0 ? 't-up' : 't-down'}`}>{fmtPct(change)}</span>}
        {halted ? (
          <span className="mtb-halt">HALT</span>
        ) : (
          quote && (
            <span className="mtb-quote mono">
              <span className="t-up" title="Mejor compra (bid)">
                C {fmtPrice(quote.bid)}
              </span>{' '}
              ·{' '}
              <span className="t-down" title="Mejor venta (ask)">
                V {fmtPrice(quote.ask)}
              </span>
            </span>
          )
        )}
      </div>

      <div className="mtb-pos">
        {pos ? (
          <>
            {short && <span className="tag tag-short">CORTO</span>}
            <span className="mono">
              {pos.shares} @ {fmtPrice(pos.avgCost)}
            </span>
            {un && (
              <b className={`mono ${un.pnl >= 0 ? 't-up' : 't-down'}`}>
                {un.pnl >= 0 ? '+' : ''}
                {fmtMoney(un.pnl)} ({fmtPct(un.pct)})
              </b>
            )}
            <span className="mtb-chips">
              <button type="button" className="chip" onClick={() => setQty(Math.max(1, Math.floor(pos.shares / 2)))}>
                ½
              </button>
              <button type="button" className="chip" onClick={() => setQty(pos.shares)}>
                Todo
              </button>
            </span>
          </>
        ) : (
          <>
            <span className="t-muted">Sin posición</span>
            <span className="mtb-chips">
              {maxQty > 0 && (
                <button type="button" className="chip" onClick={() => setQty(maxQty)} title="Lo máximo que te alcanza con el poder de compra">
                  Máx {fmtInt(maxQty)}
                </button>
              )}
            </span>
          </>
        )}
        {orders.length > 0 && (
          <button type="button" className="chip mtb-cancel" onClick={() => c.cancelAll(sym)}>
            Cancelar {orders.length === 1 ? 'la orden' : `${orders.length} órdenes`}
          </button>
        )}
      </div>

      <div className="mtb-row">
        <div className="mtb-qty" role="group" aria-label="Cantidad de acciones">
          <button type="button" onClick={() => setQty(stepShares(shares, -1))} aria-label="Menos acciones">
            −
          </button>
          <input id="mtb-shares" inputMode="numeric" value={ticket.shares} onChange={(e) => setTicket({ shares: e.target.value.replace(/[^0-9]/g, '') })} aria-label="Acciones" />
          <button type="button" onClick={() => setQty(stepShares(shares, 1))} aria-label="Más acciones">
            +
          </button>
        </div>
        {/* Mismo criterio que el ticket del escritorio: sin poder de compra no se entra; sin posición, VENDER abre un corto si hay locate. */}
        {short ? (
          <button id="mtb-buy" type="button" className="mtb-buy" disabled={!ready || halted || !buyPx || !coverQty} onClick={cover} title="Comprar para devolver las acciones prestadas">
            CUBRIR {fmtInt(coverQty)}
            <small>{buyPx ? `a ${fmtPrice(buyPx)}` : '—'}</small>
          </button>
        ) : (
          <button id="mtb-buy" type="button" className="mtb-buy" disabled={!ready || halted || !shares || !buyPx || tooBig} onClick={() => onHotkey(BUY)} title={tooBig ? `Te alcanza para ${fmtInt(maxQty)} acciones` : undefined}>
            COMPRAR {fmtInt(shares)}
            <small className={tooBig ? 'mtb-short' : undefined}>{buyPx ? `a ${fmtPrice(buyPx)} · ${fmtMoney(cost)}` : '—'}</small>
          </button>
        )}
        {opensShort ? (
          <button
            id="mtb-sell"
            type="button"
            className="mtb-sell is-short"
            disabled={!ready || halted || !shares || !sellPx || !!shortBlock || shortTooBig}
            onClick={openShort}
            title={shortBlock ?? (shortTooBig ? `El corto bloquea el 150 % de la venta: ${fmtMoney(shortNeed)}` : 'Vender acciones prestadas: ganás si baja')}
          >
            {short ? 'AGREGAR' : 'CORTO'} {fmtInt(shares)}
            <small className={shortTooBig ? 'mtb-short' : undefined}>{sellPx ? `a ${fmtPrice(sellPx)} · ${locate ? describeLocate(locate) : '—'}` : '—'}</small>
          </button>
        ) : (
          <button
            id="mtb-sell"
            type="button"
            className="mtb-sell"
            disabled={!ready || halted || !pos || !sellPx}
            onClick={() => withConfirm({ sym, side: 'sell', shares: sellQty, type: 'limit', price: sellPx, approx: true }, () => c.sell(sym, 1, 'bid', -OFFSET, sellQty))}
          >
            VENDER {pos ? fmtInt(sellQty) : ''}
            <small>{pos && sellPx ? `a ${fmtPrice(sellPx)}` : 'sin posición'}</small>
          </button>
        )}
      </div>
    </div>
  );
}
