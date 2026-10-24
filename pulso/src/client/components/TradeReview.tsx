// Revisión de un trade cerrado: velas de 1 minuto alrededor del trade con las compras y ventas marcadas.
import { useEffect, useRef } from 'react';
import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, LineStyle, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import { etOffset, formatEtTime } from '../../engine/time';
import { fmtMoney } from '../../trading/broker';
import type { Trade } from '../../trading/types';
import { fmtPct, fmtPrice } from '../lib/format';
import { IconClose } from './Icons';

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
const toTime = (t: number) => Math.floor((t + etOffset(t)) / 1000) as UTCTimestamp;

export function TradeReview({ trade, onClose }: { trade: Trade; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!host.current || !trade.bars?.length) return;
    const up = css('--up');
    const down = css('--down');
    const chart = createChart(host.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: css('--panel') }, textColor: css('--muted'), fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
    });
    const candles = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false });
    candles.setData(trade.bars.map(([t, o, h, l, c]) => ({ time: toTime(t), open: o, high: h, low: l, close: c })));
    candles.createPriceLine({ price: trade.avgEntry, color: css('--accent'), lineStyle: LineStyle.Dashed, lineWidth: 1, title: 'Entrada', axisLabelVisible: true });
    candles.createPriceLine({ price: trade.avgExit, color: trade.net >= 0 ? up : down, lineStyle: LineStyle.Dashed, lineWidth: 1, title: 'Salida', axisLabelVisible: true });
    const marks: SeriesMarker<Time>[] = (trade.marks ?? []).map(([ts, side, price, shares]) => ({
      time: toTime(Math.floor(ts / 60_000) * 60_000),
      position: side === 'B' ? 'belowBar' : 'aboveBar',
      color: side === 'B' ? css('--info') : css('--warn'),
      shape: side === 'B' ? 'arrowUp' : 'arrowDown',
      text: `${side === 'B' ? 'C' : 'V'} ${shares} @ ${fmtPrice(price)}`,
    }));
    createSeriesMarkers(candles, marks);
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [trade]);

  const mins = (trade.closedAt - trade.openedAt) / 60_000;
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal review" role="dialog" aria-modal="true" aria-labelledby="review-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2 id="review-title">
            {trade.sym} · <span className={trade.net >= 0 ? 't-up' : 't-down'}>{trade.net >= 0 ? '+' : ''}{fmtMoney(trade.net)}</span>
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <IconClose />
          </button>
        </header>
        <div className="review-body">
          <div className="review-chart" ref={host} />
          <dl className="review-stats mono">
            <div>
              <dt>Entrada</dt>
              <dd>
                {trade.shares} a {fmtPrice(trade.avgEntry)} · {formatEtTime(trade.openedAt)}
              </dd>
            </div>
            <div>
              <dt>Salida</dt>
              <dd>
                {fmtPrice(trade.avgExit)} · {formatEtTime(trade.closedAt)} ({{ manual: 'manual', stop: 'stop', target: 'objetivo', eod: 'cierre del día' }[trade.exitReason]})
              </dd>
            </div>
            <div>
              <dt>Resultado</dt>
              <dd>
                {fmtPct(trade.returnPct)}
                {trade.r !== undefined ? ` · ${trade.r.toFixed(2)}R` : ''} · {mins.toFixed(1)} min
              </dd>
            </div>
            <div>
              <dt>A favor / en contra</dt>
              <dd>
                <span className="t-up">{fmtPct(trade.mfePct)}</span> / <span className="t-down">{fmtPct(trade.maePct)}</span>
              </dd>
            </div>
            {trade.ctx && (
              <div>
                <dt>Al entrar</dt>
                <dd>
                  {fmtPct(trade.ctx.changePct)} en el día · RVOL {trade.ctx.rvol.toFixed(1)}x · {trade.ctx.score}/5 pilares
                </dd>
              </div>
            )}
            {trade.setup && (
              <div>
                <dt>Setup</dt>
                <dd>{trade.setup}</dd>
              </div>
            )}
            {trade.note && (
              <div>
                <dt>Nota</dt>
                <dd>{trade.note}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}
