import { Fragment, useMemo, useRef, useState } from "react";
import { apiUrl, useApi } from "../api/client";
import type { Chain, ChainCell, ChainDays, ChainRow, ComparedKey, Compare, SessionKey, StrikeSeries } from "../api/types";
import { compact, isNum, num, price, times } from "../lib/format";
import { barEnd, barTime, useView } from "../state/view";
import { useWindow } from "../state/window";
import { ChangeLines } from "./charts/ChangeLines";
import { DaysBars } from "./charts/DaysBars";

type View = "oi" | "greeks";

interface Col {
  key: keyof ChainCell & string;
  label: string;
  fmt: (n: number | null) => string;
  x?: ComparedKey; // show "2.4×" when today is unusual for this strike's moneyness
  bar?: boolean; // in-cell bar: size against the largest on screen (dashed when negative, i.e. OI fell)
  tone?: string; // extra cell class (volume reads in blue)
  sub?: keyof ChainCell & string; // small second line (change), green when up and red when down
  subFmt?: (n: number | null) => string;
}

const signed = (n: number | null) => compact(n, true);
const COLS: Record<View, Col[]> = {
  oi: [
    { key: "oi", label: "OI", fmt: compact, bar: true },
    { key: "oi_chg", label: "OI chg", fmt: signed, x: "oi_chg", bar: true },
    { key: "oi_5m", label: "Last 5m", fmt: signed, x: "oi_5m" },
    { key: "vol", label: "Volume", fmt: compact, x: "vol", tone: "vol" },
    { key: "iv", label: "IV", fmt: (n) => (isNum(n) ? n.toFixed(1) : "—") },
    { key: "ltp", label: "LTP", fmt: (n) => price(n), sub: "ltp_chg", subFmt: (n) => price(n, true) },
  ],
  greeks: [
    { key: "vega", label: "Vega", fmt: (n) => num(n, 3), sub: "vega_chg", subFmt: (n) => num(n, 3, true) },
    { key: "theta", label: "Theta", fmt: (n) => num(n, 2), sub: "theta_chg", subFmt: (n) => num(n, 2, true) },
    { key: "gamma", label: "Gamma", fmt: (n) => num(n, 4), sub: "gamma_chg", subFmt: (n) => num(n, 4, true) },
    { key: "delta", label: "Delta", fmt: (n) => num(n, 2), sub: "delta_chg", subFmt: (n) => num(n, 2, true) },
    { key: "iv", label: "IV", fmt: (n) => (isNum(n) ? n.toFixed(1) : "—"), sub: "iv_chg", subFmt: (n) => num(n, 1, true) },
    { key: "ltp", label: "LTP", fmt: (n) => price(n), sub: "ltp_chg", subFmt: (n) => price(n, true) },
  ],
};

// metrics with a "last N sessions" bar graph (click the cell), per column set
const SESSION: Record<View, SessionKey[]> = { oi: ["oi", "oi_chg", "vol", "iv"], greeks: ["vega", "theta", "gamma", "delta"] };
const SESSION_LABEL: Record<SessionKey, string> = { oi: "OI", oi_chg: "OI change", vol: "Volume", iv: "IV", vega: "Vega", theta: "Theta", gamma: "Gamma", delta: "Delta" };
const SESSION_FMT: Record<SessionKey, (n: number) => string> = {
  oi: (n) => compact(n),
  oi_chg: signed,
  vol: (n) => compact(n),
  iv: (n) => n.toFixed(1),
  vega: (n) => num(n, 3),
  theta: (n) => num(n, 2),
  gamma: (n) => num(n, 4),
  delta: (n) => num(n, 2),
};
const isSession = (view: View, k: string | undefined): k is SessionKey => !!k && (SESSION[view] as string[]).includes(k);

const UNUSUAL = 2; // a cell is flagged when today is ≥ 2× its usual value …
const MAX_FLAGS = 8; // … and it is among the most unusual cells on screen (so busy days don't flag everything)

function flagged(rows: ChainRow[], cols: Col[]): Set<string> {
  const all: { id: string; x: number }[] = [];
  for (const r of rows)
    for (const side of ["ce", "pe"] as const)
      for (const col of cols) {
        const x = col.x ? r[side]?.x[col.x] : null;
        if (isNum(x) && x >= UNUSUAL) all.push({ id: `${r.strike}-${side}-${col.key}`, x });
      }
  return new Set(all.sort((p, q) => q.x - p.x).slice(0, MAX_FLAGS).map((f) => f.id));
}

/** Direction of a formatted change, judged on what is shown: "+0.0000" stays neutral. */
function tone(text: string): string {
  if (!/[1-9]/.test(text)) return "";
  return text.startsWith("+") ? "up" : /^[−-]/.test(text) ? "down" : "";
}

function Cell({ c, col, side, max, itm, flag, focus }: { c: ChainCell | null; col: Col; side: "ce" | "pe"; max: number; itm: boolean; flag: boolean; focus: boolean }) {
  if (!c) return <td className={`nil${itm ? " itm" : ""}`}>—</td>;
  const v = c[col.key] as number | null;
  const x = col.x ? c.x[col.x] : null;
  const share = col.bar && isNum(v) && max > 0 ? Math.min(1, Math.abs(v) / max) : 0;
  const sub = col.sub ? col.subFmt!(c[col.sub] as number | null) : null;
  return (
    <td data-k={col.key} className={[col.bar && `oi-cell ${side}`, col.tone, itm && "itm", focus && "focus"].filter(Boolean).join(" ")}>
      {col.bar && <span className={`oi-bar${isNum(v) && v < 0 ? " fell" : ""}`} style={{ width: `calc((100% - 20px) * ${share})` }} />}
      <span className="cv">{col.fmt(v)}</span>
      {sub !== null && <span className={`cs ${tone(sub)}`}>{sub}</span>}
      {flag && isNum(x) && <span className="cx" title={`${times(x)} the usual value at this distance from ATM, same window`}>{times(x)}</span>}
    </td>
  );
}

export function ChainTable({ chain }: { chain: Chain }) {
  const [view, setView] = useState<View>("oi");
  // strikes whose panel is open (any number) -> the metric compared with past sessions, or null = intraday chart
  const [open, setOpen] = useState<Record<number, SessionKey | null>>({});
  const cols = COLS[view];
  const focusOf = (strike: number) => (strike in open ? open[strike] : undefined);
  // switching column sets keeps open panels open, on the new set's first metric
  const switchView = (v: View) => {
    setView(v);
    setOpen((o) => Object.fromEntries(Object.entries(o).map(([k, f]) => [k, f && !isSession(v, f) ? SESSION[v][0] : f])) as Record<number, SessionKey | null>);
  };
  const setFocus = (strike: number, k: SessionKey | null) => setOpen((o) => ({ ...o, [strike]: k }));
  // a metric cell opens (or switches to) that metric's sessions graph; any other cell opens the intraday
  // chart; clicking the same thing again closes the panel
  const onRow = (strike: number, k: string | undefined) =>
    setOpen((o) => {
      const metric = isSession(view, k) ? k : null;
      if (!(strike in o) || (metric && o[strike] !== metric)) return { ...o, [strike]: metric };
      const rest = { ...o };
      delete rest[strike];
      return rest;
    });
  // each bar column is scaled to its own largest |value| on screen, calls and puts together
  const barMax = useMemo(() => {
    const m: Record<string, number> = {};
    for (const col of cols.filter((c) => c.bar))
      m[col.key] = Math.max(0, ...chain.rows.flatMap((r) => [r.ce, r.pe].map((s) => Math.abs((s?.[col.key] as number | null) ?? 0) || 0)));
    return m;
  }, [chain, cols]);
  const flags = useMemo(() => flagged(chain.rows, cols), [chain, cols]);
  const spot = chain.spot;
  // index after which the spot line sits
  const spotAfter = isNum(spot) ? chain.rows.findIndex((r, i) => r.strike <= spot && (chain.rows[i + 1]?.strike ?? Infinity) > spot) : -1;

  return (
    <div className="chain">
      <div className="chain-tools">
        <div className="seg" role="group" aria-label="Columns">
          <button aria-pressed={view === "oi"} onClick={() => switchView("oi")}>
            OI &amp; volume
          </button>
          <button aria-pressed={view === "greeks"} onClick={() => switchView("greeks")}>
            Greeks
          </button>
        </div>
        <span className="muted chain-help">
          Changes are since the window start{view === "oi" && " · bars show size (dashed = OI fell)"} · <span className="cx static">2.4×</span> = the {MAX_FLAGS} most unusual cells (≥ {UNUSUAL}× the same strike distance on the last {chain.baseline.n} sessions) · click a value to compare it with past sessions, or the strike for its intraday chart
        </span>
      </div>
      <div className="chain-scroll">
        <table className="chain-table">
          <thead>
            <tr className="sides">
              <th colSpan={cols.length} className="side-ce">
                Calls (CE)
              </th>
              <th className="strike-h">Strike</th>
              <th colSpan={cols.length} className="side-pe">
                Puts (PE)
              </th>
            </tr>
            <tr>
              {cols.map((c) => (
                <th key={"ce" + c.key}>{c.label}</th>
              ))}
              <th className="strike-h" />
              {[...cols].reverse().map((c) => (
                <th key={"pe" + c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chain.rows.map((r: ChainRow, i) => {
              const ceItm = isNum(spot) && r.strike < spot;
              const peItm = isNum(spot) && r.strike > spot;
              return (
                <Fragment key={r.strike}>
                  <tr
                    className={`${r.atm ? "atm" : ""}${r.strike in open ? " open" : ""}`}
                    onClick={(e) => onRow(r.strike, (e.target as HTMLElement).closest("td")?.dataset.k)}
                  >
                    {cols.map((c) => (
                      <Cell key={"ce" + c.key} c={r.ce} col={c} side="ce" max={barMax[c.key] ?? 0} itm={ceItm} flag={flags.has(`${r.strike}-ce-${c.key}`)} focus={focusOf(r.strike) === c.key} />
                    ))}
                    <td className="strike">
                      {num(r.strike, r.strike % 1 ? 1 : 0)}
                      {r.strike === chain.max_pain && <span className="mp-tag" title="Max pain">MP</span>}
                    </td>
                    {[...cols].reverse().map((c) => (
                      <Cell key={"pe" + c.key} c={r.pe} col={c} side="pe" max={barMax[c.key] ?? 0} itm={peItm} flag={flags.has(`${r.strike}-pe-${c.key}`)} focus={focusOf(r.strike) === c.key} />
                    ))}
                  </tr>
                  {r.strike in open && (
                    <tr className="strike-detail-row">
                      <td colSpan={cols.length * 2 + 1}>
                        <StrikeDetail chain={chain} row={r} keys={SESSION[view]} focus={open[r.strike]} onFocus={(k) => setFocus(r.strike, k)} />
                      </td>
                    </tr>
                  )}
                  {i === spotAfter && (
                    <tr className="spot-row" aria-label={`Spot ${price(spot)}`}>
                      <td colSpan={cols.length * 2 + 1}>
                        <span>Spot {price(spot)}</span>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function grid(s: StrikeSeries | null, key: "oi" | "close"): (number | null)[] {
  const out: (number | null)[] = Array(75).fill(null);
  if (!s) return out;
  s.bars.forEach((b, k) => (out[b] = s[key][k]));
  return out;
}

/** A chain row's panel: this strike against the last N sessions (one metric), or its intraday chart. */
function StrikeDetail({ chain, row, keys, focus, onFocus }: { chain: Chain; row: ChainRow; keys: SessionKey[]; focus: SessionKey | null; onFocus: (k: SessionKey | null) => void }) {
  const lookback = useView((s) => s.lookback);
  const last = useRef<SessionKey>(keys[0]);
  const metric = focus ? (keys.includes(focus) ? focus : keys[0]) : null; // the column set may have changed
  if (metric) last.current = metric;
  return (
    <div className="strike-panel">
      <div className="seg" role="group" aria-label="Graph">
        <button aria-pressed={metric !== null} onClick={() => onFocus(keys.includes(last.current) ? last.current : keys[0])}>
          Last {lookback} sessions
        </button>
        <button aria-pressed={metric === null} onClick={() => onFocus(null)}>
          Intraday
        </button>
      </div>
      {metric ? <StrikeDays chain={chain} row={row} keys={keys} metric={metric} onMetric={onFocus} /> : <StrikeIntraday chain={chain} strike={row.strike} />}
    </div>
  );
}

const offsetText = (o: number) => (o === 0 ? "ATM" : `ATM${o > 0 ? "+" : "−"}${Math.abs(o)}`);

/** The same window on each of the last N sessions, at this row's distance from ATM: calls and puts side by side. */
function StrikeDays({ chain, row, keys, metric, onMetric }: { chain: Chain; row: ChainRow; keys: SessionKey[]; metric: SessionKey; onMetric: (k: SessionKey) => void }) {
  const { symbol, date, lookback, setLookback } = useView();
  const { a, b } = useWindow(); // the option chain section's window
  const url = symbol && date ? apiUrl(`chain/${encodeURIComponent(symbol)}/days`, { date, from: barTime(a), to: barEnd(b), lookback, expiry: chain.expiry, offset: row.offset }) : null;
  const res = useApi<ChainDays>(url);
  const d = res.data?.available && res.data.offset === row.offset ? res.data : null;
  return (
    <div className={`strike-days${res.loading ? " is-loading" : ""}`}>
      <div className="strike-days-tools">
        <div className="seg" role="group" aria-label="Metric">
          {keys.map((k) => (
            <button key={k} aria-pressed={k === metric} onClick={() => onMetric(k)}>
              {SESSION_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Sessions to compare">
          {[10, 20, 30].map((n) => (
            <button key={n} aria-pressed={lookback === n} onClick={() => setLookback(n)} title={`Compare with the last ${n} sessions`}>
              {n}
            </button>
          ))}
        </div>
        <span className="muted strike-days-help">
          {barTime(a)}–{barEnd(b)} on each session, at the same distance from ATM ({offsetText(row.offset)}, that day's own strike)
        </span>
      </div>
      {res.error && <p className="error">Could not load past sessions: {res.error.message}</p>}
      {res.data && !res.data.available && <p className="muted">{res.data.reason}</p>}
      {!res.data && !res.error && <p className="muted">Loading past sessions…</p>}
      {d && (
        <div className="strike-days-charts">
          {(["ce", "pe"] as const).map((side) => (
            <SideDays key={side} side={side} d={d} cmp={d[side]?.[metric] ?? null} metric={metric} date={date ?? ""} />
          ))}
        </div>
      )}
    </div>
  );
}

function SideDays({ side, d, cmp, metric, date }: { side: "ce" | "pe"; d: ChainDays; cmp: Compare | null; metric: SessionKey; date: string }) {
  const name = `${side === "ce" ? "Call" : "Put"} ${num(d.strike)} ${side.toUpperCase()}`;
  const strikeText = (k: number | null) => (isNum(k) ? num(k, k % 1 ? 1 : 0) : null);
  return (
    <div className="side-days">
      <h4>
        <span className="key-line" style={{ background: side === "ce" ? "var(--ce)" : "var(--pe)" }} /> {name} · {SESSION_LABEL[metric]}
      </h4>
      {!cmp ? (
        <p className="muted">Not listed on this side.</p>
      ) : (
        <>
          <ul className="legend">
            <li>
              <span className="key-rect" style={{ background: "var(--base-bar)" }} /> Each session
            </li>
            <li>
              <span className="key-rect" style={{ background: "var(--accent)" }} /> Today
            </li>
          </ul>
          <DaysBars
            days={d.baseline.days}
            hist={cmp.hist ?? []}
            today={cmp.value}
            todayDate={date}
            avg={cmp.avg}
            abs={cmp.abs}
            format={SESSION_FMT[metric]}
            detail={{ key: "Strike", days: d.strikes.map(strikeText), today: strikeText(d.strike) }}
            height={200}
            label={`${name} ${SESSION_LABEL[metric]}: same window on the last ${d.baseline.n} sessions`}
          />
          <p className="detail-foot muted">
            {isNum(cmp.x)
              ? `Today${cmp.abs ? " (size)" : ""} is ${times(cmp.x)} the ${cmp.n}-session average and higher than ${isNum(cmp.pct) ? Math.round(cmp.pct) : "—"}% of them.`
              : "No comparison: too few past sessions have a value."}
            {cmp.n < d.baseline.n && ` ${d.baseline.n - cmp.n} of the ${d.baseline.n} sessions ${d.baseline.n - cmp.n === 1 ? "has" : "have"} no value (expiry days have no IV or Greeks).`}
          </p>
        </>
      )}
    </div>
  );
}

/** Intraday OI and premium of one strike, calls vs puts, over the selected window. */
function StrikeIntraday({ chain, strike }: { chain: Chain; strike: number }) {
  const { symbol, date } = useView();
  const { a, b } = useWindow(); // the option chain section's window
  const url = (right: "CE" | "PE") => (symbol && date ? apiUrl(`strike/${encodeURIComponent(symbol)}`, { date, expiry: chain.expiry, strike, right }) : null);
  const ce = useApi<StrikeSeries>(url("CE"));
  const pe = useApi<StrikeSeries>(url("PE"));
  const colors = { today: "var(--ce)", base: "var(--pe)" };
  return (
    <div className="strike-detail">
      <div>
        <h4>
          Open interest · {num(strike)} · from {barTime(a)}
        </h4>
        <ul className="legend">
          <li>
            <span className="key-line" style={{ background: "var(--ce)" }} /> Call {num(strike)} CE
          </li>
          <li>
            <span className="key-line" style={{ background: "var(--pe)" }} /> Put {num(strike)} PE
          </li>
        </ul>
        <ChangeLines a={a} b={b} today={grid(ce.data, "oi")} base={grid(pe.data, "oi")} colors={colors} format={(n) => compact(n)} todayName="CE OI" baseName="PE OI" height={190} label={`OI of ${strike} CE and PE`} />
      </div>
      <div>
        <h4>Premium (LTP)</h4>
        <ul className="legend">
          <li>
            <span className="key-line" style={{ background: "var(--ce)" }} /> CE
          </li>
          <li>
            <span className="key-line" style={{ background: "var(--pe)" }} /> PE
          </li>
        </ul>
        <ChangeLines a={a} b={b} today={grid(ce.data, "close")} base={grid(pe.data, "close")} colors={colors} format={(n) => price(n)} todayName="CE" baseName="PE" height={190} label={`Premium of ${strike} CE and PE`} />
      </div>
    </div>
  );
}
