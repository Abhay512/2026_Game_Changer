import { useId, useRef } from "react";
import { duration, isNum } from "../lib/format";
import { useSize } from "../lib/hooks";
import { BARS, barEnd, barTime } from "../state/view";

const PRESETS: { label: string; a: number; b: number }[] = [
  { label: "Full day", a: 0, b: 74 },
  { label: "First 15m", a: 0, b: 2 },
  { label: "First hour", a: 0, b: 11 },
  { label: "Till noon", a: 0, b: 32 },
  { label: "Afternoon", a: 33, b: 74 },
  { label: "Last hour", a: 63, b: 74 },
];

// bar boundaries (0…75) that get a time label / a minor tick
const LABELS = [0, 9, 21, 33, 45, 57, 69, 75];
const MINOR = [3, 15, 27, 39, 51, 63];

type Mode = "start" | "end" | "move" | "new";

interface Props {
  a: number;
  b: number;
  onChange: (a: number, b: number) => void;
  closes?: (number | null)[]; // the day's closes, drawn behind the track
  extra?: React.ReactNode; // controls shown next to the presets
  label?: string; // accessible name of this scrubber
}

/** 09:15 → 15:30 window selector. The main one drives every metric on the page; the option chain can
 *  have its own (see OptionChainSection). */
export function TimeWindow({ a, b, onChange: setWindow, closes, extra, label = "Window" }: Props) {
  const clipId = `tw-clip-${useId().replace(/:/g, "")}`;
  const [track, { width }] = useSize<HTMLDivElement>();
  const drag = useRef<{ mode: Mode; x: number; a0: number; b0: number; k0: number } | null>(null);
  const per = width / BARS;

  const boundaryAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(BARS, Math.max(0, Math.round((clientX - r.left) / per)));
  };

  const begin = (mode: Mode) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const k0 = boundaryAt(e.clientX);
    drag.current = { mode, x: e.clientX, a0: a, b0: b, k0 };
    if (mode === "new") setWindow(Math.min(k0, BARS - 1), Math.min(k0, BARS - 1));
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const k = boundaryAt(e.clientX);
    if (d.mode === "start") setWindow(Math.min(k, d.b0), d.b0);
    else if (d.mode === "end") setWindow(d.a0, Math.max(k - 1, d.a0));
    else if (d.mode === "move") {
      const span = d.b0 - d.a0;
      const na = Math.min(BARS - 1 - span, Math.max(0, d.a0 + Math.round((e.clientX - d.x) / per)));
      setWindow(na, na + span);
    } else {
      const lo = Math.min(d.k0, k);
      const hi = Math.max(d.k0, k);
      setWindow(Math.min(lo, BARS - 1), Math.max(Math.min(lo, BARS - 1), hi - 1));
    }
  };

  const end = () => (drag.current = null);

  const keys = (which: "start" | "end" | "move") => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 6 : 1;
    let d = 0;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") d = -step;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") d = step;
    else if (e.key === "Home") d = -BARS;
    else if (e.key === "End") d = BARS;
    else return;
    e.preventDefault();
    if (which === "start") setWindow(Math.min(b, Math.max(0, a + d)), b);
    else if (which === "end") setWindow(a, Math.max(a, Math.min(BARS - 1, b + d)));
    else {
      const span = b - a;
      const na = Math.min(BARS - 1 - span, Math.max(0, a + d));
      setWindow(na, na + span);
    }
  };

  // sparkline of the day's closes behind the track
  const pts = (closes ?? []).map((c, i) => [i + 0.5, c] as const).filter((p): p is readonly [number, number] => isNum(p[1]));
  let spark = "";
  if (pts.length > 1) {
    const ys = pts.map((p) => p[1]);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    const span = hi - lo || 1;
    spark = pts.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(2)},${(34 - ((y - lo) / span) * 28).toFixed(2)}`).join("");
  }

  const bars = b - a + 1;
  return (
    <div className="tw">
      <div className="tw-head">
        <div className="tw-readout">
          <span className="tw-range mono">
            {barTime(a)} – {barEnd(b)}
          </span>
          <span className="muted">
            {duration(bars)} · {bars} bar{bars > 1 ? "s" : ""}
          </span>
        </div>
        <div className="tw-presets" role="group" aria-label={`${label} presets`}>
          {PRESETS.map((p) => (
            <button key={p.label} aria-pressed={a === p.a && b === p.b} onClick={() => setWindow(p.a, p.b)}>
              {p.label}
            </button>
          ))}
          {extra}
        </div>
      </div>

      <div className="tw-track" ref={track} onPointerDown={begin("new")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <svg className="tw-spark" viewBox={`0 0 ${BARS} 40`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <clipPath id={clipId}>
              <rect x={a} width={bars} y="0" height="40" />
            </clipPath>
          </defs>
          {MINOR.map((k) => (
            <line key={k} x1={k} x2={k} y1="0" y2="40" className="tw-grid" vectorEffect="non-scaling-stroke" />
          ))}
          {spark && <path d={spark} className="tw-spark-out" vectorEffect="non-scaling-stroke" />}
          {spark && <path d={spark} className="tw-spark-in" clipPath={`url(#${clipId})`} vectorEffect="non-scaling-stroke" />}
        </svg>
        <div
          className="tw-sel"
          style={{ left: a * per, width: bars * per }}
          onPointerDown={begin("move")}
          onPointerMove={move}
          onPointerUp={end}
          tabIndex={0}
          role="group"
          aria-label={`${label} ${barTime(a)} to ${barEnd(b)}. Arrow keys move it.`}
          onKeyDown={keys("move")}
        >
          <div
            className="tw-h tw-h-start"
            role="slider"
            tabIndex={0}
            aria-label={`${label} start`}
            aria-valuemin={0}
            aria-valuemax={b}
            aria-valuenow={a}
            aria-valuetext={barTime(a)}
            onPointerDown={begin("start")}
            onPointerMove={move}
            onPointerUp={end}
            onKeyDown={(e) => {
              e.stopPropagation();
              keys("start")(e);
            }}
          />
          <div
            className="tw-h tw-h-end"
            role="slider"
            tabIndex={0}
            aria-label={`${label} end`}
            aria-valuemin={a}
            aria-valuemax={BARS - 1}
            aria-valuenow={b}
            aria-valuetext={barEnd(b)}
            onPointerDown={begin("end")}
            onPointerMove={move}
            onPointerUp={end}
            onKeyDown={(e) => {
              e.stopPropagation();
              keys("end")(e);
            }}
          />
        </div>
      </div>
      <div className="tw-ticks" aria-hidden="true">
        {LABELS.map((k) => (
          <span key={k} style={{ left: `${(k / BARS) * 100}%` }} className={k === 0 ? "first" : k === BARS ? "last" : ""}>
            {k === BARS ? "15:30" : barTime(k)}
          </span>
        ))}
      </div>
    </div>
  );
}
