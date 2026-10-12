import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { IChartApi, IPanePrimitive, IPrimitivePaneRenderer, Logical, PaneAttachedParameter, Time, UTCTimestamp } from "lightweight-charts";

/** Pane primitive that washes the selected time window (behind the series) with hairline edges.
 *  One instance per pane, so the price, volume and OI panes all show the same window. */
export class WindowShade implements IPanePrimitive<Time> {
  private chart: IChartApi | null = null;
  private requestUpdate: (() => void) | null = null;
  private range: { from: UTCTimestamp; to: UTCTimestamp } | null = null;
  private fill = "rgba(42,120,214,0.10)";
  private edge = "rgba(42,120,214,0.6)";

  private readonly renderer: IPrimitivePaneRenderer = {
    draw: () => undefined,
    drawBackground: (target: CanvasRenderingTarget2D) => this.paint(target),
  };

  attached(param: PaneAttachedParameter<Time>): void {
    this.chart = param.chart as IChartApi;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.requestUpdate = null;
  }

  paneViews() {
    return [{ zOrder: () => "bottom" as const, renderer: () => this.renderer }];
  }

  set(range: { from: number; to: number } | null, fill: string, edge: string): void {
    this.range = range ? { from: range.from as UTCTimestamp, to: range.to as UTCTimestamp } : null;
    this.fill = fill;
    this.edge = edge;
    this.requestUpdate?.();
  }

  private paint(target: CanvasRenderingTarget2D) {
    if (!this.chart || !this.range) return;
    const ts = this.chart.timeScale();
    const x1 = ts.timeToCoordinate(this.range.from);
    const x2 = ts.timeToCoordinate(this.range.to);
    if (x1 === null || x2 === null) return;
    const c0 = ts.logicalToCoordinate(0 as Logical);
    const c1 = ts.logicalToCoordinate(1 as Logical);
    const half = c0 !== null && c1 !== null ? Math.abs(c1 - c0) / 2 : 3;
    target.useBitmapCoordinateSpace(({ context, bitmapSize, horizontalPixelRatio: hr }) => {
      const left = Math.round((x1 - half) * hr);
      const right = Math.round((x2 + half) * hr);
      const line = Math.max(1, Math.round(hr));
      context.fillStyle = this.fill;
      context.fillRect(left, 0, right - left, bitmapSize.height);
      context.fillStyle = this.edge;
      context.fillRect(left, 0, line, bitmapSize.height);
      context.fillRect(right - line, 0, line, bitmapSize.height);
    });
  }
}
