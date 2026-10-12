import { useContext, useState } from "react";
import { DetailPanel, type DetailSpec } from "../components/DetailPanel";
import { ClockIcon } from "../components/Icons";
import { TimeWindow } from "../components/TimeWindow";
import { duration } from "../lib/format";
import { barEnd, barTime, useView } from "../state/view";
import { ClosesCtx, useSectionWindow, WindowCtx } from "../state/window";

/** A titled group of metric cards with its own time control.
 *  - The clock button in the header shows the window this section describes; it opens a scrubber.
 *  - Moving that scrubber gives the section its own window (other sections keep following the main one);
 *    "Follow main" links it back.
 *  - Every graph opened from its cards appears full-width under the group (in card order), uses the
 *    section's window, and stays open until its own close button is used. */
export function Section({
  id,
  title,
  sub,
  tools,
  specs,
  loading,
  timeOpen = false,
  children,
}: {
  id: string;
  title: string;
  sub?: React.ReactNode;
  tools?: React.ReactNode;
  specs?: Record<string, DetailSpec>;
  loading?: boolean;
  timeOpen?: boolean; // show the section scrubber initially
  children: React.ReactNode;
}) {
  const open = useView((s) => s.details);
  const setSectionWindow = useView((s) => s.setSectionWindow);
  const followMain = useView((s) => s.followMain);
  const win = useSectionWindow(id);
  const closes = useContext(ClosesCtx);
  const [showTime, setShowTime] = useState(timeOpen || win.own);
  const panels = specs ? Object.values(specs).filter((sp) => open.includes(sp.id)) : [];
  const follow = (
    <button className={`tw-follow${win.own ? "" : " on"}`} onClick={() => followMain(id)} disabled={!win.own} title={win.own ? "Use the main window again" : "Move this scrubber to give the section its own window"}>
      {win.own ? "Follow main window" : "Following main window"}
    </button>
  );
  return (
    <WindowCtx.Provider value={win}>
      <section className={`section${loading ? " is-loading" : ""}`} id={`sec-${id}`} aria-labelledby={`h-${id}`}>
        <header className="sec-head">
          <div>
            <div className="sec-title">
              <h2 id={`h-${id}`}>{title}</h2>
              <button
                className={`time-chip${win.own ? " own" : ""}`}
                aria-expanded={showTime}
                aria-controls={`tw-${id}`}
                onClick={() => setShowTime((v) => !v)}
                title={showTime ? "Hide this section's time window" : "Set a custom time window for this section"}
              >
                <ClockIcon />
                <span className="mono">
                  {barTime(win.a)}–{barEnd(win.b)}
                </span>
                <span className="time-chip-k">{win.own ? "custom" : "main"}</span>
              </button>
              {win.own && (
                <button className="link" onClick={() => followMain(id)} title="Use the main window again">
                  Follow main
                </button>
              )}
            </div>
            {sub && <p className="sec-sub">{sub}</p>}
          </div>
          {tools && <div className="sec-tools">{tools}</div>}
        </header>
        {showTime && (
          <div className="sec-window" id={`tw-${id}`}>
            <TimeWindow a={win.a} b={win.b} onChange={(a, b) => setSectionWindow(id, a, b)} closes={closes} label={`${title} window`} extra={follow} />
            <p className="sec-window-note muted">
              {win.own
                ? `${title} shows ${barTime(win.a)}–${barEnd(win.b)} (${duration(win.b - win.a + 1)}); the rest of the page keeps the main window.`
                : "This section follows the main window. Drag here to give it its own time."}
            </p>
          </div>
        )}
        <div className="cards">{children}</div>
        {panels.map((spec) => (
          <DetailPanel key={spec.id + spec.src + (spec.metric ?? "")} spec={spec} />
        ))}
      </section>
    </WindowCtx.Provider>
  );
}
