import type { Compare } from "../api/types";
import { isNum, ordinalPct } from "../lib/format";

/** Where today sits among the last N sessions (same window): one tick per baseline day,
 *  a taller tick for their average, and a dot for today. Magnitudes when the comparison is `abs`. */
export function RangeStrip({ cmp, label }: { cmp: Compare; label: string }) {
  const vals = (cmp.hist ?? []).filter(isNum).map((v) => (cmp.abs ? Math.abs(v) : v));
  const today = isNum(cmp.value) ? (cmp.abs ? Math.abs(cmp.value) : cmp.value) : null;
  if (!vals.length || today === null) return <div className="strip strip-empty" />;
  const lo = Math.min(...vals, today);
  const hi = Math.max(...vals, today);
  const span = hi - lo || 1;
  const pos = (v: number) => 4 + ((v - lo) / span) * 92; // % with 4% padding each side
  const avg = isNum(cmp.avg) ? cmp.avg : null;
  return (
    <svg
      className="strip"
      viewBox="0 0 100 14"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label}: today is at the ${ordinalPct(cmp.pct)} of the last ${cmp.n} sessions`}
    >
      <line x1="4" x2="96" y1="7" y2="7" className="strip-track" vectorEffect="non-scaling-stroke" />
      {vals.map((v, i) => (
        <line key={i} x1={pos(v)} x2={pos(v)} y1="4" y2="10" className="strip-day" vectorEffect="non-scaling-stroke" />
      ))}
      {avg !== null && <line x1={pos(avg)} x2={pos(avg)} y1="1.5" y2="12.5" className="strip-avg" vectorEffect="non-scaling-stroke" />}
      <line x1={pos(today)} x2={pos(today)} y1="0.5" y2="13.5" className="strip-today" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
