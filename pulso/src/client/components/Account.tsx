// Ventanas de la cuenta de práctica, como en el simulador de Warrior Trading: posiciones (con el poder
// de compra disponible y usado), actividad de órdenes y valor de la cuenta.
import { useState } from 'react';
import { formatEtTime } from '../../engine/time';
import { fmtMoney, fmtPx, STATUS_LABEL } from '../../trading/broker';
import type { Order, Trade } from '../../trading/types';
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

const money = (v: number) => Math.round(v * 100) / 100;

interface PosRow {
  sym: string;
  shares: number;
  avgCost?: number;
  unreal: number;
  realized: number;
  total: number;
  open: boolean;
}

/**
 * Posiciones del día, como en el simulador de Warrior: las abiertas y también las que ya cerraste,
 * con lo que ganaste o perdiste en cada acción y el total.
 */
export function PositionsWindow({ c, selected, onSelect }: { c: TrainingController; selected: string | null; onSelect: (s: string) => void }) {
  const a = c.active;
  const s = c.summary();
  // Resultado de los trades ya cerrados hoy, por acción (el más reciente primero).
  const closed = new Map<string, number>();
  for (const t of [...(a?.trades ?? [])].reverse()) closed.set(t.sym, money((closed.get(t.sym) ?? 0) + t.net));
  const open: PosRow[] = (a?.positions ?? []).map((p) => {
    const last = c.marks(p.sym) ?? p.avgCost;
    const unreal = money((last - p.avgCost) * p.shares);
    const realized = money(p.realized + (closed.get(p.sym) ?? 0));
    return { sym: p.sym, shares: p.shares, avgCost: p.avgCost, unreal, realized, total: money(unreal + realized), open: true };
  });
  const flat: PosRow[] = [...closed]
    .filter(([sym]) => !open.some((r) => r.sym === sym))
    .map(([sym, net]) => ({ sym, shares: 0, unreal: 0, realized: net, total: net, open: false }));
  const rows = [...open, ...flat];
  const tot = rows.reduce((x, r) => ({ unreal: x.unreal + r.unreal, real: x.real + r.realized, total: x.total + r.total }), { unreal: 0, real: 0, total: 0 });
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
        <Empty>Sin posiciones ni trades hoy.</Empty>
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
              {rows.map((r) => (
                <tr key={r.sym} className={`${r.sym === selected ? 'is-selected' : ''} ${r.open ? '' : 'is-flat'}`} onClick={() => onSelect(r.sym)}>
                  <td>
                    <button className="link sym-link">{r.sym}</button>
                  </td>
                  <td className="num">{r.shares.toLocaleString('en-US')}</td>
                  <td className="num">{r.avgCost !== undefined ? fmtPx(r.avgCost) : '—'}</td>
                  <td className={`num ${tone(r.unreal)}`}>{r.open ? signed(r.unreal) : '—'}</td>
                  <td className={`num hide-md ${tone(r.realized)}`}>{signed(r.realized)}</td>
                  <td className={`num ${tone(r.total)}`}>
                    <b>{signed(r.total)}</b>
                  </td>
                  <td className="c-extra">
                    {r.open && (
                      <button
                        className="btn-small sell"
                        onClick={(e) => {
                          e.stopPropagation();
                          c.sell(r.sym, 1);
                        }}
                        title="Vender toda la posición a Bid − 0,05"
                      >
                        Cerrar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td />
                <td />
                <td className={`num ${tone(tot.unreal)}`}>{signed(money(tot.unreal))}</td>
                <td className={`num hide-md ${tone(tot.real)}`}>{signed(money(tot.real))}</td>
                <td className={`num ${tone(tot.total)}`}>
                  <b>{signed(money(tot.total))}</b>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/** Los trades cerrados hoy, uno por uno, con lo que ganaste o perdiste en cada uno y el total del día. */
export function TodayTrades({ c, onSelect }: { c: TrainingController; onSelect: (s: string) => void }) {
  const trades = [...(c.active?.trades ?? [])].reverse();
  const total = money(trades.reduce((x, t) => x + t.net, 0));
  const wins = trades.filter((t) => t.net > 0).length;
  const losses = trades.filter((t) => t.net < 0).length;
  const openPnl = money((c.active?.positions ?? []).reduce((x, p) => x + ((c.marks(p.sym) ?? p.avgCost) - p.avgCost) * p.shares, 0));
  return (
    <div className="acct">
      <div className="day-total">
        <span className="day-total-label">Resultado del día</span>
        <b className={`day-total-value ${tone(total)}`}>{signed(total)}</b>
        <span className="t-muted small">
          {trades.length} {trades.length === 1 ? 'trade' : 'trades'}
          {trades.length > 0 && (
            <>
              {' '}
              · <span className="t-up">
                {wins} {wins === 1 ? 'ganador' : 'ganadores'}
              </span>{' '}
              · <span className="t-down">
                {losses} {losses === 1 ? 'perdedor' : 'perdedores'}
              </span>{' '}
              · {Math.round((wins / trades.length) * 100)}% aciertos
            </>
          )}
          {openPnl !== 0 && (
            <>
              {' '}
              · abierto <span className={tone(openPnl)}>{signed(openPnl)}</span>
            </>
          )}
        </span>
      </div>
      {!trades.length ? (
        <Empty>Todavía no cerraste trades hoy. Cada vez que cierres una posición aparece acá con su resultado.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="grid-table today-trades">
            <thead>
              <tr>
                <th className="hide-sm">Hora</th>
                <th>Sím.</th>
                <th className="num">
                  <Lbl long="Acciones" short="Acc." />
                </th>
                <th className="num">Entrada</th>
                <th className="num">Salida</th>
                <th className="num">$ P/G</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id} onClick={() => onSelect(t.sym)} title={`${t.returnPct >= 0 ? '+' : ''}${t.returnPct.toFixed(1)}%${t.r !== undefined ? ` · ${t.r}R` : ''} · salió por ${EXIT_LABEL[t.exitReason]}`}>
                  <td className="num t-muted hide-sm">{formatEtTime(t.closedAt)}</td>
                  <td>
                    <button className="link sym-link">{t.sym}</button>
                  </td>
                  <td className="num">{t.shares.toLocaleString('en-US')}</td>
                  <td className="num">{fmtPx(t.avgEntry)}</td>
                  <td className="num">{fmtPx(t.avgExit)}</td>
                  <td className={`num ${tone(t.net)}`}>
                    <b>{signed(t.net)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="hide-sm" />
                <td colSpan={4}>Total del día</td>
                <td className={`num ${tone(total)}`}>
                  <b>{signed(total)}</b>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

const EXIT_LABEL: Record<Trade['exitReason'], string> = { manual: 'venta manual', stop: 'stop', target: 'objetivo', eod: 'cierre del día' };

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
