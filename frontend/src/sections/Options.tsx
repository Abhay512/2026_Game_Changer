import { useState } from "react";
import type { Analysis, CellKey, Chain, ChainCell, ChainRow, Compare, ComparedKey, OptionsSection } from "../api/types";
import { isAvailable } from "../api/types";
import { ChainTable } from "../components/ChainTable";
import { StrikeBars } from "../components/charts/StrikeBars";
import type { DetailSpec } from "../components/DetailPanel";
import { InfoHint, InfoToggle } from "../components/InfoHint";
import { MetricCard, Unavailable } from "../components/MetricCard";
import { compact, day, isNum, num, pct, price, rupees, times } from "../lib/format";
import { useView } from "../state/view";
import { Section } from "./Section";

type Props = { analysis: Analysis | null; chain: Chain | null; loading: boolean };

const CE = "var(--ce)";
const PE = "var(--pe)";
const ivFmt = (n: number | null) => (isNum(n) ? `${n.toFixed(2)}%` : "—");
const ptsFmt = (n: number | null) => (isNum(n) ? `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)} pts` : "—");

function opts(analysis: Analysis | null): OptionsSection | null {
  return analysis && isAvailable(analysis.options) ? analysis.options : null;
}

function reason(analysis: Analysis | null, chain: Chain | null): string {
  if (!analysis) return "Loading…";
  if ("reason" in analysis.options) return analysis.options.reason;
  return chain?.reason ?? "Not available";
}

function baselineText(o: OptionsSection, lookback: number) {
  const n = o.baseline.n;
  return `vs the same window on the last ${n} sessions${n < lookback ? " (fewer exist)" : ""}, same distance from ATM`;
}

/** Chart card that belongs to a section (always visible), with its own info tip. */
function ChartPanel({ id, title, tools, children }: { id: string; title: string; tools?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="panel" id={`panel-${id}`}>
      <header className="panel-head">
        <h3>{title}</h3>
        <InfoToggle id={id} />
        {tools && <div className="panel-tools">{tools}</div>}
      </header>
      <InfoHint id={id} />
      {children}
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

const scrollTo = (id: string) => window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" }));

// ------------------------------------------------------------------------------------- chain

export function OptionChainSection({ analysis, chain, loading }: Props) {
  const { lookback, strikes, setStrikes, setExpiry } = useView();
  const o = opts(analysis);
  if (!o || !chain?.available) {
    return (
      <Section id="chain" title="Option chain" timeOpen>
        <Unavailable reason={reason(analysis, chain)} />
      </Section>
    );
  }
  return (
    <Section
      id="chain"
      title="Option chain"
      sub={`${day(chain.expiry)} expiry · spot ${price(chain.spot)} · ATM ${num(chain.atm)} · max pain ${num(chain.max_pain)}${chain.lot_size ? ` · lot ${num(chain.lot_size)}` : ""} · ${baselineText(o, lookback)}`}
      tools={
        <>
          {chain.expiries.length > 1 && (
            <Seg
              label="Expiry"
              value={chain.expiry}
              options={chain.expiries.map((e) => [e, day(e)] as [string, string])}
              onChange={(e) => setExpiry(e === chain.expiries[0] ? null : e)}
            />
          )}
          <Seg label="Strikes each side" value={String(strikes)} options={[["5", "±5"], ["10", "±10"], ["15", "±15"]]} onChange={(v) => setStrikes(Number(v))} />
        </>
      }
      loading={loading}
      timeOpen
    >
      {chain.notes.length > 0 && <ul className="notices inline">{chain.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      <div className="wide">
        <div className="panel-tip">
          <InfoToggle id="opt.chain" />
          <InfoHint id="opt.chain" />
        </div>
        <ChainTable chain={chain} />
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------------------------- OI by strike

type OiMetric = "oi" | "oi_chg" | "oi_5m" | "vol" | "turnover";
const OI_METRICS: [OiMetric, string][] = [
  ["oi", "Open interest"],
  ["oi_chg", "OI change"],
  ["oi_5m", "Last 5 min"],
  ["vol", "Volume"],
  ["turnover", "Turnover"],
];

function seriesFor(rows: ChainRow[], key: CellKey, cmp: ComparedKey | null) {
  const pick = (side: "ce" | "pe") => ({
    values: rows.map((r) => (r[side] ? (r[side]![key] as number | null) : null)),
    avg: cmp ? rows.map((r) => (r[side] ? r[side]!.avg[cmp] : null)) : undefined,
    x: cmp ? rows.map((r) => (r[side] ? r[side]!.x[cmp] : null)) : undefined,
  });
  return [
    { name: "Calls (CE)", color: CE, ...pick("ce") },
    { name: "Puts (PE)", color: PE, ...pick("pe") },
  ];
}

function maxBy(rows: ChainRow[], side: "ce" | "pe", key: CellKey, abs = false): { row: ChainRow; cell: ChainCell } | null {
  let best: { row: ChainRow; cell: ChainCell } | null = null;
  let score = -Infinity;
  for (const r of rows) {
    const c = r[side];
    const v = c?.[key] as number | null | undefined;
    if (!c || !isNum(v)) continue;
    const sv = abs ? Math.abs(v) : v;
    if (sv > score) {
      score = sv;
      best = { row: r, cell: c };
    }
  }
  return best;
}

export function StrikeOISection({ analysis, chain, loading }: Props) {
  const [metric, setMetric] = useState<OiMetric>("oi_chg");
  const o = opts(analysis);
  if (!o || !chain?.available) {
    return (
      <Section id="strikes" title="Open interest by strike">
        <Unavailable reason={reason(analysis, chain)} />
      </Section>
    );
  }
  const rows = chain.rows;
  const hiCe = maxBy(rows, "ce", "oi");
  const hiPe = maxBy(rows, "pe", "oi");
  const buildCe = maxBy(rows, "ce", "oi_chg", true);
  const buildPe = maxBy(rows, "pe", "oi_chg", true);
  const build = buildCe && buildPe ? (Math.abs(buildCe.cell.oi_chg ?? 0) >= Math.abs(buildPe.cell.oi_chg ?? 0) ? { ...buildCe, side: "CE" } : { ...buildPe, side: "PE" }) : buildCe ? { ...buildCe, side: "CE" } : buildPe ? { ...buildPe, side: "PE" } : null;
  const show = (m: OiMetric) => {
    setMetric(m);
    scrollTo("panel-opt.chart_oi");
  };
  const fmt = metric === "turnover" ? (n: number) => rupees(n) : metric === "oi_chg" || metric === "oi_5m" ? (n: number) => compact(n, true) : (n: number) => compact(n);
  const cmpKey: ComparedKey | null = metric === "oi" ? null : metric;
  return (
    <Section id="strikes" title="Open interest by strike" sub={`${day(chain.expiry)} expiry · ATM ±${chain.strikes_each_side} strikes · changes since the window start`} loading={loading}>
      <MetricCard
        id="opt.ce_oi"
        label="Call OI, all strikes"
        value={compact(o.oi.ce.value)}
        delta={{ text: ` ${compact(o.oi.ce.chg.value, true)}`, value: o.oi.ce.chg.value }}
        cmp={o.oi.ce.chg}
        cmpLabel="change vs usual"
        avgText={compact(o.oi.ce.chg.avg)}
        onOpen={() => show("oi_chg")}
        active={metric === "oi_chg"}
      />
      <MetricCard
        id="opt.pe_oi"
        label="Put OI, all strikes"
        value={compact(o.oi.pe.value)}
        delta={{ text: ` ${compact(o.oi.pe.chg.value, true)}`, value: o.oi.pe.chg.value }}
        cmp={o.oi.pe.chg}
        cmpLabel="change vs usual"
        avgText={compact(o.oi.pe.chg.avg)}
        onOpen={() => show("oi_chg")}
        active={metric === "oi_chg"}
      />
      <MetricCard
        id="opt.max_ce"
        label="Highest call OI"
        value={hiCe ? num(hiCe.row.strike) : "—"}
        unit="CE"
        meta={hiCe && <span>OI {compact(hiCe.cell.oi)} · chg {compact(hiCe.cell.oi_chg, true)}</span>}
        onOpen={() => show("oi")}
        active={metric === "oi"}
      />
      <MetricCard
        id="opt.max_pe"
        label="Highest put OI"
        value={hiPe ? num(hiPe.row.strike) : "—"}
        unit="PE"
        meta={hiPe && <span>OI {compact(hiPe.cell.oi)} · chg {compact(hiPe.cell.oi_chg, true)}</span>}
        onOpen={() => show("oi")}
        active={metric === "oi"}
      />
      <MetricCard
        id="opt.build"
        label="Biggest OI build-up"
        value={build ? `${num(build.row.strike)}` : "—"}
        unit={build?.side}
        delta={build ? { text: ` ${compact(build.cell.oi_chg, true)}`, value: build.cell.oi_chg } : undefined}
        meta={build && <span>{isNum(build.cell.x.oi_chg) ? `${times(build.cell.x.oi_chg)} usual for this distance from ATM` : ""}</span>}
        onOpen={() => show("oi_chg")}
        active={metric === "oi_chg"}
      />
      <div className="wide">
        <ChartPanel id="opt.chart_oi" title="By strike" tools={<Seg label="Metric" value={metric} options={OI_METRICS} onChange={setMetric} />}>
          <ul className="legend">
            <li>
              <span className="key-rect" style={{ background: CE }} /> Calls (CE)
            </li>
            <li>
              <span className="key-rect" style={{ background: PE }} /> Puts (PE)
            </li>
            {cmpKey && (
              <li>
                <span className="key-line" style={{ background: "var(--ink-2)" }} /> 20-session avg, same distance from ATM
              </li>
            )}
            <li>
              <span className="key-line" style={{ background: "var(--ink-2)", width: 2, height: 12 }} /> Spot
            </li>
            <li>
              <span className="key-tri" /> Max pain
            </li>
          </ul>
          <StrikeBars
            strikes={rows.map((r) => r.strike)}
            series={seriesFor(rows, metric, cmpKey)}
            absAvg={metric === "oi_chg" || metric === "oi_5m"}
            spot={chain.spot}
            atm={chain.atm}
            maxPain={chain.max_pain}
            format={fmt}
            label={`${OI_METRICS.find((m) => m[0] === metric)![1]} by strike`}
          />
        </ChartPanel>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------------------------- greeks

type Greek = "iv" | "delta" | "gamma" | "theta" | "vega";
const GREEKS: [Greek, string][] = [
  ["iv", "IV"],
  ["delta", "Delta"],
  ["gamma", "Gamma"],
  ["theta", "Theta"],
  ["vega", "Vega"],
];
const GREEK_FMT: Record<Greek, (n: number) => string> = {
  iv: (n) => `${n.toFixed(1)}%`,
  delta: (n) => num(n, 2),
  gamma: (n) => num(n, 4),
  theta: (n) => num(n, 2),
  vega: (n) => num(n, 3),
};

function greekCmp(cell: ChainCell | null | undefined, g: Greek, n: number): Compare | null {
  if (!cell) return null;
  return { value: cell[g] as number | null, avg: cell.avg[g], x: cell.x[g], pct: null, n, abs: g === "delta" || g === "theta" };
}

export function GreeksSection({ analysis, chain, loading }: Props) {
  const [greek, setGreek] = useState<Greek>("iv");
  const [mode, setMode] = useState<"level" | "chg">("level");
  const lookback = useView((s) => s.lookback);
  const o = opts(analysis);
  if (!o || !chain?.available) {
    return (
      <Section id="greeks" title="Greeks">
        <Unavailable reason={reason(analysis, chain)} />
      </Section>
    );
  }
  const atm = o.atm_contracts;
  const n = o.baseline.n;
  const days = o.baseline.days;
  const specs: Record<string, DetailSpec> = {
    "opt.iv": { id: "opt.iv", title: "ATM implied volatility", src: "opt", intraday: "level", metric: "atm_iv", cmp: o.iv.atm, baselineDays: days, format: (v) => `${v.toFixed(2)}%` },
    "opt.iv_chg": { id: "opt.iv_chg", title: "ATM IV change", src: "opt", intraday: "change", metric: "atm_iv", cmp: o.iv.chg, baselineDays: days, format: (v) => ptsFmt(v), changeName: "Today, IV change since window start (pts)" },
  };
  const show = (g: Greek) => {
    setGreek(g);
    scrollTo("panel-opt.chart_greeks");
  };
  const key = (mode === "level" ? greek : `${greek}_chg`) as CellKey;
  const cmpKey = (mode === "level" ? greek : `${greek}_chg`) as ComparedKey;
  const greekCard = (g: Exclude<Greek, "iv">, label: string) => {
    const ce = atm?.ce;
    const pe = atm?.pe;
    const f = GREEK_FMT[g];
    return (
      <MetricCard
        key={g}
        id={`opt.${g}`}
        label={label}
        value={ce && isNum(ce[g]) ? f(ce[g] as number) : "—"}
        unit="CE"
        delta={ce ? { text: ` ${isNum(ce[`${g}_chg`]) ? ((ce[`${g}_chg`] as number) > 0 ? "+" : "") + f(ce[`${g}_chg`] as number) : "—"}`, value: ce[`${g}_chg`] as number | null } : undefined}
        cmp={greekCmp(ce, g, n)}
        cmpLabel="CE vs 20D avg"
        avgText={ce && isNum(ce.avg[g]) ? f(ce.avg[g] as number) : undefined}
        meta={pe && <span>PE {isNum(pe[g]) ? f(pe[g] as number) : "—"} ({isNum(pe[`${g}_chg`]) ? ((pe[`${g}_chg`] as number) > 0 ? "+" : "") + f(pe[`${g}_chg`] as number) : "—"})</span>}
        onOpen={() => show(g)}
        active={greek === g}
      />
    );
  };
  return (
    <Section id="greeks" title="Greeks" sub={`ATM ${num(chain.atm)} · ${day(chain.expiry)} expiry · ${baselineText(o, lookback)}`} specs={specs} loading={loading}>
      <MetricCard
        id="opt.iv"
        label="ATM IV"
        value={ivFmt(o.iv.atm.value)}
        delta={{ text: ` ${ptsFmt(o.iv.chg.value)}`, value: o.iv.chg.value }}
        cmp={o.iv.atm}
        cmpLabel="IV percentile (20D)"
        avgText={`avg ${ivFmt(o.iv.atm.avg)}`}
        meta={
          <>
            <span>
              all history P{isNum(o.iv.pct_all) ? Math.round(o.iv.pct_all) : "—"} of {o.iv.n_all}
            </span>
            <span>
              range {ivFmt(o.iv.min_all)}–{ivFmt(o.iv.max_all)}
            </span>
          </>
        }
      />
      <MetricCard id="opt.iv_chg" label="IV change speed" value={times(o.iv.chg.x)} cmp={o.iv.chg} hideX cmpLabel={`${ptsFmt(o.iv.chg.value)} vs usual ±${isNum(o.iv.chg.avg) ? o.iv.chg.avg.toFixed(2) : "—"}`} />
      {greekCard("delta", "Delta (ATM)")}
      {greekCard("gamma", "Gamma (ATM)")}
      {greekCard("theta", "Theta (ATM)")}
      {greekCard("vega", "Vega (ATM)")}
      <div className="wide">
        <ChartPanel
          id="opt.chart_greeks"
          title="By strike"
          tools={
            <>
              <Seg label="Greek" value={greek} options={GREEKS} onChange={setGreek} />
              <Seg label="Mode" value={mode} options={[["level", "Level"], ["chg", "Change since start"]]} onChange={setMode} />
            </>
          }
        >
          <ul className="legend">
            <li>
              <span className="key-rect" style={{ background: CE }} /> Calls (CE)
            </li>
            <li>
              <span className="key-rect" style={{ background: PE }} /> Puts (PE)
            </li>
            <li>
              <span className="key-line" style={{ background: "var(--ink-2)" }} /> 20-session avg, same distance from ATM
            </li>
          </ul>
          <StrikeBars
            strikes={chain.rows.map((r) => r.strike)}
            series={seriesFor(chain.rows, key, cmpKey)}
            absAvg={mode === "chg" || greek === "delta" || greek === "theta"}
            spot={chain.spot}
            atm={chain.atm}
            maxPain={chain.max_pain}
            format={(v) => (mode === "chg" && greek === "iv" ? ptsFmt(v) : GREEK_FMT[greek](v))}
            label={`${GREEKS.find((g) => g[0] === greek)![1]} by strike`}
          />
        </ChartPanel>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------------------------- PCR

export function PcrSection({ analysis, chain, loading }: Props) {
  const lookback = useView((s) => s.lookback);
  const o = opts(analysis);
  if (!o) {
    return (
      <Section id="pcr" title="Put-call ratio">
        <Unavailable reason={reason(analysis, chain)} />
      </Section>
    );
  }
  const days = o.baseline.days;
  const r2 = (v: number) => num(v, 2);
  const specs: Record<string, DetailSpec> = {
    "opt.pcr": { id: "opt.pcr", title: "PCR (open interest)", src: "opt", intraday: "level", metric: "pcr_oi", cmp: o.pcr.oi, baselineDays: days, format: r2 },
    "opt.pcr_chg": { id: "opt.pcr_chg", title: "PCR change", src: "opt", intraday: "change", metric: "pcr_oi", cmp: o.pcr.chg, baselineDays: days, format: (v) => num(v, 3, true), changeName: "Today, PCR change since window start" },
    "opt.pcr_vol": { id: "opt.pcr_vol", title: "Volume PCR", src: "opt", intraday: "cumratio", metric: "pcr_vol", cmp: o.pcr.vol, baselineDays: days, format: r2 },
  };
  return (
    <Section id="pcr" title="Put-call ratio" sub={`${day(o.expiry)} expiry · all strikes · vs the same window on the last ${o.baseline.n} sessions${o.baseline.n < lookback ? " (fewer exist)" : ""}`} specs={specs} loading={loading}>
      <MetricCard
        id="opt.pcr"
        label="PCR (OI)"
        value={num(o.pcr.oi.value, 2)}
        delta={{ text: ` ${num(o.pcr.chg.value, 3, true)} since ${analysis!.window.from}`, value: o.pcr.chg.value }}
        cmp={o.pcr.oi}
        avgText={num(o.pcr.oi.avg, 2)}
        meta={<span>at window start {num(o.pcr.start, 2)}</span>}
      />
      <MetricCard id="opt.pcr_chg" label="PCR change speed" value={times(o.pcr.chg.x)} cmp={o.pcr.chg} hideX cmpLabel={`${num(o.pcr.chg.value, 3, true)} vs usual ±${num(o.pcr.chg.avg, 3)}`} />
      <MetricCard id="opt.pcr_vol" label="Volume PCR" value={num(o.pcr.vol.value, 2)} cmp={o.pcr.vol} avgText={num(o.pcr.vol.avg, 2)} />
    </Section>
  );
}

// ------------------------------------------------------------------------------------- max pain

export function MaxPainSection({ analysis, chain, loading }: Props) {
  const lookback = useView((s) => s.lookback);
  const o = opts(analysis);
  if (!o) {
    return (
      <Section id="maxpain" title="Max pain">
        <Unavailable reason={reason(analysis, chain)} />
      </Section>
    );
  }
  const mp = o.max_pain;
  const days = o.baseline.days;
  const specs: Record<string, DetailSpec> = {
    "opt.max_pain": { id: "opt.max_pain", title: "Max pain vs spot", src: "opt", intraday: "pain", metric: "max_pain", cmp: mp.shift, baselineDays: days, format: (v) => price(v, true), seriesFormat: (v) => price(v) },
    "opt.mp_shift": { id: "opt.mp_shift", title: "Max pain shift", src: "opt", intraday: "change", metric: "max_pain", cmp: mp.shift, baselineDays: days, format: (v) => price(v, true), changeName: "Today, max pain change since window start" },
  };
  const pain = chain?.available ? chain.pain : null;
  return (
    <Section id="maxpain" title="Max pain" sub={`${day(o.expiry)} expiry · vs the same window on the last ${o.baseline.n} sessions${o.baseline.n < lookback ? " (fewer exist)" : ""}`} specs={specs} loading={loading}>
      <MetricCard
        id="opt.max_pain"
        label="Max pain"
        value={price(mp.value)}
        delta={{ text: ` ${price((mp.value ?? NaN) - (mp.start ?? NaN), true)} since ${analysis!.window.from}`, value: isNum(mp.value) && isNum(mp.start) ? mp.value - mp.start : null }}
        meta={
          <>
            <span>
              {pct(mp.vs_spot_pct)} from spot {price(o.spot)}
            </span>
            <span>at window start {price(mp.start)}</span>
          </>
        }
      />
      <MetricCard id="opt.mp_shift" label="Max pain shift speed" value={times(mp.shift.x)} cmp={mp.shift} hideX cmpLabel={`moved ${price(mp.shift.value, true)} vs usual ±${price(mp.shift.avg)}`} />
      {pain && pain.strikes.length > 0 && (
        <div className="wide">
          <ChartPanel id="opt.chart_pain" title="Writers' payout if expiry settles at each strike">
            <ul className="legend">
              <li>
                <span className="key-rect" style={{ background: "var(--accent)" }} /> Max pain {num(pain.max_pain)}
              </li>
              <li>
                <span className="key-rect" style={{ background: "var(--base-bar)" }} /> Other strikes
              </li>
            </ul>
            <StrikeBars
              strikes={pain.strikes}
              series={[{ name: "Payout", color: "var(--base-bar)", values: pain.payout }]}
              highlight={pain.max_pain}
              spot={chain!.spot}
              format={(v) => rupees(v)}
              height={240}
              label="Option writers' total payout at each settlement strike"
            />
          </ChartPanel>
        </div>
      )}
    </Section>
  );
}
