// "Mis trades": el trade que tenés abierto, en vivo (resultado, R, tiempo y dónde está el precio entre
// tu stop y tu objetivo), y los trades que ya cerraste hoy con su resultado.
import { formatEtTime } from '../../engine/time';
import { fmtMoney, fmtPx } from '../../trading/broker';
import type { Position, Trade } from '../../trading/types';
import type { TrainingController } from '../training';

const money = (v: number) => Math.round(v * 100) / 100;
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtMoney(Math.abs(v))}`;
const tone = (v: number) => (v > 0 ? 't-up' : v < 0 ? 't-down' : 't-muted');
/** Con signo y un decimal: +1.4 / −0.9. */
const num1 = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;

function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Barra entre el stop y el objetivo: dónde está el precio y dónde entraste. */
function RangeBar({ stop, target, entry, last }: { stop: number; target: number; entry: number; last: number }) {
  const span = target - stop;
  const at = (v: number) => `${Math.min(100, Math.max(0, ((v - stop) / span) * 100))}%`;
  return (
    <div className="mt-bar" title={`Stop ${fmtPx(stop)} · entrada ${fmtPx(entry)} · último ${fmtPx(last)} · objetivo ${fmtPx(target)}`}>
      <span className="mt-bar-end t-down">{fmtPx(stop)}</span>
      <span className="mt-bar-track">
        <span className="mt-bar-fill" style={{ left: last >= entry ? at(entry) : at(last), right: `calc(100% - ${last >= entry ? at(last) : at(entry)})` }} data-up={last >= entry} />
        <span className="mt-bar-entry" style={{ left: at(entry) }} />
        <span className="mt-bar-last" style={{ left: at(last) }} />
      </span>
      <span className="mt-bar-end t-up">{fmtPx(target)}</span>
    </div>
  );
}

function OpenTrade({ c, p, now, onSelect }: { c: TrainingController; p: Position; now: number; onSelect: (s: string) => void }) {
  const last = c.marks(p.sym) ?? p.avgCost;
  const unreal = money((last - p.avgCost) * p.shares + p.realized);
  const pct = ((last - p.avgCost) / p.avgCost) * 100;
  const risk = p.initialStop !== undefined && p.avgCost > p.initialStop ? (p.avgCost - p.initialStop) * p.shares : 0;
  const stop = p.stop ?? p.planStop;
  const target = p.target ?? p.planTarget;
  return (
    <div className="mt-open">
      <div className="mt-open-row">
        <button className="link sym-link mt-sym" onClick={() => onSelect(p.sym)}>
          {p.sym}
        </button>
        <span className="mt-qty">
          {p.shares.toLocaleString('en-US')} a {fmtPx(p.avgCost)}
        </span>
        <b className={`mt-pnl ${tone(unreal)}`}>{signed(unreal)}</b>
        <span className={tone(pct)}>{num1(pct)}%</span>
        {risk > 0 && <span className={tone(unreal)}>{num1(unreal / risk)}R</span>}
        <span className="t-muted">{duration(now - p.openedAt)}</span>
        <button className="btn-small sell mt-close" onClick={() => c.sell(p.sym, 1)} title="Vender toda la posición a Bid − 0,05">
          Cerrar
        </button>
      </div>
      {stop !== undefined && target !== undefined && target > stop ? (
        <RangeBar stop={stop} target={target} entry={p.avgCost} last={last} />
      ) : (
        <p className="t-muted small mt-nolevels">Sin stop ni objetivo: poné tu plan en el ticket para ver la barra.</p>
      )}
    </div>
  );
}

function ClosedChip({ t, onSelect }: { t: Trade; onSelect: (s: string) => void }) {
  return (
    <button className={`mt-chip ${t.net > 0 ? 'is-win' : t.net < 0 ? 'is-loss' : ''}`} onClick={() => onSelect(t.sym)} title={`${t.shares} acciones · entrada ${fmtPx(t.avgEntry)} · salida ${fmtPx(t.avgExit)}${t.r !== undefined ? ` · ${t.r}R` : ''}`}>
      <span className="t-muted">{formatEtTime(t.closedAt, false)}</span> <b>{t.sym}</b> <span className={tone(t.net)}>{signed(t.net)}</span>
    </button>
  );
}

export function MyTrades({ c, now, onSelect }: { c: TrainingController; now: number; onSelect: (s: string) => void }) {
  const a = c.active;
  const open = a?.positions ?? [];
  const closed = [...(a?.trades ?? [])].reverse();
  return (
    <div className="mt">
      {open.length ? (
        open.map((p) => <OpenTrade key={p.sym} c={c} p={p} now={now} onSelect={onSelect} />)
      ) : (
        <p className="mt-empty t-muted">Sin trade abierto. Cuando compres, acá ves cómo viene en vivo.</p>
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
