import { create } from "zustand";

export const BARS = 75; // 09:15 … 15:25 five-minute bars
const START_MIN = 9 * 60 + 15;

export type Instrument = "spot" | "fut";
export type OiScope = "front" | "all";

/** Bar index → "HH:MM" of its start; barEnd(b) → the window end label. */
export function barTime(bar: number): string {
  const m = START_MIN + bar * 5;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
export const barEnd = (bar: number) => barTime(bar + 1);

function timeToBar(t: string | null, fallback: number, end = false): number {
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return fallback;
  const [h, m] = t.split(":").map(Number);
  const bar = Math.round((h * 60 + m - START_MIN) / 5) - (end ? 1 : 0);
  return Math.min(BARS - 1, Math.max(0, bar));
}

interface ViewState {
  symbol: string | null;
  date: string | null;
  a: number; // first bar of the window (inclusive)
  b: number; // last bar of the window (inclusive)
  instrument: Instrument;
  oiScope: OiScope;
  chartDays: 1 | 5;
  lookback: number;
  details: string[]; // ids of the metric graphs that are open (each stays open until closed)
  expiry: string | null; // option expiry (null = front month)
  strikes: number; // strikes on each side of ATM in the chain
  secWin: Record<string, { a: number; b: number }>; // sections with their own window (others follow the main one)
  setSectionWindow: (id: string, a: number, b: number) => void;
  followMain: (id: string) => void;
  setExpiry: (e: string | null) => void;
  setStrikes: (n: number) => void;
  setSymbol: (s: string) => void;
  setDate: (d: string) => void;
  setWindow: (a: number, b: number) => void;
  setInstrument: (i: Instrument) => void;
  setOiScope: (s: OiScope) => void;
  setChartDays: (d: 1 | 5) => void;
  setLookback: (n: number) => void;
  toggleDetail: (id: string) => void;
}

const q = new URLSearchParams(window.location.search);
const initA = timeToBar(q.get("from"), 0);
const initB = Math.max(initA, timeToBar(q.get("to"), BARS - 1, true));
/** ?w=price@09:30-10:30,chain@13:00-14:00 → per-section windows (older links used cf/ct for the chain). */
function parseSectionWindows(): Record<string, { a: number; b: number }> {
  const out: Record<string, { a: number; b: number }> = {};
  for (const part of (q.get("w") ?? "").split(",")) {
    const m = /^([a-z]+)@(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(part.trim());
    if (m) {
      const a = timeToBar(m[2], 0);
      out[m[1]] = { a, b: Math.max(a, timeToBar(m[3], BARS - 1, true)) };
    }
  }
  if (!out.chain && (q.get("cf") || q.get("ct"))) {
    const a = timeToBar(q.get("cf"), 0);
    out.chain = { a, b: Math.max(a, timeToBar(q.get("ct"), BARS - 1, true)) };
  }
  return out;
}

export const useView = create<ViewState>((set) => ({
  symbol: q.get("s")?.toUpperCase() || null,
  date: q.get("d"),
  a: initA,
  b: initB,
  instrument: q.get("i") === "fut" ? "fut" : "spot",
  oiScope: "front",
  chartDays: 1,
  lookback: Number(q.get("lb")) >= 5 && Number(q.get("lb")) <= 60 ? Number(q.get("lb")) : 20,
  details: [],
  expiry: q.get("e"),
  strikes: [5, 10, 15].includes(Number(q.get("k"))) ? Number(q.get("k")) : 10,
  secWin: parseSectionWindows(),
  setSectionWindow: (id, a, b) =>
    set((s) => ({ secWin: { ...s.secWin, [id]: { a: Math.max(0, Math.min(a, b)), b: Math.min(BARS - 1, Math.max(a, b)) } } })),
  followMain: (id) =>
    set((s) => {
      const secWin = { ...s.secWin };
      delete secWin[id];
      return { secWin };
    }),
  setExpiry: (expiry) => set({ expiry }),
  setStrikes: (strikes) => set({ strikes }),
  setSymbol: (symbol) => set((s) => (s.symbol === symbol ? s : { symbol, expiry: null })),
  setDate: (date) => set({ date }),
  setWindow: (a, b) => {
    const lo = Math.max(0, Math.min(a, b));
    const hi = Math.min(BARS - 1, Math.max(a, b));
    set({ a: lo, b: hi });
  },
  setInstrument: (instrument) => set({ instrument }),
  setOiScope: (oiScope) => set({ oiScope }),
  setChartDays: (chartDays) => set({ chartDays }),
  setLookback: (lookback) => set({ lookback }),
  toggleDetail: (id) => set((s) => ({ details: s.details.includes(id) ? s.details.filter((d) => d !== id) : [...s.details, id] })),
}));

// Keep the address bar shareable: ?s=RELIANCE&d=2026-01-23&from=09:30&to=10:30&i=fut
useView.subscribe((s) => {
  const p = new URLSearchParams();
  if (s.symbol) p.set("s", s.symbol);
  if (s.date) p.set("d", s.date);
  if (s.a !== 0 || s.b !== BARS - 1) {
    p.set("from", barTime(s.a));
    p.set("to", barEnd(s.b));
  }
  if (s.instrument === "fut") p.set("i", "fut");
  if (s.lookback !== 20) p.set("lb", String(s.lookback));
  if (s.expiry) p.set("e", s.expiry);
  if (s.strikes !== 10) p.set("k", String(s.strikes));
  const own = Object.entries(s.secWin).map(([id, w]) => `${id}@${barTime(w.a)}-${barEnd(w.b)}`);
  if (own.length) p.set("w", own.join(","));
  const next = `${window.location.pathname}?${p.toString()}`;
  if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
});
