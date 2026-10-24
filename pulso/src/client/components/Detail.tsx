// Cotización de la acción elegida (como la ventana "Stock Quote"): precio, noticias, datos clave,
// los 5 pilares y la salud del setup.
import type { Settings, SymbolDetail } from '../../engine/types';
import { formatEtTime } from '../../engine/time';
import { fmtFloat, fmtMoney, fmtPct, fmtPrice, fmtRvol, fmtVolume, timeAgo, toneOf } from '../lib/format';
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

export function Detail({ detail, settings: s, now, watched, onToggleWatch }: Props) {
  if (!detail) return <Empty>Elegí una acción de cualquier lista para ver su cotización.</Empty>;
  const r = detail.row;
  const p = r.pillars;
  const ref = detail.ref;
  const shares = ref.sharesOutstanding;
  const lastNews = detail.news[0];
  const chg = r.price - r.prevClose;

  return (
    <div className="quote">
      <div className="quote-head">
        <div className="quote-sym">
          <span className="sym-big">{detail.sym}</span>
          <button className={`icon-btn star ${watched ? 'is-on' : ''}`} onClick={() => onToggleWatch(detail.sym)} aria-pressed={watched} aria-label={watched ? 'Quitar de la watchlist' : 'Agregar a la watchlist'} title={watched ? 'Quitar de la watchlist' : 'Agregar a la watchlist'}>
            <IconStar filled={watched} />
          </button>
        </div>
        <div className={`quote-price t-${toneOf(r.changePct)}`}>
          <span className="price-big">{fmtPrice(r.price)}</span>
          <span className="quote-chg">
            {chg >= 0 ? '+' : ''}
            {fmtPrice(chg)} ({fmtPct(r.changePct, 2)})
          </span>
        </div>
      </div>
      <p className="quote-name">
        {ref.name ?? '—'}
        {ref.exchange ? ` | ${ref.exchange}` : ''}
      </p>
      <p className="quote-updated">Actualizado {formatEtTime(r.lastTs || now)} ET</p>

      <div className="tags">
        {r.halted && <span className="tag warn">HALT · {detail.halt?.reasonText}</span>}
        {r.float !== undefined && r.float <= s.maxFloat && <span className="tag up">Float bajo</span>}
        {p.news && <span className="tag info">Noticia</span>}
        {r.rotation !== undefined && r.rotation >= 1 && <span className="tag up">Rotó el float {r.rotation.toFixed(1)}x</span>}
        {(ref.flags ?? []).map((f) => (
          <span key={f} className="tag down" title="Riesgo de dilución / contexto de la empresa">
            {f}
          </span>
        ))}
      </div>

      <section className="quote-news">
        <h3 className="sub">Noticias</h3>
        {detail.news.length ? (
          <ol className="news-list compact">
            {detail.news.slice(0, 4).map((n) => (
              <li key={n.id} className={`news s-${n.sentiment ?? 'neutral'}`}>
                {n.url ? (
                  <a className="news-headline" href={n.url} target="_blank" rel="noreferrer">
                    {n.headline}
                  </a>
                ) : (
                  <p className="news-headline">{n.headline}</p>
                )}
                <span className="news-meta">
                  {formatEtTime(n.ts, false)} ET · {timeAgo(n.ts, now)}
                  {n.source ? ` · ${n.source}` : ''}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="t-muted small">Sin noticias recientes.</p>
        )}
      </section>

      <dl className="kv">
        <div>
          <dt>Float</dt>
          <dd title={ref.floatSource ? `Fuente: ${ref.floatSource}` : undefined}>
            {r.floatEst ? '≈' : ''}
            {fmtFloat(r.float)}
          </dd>
        </div>
        <div>
          <dt>Volumen</dt>
          <dd>{fmtVolume(r.volume)}</dd>
        </div>
        <div>
          <dt>Volumen relativo (diario)</dt>
          <dd className={r.rvol >= s.minRvol ? 't-hot' : ''}>{fmtRvol(r.rvol)}</dd>
        </div>
        <div>
          <dt>Volumen relativo (5 min)</dt>
          <dd>{fmtRvol(r.rvol5m)}</dd>
        </div>
        <div>
          <dt>Gap (%)</dt>
          <dd className={`t-${toneOf(r.gapPct)}`}>{fmtPct(r.gapPct)}</dd>
        </div>
        <div>
          <dt>Volumen en 5 minutos</dt>
          <dd>{fmtVolume(r.vol5m)}</dd>
        </div>
        <div>
          <dt>Cierre anterior</dt>
          <dd>{fmtPrice(r.prevClose)}</dd>
        </div>
        <div>
          <dt>Máximo / mínimo</dt>
          <dd>
            {fmtPrice(r.hod)} / {fmtPrice(detail.lod)}
          </dd>
        </div>
        <div>
          <dt>Máximo pre-market</dt>
          <dd>{detail.pmHigh ? fmtPrice(detail.pmHigh) : '—'}</dd>
        </div>
        <div>
          <dt>VWAP</dt>
          <dd className={r.price >= r.vwap ? 't-up' : 't-down'}>{fmtPrice(r.vwap)}</dd>
        </div>
        <div>
          <dt>Short interest</dt>
          <dd>{ref.shortInterest && ref.float ? `${((ref.shortInterest / ref.float) * 100).toFixed(0)}% del float` : '—'}</dd>
        </div>
        <div>
          <dt>Volumen promedio</dt>
          <dd>{fmtVolume(ref.avgVolume ?? 0)}</dd>
        </div>
        <div>
          <dt>Capitalización</dt>
          <dd>{shares ? fmtMoney(shares * r.price) : '—'}</dd>
        </div>
      </dl>

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
          <p className="next-level">
            Próximo nivel: <b>${fmtPrice(detail.setup.nextLevel)}</b>
            {detail.setup.flag && <span className="t-up"> · bull flag armado (entrada ${fmtPrice(detail.setup.flag.entry)})</span>}
          </p>
        </section>
      </div>
    </div>
  );
}
