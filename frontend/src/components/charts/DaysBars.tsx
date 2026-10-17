import { scaleLinear } from "d3-scale";
import { day, isNum, times } from "../../lib/format";
import { barPath, ChartBox, useTip, YAxis } from "./frame";

const M = { t: 16, r: 16, b: 26, l: 64 };

interface Props {
  days: string[];
  hist: (number | null)[];
  today: number | null;
  todayDate: string;
  avg: number | null;
  abs?: boolean; // the × compares magnitudes: draw ±avg guides
  format: (n: number) => string;
  detail?: { key: string; days: (string | null)[]; today: string | null }; // extra tooltip row per session
  height?: number;
  label: string;
}

/** The same window on each baseline session, oldest → newest, then today (accent). */
export function DaysBars({ days, hist, today, todayDate, avg, abs, format, detail, height = 240, label }: Props) {
  const [tip, setTip] = useTip();
  const items = [...days.map((d, i) => ({ d, v: hist[i] ?? null, today: false })), { d: todayDate, v: today, today: true }];
  const vals = items.map((i) => i.v).filter(isNum);
  const nBase = hist.filter(isNum).length; // sessions with a value (e.g. no Greeks on an expiry day)
  const guides = isNum(avg) ? (abs ? [avg, -avg] : [avg]) : [];
  const lo = Math.min(0, ...vals, ...guides);
  const hi = Math.max(0, ...vals, ...guides);

  return (
    <ChartBox
      height={height}
      margin={M}
      label={label}
      tip={tip}
      onPointer={(x, f) => {
        if (x === null) return setTip(null);
        const i = Math.min(items.length - 1, Math.max(0, Math.floor((x / f.iw) * items.length)));
        const it = items[i];
        const rows = [{ key: it.today ? "Today" : "Same window", value: isNum(it.v) ? format(it.v) : "—", swatch: it.today ? "var(--accent)" : "var(--base-bar)" }];
        if (isNum(avg) && isNum(it.v) && avg !== 0) rows.push({ key: abs ? "vs avg size" : `vs ${nBase}-session avg`, value: times((abs ? Math.abs(it.v) : it.v) / avg), swatch: "" });
        const extra = detail && (it.today ? detail.today : detail.days[i]);
        if (detail && extra) rows.push({ key: detail.key, value: extra, swatch: "" });
        setTip({ x: f.m.l + ((i + 0.5) / items.length) * f.iw, title: day(it.d, true), rows });
      }}
    >
      {(f) => {
        const y = scaleLinear().domain([lo, hi === lo ? lo + 1 : hi]).nice(4).range([f.m.t + f.ih, f.m.t]);
        const band = f.iw / items.length;
        const w = Math.max(2, Math.min(24, band * 0.62));
        const every = Math.max(1, Math.ceil(items.length / 8));
        const hoverI = tip ? Math.floor(((tip.x - f.m.l) / f.iw) * items.length) : -1;
        return (
          <>
            <YAxis f={f} ticks={y.ticks(4)} y={y} format={format} />
            {items.map((it, i) =>
              isNum(it.v) ? (
                <path
                  key={it.d + i}
                  d={barPath(f.m.l + i * band + (band - w) / 2, w, y(0), y(it.v))}
                  fill={it.today ? "var(--accent)" : "var(--base-bar)"}
                  opacity={hoverI === i ? 0.75 : 1}
                />
              ) : null,
            )}
            {guides.map((g, k) => (
              <g key={k}>
                <line x1={f.m.l} x2={f.m.l + f.iw} y1={y(g)} y2={y(g)} className="guide" />
                {k === 0 && (
                  <text x={f.m.l + 4} y={y(g) - 5} className="guide-label">
                    {abs ? "average size" : `${nBase}-session average`}
                  </text>
                )}
              </g>
            ))}
            <g className="axis">
              {items.map((it, i) =>
                it.today || (i % every === 0 && i < items.length - 2) ? (
                  <text key={it.d + "x"} x={f.m.l + (i + 0.5) * band} y={f.m.t + f.ih + 17} textAnchor="middle" className={it.today ? "axis-strong" : ""}>
                    {it.today ? "Today" : day(it.d)}
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
