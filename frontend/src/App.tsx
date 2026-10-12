import { useEffect, useState } from "react";
import { apiUrl, useApi } from "./api/client";
import type { Analysis, Bars, Chain, DatesResponse, SymbolInfo } from "./api/types";
import { isAvailable } from "./api/types";
import { PriceChart } from "./components/chart/PriceChart";
import { TimeWindow } from "./components/TimeWindow";
import { TopBar } from "./components/TopBar";
import { compact, direction, num, pct, price, rupees, times } from "./lib/format";
import { useDebounced } from "./lib/hooks";
import { GreeksSection, MaxPainSection, OptionChainSection, PcrSection, StrikeOISection } from "./sections/Options";
import { FlowSection, FuturesOISection, PriceSection, TurnoverSection, useInstrument, VolumeSection } from "./sections/Sections";
import { barEnd, barTime, useView } from "./state/view";
import { ClosesCtx, useSectionAnalysis, useSectionChain } from "./state/window";

const NAV = [
  { id: "price", label: "Price" },
  { id: "turnover", label: "Turnover" },
  { id: "volume", label: "Volume" },
  { id: "flow", label: "Buy / sell" },
  { id: "oi", label: "Futures OI" },
  { id: "chain", label: "Option chain" },
  { id: "strikes", label: "OI by strike" },
  { id: "greeks", label: "Greeks" },
  { id: "pcr", label: "PCR" },
  { id: "maxpain", label: "Max pain" },
];

export default function App() {
  const { symbol, date, a, b, lookback, instrument, chartDays, expiry, strikes, setSymbol, setDate, setInstrument, setChartDays, setWindow } = useView();
  const symbols = useApi<{ symbols: SymbolInfo[] }>("/api/symbols");
  const list = symbols.data?.symbols ?? [];
  const info = list.find((s) => s.symbol === symbol);

  // first visit: a liquid F&O name
  useEffect(() => {
    if (!list.length) return;
    if (!symbol || !list.some((s) => s.symbol === symbol)) {
      const pick = list.find((s) => s.symbol === "RELIANCE") ?? list.find((s) => s.has_fno) ?? list[0];
      setSymbol(pick.symbol);
    }
  }, [list, symbol, setSymbol]);

  const sym = symbol ? encodeURIComponent(symbol) : null;
  const dates = useApi<DatesResponse>(sym ? `/api/symbols/${sym}/dates` : null);
  const days = dates.data?.symbol === symbol ? dates.data.days : [];
  useEffect(() => {
    const d = dates.data;
    if (!d || d.symbol !== symbol) return;
    if (!date || !d.days.some((x) => x.date === date)) setDate(d.default);
  }, [dates.data, symbol, date, setDate]);

  const win = useDebounced(`${a}-${b}`, 70);
  const [wa, wb] = win.split("-").map(Number);
  const ready = sym && date && days.some((d) => d.date === date);
  const win_ = { date, from: barTime(wa), to: barEnd(wb), lookback, expiry };
  const analysis = useApi<Analysis>(ready ? apiUrl(`analysis/${sym}`, win_) : null);
  const chain = useApi<Chain>(ready && info?.has_fno ? apiUrl(`chain/${sym}`, { ...win_, strikes }) : null);

  const hasFut = !!info?.has_fno && days.find((d) => d.date === date)?.futures !== false;
  const src = instrument === "fut" && hasFut ? "fut" : "spot";
  const bars = useApi<Bars>(ready ? apiUrl(`bars/${sym}`, { src, date, days: chartDays }) : null);
  const spotDay = useApi<Bars>(ready ? apiUrl(`bars/${sym}`, { src: "spot", date, days: 1 }) : null);

  const A = analysis.data && analysis.data.symbol === symbol && analysis.data.date === date ? analysis.data : null;
  const loading = analysis.loading || !A;
  const C = chain.data && chain.data.symbol === symbol && chain.data.date === date ? chain.data : null;
  const setExpiry = useView((s) => s.setExpiry);
  useEffect(() => {
    if (expiry && C?.available && !C.expiries.includes(expiry)) setExpiry(null); // chosen expiry not trading on this date
  }, [C, expiry, setExpiry]);
  const closes = spotDay.data ? toBars(spotDay.data) : undefined;

  return (
    <div className="app">
      <TopBar symbols={list} days={days} />
      <main className="wrap">
        {symbols.error && <p className="error">Cannot reach the analyser API ({symbols.error.message}). Is `python -m app` running?</p>}
        <div className="controls">
          <TimeWindow
            a={a}
            b={b}
            onChange={setWindow}
            closes={closes}
            label="Main window"
            extra={<span className="tw-note muted">Main window · every section follows it unless you give it its own (clock button in the section header)</span>}
          />
        </div>

        <Notices analysis={A} />

        <div className="top-grid">
          <div className="chart-card">
            <div className="chart-head">
              <div className="chart-title">
                <h1>{symbol ?? "—"}</h1>
                <span className="muted">{src === "fut" && bars.data?.expiry ? `Futures · ${bars.data.expiry[bars.data.expiry.length - 1]}` : "Spot"}</span>
              </div>
              <div className="chart-tools">
                <div className="seg" role="group" aria-label="Instrument">
                  <button aria-pressed={src === "spot"} onClick={() => setInstrument("spot")}>
                    Spot
                  </button>
                  <button aria-pressed={src === "fut"} onClick={() => setInstrument("fut")} disabled={!hasFut} title={hasFut ? "Front-month futures" : "No futures data for this date"}>
                    Futures
                  </button>
                </div>
                <div className="seg" role="group" aria-label="Chart range">
                  <button aria-pressed={chartDays === 1} onClick={() => setChartDays(1)}>
                    1D
                  </button>
                  <button aria-pressed={chartDays === 5} onClick={() => setChartDays(5)}>
                    5D
                  </button>
                </div>
              </div>
            </div>
            {bars.data && bars.data.src === src ? (
              <PriceChart key={`${src}-${symbol}`} bars={bars.data} a={a} b={b} loading={bars.loading} />
            ) : (
              <div className="chart-placeholder muted">{bars.error ? bars.error.message : "Loading chart…"}</div>
            )}
          </div>
          <Glance analysis={A} loading={loading} />
        </div>

        <SectionNav />

        <ClosesCtx.Provider value={closes}>
          {SECTIONS.map(({ id, Comp, chain: needsChain }) => (
            <Windowed key={id} id={id} Comp={Comp} needsChain={needsChain} analysis={A} chain={C} loading={loading} chainLoading={chain.loading} />
          ))}
        </ClosesCtx.Provider>
      </main>
      <footer className="footer wrap">
        <span>5-minute NSE data · every comparison uses the same time window on previous full sessions (short sessions such as Muhurat are skipped).</span>
        <span>
          Charts by{" "}
          <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noreferrer">
            TradingView Lightweight Charts™
          </a>
        </span>
      </footer>
    </div>
  );
}

type SectionProps = { analysis: Analysis | null; chain: Chain | null; loading: boolean };
const SECTIONS: { id: string; Comp: (p: SectionProps) => JSX.Element; chain: boolean }[] = [
  { id: "price", Comp: PriceSection, chain: false },
  { id: "turnover", Comp: TurnoverSection, chain: false },
  { id: "volume", Comp: VolumeSection, chain: false },
  { id: "flow", Comp: FlowSection, chain: false },
  { id: "oi", Comp: FuturesOISection, chain: false },
  { id: "chain", Comp: OptionChainSection, chain: true },
  { id: "strikes", Comp: StrikeOISection, chain: true },
  { id: "greeks", Comp: GreeksSection, chain: true },
  { id: "pcr", Comp: PcrSection, chain: false },
  { id: "maxpain", Comp: MaxPainSection, chain: true },
];

/** Feeds a section the main data, or data fetched for the section's own time window. */
function Windowed({ id, Comp, needsChain, analysis, chain, loading, chainLoading }: { id: string; Comp: (p: SectionProps) => JSX.Element; needsChain: boolean; analysis: Analysis | null; chain: Chain | null; loading: boolean; chainLoading: boolean }) {
  const a = useSectionAnalysis(id, analysis, loading);
  const c = useSectionChain(id, chain, chainLoading, needsChain);
  return <Comp analysis={a.analysis} chain={c.chain} loading={a.loading || (needsChain && c.loading)} />;
}

/** Spot closes of the selected day on the 75-bar grid (for the scrubber sparkline). */
function toBars(d: Bars): (number | null)[] {
  const out: (number | null)[] = Array(75).fill(null);
  if (!d.t.length) return out;
  const t0 = d.t[0] - (((d.t[0] / 60) % 1440) - 555) * 60;
  d.t.forEach((t, k) => {
    const i = Math.round((t - t0) / 300);
    if (i >= 0 && i < 75) out[i] = d.c[k];
  });
  return out;
}

function Notices({ analysis }: { analysis: Analysis | null }) {
  if (!analysis || !analysis.notes.length) return null;
  return (
    <ul className="notices">
      {analysis.notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

/** One-glance summary next to the chart; each row opens that metric's graph. */
function Glance({ analysis, loading }: { analysis: Analysis | null; loading: boolean }) {
  const { sec, label } = useInstrument(analysis);
  const toggleDetail = useView((s) => s.toggleDetail);
  const openIds = useView((s) => s.details);
  const fut = analysis && isAvailable(analysis.futures) ? analysis.futures : null;
  const go = (id: string, section: string) => {
    if (!openIds.includes(id)) toggleDetail(id);
    window.requestAnimationFrame(() => document.getElementById(`sec-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  if (!sec) return <aside className="glance is-loading" aria-label="Summary" />;
  const p = sec.price;
  const rows: { id: string; sec: string; k: string; v: string; x?: string; dir?: number | null }[] = [
    { id: "price.last", sec: "price", k: "Change", v: pct(p.chg_pct), dir: p.chg_pct },
    { id: "price.vwap", sec: "price", k: "vs VWAP", v: `${p.vs_vwap ?? "—"} ${pct(Math.abs(p.vwap_dist_pct ?? 0), 2, false)}`, dir: p.vwap_dist_pct },
    { id: "price.speed", sec: "price", k: "Price speed", v: times(p.speed.x) },
    { id: "turnover.window", sec: "turnover", k: "Turnover", v: rupees(sec.turnover.window.value), x: times(sec.turnover.window.x) },
    { id: "volume.window", sec: "volume", k: "Volume", v: compact(sec.volume.window.value), x: times(sec.volume.window.x) },
    { id: "flow.ratio", sec: "flow", k: "Buy / sell", v: num(sec.flow.ratio.value, 2), x: times(sec.flow.ratio.x) },
  ];
  if (fut) {
    rows.push({ id: "oi.value", sec: "oi", k: "Futures OI", v: pct(fut.oi.front.chg_pct), dir: fut.oi.front.chg.value, x: times(fut.oi.front.chg.x) });
  }
  return (
    <aside className={`glance${loading ? " is-loading" : ""}`} aria-label="Summary">
      <div className="glance-head">
        <span className="glance-price">{price(p.close)}</span>
        <span className="muted">{label}</span>
      </div>
      <dl>
        {rows.map((r) => {
          const d = r.dir === undefined ? "flat" : direction(r.dir);
          return (
            <button key={r.id} className={`glance-row${openIds.includes(r.id) ? " on" : ""}`} onClick={() => go(r.id, r.sec)}>
              <dt>{r.k}</dt>
              <dd className={d !== "flat" ? d : ""}>{r.v}</dd>
              <dd className="glance-x">{r.x ?? ""}</dd>
            </button>
          );
        })}
      </dl>
      <p className="glance-foot muted">× = vs the same window on the last {sec.baseline.n} sessions</p>
    </aside>
  );
}

function SectionNav() {
  const [active, setActive] = useState("price");
  useEffect(() => {
    const els = NAV.map((n) => document.getElementById(`sec-${n.id}`)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((x, y) => x.boundingClientRect.top - y.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id.replace("sec-", ""));
      },
      { rootMargin: "-120px 0px -55% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  });
  return (
    <nav className="secnav" aria-label="Sections">
      {NAV.map((n) => (
        <a key={n.id} href={`#sec-${n.id}`} className={active === n.id ? "on" : ""}>
          {n.label}
        </a>
      ))}
    </nav>
  );
}
