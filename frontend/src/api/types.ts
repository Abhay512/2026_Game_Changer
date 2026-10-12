/** Response shapes of the FastAPI backend (backend/app/routes). */

/** Comparison block: today vs the same window on the baseline days. */
export interface Compare {
  value: number | null;
  avg: number | null;
  x: number | null; // value ÷ avg
  pct: number | null; // percentile among baseline days, 0–100
  n: number;
  abs?: boolean; // x / pct compare magnitudes (speed of change)
  hist?: (number | null)[]; // baseline days' own values, aligned with baseline.days
}

export interface Baseline {
  days: string[];
  n: number;
  lookback: number;
}

export interface Unavailable {
  available: false;
  reason: string;
}

export interface PriceBlock {
  available: true;
  start: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  chg: number | null;
  chg_pct: number | null;
  from_open_pct: number | null;
  range_pct: number | null;
  vwap: number | null;
  vwap_window: number | null;
  vs_vwap: "above" | "below" | "at" | null;
  vwap_dist_pct: number | null;
  above_vwap_pct: number | null;
  speed: Compare;
}

export interface TotalBlock {
  window: Compare;
  day: Compare;
  last5: Compare;
}

export interface FlowBlock {
  method: "bvc";
  buy: Compare;
  sell: Compare;
  ratio: Compare;
  buy_share_pct: number | null;
  last5: { buy: Compare; sell: Compare; ratio: number | null };
}

export interface OiScope {
  value: number | null;
  start: number | null;
  chg: Compare;
  chg_pct: number | null;
  last5: Compare;
  expiries?: number;
}

export type Buildup = "long_buildup" | "short_buildup" | "short_covering" | "long_unwinding" | "oi_up" | "oi_down" | "neutral";

export interface InstrumentSection {
  available: true;
  baseline: Baseline;
  price: PriceBlock;
  volume: TotalBlock;
  turnover: TotalBlock;
  flow: FlowBlock;
}

export interface FuturesSection extends InstrumentSection {
  expiry: string;
  front_ok: boolean;
  oi: { front: OiScope; all: OiScope; buildup: Buildup | null; buildup_all: Buildup | null; lot_size: number | null };
  premium?: { points: number | null; pct: number | null };
}

export interface OptionsSection {
  available: true;
  expiry: string;
  expiries: string[];
  rank: number;
  front_ok: boolean;
  notes: string[];
  baseline: Baseline;
  spot: number | null;
  atm: number | null;
  pcr: { oi: Compare; start: number | null; chg: Compare; vol: Compare };
  max_pain: { value: number | null; start: number | null; shift: Compare; vs_spot_pct: number | null };
  iv: { atm: Compare; start: number | null; chg: Compare; pct_all: number | null; n_all: number; min_all: number | null; max_all: number | null };
  oi: { ce: { value: number | null; start: number | null; chg: Compare }; pe: { value: number | null; start: number | null; chg: Compare } };
  atm_contracts: ChainRow | null; // ATM strike row (offset 0) with Greeks and 20-session comparisons
}

export interface WindowInfo {
  from: string;
  to: string;
  a: number;
  b: number;
  bars: number;
}

export interface Analysis {
  symbol: string;
  date: string;
  window: WindowInfo;
  lookback: number;
  session: { bars: number; full: boolean };
  spot: InstrumentSection | Unavailable;
  futures: FuturesSection | Unavailable;
  options: OptionsSection | Unavailable;
  notes: string[];
}

export interface SymbolInfo {
  symbol: string;
  has_fno: boolean;
  equity: { first: string | null; last: string | null };
  fno: { first: string; last: string; days: number } | null;
  warnings: string[];
}

export interface DayInfo {
  date: string;
  equity: boolean;
  futures: boolean;
  options: boolean;
  full: boolean;
  expiry_day: boolean;
  bars: number;
}

export interface DatesResponse {
  symbol: string;
  has_fno: boolean;
  default: string;
  days: DayInfo[];
}

export interface Meta {
  session: { start: string; end: string; bar_minutes: number; bars: number; labels: string[] };
  lookback_default: number;
}

export interface Bars {
  symbol: string;
  src: "spot" | "fut";
  date: string;
  sessions: { date: string; start: number; bars: number }[];
  t: number[];
  o: (number | null)[];
  h: (number | null)[];
  l: (number | null)[];
  c: (number | null)[];
  v: (number | null)[];
  vwap: (number | null)[];
  buy: (number | null)[];
  sell: (number | null)[];
  oi?: (number | null)[];
  expiry?: string[];
}

export type SeriesKind = "flow" | "ratio" | "snapshot";

export interface Series {
  symbol: string;
  date: string;
  src: "spot" | "fut" | "opt";
  metric: string;
  kind: SeriesKind;
  unit: string;
  window: WindowInfo;
  labels: string[];
  baseline: Baseline;
  today: (number | null)[];
  base: (number | null)[];
  today_cum?: (number | null)[];
  base_cum?: (number | null)[];
  today_chg?: (number | null)[];
  base_chg?: (number | null)[];
  base_abs_chg?: (number | null)[];
  base_signed?: (number | null)[];
}

export function isAvailable<T extends { available: true }>(s: T | Unavailable | undefined | null): s is T {
  return !!s && s.available === true;
}

// ---- option chain (/api/chain) -------------------------------------------------------------

export const CELL_KEYS = ["ltp", "ltp_chg", "oi", "oi_chg", "oi_chg_pct", "oi_5m", "vol", "turnover", "iv", "iv_chg", "delta", "delta_chg", "gamma", "gamma_chg", "theta", "theta_chg", "vega", "vega_chg"] as const;
export type CellKey = (typeof CELL_KEYS)[number];
export type ComparedKey = "oi_chg" | "oi_5m" | "vol" | "turnover" | "iv" | "iv_chg" | "delta" | "delta_chg" | "gamma" | "gamma_chg" | "theta" | "theta_chg" | "vega" | "vega_chg";

/** One side (CE or PE) of one strike. `avg` / `x`: same window, same ATM offset, baseline days. */
export type ChainCell = Record<CellKey, number | null> & {
  avg: Record<ComparedKey, number | null>;
  x: Record<ComparedKey, number | null>;
};

export interface ChainRow {
  strike: number;
  offset: number; // 0 = ATM
  atm: boolean;
  ce: ChainCell | null;
  pe: ChainCell | null;
}

export interface Chain {
  symbol: string;
  date: string;
  window: WindowInfo;
  available: boolean;
  reason?: string;
  expiry: string;
  expiries: string[];
  rank: number;
  front_ok: boolean;
  notes: string[];
  spot: number | null;
  atm: number | null;
  max_pain: number | null;
  lot_size: number | null;
  strikes_each_side: number;
  baseline: Baseline;
  rows: ChainRow[];
  pain: { strikes: number[]; payout: number[]; max_pain: number | null };
}

export interface StrikeSeries {
  symbol: string;
  date: string;
  expiry: string;
  strike: number;
  right: "CE" | "PE";
  labels: string[];
  bars: number[];
  prev_close: number | null;
  prev_oi: number | null;
  close: (number | null)[];
  oi: (number | null)[];
  volume: (number | null)[];
  turnover: (number | null)[];
  iv: (number | null)[];
  delta: (number | null)[];
  gamma: (number | null)[];
  theta: (number | null)[];
  vega: (number | null)[];
}
