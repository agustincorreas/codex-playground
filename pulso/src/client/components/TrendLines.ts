// Líneas de tendencia dibujadas sobre las velas (un "primitive" de lightweight-charts): cada una une
// dos puntos y sigue hacia la derecha hasta el borde, como en las plataformas de trading.
import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { TLine } from '../lib/drawings';

/** Lo que hace falta para ubicar un instante que cae fuera de las velas (a la derecha o a la izquierda). */
export interface Geometry {
  first: number;
  last: number;
  lastIndex: number;
  /** Segundos por vela. */
  tf: number;
}

export class TrendLinesPrimitive implements ISeriesPrimitive<Time> {
  private chart?: IChartApi;
  private series?: ISeriesApi<'Candlestick'>;
  private requestUpdate?: () => void;
  private lines: TLine[] = [];
  private color = '#ffffff';
  private pending: { t: number; price: number } | null = null;
  private readonly view: IPrimitivePaneView = { zOrder: () => 'top', renderer: () => this.renderer() };

  constructor(private readonly geometry: () => Geometry | null) {}

  attached(p: SeriesAttachedParameter<Time, 'Candlestick'>): void {
    this.chart = p.chart;
    this.series = p.series;
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.chart = undefined;
    this.series = undefined;
    this.requestUpdate = undefined;
  }

  update(lines: TLine[], color: string, pending: { t: number; price: number } | null): void {
    this.lines = lines;
    this.color = color;
    this.pending = pending;
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  /** Coordenada x de un instante del gráfico, también fuera del rango de las velas. */
  private xOf(t: number): number | null {
    const chart = this.chart;
    const g = this.geometry();
    if (!chart || !g) return null;
    const ts = chart.timeScale();
    let logical: Logical | null;
    if (t > g.last) logical = (g.lastIndex + (t - g.last) / g.tf) as Logical;
    else if (t < g.first) logical = (0 - (g.first - t) / g.tf) as Logical;
    else logical = ts.timeToIndex(t as Time, true) as unknown as Logical | null;
    return logical === null ? null : ts.logicalToCoordinate(logical);
  }

  /** Si (x, y) está encima de un extremo de la línea (para arrastrar solo ese punto): 'a', 'b' o null. */
  endpointNear(line: TLine, x: number, y: number, tol = 9): 'a' | 'b' | null {
    const series = this.series;
    if (!series) return null;
    const pts: Array<['a' | 'b', number | null, number | null]> = [
      ['a', this.xOf(line.a.t), series.priceToCoordinate(line.a.price)],
      ['b', this.xOf(line.b.t), series.priceToCoordinate(line.b.price)],
    ];
    let best: ['a' | 'b', number] | null = null;
    for (const [k, px, py] of pts) {
      if (px === null || py === null) continue;
      const d = Math.hypot(px - x, py - y);
      if (d <= tol && (!best || d < best[1])) best = [k, d];
    }
    return best ? best[0] : null;
  }

  /** La línea de tendencia que pasa a menos de `tol` píxeles del punto (x, y), si hay alguna. */
  lineNear(x: number, y: number, width: number, tol = 7): TLine | null {
    const series = this.series;
    if (!series) return null;
    let best: { line: TLine; d: number } | null = null;
    for (const l of this.lines) {
      const x1 = this.xOf(l.a.t);
      const x2 = this.xOf(l.b.t);
      const y1 = series.priceToCoordinate(l.a.price);
      const y2 = series.priceToCoordinate(l.b.price);
      if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
      const [ax, ay, bx, by]: number[] = x2 >= x1 ? [x1, y1, x2, y2] : [x2, y2, x1, y1];
      let ex = width;
      let ey = by;
      if (bx > ax) ey = by + ((ex - bx) * (by - ay)) / (bx - ax);
      else ex = bx;
      // Distancia del punto al segmento a→extremo derecho.
      const dx = ex - ax;
      const dy = ey - ay;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (d <= tol && (!best || d < best.d)) best = { line: l, d };
    }
    return best?.line ?? null;
  }

  private renderer(): IPrimitivePaneRenderer | null {
    const series = this.series;
    if (!series || (!this.lines.length && !this.pending)) return null;
    const segs: Array<[number, number, number, number]> = [];
    for (const l of this.lines) {
      const x1 = this.xOf(l.a.t);
      const x2 = this.xOf(l.b.t);
      const y1 = series.priceToCoordinate(l.a.price);
      const y2 = series.priceToCoordinate(l.b.price);
      if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
      segs.push([x1, y1, x2, y2]);
    }
    const p = this.pending;
    const px = p ? this.xOf(p.t) : null;
    const py = p ? series.priceToCoordinate(p.price) : null;
    const color = this.color;
    return {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          ctx.save();
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.lineWidth = 1.5;
          for (const [x1, y1, x2, y2] of segs) {
            // De a hasta b, y de ahí sigue hasta el borde derecho con la misma pendiente.
            const [ax, ay, bx, by] = x2 >= x1 ? [x1, y1, x2, y2] : [x2, y2, x1, y1];
            let ex = mediaSize.width;
            let ey = by;
            if (bx > ax) ey = by + ((ex - bx) * (by - ay)) / (bx - ax);
            else ex = bx;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(ex, ey);
            ctx.stroke();
            for (const [x, y] of [
              [ax, ay],
              [bx, by],
            ]) {
              ctx.beginPath();
              ctx.arc(x, y, 3, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          if (px !== null && py !== null) {
            ctx.beginPath();
            ctx.arc(px, py, 4, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }),
    };
  }
}
