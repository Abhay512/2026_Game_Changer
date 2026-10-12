import { scaleLinear } from "d3-scale";
import { isNum } from "../../lib/format";
import { barEnd, barTime } from "../../state/view";
import { ChartBox, linePath, useTip, YAxis } from "./frame";

const M = { t: 14, r: 64, b: 26, l: 64 };

interface Props {
  a: number;
  b: number;
  today: (number | null)[]; // per bar, value at the END of the bar
  base?: (number | null)[]; // baseline mean, per bar
  envelope?: (number | null)[]; // ± typical size of the change on baseline days (gray band)
  anchor?: boolean; // change / running-total series: start the lines at 0 at the window start
  format: (n: number) => string;
  todayName?: string;
  baseName?: string;
  envelopeName?: string;
  height?: number;
  label: string;
  colors?: { today: string; base: string }; // default: accent vs baseline gray
}

interface Pt {
  label: string;
  t: number | null;
  b: number | null;
  e: number | null;
}

/** Lines over the selected window only — the period every number on the page describes.
 *  Each point is the state at the end of a bar; anchored series begin at 0 at the window start. */
export function ChangeLines({ a, b, today, base, envelope, anchor, format, todayName = "Today", baseName = "20D avg", envelopeName = "Typical size (±)", height = 240, label, colors }: Props) {
  const cToday = colors?.today ?? "var(--accent)";
  const cBase = colors?.base ?? "var(--base)";
  const [tip, setTip] = useTip();
  const val = (arr: (number | null)[] | undefined, i: number) => (arr && isNum(arr[i]) ? (arr[i] as number) : null);
  const pts: Pt[] = [];
  if (anchor) pts.push({ label: barTime(a), t: 0, b: base ? 0 : null, e: envelope ? 0 : null });
  for (let i = a; i <= b; i++) pts.push({ label: barEnd(i), t: val(today, i), b: val(base, i), e: val(envelope, i) });

  // change charts keep 0 on the axis; level charts (PCR, IV, price) use their own range
  const vals = [...(anchor || envelope ? [0] : []), ...pts.flatMap((p) => [p.t, p.b, p.e, isNum(p.e) ? -p.e : null]).filter(isNum)];
  if (!vals.length) vals.push(0);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
  const steps = Math.max(1, pts.length - 1);

  return (
    <ChartBox
      height={height}
      margin={M}
      label={label}
      tip={tip}
      onPointer={(x, f) => {
        if (x === null) return setTip(null);
        const k = Math.min(pts.length - 1, Math.max(0, Math.round((x / f.iw) * steps)));
        const p = pts[k];
        const rows = [
          { key: todayName, value: isNum(p.t) ? format(p.t) : "—", swatch: cToday, line: true },
          ...(base ? [{ key: baseName, value: isNum(p.b) ? format(p.b) : "—", swatch: cBase, line: true }] : []),
          ...(envelope ? [{ key: envelopeName, value: isNum(p.e) ? "±" + format(p.e) : "—" }] : []),
        ];
        setTip({ x: f.m.l + (pts.length > 1 ? (k / steps) * f.iw : f.iw / 2), title: p.label, rows });
      }}
    >
      {(f) => {
        const y = scaleLinear().domain([lo - pad, hi + pad]).nice(4).range([f.m.t + f.ih, f.m.t]);
        const x = (k: number) => f.m.l + (pts.length > 1 ? (k / steps) * f.iw : f.iw / 2);
        const withE = pts.map((p, k) => [k, p.e] as const).filter((q): q is readonly [number, number] => isNum(q[1]));
        const env =
          withE.length > 1
            ? `M${withE.map(([k, e]) => `${x(k).toFixed(1)},${y(e).toFixed(1)}`).join("L")}L${[...withE]
                .reverse()
                .map(([k, e]) => `${x(k).toFixed(1)},${y(-e).toFixed(1)}`)
                .join("L")}Z`
            : "";
        let last = -1;
        pts.forEach((p, k) => isNum(p.t) && (last = k));
        const every = Math.max(1, Math.ceil(pts.length / 7));
        return (
          <>
            <YAxis f={f} ticks={y.ticks(4)} y={y} format={format} />
            {env && <path d={env} className="area-base" />}
            {base && <path d={linePath(pts.map((p, k) => [x(k), isNum(p.b) ? y(p.b) : null]))} className="line-base" style={{ stroke: cBase }} />}
            <path d={linePath(pts.map((p, k) => [x(k), isNum(p.t) ? y(p.t) : null]))} className="line-today" style={{ stroke: cToday }} />
            {last >= 0 && (
              <>
                <circle cx={x(last)} cy={y(pts[last].t as number)} r={4} className="dot-today" style={{ fill: cToday }} />
                <text x={x(last) + 9} y={y(pts[last].t as number)} dy="0.32em" className="end-label">
                  {format(pts[last].t as number)}
                </text>
              </>
            )}
            {tip && <line x1={tip.x} x2={tip.x} y1={f.m.t} y2={f.m.t + f.ih} className="crosshair" />}
            <g className="axis">
              {pts.map((p, k) =>
                (k % every === 0 && pts.length - 1 - k >= Math.ceil(every / 2)) || k === pts.length - 1 ? (
                  <text key={k} x={x(k)} y={f.m.t + f.ih + 17} textAnchor={k === pts.length - 1 && pts.length > 1 ? "end" : k === 0 ? "start" : "middle"}>
                    {p.label}
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
