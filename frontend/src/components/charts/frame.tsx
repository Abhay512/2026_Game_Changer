import { useState } from "react";
import { tidy } from "../../lib/format";
import { useSize } from "../../lib/hooks";

export interface Margin {
  t: number;
  r: number;
  b: number;
  l: number;
}

export interface FrameProps {
  width: number;
  height: number;
  iw: number; // inner width
  ih: number; // inner height
  m: Margin;
}

export interface TipState {
  x: number; // px inside the chart box
  title: string;
  rows: { key: string; value: string; swatch?: string; line?: boolean }[];
}

/** Responsive SVG box (height fixed, width = container) + one shared tooltip. */
export function ChartBox({
  height,
  margin,
  label,
  children,
  onPointer,
  tip,
}: {
  height: number;
  margin: Margin;
  label: string;
  children: (f: FrameProps) => React.ReactNode;
  onPointer?: (xInner: number | null, f: FrameProps) => void;
  tip?: TipState | null;
}) {
  const [ref, size] = useSize<HTMLDivElement>();
  const width = Math.max(size.width, 0);
  const f: FrameProps = { width, height, m: margin, iw: Math.max(0, width - margin.l - margin.r), ih: height - margin.t - margin.b };
  const handle = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    onPointer?.(e.clientX - box.left, f);
  };
  return (
    <div className="chart-box" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          {children(f)}
          {onPointer && (
            <rect
              x={margin.l}
              y={margin.t}
              width={f.iw}
              height={f.ih}
              fill="transparent"
              onPointerMove={handle}
              onPointerDown={handle}
              onPointerLeave={() => onPointer(null, f)}
            />
          )}
        </svg>
      )}
      {tip && <Tooltip tip={tip} width={width} />}
    </div>
  );
}

function Tooltip({ tip, width }: { tip: TipState; width: number }) {
  const right = tip.x > width * 0.62;
  return (
    <div className="tip" style={right ? { right: width - tip.x + 12 } : { left: tip.x + 12 }}>
      <div className="tip-title">{tip.title}</div>
      {tip.rows.map((r) => (
        <div className="tip-row" key={r.key}>
          {r.swatch && <span className={r.line ? "tip-line" : "tip-swatch"} style={{ background: r.swatch }} />}
          <span className="tip-value">{r.value}</span>
          <span className="tip-key">{r.key}</span>
        </div>
      ))}
    </div>
  );
}

export function useTip() {
  return useState<TipState | null>(null);
}

/** Bar path with a 4px rounded data end and a square end at the baseline (works below zero too). */
export function barPath(x: number, w: number, yBase: number, yVal: number, r = 4): string {
  const h = Math.abs(yBase - yVal);
  if (h < 0.5 || w <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  if (yVal < yBase) {
    // grows upward
    return `M${x},${yBase}V${yVal + rr}Q${x},${yVal} ${x + rr},${yVal}H${x + w - rr}Q${x + w},${yVal} ${x + w},${yVal + rr}V${yBase}Z`;
  }
  return `M${x},${yBase}V${yVal - rr}Q${x},${yVal} ${x + rr},${yVal}H${x + w - rr}Q${x + w},${yVal} ${x + w},${yVal - rr}V${yBase}Z`;
}

/** Horizontal gridlines + left tick labels. */
export function YAxis({ f, ticks, y, format }: { f: FrameProps; ticks: number[]; y: (v: number) => number; format: (v: number) => string }) {
  return (
    <g className="axis">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={f.m.l} x2={f.m.l + f.iw} y1={y(t)} y2={y(t)} className={t === 0 ? "baseline" : "grid"} />
          <text x={f.m.l - 8} y={y(t)} dy="0.32em" textAnchor="end">
            {tidy(format(t))}
          </text>
        </g>
      ))}
    </g>
  );
}

export function linePath(points: [number, number | null][]): string {
  let d = "";
  let pen = false;
  for (const [x, y] of points) {
    if (y === null || !Number.isFinite(y)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    pen = true;
  }
  return d;
}
