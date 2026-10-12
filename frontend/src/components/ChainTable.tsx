import { Fragment, useMemo, useState } from "react";
import { apiUrl, useApi } from "../api/client";
import type { Chain, ChainCell, ChainRow, ComparedKey, StrikeSeries } from "../api/types";
import { compact, isNum, num, price, times } from "../lib/format";
import { barTime, useView } from "../state/view";
import { useWindow } from "../state/window";
import { ChangeLines } from "./charts/ChangeLines";

type View = "oi" | "greeks";

interface Col {
  key: keyof ChainCell & string;
  label: string;
  fmt: (n: number | null) => string;
  x?: ComparedKey; // show "2.4×" when today is unusual for this strike's moneyness
  bar?: boolean; // in-cell OI bar
  sub?: keyof ChainCell & string; // small second line (change)
  subFmt?: (n: number | null) => string;
}

const signed = (n: number | null) => compact(n, true);
const COLS: Record<View, Col[]> = {
  oi: [
    { key: "oi", label: "OI", fmt: compact, bar: true },
    { key: "oi_chg", label: "OI chg", fmt: signed, x: "oi_chg" },
    { key: "oi_5m", label: "Last 5m", fmt: signed, x: "oi_5m" },
    { key: "vol", label: "Volume", fmt: compact, x: "vol" },
    { key: "iv", label: "IV", fmt: (n) => (isNum(n) ? n.toFixed(1) : "—") },
    { key: "ltp", label: "LTP", fmt: (n) => price(n), sub: "ltp_chg", subFmt: (n) => price(n, true) },
  ],
  greeks: [
    { key: "vega", label: "Vega", fmt: (n) => num(n, 3), sub: "vega_chg", subFmt: (n) => num(n, 3, true) },
    { key: "theta", label: "Theta", fmt: (n) => num(n, 2), sub: "theta_chg", subFmt: (n) => num(n, 2, true) },
    { key: "gamma", label: "Gamma", fmt: (n) => num(n, 4), sub: "gamma_chg", subFmt: (n) => num(n, 4, true) },
    { key: "delta", label: "Delta", fmt: (n) => num(n, 2), sub: "delta_chg", subFmt: (n) => num(n, 2, true) },
    { key: "iv", label: "IV", fmt: (n) => (isNum(n) ? n.toFixed(1) : "—"), sub: "iv_chg", subFmt: (n) => (isNum(n) ? (n > 0 ? "+" : "") + n.toFixed(1) : "—") },
    { key: "ltp", label: "LTP", fmt: (n) => price(n), sub: "ltp_chg", subFmt: (n) => price(n, true) },
  ],
};

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

function Cell({ c, col, side, maxOi, itm, flag }: { c: ChainCell | null; col: Col; side: "ce" | "pe"; maxOi: number; itm: boolean; flag: boolean }) {
  if (!c) return <td className={`nil${itm ? " itm" : ""}`}>—</td>;
  const v = c[col.key] as number | null;
  const x = col.x ? c.x[col.x] : null;
  const pct = col.bar && isNum(v) && maxOi > 0 ? Math.min(100, (v / maxOi) * 100) : 0;
  return (
    <td className={`${col.bar ? `oi-cell ${side}` : ""}${itm ? " itm" : ""}`}>
      {col.bar && <span className="oi-bar" style={{ width: `${pct}%` }} />}
      <span className="cv">{col.fmt(v)}</span>
      {col.sub && <span className="cs">{col.subFmt!(c[col.sub] as number | null)}</span>}
      {flag && isNum(x) && <span className="cx" title={`${times(x)} the usual value at this distance from ATM, same window`}>{times(x)}</span>}
    </td>
  );
}

export function ChainTable({ chain }: { chain: Chain }) {
  const [view, setView] = useState<View>("oi");
  const [open, setOpen] = useState<number[]>([]); // strikes whose intraday chart is open (any number)
  const cols = COLS[view];
  const maxOi = useMemo(() => Math.max(0, ...chain.rows.flatMap((r) => [r.ce?.oi ?? 0, r.pe?.oi ?? 0])), [chain]);
  const flags = useMemo(() => flagged(chain.rows, cols), [chain, cols]);
  const spot = chain.spot;
  // index after which the spot line sits
  const spotAfter = isNum(spot) ? chain.rows.findIndex((r, i) => r.strike <= spot && (chain.rows[i + 1]?.strike ?? Infinity) > spot) : -1;

  return (
    <div className="chain">
      <div className="chain-tools">
        <div className="seg" role="group" aria-label="Columns">
          <button aria-pressed={view === "oi"} onClick={() => setView("oi")}>
            OI &amp; volume
          </button>
          <button aria-pressed={view === "greeks"} onClick={() => setView("greeks")}>
            Greeks
          </button>
        </div>
        <span className="muted chain-help">
          Changes are since the window start · <span className="cx static">2.4×</span> = the {MAX_FLAGS} most unusual cells (≥ {UNUSUAL}× the same strike distance on the last {chain.baseline.n} sessions) · click a row for its intraday chart
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
                    className={`${r.atm ? "atm" : ""}${open.includes(r.strike) ? " open" : ""}`}
                    onClick={() => setOpen((o) => (o.includes(r.strike) ? o.filter((k) => k !== r.strike) : [...o, r.strike]))}
                  >
                    {cols.map((c) => (
                      <Cell key={"ce" + c.key} c={r.ce} col={c} side="ce" maxOi={maxOi} itm={ceItm} flag={flags.has(`${r.strike}-ce-${c.key}`)} />
                    ))}
                    <td className="strike">
                      {num(r.strike, r.strike % 1 ? 1 : 0)}
                      {r.strike === chain.max_pain && <span className="mp-tag" title="Max pain">MP</span>}
                    </td>
                    {[...cols].reverse().map((c) => (
                      <Cell key={"pe" + c.key} c={r.pe} col={c} side="pe" maxOi={maxOi} itm={peItm} flag={flags.has(`${r.strike}-pe-${c.key}`)} />
                    ))}
                  </tr>
                  {open.includes(r.strike) && (
                    <tr className="strike-detail-row">
                      <td colSpan={cols.length * 2 + 1}>
                        <StrikeDetail chain={chain} strike={r.strike} />
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

/** Intraday OI and premium of one strike, calls vs puts, over the selected window. */
function StrikeDetail({ chain, strike }: { chain: Chain; strike: number }) {
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
