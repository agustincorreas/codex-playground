// Diálogo del modo "pedir confirmación": muestra la orden que está por salir (símbolo, lado, cantidad,
// tipo y precio). Enter la envía, Esc la cancela; el foco queda adentro mientras está abierto. En la
// primera venta en corto de la sesión suma el aviso de riesgo y el locate.
import { useRef } from 'react';
import { fmtFee } from '../../trading/locate';
import { useFocusTrap } from '../lib/a11y';
import { resolveConfirm, usePendingOrder } from '../lib/confirm';
import { fmtInt, fmtMoney, fmtPrice } from '../lib/format';

const TYPE_LABEL = { limit: 'Límite', market: 'A mercado', stop: 'Stop' } as const;

export function OrderConfirm() {
  const order = usePendingOrder();
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = () => resolveConfirm(false);
  useFocusTrap(dialog, cancel, !!order);
  if (!order) return null;
  const buy = order.side === 'buy';
  const short = order.kind === 'short';
  const cover = order.kind === 'cover';
  const price = order.price !== undefined && order.price > 0 ? `${order.approx ? '≈ ' : ''}${fmtPrice(order.price)}` : '—';
  const total = order.price !== undefined && order.price > 0 ? order.price * order.shares : undefined;
  const title = short ? 'Confirmar venta en corto' : cover ? 'Confirmar cobertura' : buy ? 'Confirmar compra' : 'Confirmar venta';
  const sideLabel = short ? 'Venta en corto' : cover ? 'Cobertura (compra)' : buy ? 'Compra' : 'Venta';
  const locate = short ? (order.borrowFee ? `HTB · US$ ${fmtFee(order.borrowFee)}/acción (${fmtMoney(order.borrowFee * order.shares)})` : 'ETB · sin costo') : null;
  return (
    <div className="modal-back" onClick={cancel}>
      <div
        className={`modal confirm-modal ${buy ? 'is-buy' : 'is-sell'} ${short ? 'is-short' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        ref={dialog}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Enter envía desde cualquier parte del diálogo; sobre un botón, lo que haga el botón.
          if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
            e.preventDefault();
            resolveConfirm(true);
          }
        }}
      >
        <header className="modal-head">
          <h2 id="confirm-title">{title}</h2>
        </header>
        {order.shortWarning && (
          <p className="confirm-warning" role="note">
            <b>Primer corto del día.</b> Vendés acciones que pedís prestadas para recomprarlas más baratas. Si la acción sube, la pérdida no
            tiene techo (una small cap puede duplicarse en minutos) y el bróker puede obligarte a cubrir. Operá con stop y tamaño chico.
          </p>
        )}
        <dl className="confirm-body" id="confirm-body">
          <div>
            <dt>Símbolo</dt>
            <dd className="mono">{order.sym}</dd>
          </div>
          <div>
            <dt>Lado</dt>
            <dd className={short ? 't-short' : buy ? 't-up' : 't-down'}>{sideLabel}</dd>
          </div>
          <div>
            <dt>Cantidad</dt>
            <dd className="mono">{fmtInt(order.shares)} acciones</dd>
          </div>
          <div>
            <dt>Tipo</dt>
            <dd>{TYPE_LABEL[order.type]}</dd>
          </div>
          <div>
            <dt>Precio</dt>
            <dd className="mono">
              {price}
              {total !== undefined && <span className="t-muted"> · {fmtMoney(total)}</span>}
            </dd>
          </div>
          {locate && (
            <div>
              <dt>Locate</dt>
              <dd>{locate}</dd>
            </div>
          )}
        </dl>
        <footer className="modal-foot">
          <span className="t-muted small">Enter envía · Esc cancela</span>
          <button type="button" className="btn" onClick={cancel}>
            Cancelar
          </button>
          <button type="button" className={`btn primary ${short ? 'btn-short' : buy ? 'btn-buy' : 'btn-sell'}`} onClick={() => resolveConfirm(true)} data-autofocus>
            {short ? 'Vender en corto' : cover ? 'Cubrir' : buy ? 'Comprar' : 'Vender'}
          </button>
        </footer>
      </div>
    </div>
  );
}
