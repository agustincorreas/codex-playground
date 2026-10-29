// Paneles de flujo: momentum (máximos del día), alertas, noticias, halts, watchlist y mapa de máximos.
import { memo, useMemo, useState } from 'react';
import type { Alert, AlertType, HaltRow, NewsItem, ScanRow } from '../../engine/types';
import { formatCountdown, formatEtTime } from '../../engine/time';
import { ALERT_META, GROUP_LABEL, MOMENTUM_TYPES, type AlertGroup } from '../lib/alertMeta';
import { pressable } from '../lib/a11y';
import { fmtFloat, fmtPct, fmtPrice, fmtRvol, timeAgo, toneOf } from '../lib/format';
import { useNow } from '../lib/now';
import { IconClose } from './Icons';
import { Empty } from './Panel';
import { ScoreDots } from './PillarDots';

const MOMENTUM = new Set<AlertType>(MOMENTUM_TYPES);

/**
 * Lista estilo "High of Day Momentum" de los escáneres de Ross Cameron: cada fila es una señal, la más
 * nueva arriba. El color de la fila dice cuántos pilares cumple (5 magenta, 4 celeste, 3 azul) y se
 * resaltan las celdas que cumplen su pilar: float bajo, volumen relativo de 5x y suba de 10% o más.
 */
/** "hace 12s" / "hace 3 min": se actualiza solo, una vez por segundo. */
export function TimeAgo({ ts }: { ts: number }) {
  const now = useNow(1000);
  return <>{timeAgo(ts, now || Date.now())}</>;
}

export const MomentumFeed = memo(function MomentumFeed({
  alerts,
  minScore,
  selected,
  onSelect,
}: {
  alerts: Alert[];
  minScore: number;
  selected: string | null;
  onSelect: (s: string) => void;
}) {
  // Varias señales del mismo símbolo en el mismo instante se muestran en una sola fila.
  const rows = useMemo(() => {
    const out: Array<{ a: Alert; types: AlertType[]; n: number }> = [];
    for (let i = alerts.length - 1; i >= 0 && out.length < 80; i--) {
      const a = alerts[i];
      if (!MOMENTUM.has(a.type) || a.score < minScore) continue;
      const last = out[out.length - 1];
      if (last && last.a.sym === a.sym && Math.abs(last.a.ts - a.ts) <= 2000) {
        if (!last.types.includes(a.type)) last.types.push(a.type);
        last.n++;
        continue;
      }
      out.push({ a, types: [a.type], n: 1 });
    }
    return out;
  }, [alerts, minScore]);
  if (!rows.length) return <Empty>Todavía no hay señales con {minScore}+ pilares.</Empty>;
  return (
    <div className="table-wrap">
      <table className="scan dtd">
        <thead>
          <tr>
            <th>Hora</th>
            <th>Símbolo</th>
            <th className="num">Precio</th>
            <th className="num dtd-vol" title="Volumen del día">Vol.</th>
            <th className="num">Float</th>
            <th className="num" title="Volumen relativo del día, ajustado por horario">RVOL</th>
            <th className="num">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ a, types, n }) => (
            <tr key={a.id} className={`dtd-s${Math.min(5, Math.max(2, a.score))} ${a.sym === selected ? 'is-selected' : ''} ${a.warmup ? 'is-old' : ''}`} {...pressable(() => onSelect(a.sym), null)} title={a.text}>
              <td className="dtd-time">
                {formatEtTime(a.ts)}
                {n > 1 && <small> ({n})</small>}
              </td>
              <td className="c-sym">
                <b className="dtd-sym">{a.sym}</b>
                {types.map((t) => (
                  <span key={t} className={`dtd-sig b-${t}`}>
                    {ALERT_META[t].short}
                  </span>
                ))}
              </td>
              <td className="num">{fmtPrice(a.price)}</td>
              <td className="num dtd-vol">{fmtFloat(a.volume)}</td>
              <td className={`num ${a.float !== undefined && a.float <= 10e6 ? 'dtd-hit-float' : ''}`}>{fmtFloat(a.float)}</td>
              <td className={`num ${a.rvol >= 5 ? 'dtd-hit-rvol' : ''}`}>{fmtRvol(a.rvol)}</td>
              <td className={`num ${a.changePct >= 10 ? 'dtd-hit-chg' : ''}`}>{fmtPct(a.changePct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

export const AlertFeed = memo(function AlertFeed({
  alerts,
  selected,
  onSelect,
}: {
  alerts: Alert[];
  selected: string | null;
  onSelect: (s: string) => void;
}) {
  const [group, setGroup] = useState<AlertGroup | 'all'>('all');
  const [minScore, setMinScore] = useState(0);
  const rows = useMemo(() => {
    const out: Alert[] = [];
    for (let i = alerts.length - 1; i >= 0 && out.length < 150; i--) {
      const a = alerts[i];
      if (group !== 'all' && ALERT_META[a.type].group !== group) continue;
      if (a.score < minScore) continue;
      out.push(a);
    }
    return out;
  }, [alerts, group, minScore]);
  return (
    <div className="feed-wrap">
      <div className="chips" role="group" aria-label="Filtrar alertas">
        {(['all', 'impulso', 'patron', 'halt', 'info'] as const).map((g) => (
          <button key={g} className={`chip ${group === g ? 'is-active' : ''}`} onClick={() => setGroup(g)}>
            {GROUP_LABEL[g]}
          </button>
        ))}
        <label className="chip-select">
          Pilares ≥
          <select id="alert-min-score" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {rows.length === 0 ? (
        <Empty>Sin alertas con este filtro.</Empty>
      ) : (
        <ol className="alert-list">
          {rows.map((a) => (
            <li key={a.id} className={`alert tone-${a.tone} ${a.sym === selected ? 'is-selected' : ''} ${a.warmup ? 'is-old' : ''}`} {...pressable(() => onSelect(a.sym))} aria-label={`${a.sym}: ${a.text}`}>
              <span className="mono t-muted">{formatEtTime(a.ts)}</span>
              <b className="alert-sym">{a.sym}</b>
              <span className={`badge b-${a.type}`}>{ALERT_META[a.type].short}</span>
              <span className="alert-text">{a.text.replace(/^Noticia: /, '')}</span>
              <span className="alert-meta mono">
                {fmtPrice(a.price)} <span className={`t-${toneOf(a.changePct)}`}>{fmtPct(a.changePct)}</span>
              </span>
              <ScoreDots score={a.score} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
});

export const NewsPanel = memo(function NewsPanel({
  news,
  onSelect,
  known,
}: {
  news: NewsItem[];
  onSelect: (s: string) => void;
  known: (sym: string) => boolean;
}) {
  if (!news.length) return <Empty>Sin noticias todavía.</Empty>;
  return (
    <ol className="news-list">
      {news.slice(0, 80).map((n) => (
        <li key={n.id} className={`news s-${n.sentiment ?? 'neutral'}`}>
          <div className="news-top">
            <span className="mono t-muted">{formatEtTime(n.ts, false)}</span>
            <span className="t-muted">
              <TimeAgo ts={n.ts} />
            </span>
            {n.source && <span className="news-src">{n.source}</span>}
            <span className="news-syms">
              {n.symbols.slice(0, 4).map((s) => (
                <button key={s} className={`sym-chip ${known(s) ? '' : 'is-unknown'}`} onClick={() => onSelect(s)}>
                  {s}
                </button>
              ))}
            </span>
          </div>
          {n.url ? (
            <a className="news-headline" href={n.url} target="_blank" rel="noreferrer">
              {n.headline}
            </a>
          ) : (
            <p className="news-headline">{n.headline}</p>
          )}
        </li>
      ))}
    </ol>
  );
});

export const HaltsPanel = memo(function HaltsPanel({
  halts,
  selected,
  onSelect,
}: {
  halts: HaltRow[];
  selected: string | null;
  onSelect: (s: string) => void;
}) {
  // La cuenta regresiva de cada halt avanza una vez por segundo.
  const now = useNow(1000);
  if (!halts.length) return <Empty>Ningún halt por ahora. Las pausas LULD duran 5 minutos.</Empty>;
  return (
    <ol className="halt-list">
      {halts.map((h) => {
        const diff = h.haltPrice > 0 ? ((h.price - h.haltPrice) / h.haltPrice) * 100 : 0;
        return (
          <li key={h.sym + h.ts} className={`halt ${h.halted ? 'is-halted' : 'is-resumed'} ${h.sym === selected ? 'is-selected' : ''}`} {...pressable(() => onSelect(h.sym))}>
            <div className="halt-top">
              <b>{h.sym}</b>
              <span className={`status-pill ${h.halted ? 'warn' : 'up'}`}>{h.halted ? 'HALT' : 'REANUDÓ'}</span>
              {h.count > 1 && <span className="t-muted">{h.count}º del día</span>}
              <span className="mono t-muted halt-time">{formatEtTime(h.ts)}</span>
            </div>
            <div className="halt-bottom">
              <span className="t-muted">{h.reasonText}</span>
              {h.halted && h.resumeTs ? (
                <span className="mono countdown">reanuda en {formatCountdown(h.resumeTs - now)}</span>
              ) : (
                <span className="mono">
                  {fmtPrice(h.price)} {!h.halted && <span className={`t-${toneOf(diff)}`}>{fmtPct(diff)} vs. halt</span>}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
});

export const WatchlistPanel = memo(function WatchlistPanel({
  rows,
  watch,
  selected,
  onSelect,
  onRemove,
  onAdd,
}: {
  rows: ScanRow[];
  watch: string[];
  selected: string | null;
  onSelect: (s: string) => void;
  onRemove: (s: string) => void;
  onAdd: (s: string) => void;
}) {
  const [text, setText] = useState('');
  const bySym = new Map(rows.map((r) => [r.sym, r]));
  return (
    <div className="watch">
      <form
        className="watch-add"
        onSubmit={(e) => {
          e.preventDefault();
          const s = text.trim().toUpperCase();
          if (s) onAdd(s);
          setText('');
        }}
      >
        <input id="watch-add-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Agregar símbolo" aria-label="Agregar símbolo a la watchlist" maxLength={8} />
        <button type="submit" className="btn-small">
          Agregar
        </button>
      </form>
      {watch.length === 0 ? (
        <Empty>Marcá la estrella en la ficha de una acción para seguirla acá.</Empty>
      ) : (
        <ol className="watch-list">
          {watch.map((sym) => {
            const r = bySym.get(sym);
            return (
              <li key={sym} className={sym === selected ? 'is-selected' : ''} {...pressable(() => onSelect(sym))}>
                <b>{sym}</b>
                <span className="mono">{r ? fmtPrice(r.price) : '—'}</span>
                <span className={`mono t-${toneOf(r?.changePct ?? 0)}`}>{r ? fmtPct(r.changePct) : ''}</span>
                <span className="mono t-muted">{r ? fmtRvol(r.rvol) : ''}</span>
                <button
                  className="icon-btn"
                  aria-label={`Quitar ${sym}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(sym);
                  }}
                >
                  <IconClose />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
});

/** Dónde está el precio dentro del rango del día (mínimo → máximo), con la marca del VWAP. */
export const HodBoard = memo(function HodBoard({ rows, selected, onSelect }: { rows: ScanRow[]; selected: string | null; onSelect: (s: string) => void }) {
  if (!rows.length) return <Empty>Sin gappers todavía.</Empty>;
  return (
    <ol className="hod-board">
      {rows.map((r) => {
        const range = r.hod - r.lod;
        const pos = range > 0 ? ((r.price - r.lod) / range) * 100 : 100;
        const vw = range > 0 ? Math.min(100, Math.max(0, ((r.vwap - r.lod) / range) * 100)) : 50;
        const tone = pos >= 90 ? 'up' : pos <= 40 ? 'down' : 'mid';
        return (
          <li key={r.sym} className={r.sym === selected ? 'is-selected' : ''} {...pressable(() => onSelect(r.sym))} title={`Mín. ${fmtPrice(r.lod)} · VWAP ${fmtPrice(r.vwap)} · Máx. ${fmtPrice(r.hod)}`}>
            <b>{r.sym}</b>
            <span className="hod-track">
              <span className={`hod-fill ${tone}`} style={{ width: `${pos}%` }} />
              <span className="hod-vwap" style={{ left: `${vw}%` }} />
            </span>
            <span className="mono hod-nums">
              {fmtPrice(r.price)} <span className="t-muted">/ {fmtPrice(r.hod)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
});
