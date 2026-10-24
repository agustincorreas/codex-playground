// Gráfico de 1/5 minutos con velas, volumen, VWAP, EMA 9/20 y MACD (lightweight-charts de TradingView).
import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { aggregateBars, aggregateSpan, emaSeries, macdSeries, vwapSeries } from '../../engine/indicators';
import { etOffset } from '../../engine/time';
import type { Alert, Bar, SymbolDetail } from '../../engine/types';

interface Series {
  candles: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
  vwap: ISeriesApi<'Line'>;
  ema9: ISeriesApi<'Line'>;
  ema20: ISeriesApi<'Line'>;
  markers: ISeriesMarkersPluginApi<Time>;
  /** Panel inferior del MACD (solo si está visible). */
  macd?: { macd: ISeriesApi<'Line'>; signal: ISeriesApi<'Line'>; hist: ISeriesApi<'Histogram'> };
}

const LINE = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };

function addMacd(chart: IChartApi, s: Series) {
  const p = palette();
  s.macd = {
    hist: chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 1),
    macd: chart.addSeries(LineSeries, { ...LINE, color: p.ema9 }, 1),
    signal: chart.addSeries(LineSeries, { ...LINE, color: p.vwap }, 1),
  };
  // El precio ocupa ~80% del alto y el MACD ~20%.
  const panes = chart.panes();
  panes[0]?.setStretchFactor(4);
  panes[1]?.setStretchFactor(1);
}

function removeMacd(chart: IChartApi, s: Series) {
  if (!s.macd) return;
  chart.removeSeries(s.macd.hist);
  chart.removeSeries(s.macd.macd);
  chart.removeSeries(s.macd.signal);
  s.macd = undefined;
}

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

/** Desplaza el tiempo a la hora de pared de Nueva York: el gráfico muestra horas ET. */
const toTime = (t: number) => Math.floor((t + etOffset(t)) / 1000) as UTCTimestamp;

function palette() {
  return {
    bg: css('--panel'),
    text: css('--muted'),
    grid: css('--grid'),
    line: css('--line'),
    up: css('--up'),
    down: css('--down'),
    vwap: css('--warn'),
    ema9: css('--info'),
    ema20: css('--accent'),
    faint: css('--faint'),
  };
}

function applyTheme(chart: IChartApi, s: Series) {
  const p = palette();
  chart.applyOptions({
    layout: { background: { type: ColorType.Solid, color: p.bg }, textColor: p.text, panes: { separatorColor: p.line } },
    grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
  });
  s.candles.applyOptions({ upColor: p.up, downColor: p.down, wickUpColor: p.up, wickDownColor: p.down });
  s.vwap.applyOptions({ color: p.vwap });
  s.ema9.applyOptions({ color: p.ema9 });
  s.ema20.applyOptions({ color: p.ema20 });
  s.macd?.macd.applyOptions({ color: p.ema9 });
  s.macd?.signal.applyOptions({ color: p.vwap });
}

export interface ChartPosition {
  avgCost: number;
  shares: number;
  stop?: number;
  target?: number;
}

export interface ChartFill {
  ts: number;
  side: 'buy' | 'sell';
  price: number;
  shares: number;
}

interface Props {
  detail: SymbolDetail | null;
  alerts: Alert[];
  themeKey: string;
  /** Posición de práctica en la acción del gráfico (costo, stop y objetivo). */
  position?: ChartPosition;
  fills?: ChartFill[];
}

/** Temporalidades en segundos: las de 10 y 30 s salen de las velas de 10 s. */
const TIMEFRAMES: Array<[number, string]> = [
  [10, '10 s'],
  [30, '30 s'],
  [60, '1 min'],
  [300, '5 min'],
];

/** Velas de la temporalidad elegida y su VWAP (siempre el del día completo, calculado en velas de 1 min). */
function framed(detail: SymbolDetail, tf: number): { bars: Bar[]; vwap: number[] } {
  if (tf >= 60) {
    const bars = aggregateBars(detail.bars, tf / 60);
    return { bars, vwap: vwapSeries(bars) };
  }
  const bars = tf === 10 ? detail.secBars : aggregateSpan(detail.secBars, tf * 1000);
  const dayVwap = vwapSeries(detail.bars);
  const byMinute = new Map(detail.bars.map((b, i) => [b.t, dayVwap[i]]));
  let lastV = bars[0]?.c ?? 0;
  const vwap = bars.map((b) => {
    const v = byMinute.get(Math.floor(b.t / 60_000) * 60_000);
    if (v !== undefined) lastV = v;
    return lastV;
  });
  return { bars, vwap };
}

export function Chart({ detail, alerts, themeKey, position, fills }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Series | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const stateRef = useRef<{ sym: string; tf: number; len: number; first: number }>({ sym: '', tf: 1, len: 0, first: 0 });
  const [tf, setTf] = useState(60);
  const [showMacd, setShowMacd] = useState(true);

  useEffect(() => {
    if (!host.current) return;
    const p = palette();
    const chart = createChart(host.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: p.bg },
        textColor: p.text,
        fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
        fontSize: 11,
        attributionLogo: true,
        panes: { separatorColor: p.line, enableResize: false },
      },
      grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 3 },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: p.up,
      downColor: p.down,
      wickUpColor: p.up,
      wickDownColor: p.down,
      borderVisible: false,
    });
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    const vwap = chart.addSeries(LineSeries, { ...LINE, lineWidth: 2, color: p.vwap });
    const ema9 = chart.addSeries(LineSeries, { ...LINE, color: p.ema9 });
    const ema20 = chart.addSeries(LineSeries, { ...LINE, color: p.ema20 });
    const markers = createSeriesMarkers(candles, []);
    chartRef.current = chart;
    seriesRef.current = { candles, volume, vwap, ema9, ema20, markers };
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      linesRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (chartRef.current && seriesRef.current) applyTheme(chartRef.current, seriesRef.current);
    stateRef.current.len = -1;
  }, [themeKey]);

  useEffect(() => {
    const chart = chartRef.current;
    const s = seriesRef.current;
    if (!chart || !s) return;
    if (showMacd && !s.macd) addMacd(chart, s);
    if (!showMacd) removeMacd(chart, s);
    stateRef.current.len = -1;
  }, [showMacd]);

  useEffect(() => {
    const s = seriesRef.current;
    const chart = chartRef.current;
    if (!s || !chart) return;
    const frame = detail ? framed(detail, tf) : null;
    if (!detail || !frame || !frame.bars.length) {
      for (const series of [s.candles, s.volume, s.vwap, s.ema9, s.ema20]) series.setData([]);
      if (s.macd) for (const series of [s.macd.macd, s.macd.signal, s.macd.hist]) series.setData([]);
      stateRef.current = { sym: '', tf, len: 0, first: 0 };
      return;
    }
    chart.applyOptions({ timeScale: { secondsVisible: tf < 60 } });
    const bars: Bar[] = frame.bars;
    const closes = bars.map((b) => b.c);
    const vw = frame.vwap;
    const e9 = emaSeries(closes, 9);
    const e20 = emaSeries(closes, 20);
    const m = macdSeries(closes);
    const p = palette();
    const precision = detail.row.price >= 1 ? 2 : 4;
    const st = stateRef.current;
    const same = st.sym === detail.sym && st.tf === tf && st.first === bars[0].t && (bars.length === st.len || bars.length === st.len + 1);
    const volColor = (b: Bar) => (b.c >= b.o ? `${p.up}66` : `${p.down}66`);

    if (!same) {
      s.candles.applyOptions({ priceFormat: { type: 'price', precision, minMove: precision === 2 ? 0.01 : 0.0001 } });
      s.candles.setData(bars.map((b) => ({ time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));
      s.volume.setData(bars.map((b) => ({ time: toTime(b.t), value: b.v, color: volColor(b) })));
      s.vwap.setData(bars.map((b, i) => ({ time: toTime(b.t), value: vw[i] })));
      s.ema9.setData(bars.map((b, i) => ({ time: toTime(b.t), value: e9[i] })));
      s.ema20.setData(bars.map((b, i) => ({ time: toTime(b.t), value: e20[i] })));
      if (s.macd) {
        s.macd.macd.setData(bars.map((b, i) => ({ time: toTime(b.t), value: m.macd[i] })));
        s.macd.signal.setData(bars.map((b, i) => ({ time: toTime(b.t), value: m.signal[i] })));
        s.macd.hist.setData(bars.map((b, i) => ({ time: toTime(b.t), value: m.hist[i], color: m.hist[i] >= 0 ? `${p.up}99` : `${p.down}99` })));
      }
      if (st.sym !== detail.sym || st.tf !== tf) {
        chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - (tf === 300 ? 60 : 120)), to: bars.length + 3 });
      }
    } else {
      // update() solo acepta la última vela o una nueva: si apareció una vela, se cierra la anterior y se agrega.
      const from = bars.length === st.len ? bars.length - 1 : bars.length - 2;
      for (let i = Math.max(0, from); i < bars.length; i++) {
        const b = bars[i];
        const time = toTime(b.t);
        s.candles.update({ time, open: b.o, high: b.h, low: b.l, close: b.c });
        s.volume.update({ time, value: b.v, color: volColor(b) });
        s.vwap.update({ time, value: vw[i] });
        s.ema9.update({ time, value: e9[i] });
        s.ema20.update({ time, value: e20[i] });
        if (s.macd) {
          s.macd.macd.update({ time, value: m.macd[i] });
          s.macd.signal.update({ time, value: m.signal[i] });
          s.macd.hist.update({ time, value: m.hist[i], color: m.hist[i] >= 0 ? `${p.up}99` : `${p.down}99` });
        }
      }
    }
    stateRef.current = { sym: detail.sym, tf, len: bars.length, first: bars[0].t };

    // Líneas de precio: máximo del día, máximo pre-market, cierre anterior y el plan del bull flag.
    for (const l of linesRef.current) s.candles.removePriceLine(l);
    const lines: IPriceLine[] = [];
    const add = (price: number, color: string, title: string, style: LineStyle) => {
      if (price > 0) lines.push(s.candles.createPriceLine({ price, color, title, lineStyle: style, lineWidth: 1, axisLabelVisible: true }));
    };
    add(detail.row.hod, p.up, 'HOD', LineStyle.Dashed);
    if (detail.pmHigh > 0 && Math.abs(detail.pmHigh - detail.row.hod) > 1e-9) add(detail.pmHigh, p.ema20, 'PMH', LineStyle.Dotted);
    add(detail.row.prevClose, p.faint, 'Cierre ant.', LineStyle.Dotted);
    if (position) {
      add(position.avgCost, p.ema20, `Tu costo (${position.shares})`, LineStyle.Solid);
      if (position.stop) add(position.stop, p.down, 'Tu stop', LineStyle.Solid);
      if (position.target) add(position.target, p.up, 'Tu objetivo', LineStyle.Solid);
    } else if (detail.setup.flag) {
      add(detail.setup.flag.entry, p.ema9, 'Entrada', LineStyle.Solid);
      add(detail.setup.flag.stop, p.down, 'Stop', LineStyle.Solid);
    }
    linesRef.current = lines;

    // Marcas de halts y bull flags del símbolo.
    const first = bars[0].t;
    const span = tf * 1000;
    const marks: SeriesMarker<Time>[] = [];
    for (const a of alerts) {
      if (a.sym !== detail.sym || a.ts < first) continue;
      if (a.type !== 'halt' && a.type !== 'bullFlag' && a.type !== 'resume') continue;
      const time = toTime(Math.floor(a.ts / span) * span);
      if (a.type === 'halt') marks.push({ time, position: 'aboveBar', color: p.vwap, shape: 'square', text: 'H' });
      else if (a.type === 'resume') marks.push({ time, position: 'aboveBar', color: p.ema9, shape: 'circle', text: 'R' });
      else marks.push({ time, position: 'belowBar', color: p.up, shape: 'arrowUp', text: 'BF' });
    }
    // Tus compras y ventas de práctica.
    for (const f of fills ?? []) {
      if (f.ts < first) continue;
      const time = toTime(Math.floor(f.ts / span) * span);
      marks.push(
        f.side === 'buy'
          ? { time, position: 'belowBar', color: p.ema9, shape: 'arrowUp', text: `C ${f.shares}` }
          : { time, position: 'aboveBar', color: p.vwap, shape: 'arrowDown', text: `V ${f.shares}` },
      );
    }
    marks.sort((x, y) => (x.time as number) - (y.time as number));
    s.markers.setMarkers(marks);
  }, [detail, alerts, tf, themeKey, showMacd, position, fills]);

  return (
    <div className="chart">
      <div className="chart-bar">
        <div className="seg" role="group" aria-label="Temporalidad">
          {TIMEFRAMES.map(([x, label]) => (
            <button key={x} className={tf === x ? 'is-active' : ''} onClick={() => setTf(x)}>
              {label}
            </button>
          ))}
        </div>
        <span className="legend">
          <i className="lg vwap" />
          VWAP <i className="lg ema9" />
          EMA 9 <i className="lg ema20" />
          EMA 20
        </span>
        <button className={`chip ${showMacd ? 'is-active' : ''}`} onClick={() => setShowMacd((v) => !v)}>
          MACD
        </button>
      </div>
      <div className="chart-host" ref={host} />
      {!detail && <div className="chart-empty">Elegí una acción de cualquier lista para ver su gráfico.</div>}
    </div>
  );
}
