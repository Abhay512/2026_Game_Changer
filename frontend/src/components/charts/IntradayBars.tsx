import { scaleLinear } from "d3-scale";
import { isNum, times } from "../../lib/format";
import { barPath, ChartBox, linePath, useTip, YAxis } from "./frame";

const M = { t: 12, r: 12, b: 26, l: 60 };

interface Props {
  labels: string[];
  a: number;
  b: number;
  format: (n: number) => string;
  /** single series: today per bar (+ baseline per-bar mean as a line) */
  today?: (number | null)[];
  base?: (number | null)[];
  /** stacked series (buy below, sell above) */
  stack?: { bottom: (number | null)[]; top: (number | null)[]; bottomName: string; topName: string };
  height?: number;
  label: string;
}

/** Per-bar columns for the whole session; bars inside the window in the accent, the rest gray.
 *  The 20-day average for each bar is a gray line, so today's profile reads against normal. */
export function IntradayBars({ labels, a, b, format, today, base, stack, height = 240, label }: Props) {
  const [tip, setTip] = useTip();
  const n = labels.length;
  const val = (arr: (number | null)[] | undefined, i: number) => (arr && isNum(arr[i]) ? (arr[i] as number) : 0);
  const totals = labels.map((_, i) => (stack ? val(stack.bottom, i) + val(stack.top, i) : val(today, i)));
  const max = Math.max(1, ...totals, ...(base ?? []).filter(isNum));

  return (
    <ChartBox
      height={height}
      margin={M}
      label={label}
      tip={tip}
      onPointer={(x, f) => {
        if (x === null) return setTip(null);
        const i = Math.min(n - 1, Math.max(0, Math.floor((x / f.iw) * n)));
        const rows = stack
          ? [
              { key: stack.topName, value: format(val(stack.top, i)), swatch: "var(--down)" },
              { key: stack.bottomName, value: format(val(stack.bottom, i)), swatch: "var(--up)" },
            ]
          : [
              { key: "Today", value: format(val(today, i)), swatch: i >= a && i <= b ? "var(--accent)" : "var(--base-bar)" },
              ...(base && isNum(base[i]) ? [{ key: "20D avg, same bar", value: format(base[i] as number), swatch: "var(--base)", line: true }] : []),
              ...(base && isNum(base[i]) && (base[i] as number) > 0 && !stack
                ? [{ key: "vs avg", value: times(val(today, i) / (base[i] as number)) }]
                : []),
            ];
        setTip({ x: f.m.l + ((i + 0.5) / n) * f.iw, title: `${labels[i]}${i >= a && i <= b ? "" : "  (outside window)"}`, rows });
      }}
    >
      {(f) => {
        const y = scaleLinear().domain([0, max]).nice(4).range([f.m.t + f.ih, f.m.t]);
        const band = f.iw / n;
        const w = Math.max(1, Math.min(24, band * 0.72));
        const x0 = (i: number) => f.m.l + i * band + (band - w) / 2;
        const yb = y(0);
        const hoverI = tip ? Math.floor(((tip.x - f.m.l) / f.iw) * n) : -1;
        return (
          <>
            <YAxis f={f} ticks={y.ticks(4)} y={y} format={format} />
            <rect x={f.m.l + a * band} width={(b - a + 1) * band} y={f.m.t} height={f.ih} className="win-wash" />
            {labels.map((_, i) => {
              const inWin = i >= a && i <= b;
              if (stack) {
                const lo = val(stack.bottom, i);
                const hi = val(stack.top, i);
                const yLo = y(lo);
                const yHi = y(lo + hi);
                const gap = lo > 0 && hi > 0 ? 1 : 0; // 2px surface gap split across the two segments
                return (
                  <g key={i} opacity={inWin ? 1 : 0.35}>
                    <path d={barPath(x0(i), w, yb, yLo + gap, lo > 0 && hi > 0 ? 0 : 4)} fill="var(--up)" />
                    <path d={barPath(x0(i), w, yLo - gap, yHi, 4)} fill="var(--down)" />
                  </g>
                );
              }
              return (
                <path
                  key={i}
                  d={barPath(x0(i), w, yb, y(val(today, i)))}
                  fill={inWin ? "var(--accent)" : "var(--base-bar)"}
                  opacity={hoverI === i ? 0.75 : 1}
                />
              );
            })}
            {base && !stack && (
              <path d={linePath(labels.map((_, i) => [f.m.l + (i + 0.5) * band, isNum(base[i]) ? y(base[i] as number) : null]))} className="line-base" />
            )}
            {tip && <line x1={tip.x} x2={tip.x} y1={f.m.t} y2={f.m.t + f.ih} className="crosshair" />}
            <g className="axis">
              {labels.map((l, i) =>
                i % 12 === 0 ? (
                  <text key={l} x={f.m.l + (i + 0.5) * band} y={f.m.t + f.ih + 17} textAnchor="middle">
                    {l}
                  </text>
                ) : null,
              )}
            </g>
          </>
        );
      }}
    </ChartBox>
  );
}
