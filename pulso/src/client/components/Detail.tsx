// Ficha de la acción seleccionada: datos clave, los 5 pilares, salud del setup y plan de riesgo.
import { useEffect, useState } from 'react';
import type { Settings, SymbolDetail } from '../../engine/types';
import { formatEtTime } from '../../engine/time';
import { fmtFloat, fmtMoney, fmtPct, fmtPrice, fmtRvol, fmtVolume, timeAgo, toneOf } from '../lib/format';
import { load, save } from '../lib/storage';
import { IconStar } from './Icons';
import { Empty } from './Panel';

interface Props {
  detail: SymbolDetail | null;
  settings: Settings;
  now: number;
  watched: boolean;
  onToggleWatch: (sym: string) => void;
}

function Check({ ok, label, value }: { ok: boolean | null; label: string; value: string }) {
  return (
    <li className={`check ${ok === null ? 'unknown' : ok ? 'ok' : 'no'}`}>
      <span className="check-mark" aria-hidden="true">
        {ok === null ? '?' : ok ? '✓' : '✗'}
      </span>
      <span className="check-label">{label}</span>
      <span className="check-value mono">{value}</span>
    </li>
  );
}

function Stat({ label, value, tone, title }: { label: string; value: string; tone?: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <span className="stat-label">{label}</span>
      <span className={`stat-value mono ${tone ? `t-${tone}` : ''}`}>{value}</span>
    </div>
  );
}

export function Detail({ detail, settings: s, now, watched, onToggleWatch }: Props) {
  const [risk, setRisk] = useState<number>(() => load('risk', 100));
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const sym = detail?.sym;

  // Al cambiar de acción, precargar el plan con el bull flag (si hay) o con el precio y el VWAP.
  useEffect(() => {
    if (!detail) return;
    const f = detail.setup.flag;
    const e = f ? f.entry : detail.row.price;
    const st = f ? f.stop : Math.min(detail.row.vwap, detail.row.price * 0.97);
    setEntry(fmtPrice(e));
    setStop(fmtPrice(st));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, detail?.setup.flag?.entry]);

  if (!detail) return <Empty>Elegí una acción de cualquier lista para ver su ficha.</Empty>;
  const r = detail.row;
  const p = r.pillars;
  const ref = detail.ref;
  const shares = ref.sharesOutstanding;
  const e = Number(entry);
  const sp = Number(stop);
  const perShare = e - sp;
  const qty = perShare > 0 && risk > 0 ? Math.floor(risk / perShare) : 0;
  const target = perShare > 0 ? e + 2 * perShare : 0;
  const lastNews = detail.news[0];

  return (
    <div className="detail">
      <div className="detail-head">
        <div className="detail-id">
          <div className="detail-sym">
            <span className="sym-big">{detail.sym}</span>
            <button className={`icon-btn star ${watched ? 'is-on' : ''}`} onClick={() => onToggleWatch(detail.sym)} aria-pressed={watched} aria-label={watched ? 'Quitar de la watchlist' : 'Agregar a la watchlist'} title={watched ? 'Quitar de la watchlist' : 'Agregar a la watchlist'}>
              <IconStar filled={watched} />
            </button>
          </div>
          <span className="detail-name">
            {ref.name ?? '—'}
            {ref.exchange ? ` · ${ref.exchange}` : ''}
          </span>
        </div>
        <div className="detail-price">
          <span className="price-big mono">{fmtPrice(r.price)}</span>
          <span className={`mono t-${toneOf(r.changePct)}`}>{fmtPct(r.changePct, 2)}</span>
        </div>
      </div>

      <div className="tags">
        {r.halted && <span className="tag warn">HALT · {detail.halt?.reasonText}</span>}
        {r.float !== undefined && r.float <= s.maxFloat && <span className="tag up">Float bajo</span>}
        {p.news && <span className="tag info">Noticia</span>}
        {r.rotation !== undefined && r.rotation >= 1 && <span className="tag up">Rotó el float {r.rotation.toFixed(1)}x</span>}
        {ref.shortInterest && ref.float ? <span className="tag">Short {((ref.shortInterest / ref.float) * 100).toFixed(0)}% del float</span> : null}
        {(ref.flags ?? []).map((f) => (
          <span key={f} className="tag down" title="Riesgo de dilución / contexto de la empresa">
            {f}
          </span>
        ))}
      </div>

      <div className="stats">
        <Stat label="Volumen" value={fmtVolume(r.volume)} />
        <Stat label="RVOL" value={fmtRvol(r.rvol)} tone={r.rvol >= s.minRvol ? 'hot' : undefined} title="Volumen de hoy vs. lo normal a esta hora" />
        <Stat label="RVOL 5m" value={fmtRvol(r.rvol5m)} />
        <Stat label="Float" value={`${r.floatEst ? '≈' : ''}${fmtFloat(r.float)}`} title={ref.floatSource ? `Fuente: ${ref.floatSource}` : undefined} />
        <Stat label="VWAP" value={fmtPrice(r.vwap)} tone={r.price >= r.vwap ? 'up' : 'down'} />
        <Stat label="Máx. día" value={fmtPrice(r.hod)} />
        <Stat label="Máx. pre" value={detail.pmHigh ? fmtPrice(detail.pmHigh) : '—'} />
        <Stat label="Mín. día" value={fmtPrice(detail.lod)} />
        <Stat label="Gap" value={fmtPct(r.gapPct)} tone={toneOf(r.gapPct)} />
        <Stat label="Cierre ant." value={fmtPrice(r.prevClose)} />
        <Stat label="Vol. prom." value={fmtVolume(ref.avgVolume ?? 0)} />
        <Stat label="Cap. aprox." value={shares ? fmtMoney(shares * r.price) : '—'} />
      </div>

      <div className="detail-cols">
        <section>
          <h3 className="sub">5 pilares · {p.score}/5</h3>
          <ul className="checks">
            <Check ok={p.price} label={`Precio $${s.priceMin}–$${s.priceMax}`} value={`$${fmtPrice(r.price)}`} />
            <Check ok={p.change} label={`Sube ≥ ${s.minChangePct}%`} value={fmtPct(r.changePct)} />
            <Check ok={p.rvol} label={`Vol. relativo ≥ ${s.minRvol}x`} value={fmtRvol(r.rvol)} />
            <Check ok={p.news} label="Noticia reciente" value={lastNews ? timeAgo(lastNews.ts, now) : 'no'} />
            <Check ok={p.float} label={`Float < ${fmtFloat(s.maxFloat)}`} value={r.float ? fmtFloat(r.float) : 'sin dato'} />
          </ul>
        </section>
        <section>
          <h3 className="sub">Setup</h3>
          <ul className="checks">
            <Check ok={detail.setup.aboveVwap} label="Sobre el VWAP" value={fmtPrice(r.vwap)} />
            <Check ok={detail.setup.aboveEma9} label="Sobre la EMA 9" value={fmtPrice(detail.ema9)} />
            <Check ok={detail.setup.macdBullish} label="MACD a favor" value={detail.macd.hist.toFixed(3)} />
            <Check ok={!r.halted} label="Sin halt" value={r.halted ? 'en halt' : 'opera'} />
            <Check ok={r.pctFromHod > -5} label="Cerca del máximo" value={fmtPct(r.pctFromHod)} />
          </ul>
          <p className="next-level mono">
            Próximo nivel: <b>${fmtPrice(detail.setup.nextLevel)}</b>
            {detail.setup.flag && (
              <span className="t-up"> · bull flag armado (entrada ${fmtPrice(detail.setup.flag.entry)})</span>
            )}
          </p>
        </section>
      </div>

      <section className="planner">
        <h3 className="sub">Plan de riesgo (2:1)</h3>
        <div className="planner-grid">
          <label>
            Riesgo máx. US$
            <input
              id="plan-risk"
              type="number"
              inputMode="decimal"
              min={1}
              value={risk}
              onChange={(ev) => {
                const v = Number(ev.target.value);
                setRisk(v);
                save('risk', v);
              }}
            />
          </label>
          <label>
            Entrada
            <input id="plan-entry" type="number" inputMode="decimal" step="0.01" value={entry} onChange={(ev) => setEntry(ev.target.value)} />
          </label>
          <label>
            Stop
            <input id="plan-stop" type="number" inputMode="decimal" step="0.01" value={stop} onChange={(ev) => setStop(ev.target.value)} />
          </label>
          <div className="planner-out mono">
            <span>
              Acciones <b>{qty.toLocaleString('es-AR')}</b>
            </span>
            <span>
              Objetivo <b className="t-up">{target ? `$${fmtPrice(target)}` : '—'}</b>
            </span>
            <span>
              Capital <b>{qty ? fmtMoney(qty * e) : '—'}</b>
            </span>
          </div>
        </div>
        {perShare <= 0 && entry && stop && <p className="hint t-down">El stop tiene que estar debajo de la entrada.</p>}
      </section>

      {detail.news.length > 0 && (
        <section>
          <h3 className="sub">Noticias</h3>
          <ol className="news-list compact">
            {detail.news.slice(0, 4).map((n) => (
              <li key={n.id} className={`news s-${n.sentiment ?? 'neutral'}`}>
                <div className="news-top">
                  <span className="mono t-muted">{formatEtTime(n.ts, false)}</span>
                  <span className="t-muted">{timeAgo(n.ts, now)}</span>
                  {n.source && <span className="news-src">{n.source}</span>}
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
        </section>
      )}
    </div>
  );
}
