// Gráfico al estilo de las plantillas de 1 y 5 minutos de Ross Cameron: velas, volumen, VWAP, EMA 9,
// 20 y 200, MACD, sombreado del pre-market y del after-hours, cuenta regresiva del cierre de la vela,
// leyenda con OHLC, y tus órdenes, tu costo, tu stop y tu objetivo (lightweight-charts de TradingView).
import { memo, useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  createTextWatermark,
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
import { daily, fourHour, historyFor, monthly, TF_4H, TF_DAY, TF_MONTH, TF_WEEK, todayBar, vwapByDay, weekly, withPastDays, type HistoryTf } from '../../engine/history';
import { aggregateBars, aggregateSpan, vwapSeries } from '../../engine/indicators';
import { etOffset, etParts, POST_CLOSE, PRE_OPEN, REG_CLOSE, REG_OPEN } from '../../engine/time';
import type { Alert, Bar, SymbolDetail } from '../../engine/types';
import { addDrawing, clearDrawings, removeDrawing, restoreDrawing, toggleAlert, updateDrawing, useDrawings, type Drawing, type TLine } from '../lib/drawings';
import { fmtPrice, fmtVolume } from '../lib/format';
import { typing } from '../lib/hotkeys';
import { IncrementalIndicators } from '../lib/incremental';
import { readNow, useNow } from '../lib/now';
import { load, save } from '../lib/storage';
import { dismissToast, pushToast } from '../lib/toast';
import { TrendLinesPrimitive } from './TrendLines';

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

/** "#rrggbb" → "rgba(r, g, b, a)" (si no es un hex, se devuelve tal cual). */
function withAlpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const WATERMARK_LABEL: Record<number, string> = { 10: '10 SEG', 30: '30 SEG', 60: '1 MIN', 300: '5 MIN', [TF_4H]: '4 HORAS', [TF_DAY]: 'DIARIO', [TF_WEEK]: 'SEMANAL', [TF_MONTH]: 'MENSUAL' };

type Palette = ReturnType<typeof readPalette>;
const paletteCache = new Map<string, Palette>();

/** Colores del gráfico, leídos una vez por tema (cada lectura de una variable CSS cuesta un getComputedStyle). */
function palette(themeKey: string): Palette {
  let p = paletteCache.get(themeKey);
  if (!p) {
    p = readPalette();
    paletteCache.set(themeKey, p);
  }
  return p;
}

function readPalette() {
  return {
    bg: css('--chart-bg'),
    text: css('--chart-text'),
    grid: css('--chart-grid'),
    up: css('--chart-up'),
    down: css('--chart-down'),
    hod: css('--chart-hod'),
    draw: css('--chart-draw'),
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

function addMacd(chart: IChartApi, s: Series, p: Palette) {
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

function applyTheme(chart: IChartApi, s: Series, p: Palette) {
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
  /** Largo (compra) o corto (venta): cambia el color de la línea del costo; el stop queda arriba y el objetivo abajo. */
  side?: 'long' | 'short';
  avgCost: number;
  shares: number;
  stop?: number;
  target?: number;
  /** Stop y objetivo del plan (sin órdenes): se dibujan punteados. */
  planStop?: number;
  planTarget?: number;
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
  /** Posición de práctica en la acción del gráfico (costo, stop y objetivo). */
  position?: ChartPosition;
  fills?: ChartFill[];
  orders?: ChartOrder[];
  /** Historia (días anteriores, horas, días) para las temporalidades que la necesitan. */
  loadHistory?: (sym: string, tf: HistoryTf) => Promise<Bar[]>;
}

/** Historia cargada para un símbolo, por tipo. */
interface HistoryBars {
  sym: string;
  minute?: Bar[];
  hour?: Bar[];
  day?: Bar[];
}

/**
 * Temporalidades en segundos: las de 10 y 30 s salen de las velas de 10 s; 1 y 5 min, de las velas de 1
 * min (con los días anteriores de la historia); 4 h, diaria, semanal y mensual, de la historia más el día.
 */
const TIMEFRAMES: Array<[number, string]> = [
  [10, '10s'],
  [30, '30s'],
  [60, '1m'],
  [300, '5m'],
  [TF_4H, '4h'],
  [TF_DAY, 'D'],
  [TF_WEEK, 'S'],
  [TF_MONTH, 'M'],
];

/** Velas de la temporalidad elegida y su VWAP (el del día, reiniciado cada día; sin VWAP en las diarias). */
function framed(detail: SymbolDetail, tf: number, hist: HistoryBars | null, now: number): { bars: Bar[]; vwap: number[] } {
  const h = hist && hist.sym === detail.sym ? hist : null;
  if (tf >= TF_DAY) {
    const r = detail.row;
    const today = todayBar({ open: detail.open, high: r.hod, low: detail.lod, last: r.price, volume: r.volume, vwap: r.vwap, ts: now });
    const d = daily(h?.day ?? [], today);
    return { bars: tf >= TF_MONTH ? monthly(d) : tf >= TF_WEEK ? weekly(d) : d, vwap: [] };
  }
  if (tf >= TF_4H) {
    const bars = fourHour(h?.hour ?? [], detail.bars);
    return { bars, vwap: vwapByDay(bars) };
  }
  if (tf >= 60) {
    const bars = aggregateBars(withPastDays(h?.minute ?? [], detail.bars), tf / 60);
    return { bars, vwap: vwapByDay(bars) };
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

function sessionColor(t: number, p: Palette): string {
  const m = etParts(t).minutes;
  if (m >= PRE_OPEN && m < REG_OPEN) return p.pre;
  if (m >= REG_CLOSE && m < POST_CLOSE) return p.post;
  return 'rgba(0,0,0,0)';
}

const fmt = fmtPrice;

/** Borra una línea con un aviso de 5 segundos para deshacerlo. */
function removeWithUndo(sym: string, id: string): void {
  const removed = removeDrawing(sym, id);
  if (!removed) return;
  const d = removed.drawing;
  const what = d.kind === 'h' ? `${d.alert ? 'Alerta' : 'Línea'} en ${fmt(d.price)}` : `Línea de tendencia ${fmt(d.a.price)} → ${fmt(d.b.price)}`;
  const toast = pushToast(`${what} borrada`, 'info', {
    ms: 5000,
    action: {
      label: 'Deshacer',
      run: () => {
        restoreDrawing(sym, d, removed.index);
        dismissToast(toast);
      },
    },
  });
}

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

/** Muestra las últimas velas (unas 110 de 1 minuto o menos, 70 de 5 minutos, más en las largas) con un margen a la derecha. */
function frameLast(chart: IChartApi, n: number, tf: number): void {
  const count = tf === 300 ? 70 : tf >= TF_DAY ? 160 : tf >= TF_4H ? 120 : 110;
  if (n) chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - count), to: n + 4 });
}

/** Cuenta regresiva para que cierre la vela en curso (aunque todavía no haya operado en ella). */
function CandleCountdown({ span, top, width }: { span: number; top: number; width: number }) {
  const now = useNow(1000);
  const remain = span - (now % span);
  const text = `${String(Math.floor(remain / 60000)).padStart(2, '0')}:${String(Math.floor((remain % 60000) / 1000)).padStart(2, '0')}`;
  return (
    <span className="chart-countdown mono" style={{ top, width }} title="Tiempo para que cierre la vela">
      {text}
    </span>
  );
}

function ChartView({ id, defaultTf, detail, alerts, themeKey, position, fills, orders, loadHistory }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Series | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const watermarkRef = useRef<{ applyOptions(o: { lines: Array<{ text: string; color?: string }> }): void } | null>(null);
  const stateRef = useRef<{ sym: string; tf: number; len: number; first: number }>({ sym: '', tf: 1, len: 0, first: 0 });
  const legendsRef = useRef<Legend[]>([]);
  const barsRef = useRef<Bar[]>([]);
  /** EMA y MACD por símbolo y temporalidad: con velas nuevas al final se extienden en vez de recalcularse. */
  const indRef = useRef<IncrementalIndicators | null>(null);
  if (!indRef.current) indRef.current = new IncrementalIndicators();
  /** El encuadre inicial quedó pendiente porque el gráfico estaba oculto (pestañas del celular). */
  const pendingRange = useRef(false);
  const [tf, setTf] = useState<number>(() => load(`chart-tf-${id}`, defaultTf));
  const [showMacd, setShowMacd] = useState<boolean>(() => load(`chart-macd-${id}`, true));
  const [legendOpen, setLegendOpen] = useState<boolean>(() => load(`chart-legend-${id}`, true));
  const [hover, setHover] = useState<number | null>(null);
  const [labelY, setLabelY] = useState<number | null>(null);
  const [scaleW, setScaleW] = useState(56);
  // Dibujo: línea horizontal, alerta de precio o línea de tendencia (dos puntos); Esc cancela.
  const [tool, setTool] = useState<'h' | 'alert' | 't' | null>(null);
  const [pending, setPending] = useState<{ t: number; price: number } | null>(null);
  const [showList, setShowList] = useState(false);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const symRef = useRef<string | null>(null);
  symRef.current = detail?.sym ?? null;
  const primRef = useRef<TrendLinesPrimitive | null>(null);
  const userLinesRef = useRef<IPriceLine[]>([]);
  const drawings = useDrawings(detail?.sym);
  const [hist, setHist] = useState<HistoryBars | null>(null);
  const histRef = useRef<HistoryBars | null>(null);
  histRef.current = hist;

  // La historia se pide una vez por símbolo y tipo, recién cuando una temporalidad la necesita.
  useEffect(() => {
    const sym = detail?.sym;
    const need = historyFor(tf);
    if (!sym || !need || !loadHistory) return;
    const cur = histRef.current;
    if (cur && cur.sym === sym && cur[need]) return;
    let alive = true;
    void loadHistory(sym, need).then((bars) => {
      if (!alive) return;
      setHist((h) => ({ ...(h && h.sym === sym ? h : { sym }), [need]: bars }));
    });
    return () => {
      alive = false;
    };
  }, [detail?.sym, tf, loadHistory]);

  useEffect(() => {
    if (!host.current) return;
    const p = palette(themeKey);
    const chart = createChart(host.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: p.bg },
        textColor: p.text,
        fontFamily: "'Roboto', 'IBM Plex Sans', system-ui, sans-serif",
        fontSize: 11,
        // El logo lleva un id fijo en la página: lo muestra solo el primer gráfico.
        attributionLogo: id === 'a',
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
    // Líneas de tendencia dibujadas sobre las velas.
    const prim = new TrendLinesPrimitive(() => {
      const bars = barsRef.current;
      if (!bars.length) return null;
      return { first: toTime(bars[0].t), last: toTime(bars[bars.length - 1].t), lastIndex: bars.length - 1, tf: stateRef.current.tf };
    });
    candles.attachPrimitive(prim);
    primRef.current = prim;
    chart.subscribeClick((param) => {
      const tool = toolRef.current;
      const sym = symRef.current;
      if (!tool || !sym || !param.point) return;
      const raw = candles.coordinateToPrice(param.point.y);
      if (raw === null || raw <= 0) return;
      const price = raw >= 1 ? Math.round(raw * 100) / 100 : Math.round(raw * 10000) / 10000;
      if (tool === 'h' || tool === 'alert') {
        addDrawing(sym, { kind: 'h', price, alert: tool === 'alert' });
        setTool(null);
        return;
      }
      // Línea de tendencia: el instante del clic, también a la derecha de la última vela.
      let t: number | null = typeof param.time === 'number' ? param.time : null;
      if (t === null && param.logical !== undefined) {
        const bars = barsRef.current;
        if (bars.length) t = toTime(bars[bars.length - 1].t) + (param.logical - (bars.length - 1)) * stateRef.current.tf;
      }
      if (t === null) return;
      const p = pendingRef.current;
      if (!p) {
        setPending({ t, price });
        return;
      }
      addDrawing(sym, { kind: 't', a: p, b: { t, price } });
      setPending(null);
      setTool(null);
    });
    // El símbolo y la temporalidad de fondo, como en las plataformas de day trading.
    const watermark = createTextWatermark(chart.panes()[0], {
      horzAlign: 'center',
      vertAlign: 'center',
      lines: [{ text: '', color: withAlpha(p.text, 0.1), fontSize: 46, fontStyle: 'bold', fontFamily: "'Roboto', system-ui, sans-serif" }],
    });
    watermarkRef.current = watermark;
    chartRef.current = chart;
    seriesRef.current = { session, candles, volume, vwap, ema9, ema20, ema200, markers };
    // Oculto, el gráfico mide 0 de ancho y el encuadre comprimiría las velas: se hace al aparecer.
    chart.timeScale().subscribeSizeChange((w) => {
      if (w < 20 || !pendingRange.current) return;
      pendingRange.current = false;
      frameLast(chart, barsRef.current.length, stateRef.current.tf);
    });
    chart.subscribeCrosshairMove((param) => {
      if (param.time === undefined || !param.point || param.logical === undefined) return setHover(null);
      // El índice lógico es la posición de la vela en los datos: no hace falta buscarla.
      const i = Math.round(param.logical);
      setHover(i >= 0 && i < barsRef.current.length ? i : null);
    });
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      linesRef.current = [];
    };
    // Se crea una sola vez; el tema y el id no cambian en vivo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (chartRef.current && seriesRef.current) applyTheme(chartRef.current, seriesRef.current, palette(themeKey));
    stateRef.current.len = -1;
  }, [themeKey]);

  // Tus líneas: las horizontales como líneas de precio (con la campana si tienen alerta) y las de
  // tendencia en el dibujo sobre las velas.
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    for (const l of userLinesRef.current) s.candles.removePriceLine(l);
    userLinesRef.current = [];
    const color = palette(themeKey).draw;
    const sym = detail?.sym;
    const tlines: TLine[] = [];
    if (sym) {
      for (const d of drawings) {
        if (d.kind === 't') tlines.push(d);
        else {
          userLinesRef.current.push(
            s.candles.createPriceLine({ price: d.price, color, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: d.alert ? (d.fired ? '🔔 ✓' : '🔔') : '' }),
          );
        }
      }
    }
    primRef.current?.update(tlines, color, pending);
  }, [drawings, detail?.sym, themeKey, pending]);

  useEffect(() => {
    if (!tool) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTool(null);
        setPending(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool]);

  // Borrar líneas: clic derecho (o toque largo) sobre una línea la borra; con el mouse sobre el gráfico,
  // Supr o Retroceso borra la última que dibujaste.
  const hoveringRef = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hoveringRef.current || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
      // Mientras escribís en un campo, Supr borra texto, no líneas.
      if (typing(e.target) || typing(document.activeElement)) return;
      const sym = symRef.current;
      if (!sym) return;
      const list = drawingsRef.current;
      if (!list.length) return;
      e.preventDefault();
      removeWithUndo(sym, list[list.length - 1].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;

  // Arrastrar líneas con el mouse: una horizontal sube o baja; una de tendencia se mueve entera o por un
  // extremo (si se agarra cerca de él). Mientras se arrastra, el gráfico no se desplaza ni se escala.
  const dragRef = useRef<{ id: string; part: 'h' | 'a' | 'b' | 'both'; orig: Drawing; price0: number; t0: number } | null>(null);
  const roundPrice = (raw: number) => (raw >= 1 ? Math.round(raw * 100) / 100 : Math.round(raw * 10000) / 10000);
  /** Instante del gráfico (segundos) en la coordenada x, también a la derecha de la última vela. */
  const timeAtX = (x: number): number | null => {
    const chart = chartRef.current;
    const bars = barsRef.current;
    if (!chart || !bars.length) return null;
    const logical = chart.timeScale().coordinateToLogical(x);
    if (logical === null) return null;
    return toTime(bars[bars.length - 1].t) + (logical - (bars.length - 1)) * stateRef.current.tf;
  };
  const lineAt = (x: number, y: number): { d: Drawing; part: 'h' | 'a' | 'b' | 'both' } | null => {
    const s = seriesRef.current;
    const el = host.current;
    if (!s || !el) return null;
    let best: { d: Drawing; dist: number } | null = null;
    for (const d of drawingsRef.current) {
      if (d.kind !== 'h') continue;
      const py = s.candles.priceToCoordinate(d.price);
      if (py === null) continue;
      const dist = Math.abs(py - y);
      if (dist <= 7 && (!best || dist < best.dist)) best = { d, dist };
    }
    if (best) return { d: best.d, part: 'h' };
    const prim = primRef.current;
    const t = prim?.lineNear(x, y, el.clientWidth);
    if (!prim || !t) return null;
    return { d: t, part: prim.endpointNear(t, x, y) ?? 'both' };
  };
  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || toolRef.current || !symRef.current || !drawingsRef.current.length) return;
    const el = host.current;
    const s = seriesRef.current;
    const chart = chartRef.current;
    if (!el || !s || !chart) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = lineAt(x, y);
    if (!hit) return;
    e.preventDefault();
    const price0 = s.candles.coordinateToPrice(y) ?? 0;
    dragRef.current = { id: hit.d.id, part: hit.part, orig: hit.d, price0, t0: timeAtX(x) ?? 0 };
    chart.applyOptions({ handleScroll: false, handleScale: false });
    el.classList.add('is-dragging');
    const sym = symRef.current;
    const move = (ev: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const px = s.candles.coordinateToPrice(ev.clientY - rect.top);
      const t = timeAtX(ev.clientX - rect.left);
      if (px === null || px <= 0) return;
      const price = roundPrice(px);
      if (drag.orig.kind === 'h') {
        updateDrawing(sym, drag.id, { price });
        return;
      }
      if (t === null) return;
      if (drag.part === 'a' || drag.part === 'b') {
        updateDrawing(sym, drag.id, { [drag.part]: { t, price } } as Partial<TLine>);
        return;
      }
      const dp = roundPrice(px) - roundPrice(drag.price0);
      const dt = Math.round((t - drag.t0) / stateRef.current.tf) * stateRef.current.tf;
      updateDrawing(sym, drag.id, {
        a: { t: drag.orig.a.t + dt, price: roundPrice(drag.orig.a.price + dp) },
        b: { t: drag.orig.b.t + dt, price: roundPrice(drag.orig.b.price + dp) },
      });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      dragRef.current = null;
      chart.applyOptions({ handleScroll: true, handleScale: true });
      el.classList.remove('is-dragging');
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  // Doble clic en el eje de precios: vuelve a la escala automática; en el eje de tiempo: encuadra las
  // últimas velas; en el medio: las dos cosas.
  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = host.current;
    const chart = chartRef.current;
    const s = seriesRef.current;
    if (!el || !chart || !s || toolRef.current) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const onPriceAxis = x >= rect.width - chart.priceScale('right').width();
    const onTimeAxis = y >= rect.height - chart.timeScale().height();
    if (onPriceAxis || !onTimeAxis) s.candles.priceScale().applyOptions({ autoScale: true });
    if (onTimeAxis || !onPriceAxis) frameLast(chart, barsRef.current.length, stateRef.current.tf);
  };
  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    const sym = symRef.current;
    const s = seriesRef.current;
    const el = host.current;
    if (!sym || !s || !el || !drawingsRef.current.length) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Primero las horizontales (por distancia en píxeles al precio), después las de tendencia.
    let victim: string | null = null;
    let best = 8;
    for (const d of drawingsRef.current) {
      if (d.kind !== 'h') continue;
      const py = s.candles.priceToCoordinate(d.price);
      if (py === null) continue;
      const dist = Math.abs(py - y);
      if (dist <= best) {
        best = dist;
        victim = d.id;
      }
    }
    if (!victim) victim = primRef.current?.lineNear(x, y, rect.width)?.id ?? null;
    if (!victim) return;
    e.preventDefault();
    removeWithUndo(sym, victim);
  };

  useEffect(() => {
    const chart = chartRef.current;
    const s = seriesRef.current;
    if (!chart || !s) return;
    if (showMacd && !s.macd) addMacd(chart, s, palette(themeKey));
    if (!showMacd) removeMacd(chart, s);
    stateRef.current.len = -1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMacd]);

  // ---- Marcas (halts, bull flags, tus compras y ventas): cuando cambian las alertas o las
  // ejecuciones, y cuando el gráfico se arma de nuevo (otra acción, otra temporalidad, más historia).
  const applyMarkers = () => {
    const s = seriesRef.current;
    const bars = barsRef.current;
    const sym = symRef.current;
    if (!s) return;
    if (!sym || !bars.length) return s.markers.setMarkers([]);
    const p = palette(themeKey);
    const first = bars[0].t;
    const span = tf * 1000;
    // En las temporalidades largas la vela que contiene un instante es la última que empieza antes.
    const bucket = (ts: number): number => {
      if (tf < TF_4H) return Math.floor(ts / span) * span;
      let lo = 0;
      let hi = bars.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (bars[mid].t <= ts) lo = mid;
        else hi = mid - 1;
      }
      return bars[lo].t;
    };
    const marks: SeriesMarker<Time>[] = [];
    for (const a of alerts) {
      if (a.sym !== sym || a.ts < first) continue;
      if (a.type !== 'halt' && a.type !== 'bullFlag' && a.type !== 'resume' && a.type !== 'priceLine') continue;
      const time = toTime(bucket(a.ts));
      if (a.type === 'priceLine') marks.push({ time, position: 'aboveBar', color: p.draw, shape: 'circle', text: '🔔' });
      else if (a.type === 'halt') marks.push({ time, position: 'aboveBar', color: p.warn, shape: 'square', text: 'H' });
      else if (a.type === 'resume') marks.push({ time, position: 'aboveBar', color: p.info, shape: 'circle', text: 'R' });
      else marks.push({ time, position: 'belowBar', color: p.up, shape: 'arrowUp', text: 'BF' });
    }
    for (const f of fills ?? []) {
      if (f.ts < first) continue;
      const time = toTime(bucket(f.ts));
      marks.push(
        f.side === 'buy'
          ? { time, position: 'belowBar', color: p.info, shape: 'arrowUp', text: `C ${f.shares}` }
          : { time, position: 'aboveBar', color: p.warn, shape: 'arrowDown', text: `V ${f.shares}` },
      );
    }
    marks.sort((x, y) => (x.time as number) - (y.time as number));
    s.markers.setMarkers(marks);
  };
  const applyMarkersRef = useRef(applyMarkers);
  applyMarkersRef.current = applyMarkers;
  const sym = detail?.sym;
  useEffect(() => {
    applyMarkersRef.current();
  }, [alerts, fills, sym, tf, themeKey]);

  // ---- Velas, volumen, VWAP, EMAs y MACD: cuando llegan velas (otra acción, otra temporalidad, historia).
  useEffect(() => {
    const s = seriesRef.current;
    const chart = chartRef.current;
    if (!s || !chart) return;
    // La vela diaria de hoy se fecha con la hora del mercado (la del simulador o la del servidor).
    const frame = detail ? framed(detail, tf, hist, readNow() || detail.row.lastTs || Date.now()) : null;
    if (!detail || !frame || !frame.bars.length) {
      for (const series of [s.session, s.candles, s.volume, s.vwap, s.ema9, s.ema20, s.ema200]) series.setData([]);
      if (s.macd) for (const series of [s.macd.macd, s.macd.signal, s.macd.hist]) series.setData([]);
      stateRef.current = { sym: '', tf, len: 0, first: 0 };
      watermarkRef.current?.applyOptions({ lines: [{ text: '' }] });
      barsRef.current = [];
      legendsRef.current = [];
      s.markers.setMarkers([]);
      setLabelY(null);
      return;
    }
    chart.applyOptions({ timeScale: { secondsVisible: tf < 60, timeVisible: tf < TF_DAY } });
    const bars: Bar[] = frame.bars;
    const closes = bars.map((b) => b.c);
    const vw = frame.vwap;
    const hasVwap = vw.length === bars.length;
    const p = palette(themeKey);
    const shade = (b: Bar) => (tf < TF_4H ? sessionColor(b.t, p) : 'rgba(0,0,0,0)');
    const ind = indRef.current!;
    const changedFrom = ind.update(`${detail.sym}|${tf}`, closes);
    const { e9, e20, e200 } = ind.series;
    const m = ind.series;
    const precision = detail.row.price >= 1 ? 2 : 4;
    const st = stateRef.current;
    // Mismas velas de antes con una nueva (o la última cambiada): se actualizan solo esas. Si cambiaron
    // velas viejas (relleno de historia), los indicadores se recalcularon desde el principio y se vuelve a cargar todo.
    const same = st.sym === detail.sym && st.tf === tf && st.first === bars[0].t && (bars.length === st.len || bars.length === st.len + 1) && changedFrom >= bars.length - 2;
    const volColor = (b: Bar) => (b.c >= b.o ? `${p.up}80` : `${p.down}80`);
    const histColor = (v: number, prev: number) => (v >= 0 ? (v >= prev ? '#26a69a' : '#b2dfdb') : v <= prev ? '#ff5252' : '#ffcdd2');
    // La EMA 200 recién vale con 200 velas.
    const e200At = (i: number) => (i >= 199 ? e200[i] : undefined);

    if (!same) {
      s.candles.applyOptions({ priceFormat: { type: 'price', precision, minMove: precision === 2 ? 0.01 : 0.0001 } });
      s.session.setData(bars.map((b) => ({ time: toTime(b.t), value: 1, color: shade(b) })));
      s.candles.setData(bars.map((b) => ({ time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));
      s.volume.setData(bars.map((b) => ({ time: toTime(b.t), value: b.v, color: volColor(b) })));
      s.vwap.setData(hasVwap ? bars.map((b, i) => ({ time: toTime(b.t), value: vw[i] })) : []);
      s.ema9.setData(bars.map((b, i) => ({ time: toTime(b.t), value: e9[i] })));
      s.ema20.setData(bars.map((b, i) => ({ time: toTime(b.t), value: e20[i] })));
      s.ema200.setData(bars.flatMap((b, i) => (e200At(i) === undefined ? [] : [{ time: toTime(b.t), value: e200[i] }])));
      if (s.macd) {
        s.macd.macd.setData(bars.map((b, i) => ({ time: toTime(b.t), value: m.macd[i] })));
        s.macd.signal.setData(bars.map((b, i) => ({ time: toTime(b.t), value: m.signal[i] })));
        s.macd.hist.setData(bars.map((b, i) => ({ time: toTime(b.t), value: m.hist[i], color: histColor(m.hist[i], m.hist[i - 1] ?? 0) })));
      }
      // Se vuelve a encuadrar al cambiar de acción o temporalidad y cuando llega historia por delante
      // (si no, la vista quedaría parada en las velas más viejas); no cuando el motor recorta las viejas.
      if (st.sym !== detail.sym || st.tf !== tf || bars[0].t < st.first) {
        if ((host.current?.clientWidth ?? 0) < 20) pendingRange.current = true;
        else frameLast(chart, bars.length, tf);
      }
    } else {
      // update() solo acepta la última vela o una nueva: si apareció una vela, se cierra la anterior y se agrega.
      const from = bars.length === st.len ? bars.length - 1 : bars.length - 2;
      for (let i = Math.max(0, from); i < bars.length; i++) {
        const b = bars[i];
        const time = toTime(b.t);
        s.session.update({ time, value: 1, color: shade(b) });
        s.candles.update({ time, open: b.o, high: b.h, low: b.l, close: b.c });
        s.volume.update({ time, value: b.v, color: volColor(b) });
        if (hasVwap) s.vwap.update({ time, value: vw[i] });
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
    watermarkRef.current?.applyOptions({ lines: [{ text: `${detail.sym}  ${WATERMARK_LABEL[tf] ?? ''}`, color: withAlpha(p.text, 0.1) }] });
    barsRef.current = bars;
    legendsRef.current = bars.map((b, i) => {
      const prev = i > 0 ? bars[i - 1].c : b.o;
      return { o: b.o, h: b.h, l: b.l, c: b.c, chg: b.c - prev, chgPct: prev ? ((b.c - prev) / prev) * 100 : 0, vol: b.v, e9: e9[i], e20: e20[i], e200: e200At(i), vwap: hasVwap ? vw[i] : undefined };
    });
    // Con velas nuevas de punta a punta, las marcas se ubican de nuevo.
    if (!same) applyMarkersRef.current();

    // Posición de la cuenta regresiva: debajo de la etiqueta del último precio.
    const y = s.candles.priceToCoordinate(bars[bars.length - 1].c);
    setLabelY(y === null ? null : y);
    setScaleW(chart.priceScale('right').width());
  }, [detail, tf, themeKey, showMacd, hist]);

  // ---- Líneas de precio: máximo del día, máximo pre-market, cierre anterior, el plan del bull flag,
  // tu posición y tus órdenes. Solo cuando cambia alguno de esos niveles.
  const hod = detail?.row.hod ?? 0;
  const pmHigh = detail?.pmHigh ?? 0;
  const prevClose = detail?.row.prevClose ?? 0;
  const flagEntry = detail?.setup.flag?.entry;
  const flagStop = detail?.setup.flag?.stop;
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    for (const l of linesRef.current) s.candles.removePriceLine(l);
    const lines: IPriceLine[] = [];
    if (sym) {
      const p = palette(themeKey);
      const add = (price: number, color: string, title: string, style: LineStyle, width: 1 | 2 = 1) => {
        if (price > 0) lines.push(s.candles.createPriceLine({ price, color, title, lineStyle: style, lineWidth: width, axisLabelVisible: true }));
      };
      add(hod, p.hod, 'HOD', LineStyle.Dashed);
      if (pmHigh > 0 && Math.abs(pmHigh - hod) > 1e-9) add(pmHigh, p.accent, 'PMH', LineStyle.Dotted);
      add(prevClose, p.faint, 'Cierre ant.', LineStyle.Dotted);
      if (position) {
        // Un corto se dibuja con el color de aviso: el stop (compra) queda arriba y el objetivo (compra) abajo del costo.
        const short = position.side === 'short';
        add(position.avgCost, short ? p.warn : p.info, short ? `Tu corto (${position.shares})` : `Tu costo (${position.shares})`, LineStyle.Solid, 2);
        if (position.stop) add(position.stop, p.down, short ? 'Tu stop (cubre)' : 'Tu stop', LineStyle.Solid);
        else if (position.planStop) add(position.planStop, p.down, 'Stop plan', LineStyle.Dotted);
        if (position.target) add(position.target, p.up, short ? 'Tu objetivo (cubre)' : 'Tu objetivo', LineStyle.Solid);
        else if (position.planTarget) add(position.planTarget, p.up, 'Obj. plan', LineStyle.Dotted);
      } else if (flagEntry !== undefined && flagStop !== undefined) {
        add(flagEntry, p.ema9, 'Entrada BF', LineStyle.Dashed);
        add(flagStop, p.down, 'Stop BF', LineStyle.Dashed);
      }
      for (const o of orders ?? []) {
        add(o.price, o.side === 'buy' ? p.info : p.warn, `${o.side === 'buy' ? 'C' : 'V'} ${o.shares}${o.kind === 'stop' ? ' stop' : ''}`, LineStyle.LargeDashed);
      }
    }
    linesRef.current = lines;
  }, [sym, hod, pmHigh, prevClose, flagEntry, flagStop, position, orders, themeKey]);

  const changeTf = (x: number) => {
    setTf(x);
    save(`chart-tf-${id}`, x);
  };
  const pick = (x: 'h' | 'alert' | 't') => {
    setPending(null);
    setTool((cur) => (cur === x ? null : x));
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
        <div className="seg draw" role="group" aria-label="Dibujar">
          <button className={tool === 'h' ? 'is-active' : ''} onClick={() => pick('h')} title="Línea horizontal: después tocá el precio en el gráfico" aria-label="Línea horizontal" aria-pressed={tool === 'h'}>
            ─
          </button>
          <button className={tool === 'alert' ? 'is-active' : ''} onClick={() => pick('alert')} title="Alerta de precio: una línea que suena y avisa cuando el precio la cruza" aria-label="Alerta de precio" aria-pressed={tool === 'alert'}>
            🔔
          </button>
          <button className={tool === 't' ? 'is-active' : ''} onClick={() => pick('t')} title="Línea de tendencia: tocá dos puntos. Para borrar: clic derecho sobre la línea, Supr (la última) o el botón Líneas" aria-label="Línea de tendencia" aria-pressed={tool === 't'}>
            ╱
          </button>
        </div>
        {drawings.length > 0 && (
          <button className={`chip ${showList ? 'is-active' : ''}`} onClick={() => setShowList((v) => !v)} aria-pressed={showList} title="Tus líneas en esta acción">
            Líneas {drawings.length}
          </button>
        )}
      </div>
      <div className="chart-wrap">
        <div
          className={`chart-host${tool ? ' is-drawing' : ''}`}
          ref={host}
          onContextMenu={onContextMenu}
          onMouseDown={onMouseDown}
          onDoubleClick={onDoubleClick}
          onMouseEnter={() => (hoveringRef.current = true)}
          onMouseLeave={() => (hoveringRef.current = false)}
        />
        {tool && <span className="draw-hint">{tool === 't' ? (pending ? 'Tocá el segundo punto' : 'Tocá el primer punto') : tool === 'alert' ? 'Tocá el precio de la alerta' : 'Tocá el precio'} · Esc cancela</span>}
        {showList && detail && (
          <div className="draw-list" role="dialog" aria-label="Tus líneas">
            {drawings.map((d) => (
              <div key={d.id} className="draw-row">
                <span>{d.kind === 'h' ? `${d.alert ? '🔔' : '─'} ${fmt(d.price)}${d.fired ? ' · sonó' : ''}` : `╱ ${fmt(d.a.price)} → ${fmt(d.b.price)}`}</span>
                {d.kind === 'h' && (
                  <button type="button" className="link" onClick={() => toggleAlert(detail.sym, d.id)}>
                    {d.alert ? 'Sin alerta' : 'Alerta'}
                  </button>
                )}
                <button type="button" className="link" onClick={() => removeWithUndo(detail.sym, d.id)}>
                  Borrar
                </button>
              </div>
            ))}
            <button
              type="button"
              className="link"
              onClick={() => {
                clearDrawings(detail.sym);
                setShowList(false);
              }}
            >
              Borrar todas
            </button>
          </div>
        )}
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
                {(detail.row.float !== undefined || mcap !== undefined || ref?.industry) && (
                  <div className="lg-row">
                    {ref?.industry && (
                      <>
                        Sector <em className="lg-sector">{ref.industry}</em>{' '}
                      </>
                    )}
                    {detail.row.float !== undefined && (
                      <>
                        Float <em className="lg-float">{fmtVolume(detail.row.float)}</em>
                      </>
                    )}
                    {mcap !== undefined && (
                      <>
                        {' '}
                        Capitalización <em className="lg-mcap">{fmtVolume(mcap)}</em>
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
        {detail && labelY !== null && lastBar && tf < TF_4H && <CandleCountdown span={tf * 1000} top={labelY + 10} width={scaleW} />}
      </div>
      {!detail && <div className="chart-empty">Elegí una acción de cualquier lista para ver su gráfico.</div>}
    </div>
  );
}

/** Memorizado: se vuelve a dibujar solo cuando cambian la ficha, las alertas, el tema o tu posición. */
export const Chart = memo(ChartView);
