import type { Analysis, Buildup, FuturesSection, InstrumentSection, TotalBlock } from "../api/types";
import { isAvailable } from "../api/types";
import type { DetailSpec } from "../components/DetailPanel";
import { MetricCard, Unavailable } from "../components/MetricCard";
import { compact, day, isNum, num, pct, price, rupees, times } from "../lib/format";
import { useView } from "../state/view";
import { Section } from "./Section";

type Src = "spot" | "fut";

/** The instrument the price/volume/flow sections describe (falls back to spot without F&O). */
export function useInstrument(analysis: Analysis | null): { src: Src; sec: InstrumentSection | null; label: string } {
  const instrument = useView((s) => s.instrument);
  if (!analysis) return { src: "spot", sec: null, label: "Spot" };
  const fut = isAvailable(analysis.futures) ? analysis.futures : null;
  if (instrument === "fut" && fut) return { src: "fut", sec: fut, label: `Futures · ${day(fut.expiry)} expiry` };
  const spot = isAvailable(analysis.spot) ? analysis.spot : null;
  return { src: "spot", sec: spot, label: "Spot (cash market)" };
}

function baselineText(sec: InstrumentSection | null, lookback: number) {
  if (!sec) return "";
  const n = sec.baseline.n;
  return n < lookback ? `vs the same window on the last ${n} sessions (fewer exist)` : `vs the same window on the last ${n} sessions`;
}

const pctAbs = (n: number) => pct(Math.abs(n), 2, false);

// ------------------------------------------------------------------------------------- price

export function PriceSection({ analysis, loading }: { analysis: Analysis | null; loading: boolean }) {
  const { src, sec, label } = useInstrument(analysis);
  const lookback = useView((s) => s.lookback);
  if (!sec) return <Empty id="price" title="Price" analysis={analysis} />;
  const p = sec.price;
  const days = sec.baseline.days;
  const fut = src === "fut" ? (sec as FuturesSection) : null;
  const specs: Record<string, DetailSpec> = {
    "price.last": { id: "price.last", title: "Price change", src, intraday: "change", metric: "chg", cmp: p.speed, baselineDays: days, format: (n) => pct(n, 2), changeName: "Today, % change since window start" },
    "price.vwap": { id: "price.vwap", title: "Close vs VWAP", src, intraday: "vwap", format: price },
    "price.speed": { id: "price.speed", title: "Price speed", src, intraday: "move", metric: "move", cmp: p.speed, baselineDays: days, format: (n) => pct(n, 2), seriesFormat: (n) => pct(n, 3, false) },
  };
  return (
    <Section id="price" title="Price" sub={`${label} · ${baselineText(sec, lookback)}`} specs={specs} loading={loading}>
      <MetricCard
        id="price.last"
        label="Last price"
        value={price(p.close)}
        delta={{ text: ` ${price(p.chg, true)}  ${pct(p.chg_pct)}`, value: p.chg }}
        meta={
          <>
            <span>H {price(p.high)}</span>
            <span>L {price(p.low)}</span>
            <span>from {price(p.start)}</span>
            {fut?.premium && isNum(fut.premium.points) && <span>premium {price(fut.premium.points, true)}</span>}
          </>
        }
      />
      <MetricCard
        id="price.vwap"
        label="VWAP"
        value={price(p.vwap)}
        delta={p.vs_vwap ? { text: ` ${p.vs_vwap === "above" ? "Above" : p.vs_vwap === "below" ? "Below" : "At"} by ${pctAbs(p.vwap_dist_pct ?? 0)}`, value: p.vwap_dist_pct } : undefined}
        meta={
          <>
            <span>closed above VWAP in {isNum(p.above_vwap_pct) ? Math.round(p.above_vwap_pct) : "—"}% of window bars</span>
            <span>window VWAP {price(p.vwap_window)}</span>
          </>
        }
      />
      <MetricCard
        id="price.speed"
        label="Price speed"
        value={times(p.speed.x)}
        cmp={p.speed}
        hideX
        cmpLabel={`move ${pctAbs(p.chg_pct ?? 0)} vs usual ${isNum(p.speed.avg) ? pctAbs(p.speed.avg) : "—"}`}
      />
    </Section>
  );
}

// ------------------------------------------------------------------------------------- totals

function TotalsSection({ kind, analysis, loading }: { kind: "turnover" | "volume"; analysis: Analysis | null; loading: boolean }) {
  const { src, sec, label } = useInstrument(analysis);
  const lookback = useView((s) => s.lookback);
  const title = kind === "turnover" ? "Turnover" : "Volume";
  if (!sec) return <Empty id={kind} title={title} analysis={analysis} />;
  const blk: TotalBlock = sec[kind];
  const f = kind === "turnover" ? (n: number) => rupees(n) : (n: number) => compact(n);
  const days = sec.baseline.days;
  const mk = (part: keyof TotalBlock, name: string): DetailSpec => ({ id: `${kind}.${part}`, title: `${title} · ${name}`, src, intraday: "bars", metric: kind, cmp: blk[part], baselineDays: days, format: f });
  const specs = { [`${kind}.window`]: mk("window", "in window"), [`${kind}.day`]: mk("day", "since 09:15"), [`${kind}.last5`]: mk("last5", "last 5 min") };
  return (
    <Section id={kind} title={title} sub={`${label} · ${baselineText(sec, lookback)}`} specs={specs} loading={loading}>
      <MetricCard id={`${kind}.window`} label="In window" value={f(blk.window.value ?? NaN)} cmp={blk.window} avgText={f(blk.window.avg ?? NaN)} />
      <MetricCard id={`${kind}.day`} label="Since 09:15" value={f(blk.day.value ?? NaN)} cmp={blk.day} avgText={f(blk.day.avg ?? NaN)} />
      <MetricCard id={`${kind}.last5`} label="Last 5 minutes" value={f(blk.last5.value ?? NaN)} cmp={blk.last5} avgText={f(blk.last5.avg ?? NaN)} cmpLabel="same bar, 20D avg" />
    </Section>
  );
}

export const TurnoverSection = (p: { analysis: Analysis | null; loading: boolean }) => <TotalsSection kind="turnover" {...p} />;
export const VolumeSection = (p: { analysis: Analysis | null; loading: boolean }) => <TotalsSection kind="volume" {...p} />;

// ------------------------------------------------------------------------------------- flow

export function FlowSection({ analysis, loading }: { analysis: Analysis | null; loading: boolean }) {
  const { src, sec, label } = useInstrument(analysis);
  const lookback = useView((s) => s.lookback);
  if (!sec) return <Empty id="flow" title="Buy / sell" analysis={analysis} />;
  const fl = sec.flow;
  const days = sec.baseline.days;
  const base = { src, intraday: "stack" as const, baselineDays: days };
  const specs: Record<string, DetailSpec> = {
    "flow.buy": { ...base, id: "flow.buy", title: "Buy volume (est.)", cmp: fl.buy, format: compact },
    "flow.sell": { ...base, id: "flow.sell", title: "Sell volume (est.)", cmp: fl.sell, format: compact },
    "flow.ratio": { ...base, id: "flow.ratio", title: "Buy / sell ratio", cmp: fl.ratio, format: (n) => num(n, 2), seriesFormat: compact },
    "flow.last5": { ...base, id: "flow.last5", title: "Buy / sell, last 5 min", cmp: fl.last5.buy, format: compact },
  };
  return (
    <Section
      id="flow"
      title="Buy / sell"
      sub={`${label} · ${baselineText(sec, lookback)}`}
      tools={
        <span className="chip" title="The data has no buyer/seller split. Each bar's volume is divided by how strongly price moved in it, against normal volatility for that time of day (Bulk Volume Classification).">
          Estimated · BVC
        </span>
      }
      specs={specs}
      loading={loading}
    >
      <MetricCard id="flow.buy" label="Buy volume" value={compact(fl.buy.value)} cmp={fl.buy} avgText={compact(fl.buy.avg)} />
      <MetricCard id="flow.sell" label="Sell volume" value={compact(fl.sell.value)} cmp={fl.sell} avgText={compact(fl.sell.avg)} />
      <MetricCard
        id="flow.ratio"
        label="Buy / sell ratio"
        value={num(fl.ratio.value, 2)}
        cmp={fl.ratio}
        avgText={num(fl.ratio.avg, 2)}
        meta={<span>buyers {isNum(fl.buy_share_pct) ? fl.buy_share_pct.toFixed(1) : "—"}% of volume</span>}
      />
      <MetricCard
        id="flow.last5"
        label="Last 5 minutes"
        value={`${compact(fl.last5.buy.value)} / ${compact(fl.last5.sell.value)}`}
        meta={
          <>
            <span>B/S {num(fl.last5.ratio, 2)}</span>
            <span>buy {times(fl.last5.buy.x)} · sell {times(fl.last5.sell.x)} usual</span>
          </>
        }
      />
    </Section>
  );
}

// ------------------------------------------------------------------------------------- futures OI

const BUILDUP: Record<Buildup, { text: string; dir: number }> = {
  long_buildup: { text: "Long build-up", dir: 1 },
  short_buildup: { text: "Short build-up", dir: -1 },
  short_covering: { text: "Short covering", dir: 1 },
  long_unwinding: { text: "Long unwinding", dir: -1 },
  oi_up: { text: "OI up, price flat", dir: 0 },
  oi_down: { text: "OI down, price flat", dir: 0 },
  neutral: { text: "No change", dir: 0 },
};

export function FuturesOISection({ analysis, loading }: { analysis: Analysis | null; loading: boolean }) {
  const scope = useView((s) => s.oiScope);
  const setScope = useView((s) => s.setOiScope);
  const lookback = useView((s) => s.lookback);
  const f = analysis && isAvailable(analysis.futures) ? analysis.futures : null;
  if (!f) return <Empty id="oi" title="Futures open interest" analysis={analysis} futures />;
  const oi = scope === "all" ? f.oi.all : f.oi.front;
  const tag = scope === "all" ? f.oi.buildup_all : f.oi.buildup;
  const b = tag ? BUILDUP[tag] : null;
  const days = f.baseline.days;
  const metric = scope === "all" ? "oi_all" : "oi";
  const chg = { src: "fut" as const, intraday: "change" as const, metric, baselineDays: days, format: (n: number) => compact(n, true), changeName: "Today, OI change since window start" };
  const specs: Record<string, DetailSpec> = {
    "oi.value": { ...chg, id: "oi.value", title: "Futures OI change", cmp: oi.chg },
    "oi.change": { ...chg, id: "oi.change", title: "OI change speed", cmp: oi.chg },
    "oi.last5": { ...chg, id: "oi.last5", title: "OI change, last 5 min", cmp: oi.last5 },
    "oi.buildup": { ...chg, id: "oi.buildup", title: "Build-up: OI change", cmp: oi.chg },
    "oi.volume": { id: "oi.volume", title: "Futures buy / sell volume", src: "fut", intraday: "stack", cmp: f.volume.window, baselineDays: days, format: compact },
  };
  const scopeText = scope === "all" ? `all ${oi.expiries ?? ""} live expiries`.replace("  ", " ") : `front month · ${day(f.expiry)} expiry`;
  return (
    <Section
      id="oi"
      title="Futures open interest"
      sub={`${scopeText} · vs the same window on the last ${f.baseline.n} sessions${f.baseline.n < lookback ? " (fewer exist)" : ""}`}
      tools={
        <div className="seg" role="group" aria-label="OI scope">
          <button aria-pressed={scope === "front"} onClick={() => setScope("front")}>
            Front month
          </button>
          <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>
            All expiries
          </button>
        </div>
      }
      specs={specs}
      loading={loading}
    >
      <MetricCard
        id="oi.value"
        label="Open interest"
        value={compact(oi.value)}
        delta={{ text: ` ${compact(oi.chg.value, true)}  ${pct(oi.chg_pct)}`, value: oi.chg.value }}
        meta={
          <>
            <span>at start {compact(oi.start)}</span>
            {isNum(f.oi.lot_size) && <span>lot {num(f.oi.lot_size)}</span>}
          </>
        }
      />
      <MetricCard id="oi.change" label="OI change speed" value={times(oi.chg.x)} cmp={oi.chg} hideX cmpLabel={`${compact(Math.abs(oi.chg.value ?? NaN))} vs usual ${compact(oi.chg.avg)}`} />
      <MetricCard id="oi.last5" label="OI, last 5 minutes" value={compact(oi.last5.value, true)} cmp={oi.last5} avgText={`avg size ${compact(oi.last5.avg)}`} cmpLabel="same bar" />
      <MetricCard
        id="oi.buildup"
        label="Build-up"
        value={b?.text ?? "—"}
        delta={b && b.dir ? { text: "", value: b.dir } : undefined}
        meta={
          <>
            <span>futures {pct(f.price.chg_pct)}</span>
            <span>OI {pct(oi.chg_pct)}</span>
          </>
        }
      />
      <MetricCard
        id="oi.volume"
        label="Futures volume"
        value={compact(f.volume.window.value)}
        cmp={f.volume.window}
        avgText={compact(f.volume.window.avg)}
        meta={
          <>
            <span>B/S {num(f.flow.ratio.value, 2)}</span>
            <span>{times(f.flow.ratio.x)} usual ratio</span>
          </>
        }
      />
    </Section>
  );
}

// ------------------------------------------------------------------------------------- empty

function Empty({ id, title, analysis, futures }: { id: string; title: string; analysis: Analysis | null; futures?: boolean }) {
  let reason = "Loading…";
  if (analysis) {
    const s = futures ? analysis.futures : analysis.spot;
    reason = "reason" in s ? s.reason : "Not available";
  }
  return (
    <Section id={id} title={title}>
      <Unavailable reason={reason} />
    </Section>
  );
}
