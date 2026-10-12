import { scaleLinear } from "d3-scale";
import { isNum, num, times } from "../../lib/format";
import { barPath, ChartBox, useTip, YAxis } from "./frame";

const M = { t: 26, r: 16, b: 30, l: 64 };

export interface StrikeSeriesSet {
  name: string; // "Calls (CE)"
  color: string; // CSS colour
  values: (number | null)[]; // aligned with strikes
  avg?: (number | null)[]; // 20-session average at the same ATM offset (magnitude when `absAvg`)
  x?: (number | null)[]; // today ÷ avg
}

interface Props {
  strikes: number[];
  series: StrikeSeriesSet[]; // 1 (payout) or 2 (CE, PE)
  absAvg?: boolean; // averages are magnitudes: draw the tick on the side of today's sign
  spot?: number | null;
  atm?: number | null;
  maxPain?: number | null;
  highlight?: number | null; // strike drawn in the accent (single series)
  format: (n: number) => string;
  height?: number;
  label: string;
}

/** Bars per strike (grouped CE / PE), gray ticks for the 20-session average at the same moneyness,
 *  a vertical spot line and a max-pain marker. */
export function StrikeBars({ strikes, series, absAvg, spot, atm, maxPain, highlight, format, height = 280, label }: Props) {
  const [tip, setTip] = useTip();
  const n = strikes.length;
  const all = series.flatMap((s, si) => [
    ...s.values.filter(isNum),
    ...(s.avg ?? []).map((a, i) => (isNum(a) ? (absAvg && isNum(series[si].values[i]) && (series[si].values[i] as number) < 0 ? -a : a) : null)).filter(isNum),
  ]);
  const lo = Math.min(0, ...all);
  const top = Math.max(0, ...all);
  const hi = top === lo ? lo + 1 : top;

  return (
    <ChartBox
      height={height}
      margin={M}
      label={label}
      tip={tip}
      onPointer={(x, f) => {
        if (x === null || !n) return setTip(null);
        const i = Math.min(n - 1, Math.max(0, Math.floor((x / f.iw) * n)));
        const rows = series.map((s) => ({
          key: s.name + (s.x && isNum(s.x[i]) ? `  · ${times(s.x[i])} usual` : ""),
          value: isNum(s.values[i]) ? format(s.values[i] as number) : "—",
          swatch: s.color,
        }));
        const marks = [strikes[i] === atm ? "ATM" : "", strikes[i] === maxPain ? "max pain" : ""].filter(Boolean).join(" · ");
        setTip({ x: f.m.l + ((i + 0.5) / n) * f.iw, title: `Strike ${num(strikes[i], strikes[i] % 1 ? 1 : 0)}${marks ? "  " + marks : ""}`, rows });
      }}
    >
      {(f) => {
        if (!n) return null;
        const y = scaleLinear().domain([lo, hi]).nice(4).range([f.m.t + f.ih, f.m.t]);
        const band = f.iw / n;
        const k = series.length;
        const w = Math.max(2, Math.min(24, (band * 0.78 - (k - 1) * 2) / k));
        const groupW = k * w + (k - 1) * 2;
        const x0 = (i: number, si: number) => f.m.l + i * band + (band - groupW) / 2 + si * (w + 2);
        const hoverI = tip ? Math.floor(((tip.x - f.m.l) / f.iw) * n) : -1;
        // spot: interpolate between strike centres
        let spotX: number | null = null;
        if (isNum(spot) && n > 1) {
          const j = strikes.findIndex((s) => s >= spot);
          if (j > 0) spotX = f.m.l + (j - 1 + 0.5 + (spot - strikes[j - 1]) / (strikes[j] - strikes[j - 1])) * band;
          else if (j === 0) spotX = f.m.l + 0.5 * band;
        }
        const mpI = isNum(maxPain) ? strikes.indexOf(maxPain) : -1;
        const every = n > 24 ? 2 : 1;
        return (
          <>
            <YAxis f={f} ticks={y.ticks(4)} y={y} format={format} />
            {hoverI >= 0 && hoverI < n && <rect x={f.m.l + hoverI * band} width={band} y={f.m.t} height={f.ih} className="hover-wash" />}
            {strikes.map((_, i) =>
              series.map((s, si) => {
                const v = s.values[i];
                if (!isNum(v)) return null;
                const fill = highlight !== undefined && highlight !== null ? (strikes[i] === highlight ? "var(--accent)" : "var(--base-bar)") : s.color;
                return <path key={`${i}-${si}`} d={barPath(x0(i, si), w, y(0), y(v))} fill={fill} />;
              }),
            )}
            {series.map((s, si) =>
              (s.avg ?? []).map((a, i) => {
                if (!isNum(a)) return null;
                const v = s.values[i];
                const ya = y(absAvg && isNum(v) && v < 0 ? -a : a);
                return <line key={`avg-${i}-${si}`} x1={x0(i, si) - 2} x2={x0(i, si) + w + 2} y1={ya} y2={ya} className="avg-tick" />;
              }),
            )}
            {spotX !== null && (
              <g className="spot-mark">
                <line x1={spotX} x2={spotX} y1={f.m.t - 4} y2={f.m.t + f.ih} />
                <text x={spotX} y={f.m.t - 9} textAnchor="middle">
                  spot {num(spot, 2)}
                </text>
              </g>
            )}
            {mpI >= 0 && (
              <g className="mp-mark">
                <path d={`M${f.m.l + (mpI + 0.5) * band},${f.m.t + f.ih + 3}l4,5h-8z`} />
              </g>
            )}
            <g className="axis">
              {strikes.map((s, i) =>
                i % every === 0 || s === atm ? (
                  <text key={s} x={f.m.l + (i + 0.5) * band} y={f.m.t + f.ih + 20} textAnchor="middle" className={s === atm ? "axis-strong" : ""}>
                    {num(s, s % 1 ? 1 : 0)}
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
