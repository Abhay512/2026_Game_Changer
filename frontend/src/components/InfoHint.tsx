import { METRIC_INFO } from "../content/metricInfo";
import { useHints } from "../state/hints";
import { InfoIcon } from "./Icons";

/** (i) toggle shown in a card header. */
export function InfoToggle({ id }: { id: string }) {
  const open = useHints((s) => s.open[id] ?? !s.dismissed[id]);
  const toggle = useHints((s) => s.toggle);
  const title = METRIC_INFO[id]?.title ?? "this metric";
  return (
    <button
      className="info-toggle"
      aria-expanded={open}
      aria-controls={`hint-${id}`}
      title={open ? "Hide explanation" : `What does ${title} tell me?`}
      onClick={(e) => {
        e.stopPropagation();
        toggle(id);
      }}
    >
      <InfoIcon />
      <span className="sr-only">About {title}</span>
    </button>
  );
}

/** The explainer itself, with "Don't show again" underneath. */
export function InfoHint({ id }: { id: string }) {
  const open = useHints((s) => s.open[id] ?? !s.dismissed[id]);
  const dismissed = useHints((s) => !!s.dismissed[id]);
  const setDismissed = useHints((s) => s.setDismissed);
  const info = METRIC_INFO[id];
  if (!open || !info) return null;
  return (
    <div className="hint" id={`hint-${id}`}>
      <p>
        <span className="hint-k">What it tells you</span>
        {info.what}
      </p>
      <p>
        <span className="hint-k">How to read it</span>
        {info.read}
      </p>
      <label className="hint-dismiss">
        <input type="checkbox" checked={dismissed} onChange={(e) => setDismissed(id, e.target.checked)} />
        Don't show again
      </label>
    </div>
  );
}
