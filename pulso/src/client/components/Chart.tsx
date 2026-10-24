// Gráfico al estilo de las plantillas de 1 y 5 minutos de Ross Cameron: velas, volumen, VWAP, EMA 9,
// 20 y 200, MACD, sombreado del pre-market y del after-hours, cuenta regresiva del cierre de la vela,
// leyenda con OHLC, y tus órdenes, tu costo, tu stop y tu objetivo (lightweight-charts de TradingView).
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
import { fmtVolume } from '../../engine/alerts';
import { aggregateBars, aggregateSpan, emaSeries, macdSeries, vwapSeries } from '../../engine/indicators';
import { etOffset, etParts, POST_CLOSE, PRE_OPEN, REG_CLOSE, REG_OPEN } from '../../engine/time';
import type { Alert, Bar, SymbolDetail } from '../../engine/types';
import { load, save } from '../lib/storage';

interface Series {
  session: ISeriesApi<'Histogram'>;
  candles: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
  vwap: ISeriesApi<'Line'>;
  ema9: ISeriesApi<'Line'>;
  ema20: ISeriesApi<'Line'>;
  ema200: ISeriesApi<'Line'>;
  markers: ISeriesMarkersPluginApi<Time>;
  /** Panel inferior del MACD (solo si está visible). */
  macd?: { macd: ISeriesApi<'Line'>; signal: ISeriesApi<'Line'>; hist: ISeriesApi<'Histogram'> };
}

const LINE = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

/** Colores del gráfico (cambian con el tema claro u oscuro). */
function palette() {
  return {
    bg: css('--chart-bg'),
    text: css('--chart-text'),
    grid: css('--chart-grid'),
    up: css('--chart-up'),
    down: css('--chart-down'),
    vwap: css('--chart-vwap'),
    ema9: css('--chart-ema9'),
    ema20: css('--chart-ema20'),
    ema200: css('--chart-ema200'),
    pre: css('--chart-pre'),
    post: css('--chart-post'),
    macd: css('--chart-macd'),
    signal: css('--chart-signal'),
    faint: css('--faint'),
    accent: css('--accent'),
    info: css('--info'),
    warn: css('--warn'),
  };
}

function addMacd(chart: IChartApi, s: Series) {
  const p = palette();
  s.macd = {
    hist: chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 1),
    macd: chart.addSeries(LineSeries, { ...LINE, color: p.macd }, 1),
    signal: chart.addSeries(LineSeries, { ...LINE, color: p.signal }, 1),
  };
  // El precio ocupa ~78% del alto y el MACD ~22%.
  const panes = chart.panes();
  panes[0]?.setStretchFactor(3.5);
  panes[1]?.setStretchFactor(1);
}

function removeMacd(chart: IChartApi, s: Series) {
  if (!s.macd) return;
  chart.removeSeries(s.macd.hist);
  chart.removeSeries(s.macd.macd);
  chart.removeSeries(s.macd.signal);
  s.macd = undefined;
}

function applyTheme(chart: IChartApi, s: Series) {
  const p = palette();
  chart.applyOptions({
    layout: { background: { type: ColorType.Solid, color: p.bg }, textColor: p.text, panes: { separatorColor: p.grid } },
    grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
  });
  s.candles.applyOptions({ upColor: p.up, downColor: p.down, wickUpColor: p.up, wickDownColor: p.down });
  s.vwap.applyOptions({ color: p.vwap });
  s.ema9.applyOptions({ color: p.ema9 });
  s.ema20.applyOptions({ color: p.ema20 });
  s.ema200.applyOptions({ color: p.ema200 });
  s.macd?.macd.applyOptions({ color: p.macd });
  s.macd?.signal.applyOptions({ color: p.signal });
}

/** Desplaza el tiempo a la hora de pared de Nueva York: el gráfico muestra horas ET. */
const toTime = (t: number) => Math.floor((t + etOffset(t)) / 1000) as UTCTimestamp;

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

/** Órdenes vivas que se dibujan como líneas (límite o stop). */
export interface ChartOrder {
  side: 'buy' | 'sell';
  price: number;
  shares: number;
  kind: 'limit' | 'stop';
}

interface Props {
  /** Identifica el gráfico (recuerda la temporalidad elegida). */
  id: string;
  defaultTf: number;
  detail: SymbolDetail | null;
  alerts: Alert[];
  themeKey: string;
  now: number;
  /** Posición de práctica en la acción del gráfico (costo, stop y objetivo). */
  position?: ChartPosition;
  fills?: ChartFill[];
  orders?: ChartOrder[];
}

/** Temporalidades en segundos: las de 10 y 30 s salen de las velas de 10 s. */
const TIMEFRAMES: Array<[number, string]> = [
  [10, '10s'],
  [30, '30s'],
  [60, '1m'],
  [300, '5m'],
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

function sessionColor(t: number, p: ReturnType<typeof palette>): string {
  const m = etParts(t).minutes;
  if (m >= PRE_OPEN && m < REG_OPEN) return p.pre;
  if (m >= REG_CLOSE && m < POST_CLOSE) return p.post;
  return 'rgba(0,0,0,0)';
}

const fmt = (v: number) => (v >= 1 ? v.toFixed(2) : v.toFixed(4));

interface Legend {
  o: number;
  h: number;
  l: number;
  c: number;
  chg: number;
  chgPct: number;
  vol: number;
  e9?: number;
  e20?: number;
  e200?: number;
  vwap?: number;
}

/** Muestra las últimas velas (unas 110 de 1 minuto o menos, 70 de 5 minutos) con un margen a la derecha. */
function frameLast(chart: IChartApi, n: number, tf: number): void {
  if (n) chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - (tf === 300 ? 70 : 110)), to: n + 4 });
}

export function Chart({ id, defaultTf, detail, alerts, themeKey, now, position, fills, orders }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Series | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const stateRef = useRef<{ sym: string; tf: number; len: number; first: number }>({ sym: '', tf: 1, len: 0, first: 0 });
  const legendsRef = useRef<Legend[]>([]);
  const barsRef = useRef<Bar[]>([]);
  /** El encuadre inicial quedó pendiente porque el gráfico estaba oculto (pestañas del celular). */
  const pendingRange = useRef(false);
  const [tf, setTf] = useState<number>(() => load(`chart-tf-${id}`, defaultTf));
  const [showMacd, setShowMacd] = useState<boolean>(() => load(`chart-macd-${id}`, true));
  const [legendOpen, setLegendOpen] = useState<boolean>(() => load(`chart-legend-${id}`, true));
  const [hover, setHover] = useState<number | null>(null);
  const [labelY, setLabelY] = useState<number | null>(null);
  const [scaleW, setScaleW] = useState(56);

  useEffect(() => {
    if (!host.current) return;
    const p = palette();
    const chart = createChart(host.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: p.bg },
        textColor: p.text,
        fontFamily: "'Roboto', 'IBM Plex Sans', system-ui, sans-serif",
        fontSize: 11,
        attributionLogo: true,
        panes: { separatorColor: p.grid, enableResize: false },
      },
      grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4 },
    });
    // El sombreado de la sesión va primero (debajo de todo), en una escala propia de 0 a 1.
    const session = chart.addSeries(HistogramSeries, { priceScaleId: 'session', priceLineVisible: false, lastValueVisible: false, base: 0 });
    session.priceScale().applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
    const candles = chart.addSeries(CandlestickSeries, { upColor: p.up, downColor: p.down, wickUpColor: p.up, wickDownColor: p.down, borderVisible: false });
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const vwap = chart.addSeries(LineSeries, { ...LINE, lineWidth: 2, color: p.vwap });
    const ema200 = chart.addSeries(LineSeries, { ...LINE, color: p.ema200 });
    const ema20 = chart.addSeries(LineSeries, { ...LINE, color: p.ema20 });
    const ema9 = chart.addSeries(LineSeries, { ...LINE, color: p.ema9 });
    const markers = createSeriesMarkers(candles, []);
    chartRef.current = chart;
    seriesRef.current = { session, candles, volume, vwap, ema9, ema20, ema200, markers };
    // Oculto, el gráfico mide 0 de ancho y el encuadre comprimiría las velas: se hace al aparecer.
    chart.timeScale().subscribeSizeChange((w) => {
      if (w < 20 || !pendingRange.current) return;
      pendingRange.current = false;
      frameLast(chart, barsRef.current.length, stateRef.current.tf);
    });
    chart.subscribeCrosshairMove((param) => {
      if (param.time === undefined || !param.point) return setHover(null);
      const i = barsRef.current.findIndex((b) => toTime(b.t) === param.time);
      setHover(i >= 0 ? i : null);
    });
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
      for (const series of [s.session, s.candles, s.volume, s.vwap, s.ema9, s.ema20, s.ema200]) series.setData([]);
      if (s.macd) for (const series of [s.macd.macd, s.macd.signal, s.macd.hist]) series.setData([]);
      stateRef.current = { sym: '', tf, len: 0, first: 0 };
      barsRef.current = [];
      legendsRef.current = [];
      setLabelY(null);
      return;
    }
    chart.applyOptions({ timeScale: { secondsVisible: tf < 60 } });
    const bars: Bar[] = frame.bars;
    const closes = bars.map((b) => b.c);
    const vw = frame.vwap;
    const e9 = emaSeries(closes, 9);
    const e20 = emaSeries(closes, 20);
    const e200 = emaSeries(closes, 200);
    const m = macdSeries(closes);
    const p = palette();
    const precision = detail.row.price >= 1 ? 2 : 4;
    const st = stateRef.current;
    const same = st.sym === detail.sym && st.tf === tf && st.first === bars[0].t && (bars.length === st.len || bars.length === st.len + 1);
    const volColor = (b: Bar) => (b.c >= b.o ? `${p.up}80` : `${p.down}80`);
    const histColor = (v: number, prev: number) => (v >= 0 ? (v >= prev ? '#26a69a' : '#b2dfdb') : v <= prev ? '#ff5252' : '#ffcdd2');
    // La EMA 200 recién vale con 200 velas.
    const e200At = (i: number) => (i >= 199 ? e200[i] : undefined);

    if (!same) {
      s.candles.applyOptions({ priceFormat: { type: 'price', precision, minMove: precision === 2 ? 0.01 : 0.0001 } });
      s.session.setData(bars.map((b) => ({ time: toTime(b.t), value: 1, color: sessionColor(b.t, p) })));
      s.candles.setData(bars.map((b) => ({ time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));
      s.volume.setData(bars.map((b) => ({ time: toTime(b.t), value: b.v, color: volColor(b) })));
      s.vwap.setData(bars.map((b, i) => ({ time: toTime(b.t), value: vw[i] })));
      s.ema9.setData(bars.map((b, i) => ({ time: toTime(b.t), value: e9[i] })));
      s.ema20.setData(bars.map((b, i) => ({ time: toTime(b.t), value: e20[i] })));
      s.ema200.setData(bars.flatMap((b, i) => (e200At(i) === undefined ? [] : [{ time: toTime(b.t), value: e200[i] }])));
      if (s.macd) {
        s.macd.macd.setData(bars.map((b, i) => ({ time: toTime(b.t), value: m.macd[i] })));
        s.macd.signal.setData(bars.map((b, i) => ({ time: toTime(b.t), value: m.signal[i] })));
        s.macd.hist.setData(bars.map((b, i) => ({ time: toTime(b.t), value: m.hist[i], color: histColor(m.hist[i], m.hist[i - 1] ?? 0) })));
      }
      if (st.sym !== detail.sym || st.tf !== tf) {
        if ((host.current?.clientWidth ?? 0) < 20) pendingRange.current = true;
        else frameLast(chart, bars.length, tf);
      }
    } else {
      // update() solo acepta la última vela o una nueva: si apareció una vela, se cierra la anterior y se agrega.
      const from = bars.length === st.len ? bars.length - 1 : bars.length - 2;
      for (let i = Math.max(0, from); i < bars.length; i++) {
        const b = bars[i];
        const time = toTime(b.t);
        s.session.update({ time, value: 1, color: sessionColor(b.t, p) });
        s.candles.update({ time, open: b.o, high: b.h, low: b.l, close: b.c });
        s.volume.update({ time, value: b.v, color: volColor(b) });
        s.vwap.update({ time, value: vw[i] });
        s.ema9.update({ time, value: e9[i] });
        s.ema20.update({ time, value: e20[i] });
        if (e200At(i) !== undefined) s.ema200.update({ time, value: e200[i] });
        if (s.macd) {
          s.macd.macd.update({ time, value: m.macd[i] });
          s.macd.signal.update({ time, value: m.signal[i] });
          s.macd.hist.update({ time, value: m.hist[i], color: histColor(m.hist[i], m.hist[i - 1] ?? 0) });
        }
      }
    }
    stateRef.current = { sym: detail.sym, tf, len: bars.length, first: bars[0].t };
    barsRef.current = bars;
    legendsRef.current = bars.map((b, i) => {
      const prev = i > 0 ? bars[i - 1].c : b.o;
      return { o: b.o, h: b.h, l: b.l, c: b.c, chg: b.c - prev, chgPct: prev ? ((b.c - prev) / prev) * 100 : 0, vol: b.v, e9: e9[i], e20: e20[i], e200: e200At(i), vwap: vw[i] };
    });

    // Líneas de precio: máximo del día, máximo pre-market, cierre anterior, el plan del bull flag,
    // tu posición y tus órdenes.
    for (const l of linesRef.current) s.candles.removePriceLine(l);
    const lines: IPriceLine[] = [];
    const add = (price: number, color: string, title: string, style: LineStyle, width: 1 | 2 = 1) => {
      if (price > 0) lines.push(s.candles.createPriceLine({ price, color, title, lineStyle: style, lineWidth: width, axisLabelVisible: true }));
    };
    add(detail.row.hod, p.up, 'HOD', LineStyle.Dashed);
    if (detail.pmHigh > 0 && Math.abs(detail.pmHigh - detail.row.hod) > 1e-9) add(detail.pmHigh, p.accent, 'PMH', LineStyle.Dotted);
    add(detail.row.prevClose, p.faint, 'Cierre ant.', LineStyle.Dotted);
    if (position) {
      add(position.avgCost, p.info, `Tu costo (${position.shares})`, LineStyle.Solid, 2);
      if (position.stop) add(position.stop, p.down, 'Tu stop', LineStyle.Solid);
      if (position.target) add(position.target, p.up, 'Tu objetivo', LineStyle.Solid);
    } else if (detail.setup.flag) {
      add(detail.setup.flag.entry, p.ema9, 'Entrada BF', LineStyle.Dashed);
      add(detail.setup.flag.stop, p.down, 'Stop BF', LineStyle.Dashed);
    }
    for (const o of orders ?? []) {
      add(o.price, o.side === 'buy' ? p.info : p.warn, `${o.side === 'buy' ? 'C' : 'V'} ${o.shares}${o.kind === 'stop' ? ' stop' : ''}`, LineStyle.LargeDashed);
    }
    linesRef.current = lines;

    // Marcas de halts y bull flags del símbolo, y tus compras (C) y ventas (V).
    const first = bars[0].t;
    const span = tf * 1000;
    const marks: SeriesMarker<Time>[] = [];
    for (const a of alerts) {
      if (a.sym !== detail.sym || a.ts < first) continue;
      if (a.type !== 'halt' && a.type !== 'bullFlag' && a.type !== 'resume') continue;
      const time = toTime(Math.floor(a.ts / span) * span);
      if (a.type === 'halt') marks.push({ time, position: 'aboveBar', color: p.warn, shape: 'square', text: 'H' });
      else if (a.type === 'resume') marks.push({ time, position: 'aboveBar', color: p.info, shape: 'circle', text: 'R' });
      else marks.push({ time, position: 'belowBar', color: p.up, shape: 'arrowUp', text: 'BF' });
    }
    for (const f of fills ?? []) {
      if (f.ts < first) continue;
      const time = toTime(Math.floor(f.ts / span) * span);
      marks.push(
        f.side === 'buy'
          ? { time, position: 'belowBar', color: p.info, shape: 'arrowUp', text: `C ${f.shares}` }
          : { time, position: 'aboveBar', color: p.warn, shape: 'arrowDown', text: `V ${f.shares}` },
      );
    }
    marks.sort((x, y) => (x.time as number) - (y.time as number));
    s.markers.setMarkers(marks);

    // Posición de la cuenta regresiva: debajo de la etiqueta del último precio.
    const y = s.candles.priceToCoordinate(bars[bars.length - 1].c);
    setLabelY(y === null ? null : y);
    setScaleW(chart.priceScale('right').width());
  }, [detail, alerts, tf, themeKey, showMacd, position, fills, orders]);

  const changeTf = (x: number) => {
    setTf(x);
    save(`chart-tf-${id}`, x);
  };
  const toggleMacd = () => {
    setShowMacd((v) => {
      save(`chart-macd-${id}`, !v);
      return !v;
    });
  };

  const legends = legendsRef.current;
  const lg = legends.length ? legends[hover ?? legends.length - 1] ?? legends[legends.length - 1] : null;
  const bars = barsRef.current;
  const lastBar = bars[bars.length - 1];
  const span = tf * 1000;
  // Lo que falta para que cierre la vela en curso (aunque todavía no haya operado en ella).
  const remain = span - (now % span);
  const countdown = `${String(Math.floor(remain / 60000)).padStart(2, '0')}:${String(Math.floor((remain % 60000) / 1000)).padStart(2, '0')}`;
  const tfLabel = TIMEFRAMES.find(([x]) => x === tf)?.[1] ?? '';
  const ref = detail?.ref;
  const mcap = ref?.sharesOutstanding && detail ? ref.sharesOutstanding * detail.row.price : undefined;
  const up = lg ? lg.c >= lg.o : true;

  return (
    <div className="chart">
      <div className="chart-bar">
        <span className="chart-sym">{detail?.sym ?? '—'}</span>
        <div className="seg" role="group" aria-label="Temporalidad">
          {TIMEFRAMES.map(([x, label]) => (
            <button key={x} className={tf === x ? 'is-active' : ''} onClick={() => changeTf(x)}>
              {label}
            </button>
          ))}
        </div>
        <button className={`chip ${showMacd ? 'is-active' : ''}`} onClick={toggleMacd} aria-pressed={showMacd}>
          MACD
        </button>
      </div>
      <div className="chart-wrap">
        <div className="chart-host" ref={host} />
        {detail && lg && (
          <div className="chart-legend">
            <div className="lg-row">
              <b>
                {detail.sym} · {tfLabel}
              </b>
              <span className={up ? 't-cup' : 't-cdown'}>
                O<em>{fmt(lg.o)}</em> H<em>{fmt(lg.h)}</em> L<em>{fmt(lg.l)}</em> C<em>{fmt(lg.c)}</em> {lg.chg >= 0 ? '+' : ''}
                {fmt(lg.chg)} ({lg.chgPct >= 0 ? '+' : ''}
                {lg.chgPct.toFixed(2)}%)
              </span>
              <button
                type="button"
                className="lg-toggle"
                onClick={() => {
                  save(`chart-legend-${id}`, !legendOpen);
                  setLegendOpen(!legendOpen);
                }}
                aria-expanded={legendOpen}
                aria-label={legendOpen ? 'Ocultar indicadores de la leyenda' : 'Mostrar indicadores de la leyenda'}
              >
                {legendOpen ? '▴' : '▾'}
              </button>
            </div>
            {legendOpen && (
              <>
                {(detail.row.float !== undefined || mcap !== undefined) && (
                  <div className="lg-row">
                    {detail.row.float !== undefined && (
                      <>
                        Float <em className="lg-float">{fmtVolume(detail.row.float)}</em>
                      </>
                    )}
                    {mcap !== undefined && (
                      <>
                        {' '}
                        Market Cap <em className="lg-mcap">{fmtVolume(mcap)}</em>
                      </>
                    )}
                  </div>
                )}
                <div className="lg-row">
                  EMA 9 <em className="lg-ema9">{lg.e9 !== undefined ? fmt(lg.e9) : '—'}</em> 20 <em className="lg-ema20">{lg.e20 !== undefined ? fmt(lg.e20) : '—'}</em> 200{' '}
                  <em className="lg-ema200">{lg.e200 !== undefined ? fmt(lg.e200) : '—'}</em>
                </div>
                <div className="lg-row">
                  VWAP <em className="lg-vwap">{lg.vwap !== undefined ? fmt(lg.vwap) : '—'}</em> Volumen <em className={up ? 't-cup' : 't-cdown'}>{fmtVolume(lg.vol)}</em>
                </div>
              </>
            )}
          </div>
        )}
        {detail && labelY !== null && lastBar && (
          <span className="chart-countdown mono" style={{ top: labelY + 10, width: scaleW }} title="Tiempo para que cierre la vela">
            {countdown}
          </span>
        )}
      </div>
      {!detail && <div className="chart-empty">Elegí una acción de cualquier lista para ver su gráfico.</div>}
    </div>
  );
}
