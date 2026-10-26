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
