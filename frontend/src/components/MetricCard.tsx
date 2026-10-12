import type { Compare } from "../api/types";
import { direction, isNum, ordinalPct, times } from "../lib/format";
import { useView } from "../state/view";
import { InfoHint, InfoToggle } from "./InfoHint";
import { RangeStrip } from "./RangeStrip";

export interface Delta {
  text: string;
  value: number | null; // sign picks ▲ / ▼ and color
}

interface Props {
  id: string; // also the info-tip id and the detail id
  label: string;
  value: string;
  unit?: string;
  delta?: Delta;
  cmp?: Compare | null;
  cmpLabel?: string; // what the × compares, e.g. "usual move"
  avgText?: string; // formatted baseline average
  meta?: React.ReactNode;
  tag?: React.ReactNode;
  detail?: boolean; // clicking the value opens a graph (default true)
  hideX?: boolean; // the value already is the × (speed cards)
  onOpen?: () => void; // custom click (e.g. switch a section chart) instead of the detail graph
  active?: boolean; // highlighted when onOpen drives something
}

export function MetricCard({ id, label, value, unit, delta, cmp, cmpLabel = "20D avg", avgText, meta, tag, detail = true, hideX, onOpen, active }: Props) {
  const isDetail = useView((s) => s.details.includes(id));
  const open = onOpen ? !!active : isDetail;
  const toggleDetail = useView((s) => s.toggleDetail);
  const dir = delta ? direction(delta.value) : "flat";
  const body = (
    <>
      <span className="card-value">
        {value}
        {unit && <span className="card-unit">{unit}</span>}
      </span>
      {delta && (
        <span className={`card-delta ${dir}`}>
          {dir === "up" ? "▲" : dir === "down" ? "▼" : ""}
          {delta.text}
        </span>
      )}
    </>
  );
  return (
    <article className={`card${open ? " card-open" : ""}`} aria-labelledby={`lbl-${id}`}>
      <header className="card-head">
        <h3 id={`lbl-${id}`}>{label}</h3>
        {tag}
        <InfoToggle id={id} />
      </header>
      {detail ? (
        <button className="card-main" aria-expanded={open} aria-controls={onOpen ? undefined : `detail-${id}`} onClick={() => (onOpen ? onOpen() : toggleDetail(id))} title={onOpen ? "Show in the chart below" : open ? "Hide graph" : "Show graph"}>
          {body}
        </button>
      ) : (
        <div className="card-main">{body}</div>
      )}
      {cmp && (
        <>
          <div className="card-cmp">
            {!hideX && <span className="card-x">{times(cmp.x)}</span>}
            <span className="card-cmp-text">
              {cmpLabel}
              {avgText && <> · {avgText}</>}
            </span>
            {isNum(cmp.pct) && (
              <span className="chip" title={`Higher than ${Math.round(cmp.pct)}% of the last ${cmp.n} sessions`}>
                {ordinalPct(cmp.pct)}
              </span>
            )}
          </div>
          <RangeStrip cmp={cmp} label={label} />
        </>
      )}
      {meta && <div className="card-meta">{meta}</div>}
      <InfoHint id={id} />
    </article>
  );
}

export function Unavailable({ reason }: { reason: string }) {
  return <div className="unavailable">{reason}</div>;
}
