// Posiciones abiertas y órdenes pendientes de la cuenta de práctica.
import { fmtMoney } from '../../trading/broker';
import { fmtPct, fmtPrice } from '../lib/format';
import type { TrainingController } from '../training';
import { Empty } from './Panel';

export function AccountLine({ c }: { c: TrainingController }) {
  const s = c.summary();
  return (
    <div className="account-line mono">
      <span>
        Equity <b>{fmtMoney(s.equity)}</b>
      </span>
      <span>
        Hoy <b className={s.dayPnl > 0 ? 't-up' : s.dayPnl < 0 ? 't-down' : ''}>{s.dayPnl >= 0 ? '+' : ''}{fmtMoney(s.dayPnl)}</b>
      </span>
      <span>
        Efectivo <b>{fmtMoney(s.cash)}</b>
      </span>
      <span>
        Trades <b>{s.trades}</b>
      </span>
    </div>
  );
}

export function PositionsList({ c, selected, onSelect }: { c: TrainingController; selected: string | null; onSelect: (s: string) => void }) {
  const a = c.active;
  if (!a) return <Empty>No hay un día de práctica activo.</Empty>;
  return (
    <div className="positions">
      <AccountLine c={c} />
      {a.positions.length === 0 ? (
        <Empty>Sin posiciones abiertas. Elegí una acción y comprá desde el ticket de la ficha.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="scan">
            <thead>
              <tr>
                <th>Símb.</th>
                <th className="num">Acc.</th>
                <th className="num">Costo</th>
                <th className="num">P/L</th>
                <th className="num">Stop</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {a.positions.map((p) => {
                const un = c.unrealized(p.sym);
                return (
                  <tr key={p.sym} className={p.sym === selected ? 'is-selected' : ''} onClick={() => onSelect(p.sym)}>
                    <td className="c-sym">
                      <b>{p.sym}</b>
                    </td>
                    <td className="num">{p.shares}</td>
                    <td className="num">{fmtPrice(p.avgCost)}</td>
                    <td className="num">
                      {un ? (
                        <span className={un.pnl >= 0 ? 't-up' : 't-down'} title={`${fmtPct(un.pct)} · último ${fmtPrice(un.last)}`}>
                          {un.pnl >= 0 ? '+' : ''}
                          {fmtMoney(un.pnl)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num">{p.stop ? fmtPrice(p.stop) : '—'}</td>
                    <td className="c-extra">
                      <button
                        className="btn-small sell"
                        onClick={(e) => {
                          e.stopPropagation();
                          c.sell(p.sym, 1);
                        }}
                      >
                        Vender
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function OrdersList({ c, onSelect }: { c: TrainingController; onSelect: (s: string) => void }) {
  const orders = c.active?.orders ?? [];
  if (!orders.length) return <Empty>Sin órdenes pendientes.</Empty>;
  return (
    <div className="table-wrap">
      <table className="scan">
        <thead>
          <tr>
            <th>Símb.</th>
            <th>Orden</th>
            <th className="num">Acc.</th>
            <th className="num">Precio</th>
            <th aria-label="Cancelar" />
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} onClick={() => onSelect(o.sym)}>
              <td className="c-sym">
                <b>{o.sym}</b>
              </td>
              <td>
                <span className={o.side === 'buy' ? 't-up' : 't-down'}>{o.side === 'buy' ? 'Compra' : 'Venta'}</span> {o.type === 'limit' ? 'límite' : 'stop'}
                {o.role === 'stop' ? ' · stop' : o.role === 'target' ? ' · objetivo' : ''}
              </td>
              <td className="num">{o.shares}</td>
              <td className="num">{fmtPrice(o.price ?? 0)}</td>
              <td className="c-extra">
                <button
                  className="btn-small"
                  onClick={(e) => {
                    e.stopPropagation();
                    c.cancel(o.id);
                  }}
                >
                  Cancelar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
