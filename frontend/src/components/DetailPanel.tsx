import { useEffect, useMemo, useState } from "react";
import { apiUrl, useApi } from "../api/client";
import type { Bars, Compare, Series } from "../api/types";
import { day, isNum, times } from "../lib/format";
import { barEnd, barTime, useView } from "../state/view";
import { useWindow } from "../state/window";
import { ChangeLines } from "./charts/ChangeLines";
import { DaysBars } from "./charts/DaysBars";
import { IntradayBars } from "./charts/IntradayBars";
import { CloseIcon } from "./Icons";

export type IntradayKind = "bars" | "stack" | "change" | "move" | "vwap" | "level" | "cumratio" | "pain";

export interface DetailSpec {
  id: string;
  title: string;
  src: "spot" | "fut" | "opt";
  intraday: IntradayKind;
  metric?: string; // series metric for bars / change / move
  cmp?: Compare | null; // drives the "last N sessions" view
  baselineDays?: string[];
  format: (n: number) => string; // formats the card's value / 20-day bars
  seriesFormat?: (n: number) => string; // formats the intraday series (defaults to format)
  changeName?: string; // legend name for the intraday change line
}

type Tab = "intraday" | "days" | "table";

function Legend({ items }: { items: { name: string; color: string; line?: boolean }[] }) {
  return (
    <ul className="legend">
      {items.map((i) => (
        <li key={i.name}>
          <span className={i.line ? "key-line" : "key-rect"} style={{ background: i.color }} />
          {i.name}
        </li>
      ))}
    </ul>
  );
}

export function DetailPanel({ spec }: { spec: DetailSpec }) {
  const { symbol, date, lookback, expiry } = useView();
  const { a, b } = useWindow(); // the window of the section this graph belongs to
  const toggleDetail = useView((s) => s.toggleDetail);
  const [tab, setTab] = useState<Tab>("intraday");
  const [cumulative, setCumulative] = useState(false);
  const hasDays = !!spec.cmp?.hist?.length && !!spec.baselineDays?.length;
  useEffect(() => {
    if (tab === "days" && !hasDays) setTab("intraday");
  }, [hasDays, tab]);

  const base = { date, from: barTime(a), to: barEnd(b), lookback, src: spec.src, expiry: spec.src === "opt" ? expiry : null };
  const sym = symbol ? encodeURIComponent(symbol) : "";
  const seriesUrl = (metric: string | undefined) => (symbol && date && metric ? apiUrl(`series/${sym}`, { ...base, metric }) : null);
  const stack = spec.intraday === "stack";
  const main = useApi<Series>(seriesUrl(stack ? "buy" : spec.intraday === "vwap" ? undefined : spec.metric));
  const sell = useApi<Series>(stack ? seriesUrl("sell") : null);
  const ratio = useApi<Series>(stack && cumulative ? seriesUrl("bs_ratio") : null);
  const spot = useApi<Series>(spec.intraday === "pain" ? seriesUrl("spot") : null);
  const bars = useApi<Bars>(spec.intraday === "vwap" && symbol && date ? apiUrl(`bars/${sym}`, { src: spec.src, date, days: 1 }) : null);

  const sf = spec.seriesFormat ?? spec.format;
  const s = main.data;
  const loading = main.loading || sell.loading || ratio.loading || bars.loading || spot.loading;
  const windowText = `${barTime(a)}–${barEnd(b)}`;

  const intraday = useMemo(() => {
    if (spec.intraday === "vwap") {
      const d = bars.data;
      if (!d) return null;
      const close = Array(75).fill(null) as (number | null)[];
      const vwap = Array(75).fill(null) as (number | null)[];
      const t0 = d.t[0] - ((d.t[0] / 60) % 1440 - 555) * 60; // 09:15 of the day
      d.t.forEach((t, k) => {
        const i = Math.round((t - t0) / 300);
        if (i >= 0 && i < 75) {
          close[i] = d.c[k];
          vwap[i] = d.vwap[k];
        }
      });
      return (
        <>
          <Legend items={[{ name: "Close", color: "var(--accent)", line: true }, { name: "VWAP (from 09:15)", color: "var(--base)", line: true }]} />
          <ChangeLines a={a} b={b} today={close} base={vwap} format={sf} todayName="Close" baseName="VWAP" label={`Close vs VWAP, ${windowText}`} />
        </>
      );
    }
    if (!s) return null;
    if (spec.intraday === "level") {
      return (
        <>
          <Legend items={[{ name: "Today", color: "var(--accent)", line: true }, { name: `Avg of last ${s.baseline.n} sessions, same time`, color: "var(--base)", line: true }]} />
          <ChangeLines a={a} b={b} today={s.today} base={s.base} format={sf} label={`${spec.title} through the window`} />
        </>
      );
    }
    if (spec.intraday === "cumratio") {
      return (
        <>
          <Legend items={[{ name: "Today, since window start", color: "var(--accent)", line: true }, { name: `Avg of last ${s.baseline.n} sessions`, color: "var(--base)", line: true }]} />
          <ChangeLines a={a} b={b} today={s.today_cum ?? []} base={s.base_cum} format={sf} label={`${spec.title} since ${barTime(a)}`} />
        </>
      );
    }
    if (spec.intraday === "pain") {
      return (
        <>
          <Legend items={[{ name: "Max pain", color: "var(--accent)", line: true }, { name: "Spot", color: "var(--base)", line: true }]} />
          <ChangeLines a={a} b={b} today={s.today} base={spot.data?.today} format={sf} todayName="Max pain" baseName="Spot" label="Max pain and spot through the window" />
        </>
      );
    }
    if (stack) {
      if (cumulative && ratio.data) {
        return (
          <>
            <Legend items={[{ name: "Today: buy ÷ sell since window start", color: "var(--accent)", line: true }, { name: "Same on last sessions (avg)", color: "var(--base)", line: true }]} />
            <ChangeLines a={a} b={b} today={ratio.data.today_cum ?? []} base={ratio.data.base_cum} format={(n) => n.toFixed(2)} label="Cumulative buy/sell ratio" />
          </>
        );
      }
      return (
        <>
          <Legend items={[{ name: "Buy (est.)", color: "var(--up)" }, { name: "Sell (est.)", color: "var(--down)" }]} />
          <IntradayBars labels={s.labels} a={a} b={b} format={sf} stack={{ bottom: s.today, top: sell.data?.today ?? [], bottomName: "Buy", topName: "Sell" }} label="Buy and sell volume per 5-minute bar" />
        </>
      );
    }
    if (spec.intraday === "change") {
      const chg = s.today_chg ?? s.today;
      const env = s.base_abs_chg ?? s.base;
      return (
        <>
          <Legend items={[{ name: spec.changeName ?? "Today, change since window start", color: "var(--accent)", line: true }, { name: `Typical size on last ${s.baseline.n} sessions (±)`, color: "var(--base)" }]} />
          <ChangeLines a={a} b={b} today={chg} envelope={env} anchor format={sf} label={`${spec.title}: change since ${barTime(a)}`} />
        </>
      );
    }
    if (cumulative && s.today_cum) {
      return (
        <>
          <Legend items={[{ name: "Today, running total", color: "var(--accent)", line: true }, { name: `Avg of last ${s.baseline.n} sessions`, color: "var(--base)", line: true }]} />
          <ChangeLines a={a} b={b} today={s.today_cum} base={s.base_cum} anchor format={sf} label={`${spec.title}: running total since ${barTime(a)}`} />
        </>
      );
    }
    return (
      <>
        <Legend items={[{ name: "Today (window)", color: "var(--accent)" }, { name: "Today (outside window)", color: "var(--base-bar)" }, { name: `Avg of last ${s.baseline.n} sessions, same bar`, color: "var(--base)", line: true }]} />
        <IntradayBars labels={s.labels} a={a} b={b} format={sf} today={s.today} base={s.base} label={`${spec.title} per 5-minute bar`} />
      </>
    );
  }, [spec, s, sell.data, ratio.data, bars.data, spot.data, cumulative, a, b, sf, stack, windowText]);

  const canCumulate = spec.intraday === "bars" || stack;

  return (
    <section className={`detail${loading ? " is-loading" : ""}`} id={`detail-${spec.id}`} aria-label={`${spec.title} graph`}>
      <header className="detail-head">
        <div>
          <h3>{spec.title}</h3>
          <p className="muted">
            {symbol} · {day(date, true)} · {windowText}
          </p>
        </div>
        <div className="detail-tools">
          <div className="seg" role="group" aria-label="View">
            <button aria-pressed={tab === "intraday"} onClick={() => setTab("intraday")}>
              Intraday
            </button>
            {hasDays && (
              <button aria-pressed={tab === "days"} onClick={() => setTab("days")}>
                Last {spec.baselineDays!.length} sessions
              </button>
            )}
            <button aria-pressed={tab === "table"} onClick={() => setTab("table")}>
              Table
            </button>
          </div>
          {tab === "intraday" && canCumulate && (
            <div className="seg" role="group" aria-label="Aggregation">
              <button aria-pressed={!cumulative} onClick={() => setCumulative(false)}>
                Per bar
              </button>
              <button aria-pressed={cumulative} onClick={() => setCumulative(true)}>
                {stack ? "Running ratio" : "Running total"}
              </button>
            </div>
          )}
          <button className="icon-btn" onClick={() => toggleDetail(spec.id)} title="Close graph">
            <CloseIcon />
          </button>
        </div>
      </header>

      {main.error && <p className="error">Could not load this graph: {main.error.message}</p>}

      {tab === "intraday" && intraday}

      {tab === "days" && hasDays && spec.cmp && (
        <>
          <Legend items={[{ name: `Same window ${windowText}, each session`, color: "var(--base-bar)" }, { name: "Today", color: "var(--accent)" }]} />
          <DaysBars
            days={spec.baselineDays!}
            hist={spec.cmp.hist ?? []}
            today={spec.cmp.value}
            todayDate={date ?? ""}
            avg={spec.cmp.avg}
            abs={spec.cmp.abs}
            format={spec.format}
            label={`${spec.title}: same window on the last ${spec.baselineDays!.length} sessions`}
          />
          <p className="detail-foot muted">
            Today {spec.cmp.abs ? "(size)" : ""} is {times(spec.cmp.x)} the average and higher than {isNum(spec.cmp.pct) ? Math.round(spec.cmp.pct) : "—"}% of these sessions.
          </p>
        </>
      )}

      {tab === "table" && <DetailTable spec={spec} series={stack ? null : s} a={a} b={b} sf={sf} />}
    </section>
  );
}

function DetailTable({ spec, series, a, b, sf }: { spec: DetailSpec; series: Series | null; a: number; b: number; sf: (n: number) => string }) {
  const rows = series ? Array.from({ length: b - a + 1 }, (_, k) => a + k) : [];
  const chg = series?.today_chg;
  return (
    <div className="tables">
      {series && (
        <table className="data">
          <caption>Bars in the window</caption>
          <thead>
            <tr>
              <th>Bar</th>
              <th>Today</th>
              <th>{chg ? "Change since start" : `Avg, last ${series.baseline.n}`}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i}>
                <td>{series.labels[i]}</td>
                <td>{isNum(series.today[i]) ? sf(series.today[i] as number) : "—"}</td>
                <td>{chg ? (isNum(chg[i]) ? sf(chg[i] as number) : "—") : isNum(series.base[i]) ? sf(series.base[i] as number) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {spec.cmp?.hist && spec.baselineDays && (
        <table className="data">
          <caption>Same window, previous sessions</caption>
          <thead>
            <tr>
              <th>Session</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {spec.baselineDays.map((d, i) => (
              <tr key={d}>
                <td>{day(d, true)}</td>
                <td>{isNum(spec.cmp!.hist![i]) ? spec.format(spec.cmp!.hist![i] as number) : "—"}</td>
              </tr>
            ))}
            <tr className="row-today">
              <td>Today</td>
              <td>{isNum(spec.cmp.value) ? spec.format(spec.cmp.value) : "—"}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
