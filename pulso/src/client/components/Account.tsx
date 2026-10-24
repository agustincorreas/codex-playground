// Ventanas de la cuenta de práctica, como en el simulador de Warrior Trading: posiciones (con el poder
// de compra disponible y usado), actividad de órdenes y valor de la cuenta.
import { useState } from 'react';
import { formatEtTime } from '../../engine/time';
import { fmtMoney, fmtPx, STATUS_LABEL } from '../../trading/broker';
import type { Order } from '../../trading/types';
import type { TrainingController } from '../training';
import { Empty } from './Panel';

const signed = (v: number) => `${v > 0 ? '+' : ''}${fmtMoney(v)}`;
const tone = (v: number) => (v > 0 ? 't-up' : v < 0 ? 't-down' : '');

/** Encabezado con una versión corta para ventanas angostas. */
function Lbl({ long, short }: { long: string; short: string }) {
  return (
    <>
      <span className="lbl-long">{long}</span>
      <span className="lbl-short" aria-hidden="true">
        {short}
      </span>
    </>
  );
}

export function PositionsWindow({ c, selected, onSelect }: { c: TrainingController; selected: string | null; onSelect: (s: string) => void }) {
  const a = c.active;
  const s = c.summary();
  const rows = (a?.positions ?? []).map((p) => {
    const last = c.marks(p.sym) ?? p.avgCost;
    const unreal = Math.round((last - p.avgCost) * p.shares * 100) / 100;
    return { p, last, unreal, total: Math.round((unreal + p.realized) * 100) / 100 };
  });
  const tot = rows.reduce((x, r) => ({ unreal: x.unreal + r.unreal, real: x.real + r.p.realized, total: x.total + r.total }), { unreal: 0, real: 0, total: 0 });
  return (
    <div className="acct">
      <div className="bp-line">
        PC disponible: <b className="t-bp">{fmtMoney(s.buyingPower)}</b>
        <span className="sep">|</span>
        PC usado: <b className="t-bpused">{fmtMoney(s.bpUsed)}</b>
        {s.unsettled > 0 && (
          <span className="t-muted" title="Cuenta cash: el dinero de las ventas de hoy se libera mañana (liquidación T+1)">
            {' '}
            · sin liquidar {fmtMoney(s.unsettled)}
          </span>
        )}
      </div>
      {!a ? (
        <Empty>No hay un día de práctica activo.</Empty>
      ) : !rows.length ? (
        <Empty>Sin posiciones abiertas.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Sím.</th>
                <th className="num">
                  <Lbl long="Posición" short="Pos." />
                </th>
                <th className="num">
                  <Lbl long="Precio prom." short="Prom." />
                </th>
                <th className="num">
                  <Lbl long="$ No realiz." short="No real." />
                </th>
                <th className="num hide-md">$ Realiz.</th>
                <th className="num">$ P/G</th>
                <th aria-label="Cerrar" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, unreal, total }) => (
                <tr key={p.sym} className={p.sym === selected ? 'is-selected' : ''} onClick={() => onSelect(p.sym)}>
                  <td>
                    <button className="link sym-link">{p.sym}</button>
                  </td>
                  <td className="num">{p.shares.toLocaleString('en-US')}</td>
                  <td className="num">{fmtPx(p.avgCost)}</td>
                  <td className={`num ${tone(unreal)}`}>{signed(unreal)}</td>
                  <td className={`num hide-md ${tone(p.realized)}`}>{signed(p.realized)}</td>
                  <td className={`num ${tone(total)}`}>{signed(total)}</td>
                  <td className="c-extra">
                    <button
                      className="btn-small sell"
                      onClick={(e) => {
                        e.stopPropagation();
                        c.sell(p.sym, 1);
                      }}
                      title="Vender toda la posición a Bid − 0,05"
                    >
                      Cerrar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td />
                <td />
                <td className={`num ${tone(tot.unreal)}`}>{signed(Math.round(tot.unreal * 100) / 100)}</td>
                <td className={`num hide-md ${tone(tot.real)}`}>{signed(Math.round(tot.real * 100) / 100)}</td>
                <td className={`num ${tone(tot.total)}`}>{signed(Math.round(tot.total * 100) / 100)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

type Filter = 'all' | 'open' | 'filled' | 'canceled';

const isOpen = (o: Order) => o.status === 'sent' || o.status === 'open' || o.status === 'partial';

export function TradeActivity({ c, onSelect }: { c: TrainingController; onSelect: (s: string) => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const log = c.orderLog();
  const list = log.filter((o) => filter === 'all' || (filter === 'open' ? isOpen(o) : filter === 'filled' ? o.filled > 0 : o.status === 'canceled' || o.status === 'rejected'));
  const counts = { open: log.filter(isOpen).length };
  return (
    <div className="acct">
      <div className="chips activity-filter" role="group" aria-label="Filtrar órdenes">
        {(
          [
            ['all', 'Todas'],
            ['open', `Abiertas${counts.open ? ` (${counts.open})` : ''}`],
            ['filled', 'Ejecutadas'],
            ['canceled', 'Canceladas'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={`chip ${filter === k ? 'is-active' : ''}`} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
        {counts.open > 0 && (
          <button className="chip danger" onClick={() => c.cancelAll()} title="Cancelar todas las órdenes abiertas">
            Cancelar todas
          </button>
        )}
      </div>
      {!list.length ? (
        <Empty>{filter === 'all' ? 'Todavía no mandaste órdenes hoy.' : 'Nada con este filtro.'}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="grid-table">
            <thead>
              <tr>
                <th aria-label="Cancelar" />
                <th className="hide-sm">Hora</th>
                <th>Estado</th>
                <th>Sím.</th>
                <th>Lado</th>
                <th className="num">Cant.</th>
                <th className="num">Precio</th>
                <th className="num hide-md">Ejec.</th>
                <th className="num">Prom.</th>
                <th className="hide-md">TIF</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 200).map((o) => (
                <tr key={o.id} title={o.note}>
                  <td className="c-extra">
                    {isOpen(o) ? (
                      <button className="icon-btn tiny" onClick={() => c.cancel(o.id)} aria-label="Cancelar orden" title="Cancelar">
                        ×
                      </button>
                    ) : (
                      <span className={`st-dot st-${o.status}`} aria-hidden="true" />
                    )}
                  </td>
                  <td className="num t-muted hide-sm">{formatEtTime(o.createdAt)}</td>
                  <td>
                    <span className={`st st-${o.status}`}>{STATUS_LABEL[o.status].toUpperCase()}</span>
                  </td>
                  <td>
                    <button className="link sym-link" onClick={() => onSelect(o.sym)}>
                      {o.sym}
                    </button>
                  </td>
                  <td>
                    <span className={`side-badge ${o.side}`}>{o.side === 'buy' ? 'COMPRA' : 'VENTA'}</span>
                    {o.role === 'stop' ? <span className="t-muted"> stop</span> : o.role === 'target' ? <span className="t-muted"> obj.</span> : null}
                  </td>
                  <td className="num">{o.shares.toLocaleString('en-US')}</td>
                  <td className="num">{o.type === 'market' ? 'MKT' : fmtPx(o.price ?? o.stopPrice ?? 0)}</td>
                  <td className="num hide-md">{o.filled ? o.filled.toLocaleString('en-US') : '—'}</td>
                  <td className="num">{o.filled ? fmtPx(o.avgPrice) : '—'}</td>
                  <td className="t-muted hide-md">{o.tif}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AccountValue({ c, onSettings }: { c: TrainingController; onSettings: () => void }) {
  const s = c.summary();
  const settings = c.state.settings;
  const total = Math.round(s.equity * s.leverage * 100) / 100;
  return (
    <div className="acct-value">
      <dl className="av-list">
        <div>
          <dt>Efectivo disponible</dt>
          <dd className="t-up">{fmtMoney(s.cash - s.unsettled)}</dd>
        </div>
        {s.unsettled > 0 && (
          <div title="Cuenta cash: lo vendido hoy se liquida al día siguiente (T+1)">
            <dt>Sin liquidar (T+1)</dt>
            <dd className="t-warn">{fmtMoney(s.unsettled)}</dd>
          </div>
        )}
        <div>
          <dt>Valor de posiciones</dt>
          <dd>{fmtMoney(s.positionValue)}</dd>
        </div>
        <div>
          <dt>Margen usado</dt>
          <dd className="t-warn">{fmtMoney(s.marginBorrowed)}</dd>
        </div>
      </dl>
      <div className="av-equity">
        <span>Equity</span>
        <b>{fmtMoney(s.equity)}</b>
      </div>
      <dl className="av-list">
        <div>
          <dt>Poder de compra total{s.leverage > 1 ? ` (${s.leverage}x)` : ''}</dt>
          <dd>{fmtMoney(s.account === 'cash' ? s.cash - s.unsettled : total)}</dd>
        </div>
        <div>
          <dt>Usado por posiciones y órdenes</dt>
          <dd className="t-warn">{fmtMoney(s.bpUsed)}</dd>
        </div>
        <div className="av-bp">
          <dt>Poder de compra disponible</dt>
          <dd className="t-bp">{fmtMoney(s.buyingPower)}</dd>
        </div>
      </dl>
      <p className="av-foot">
        <span>
          {settings.account === 'cash' ? 'Cuenta cash' : `Cuenta margen ${s.leverage}x`} ·{' '}
          <span className={tone(s.dayPnl)}>hoy {signed(s.dayPnl)}</span>
          {settings.account === 'margin' && s.pdt && <span className={s.dayTrades >= 3 ? 't-down' : 't-muted'}> · day trades (5 días): {s.dayTrades}/3</span>}
        </span>
        <button className="link" onClick={onSettings}>
          Ajustes de la cuenta
        </button>
      </p>
    </div>
  );
}
