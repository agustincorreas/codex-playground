// "Mis trades": el trade que tenés abierto, en vivo (resultado, R, tiempo y dónde está el precio entre
// tu stop y tu objetivo), y los trades que ya cerraste hoy con su resultado.
import { formatEtTime } from '../../engine/time';
import { fmtDuration, fmtInt, fmtMoney, fmtPrice } from '../lib/format';
import { useNow } from '../lib/now';
import type { Position, Trade } from '../../trading/types';
import { sellAll } from '../lib/orders';
import type { TrainingController } from '../training';

const money = (v: number) => Math.round(v * 100) / 100;
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtMoney(Math.abs(v))}`;
const tone = (v: number) => (v > 0 ? 't-up' : v < 0 ? 't-down' : 't-muted');
/** Con signo y un decimal: +1.4 / −0.9. */
const num1 = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;

/**
 * Barra entre el stop y el objetivo: dónde está el precio y dónde entraste. En un largo el stop queda a
 * la izquierda (abajo) y el objetivo a la derecha; en un corto, al revés: el objetivo está abajo.
 */
function RangeBar({ stop, target, entry, last, short }: { stop: number; target: number; entry: number; last: number; short?: boolean }) {
  const lo = Math.min(stop, target);
  const hi = Math.max(stop, target);
  const span = hi - lo;
  const at = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / span) * 100))}%`;
  const winning = short ? last <= entry : last >= entry;
  return (
    <div className="mt-bar" title={`Stop ${fmtPrice(stop)} · entrada ${fmtPrice(entry)} · último ${fmtPrice(last)} · objetivo ${fmtPrice(target)}`}>
      <span className={`mt-bar-end ${short ? 't-up' : 't-down'}`}>{fmtPrice(lo)}</span>
      <span className="mt-bar-track">
        <span className="mt-bar-fill" style={{ left: last >= entry ? at(entry) : at(last), right: `calc(100% - ${last >= entry ? at(last) : at(entry)})` }} data-up={winning} />
        <span className="mt-bar-entry" style={{ left: at(entry) }} />
        <span className="mt-bar-last" style={{ left: at(last) }} />
      </span>
      <span className={`mt-bar-end ${short ? 't-down' : 't-up'}`}>{fmtPrice(hi)}</span>
    </div>
  );
}

/** Tiempo que lleva abierto el trade: avanza una vez por segundo. */
function OpenFor({ since }: { since: number }) {
  const now = useNow(1000);
  return <span className="t-muted">{fmtDuration((now || Date.now()) - since)}</span>;
}

function OpenTrade({ c, p, onSelect }: { c: TrainingController; p: Position; onSelect: (s: string) => void }) {
  const last = c.marks(p.sym) ?? p.avgCost;
  const short = p.side === 'short';
  // En un corto se gana cuando el precio baja desde la venta promedio.
  const move = short ? p.avgCost - last : last - p.avgCost;
  const unreal = money(move * p.shares + p.realized);
  const pct = (move / p.avgCost) * 100;
  const riskPerShare = p.initialStop === undefined ? 0 : short ? p.initialStop - p.avgCost : p.avgCost - p.initialStop;
  const risk = riskPerShare > 0 ? riskPerShare * p.shares : 0;
  const stop = p.stop ?? p.planStop;
  const target = p.target ?? p.planTarget;
  return (
    <div className="mt-open">
      <div className="mt-open-row">
        <button className="link sym-link mt-sym" onClick={() => onSelect(p.sym)}>
          {p.sym}
        </button>
        {short && (
          <span className="tag tag-short" title="Vendida en corto: ganás si baja">
            CORTO
          </span>
        )}
        <span className="mt-qty">
          {fmtInt(p.shares)} a {fmtPrice(p.avgCost)}
        </span>
        <b className={`mt-pnl ${tone(unreal)}`}>{signed(unreal)}</b>
        <span className={tone(pct)}>{num1(pct)}%</span>
        {risk > 0 && <span className={tone(unreal)}>{num1(unreal / risk)}R</span>}
        <OpenFor since={p.openedAt} />
        <button className="btn-small sell mt-close" onClick={() => sellAll(c, p.sym)} title={short ? 'Cubrir todo el corto a Ask + 0,05' : 'Vender toda la posición a Bid − 0,05'}>
          {short ? 'Cubrir' : 'Cerrar'}
        </button>
      </div>
      {stop !== undefined && target !== undefined && (short ? stop > target : target > stop) ? (
        <RangeBar stop={stop} target={target} entry={p.avgCost} last={last} short={short} />
      ) : (
        <p className="t-muted small mt-nolevels">Sin stop ni objetivo: poné tu plan en el ticket para ver la barra.</p>
      )}
    </div>
  );
}

function ClosedChip({ t, onSelect }: { t: Trade; onSelect: (s: string) => void }) {
  const short = t.side === 'short';
  return (
    <button
      className={`mt-chip ${t.net > 0 ? 'is-win' : t.net < 0 ? 'is-loss' : ''}`}
      onClick={() => onSelect(t.sym)}
      title={`${short ? 'Corto · ' : ''}${t.shares} acciones · entrada ${fmtPrice(t.avgEntry)} · salida ${fmtPrice(t.avgExit)}${t.r !== undefined ? ` · ${t.r}R` : ''}`}
    >
      <span className="t-muted">{formatEtTime(t.closedAt, false)}</span> <b>{t.sym}</b>
      {short && <span className="t-short"> C</span>} <span className={tone(t.net)}>{signed(t.net)}</span>
    </button>
  );
}

export function MyTrades({ c, onSelect }: { c: TrainingController; onSelect: (s: string) => void }) {
  const a = c.active;
  const open = a?.positions ?? [];
  const closed = [...(a?.trades ?? [])].reverse();
  return (
    <div className="mt">
      {open.length ? (
        open.map((p) => <OpenTrade key={p.sym} c={c} p={p} onSelect={onSelect} />)
      ) : (
        <p className="mt-empty t-muted">Sin trade abierto. Cuando compres (o vendas en corto), acá ves cómo viene en vivo.</p>
      )}
      {closed.length > 0 && (
        <div className="mt-closed" aria-label="Trades cerrados hoy">
          {closed.map((t) => (
            <ClosedChip key={t.id} t={t} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Resultado del día para la barra de título de "Mis trades". */
export function DayResult({ c }: { c: TrainingController }) {
  const trades = c.active?.trades ?? [];
  const total = money(trades.reduce((x, t) => x + t.net, 0));
  const wins = trades.filter((t) => t.net > 0).length;
  return (
    <span className="mt-day" title="Resultado de los trades que ya cerraste hoy (lo abierto se ve en cada trade)">
      Realizado hoy <b className={tone(total)}>{signed(total)}</b>
      {trades.length > 0 && (
        <span className="t-muted">
          {' '}
          · {trades.length} {trades.length === 1 ? 'trade' : 'trades'} · {Math.round((wins / trades.length) * 100)}%
        </span>
      )}
    </span>
  );
}
