import { useEffect, useMemo, useRef, useState } from "react";
import type { DayInfo } from "../api/types";
import { day, monthName } from "../lib/format";
import { useDismiss } from "../lib/hooks";
import { CalendarIcon, ChevronLeft, ChevronRight } from "./Icons";

/** Trading-day picker: only days with data are selectable; F&O days carry a dot, expiry days a ring.
 *  [ and ] step to the previous / next trading day. */
export function DatePicker({ days, value, onChange }: { days: DayInfo[]; value: string | null; onChange: (d: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), box);
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const idx = value ? days.findIndex((d) => d.date === value) : -1;
  const [ym, setYm] = useState(() => (value ?? days[days.length - 1]?.date ?? "2026-01-01").slice(0, 7));
  useEffect(() => {
    if (value) setYm(value.slice(0, 7));
  }, [value]);

  const step = (d: number) => {
    const n = idx + d;
    if (n >= 0 && n < days.length) onChange(days[n].date);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "[") step(-1);
      if (e.key === "]") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  const iso = (d: number) => `${ym}-${String(d).padStart(2, "0")}`;
  const shiftMonth = (k: number) => {
    const dt = new Date(Date.UTC(y, m - 1 + k, 1));
    setYm(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const minYm = days[0]?.date.slice(0, 7);
  const maxYm = days[days.length - 1]?.date.slice(0, 7);

  return (
    <div className="datepick" ref={box}>
      <button className="icon-btn" onClick={() => step(-1)} disabled={idx <= 0} title="Previous trading day  [">
        <ChevronLeft />
      </button>
      <button className="date-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <CalendarIcon />
        <span>{day(value, true)}</span>
      </button>
      <button className="icon-btn" onClick={() => step(1)} disabled={idx < 0 || idx >= days.length - 1} title="Next trading day  ]">
        <ChevronRight />
      </button>
      {open && (
        <div className="popover cal" role="dialog" aria-label="Choose trading day">
          <div className="cal-head">
            <button className="icon-btn" onClick={() => shiftMonth(-1)} disabled={!!minYm && ym <= minYm} aria-label="Previous month">
              <ChevronLeft />
            </button>
            <span>
              {monthName(m - 1)} {y}
            </span>
            <button className="icon-btn" onClick={() => shiftMonth(1)} disabled={!!maxYm && ym >= maxYm} aria-label="Next month">
              <ChevronRight />
            </button>
          </div>
          <div className="cal-grid">
            {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((w) => (
              <span key={w} className="cal-wd">
                {w}
              </span>
            ))}
            {cells.map((d, i) => {
              if (d === null) return <span key={`e${i}`} />;
              const info = byDate.get(iso(d));
              const sel = iso(d) === value;
              const fno = info?.futures || info?.options;
              return (
                <button
                  key={d}
                  disabled={!info}
                  className={`cal-day${sel ? " sel" : ""}${info?.expiry_day ? " expiry" : ""}${info && !info.full ? " short" : ""}`}
                  onClick={() => {
                    onChange(iso(d));
                    setOpen(false);
                  }}
                  title={info ? `${day(iso(d), true)}${fno ? " · F&O" : " · equity only"}${info.expiry_day ? " · expiry" : ""}${!info.full ? ` · short session (${info.bars} bars)` : ""}` : "No trading"}
                >
                  {d}
                  {fno && <i className="cal-dot" />}
                </button>
              );
            })}
          </div>
          <div className="cal-foot">
            <span>
              <i className="cal-dot static" /> F&amp;O data
            </span>
            <span>
              <i className="cal-ring" /> Expiry
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
