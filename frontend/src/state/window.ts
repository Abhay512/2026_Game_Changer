import { createContext, useContext } from "react";
import { apiUrl, useApi } from "../api/client";
import type { Analysis, Chain } from "../api/types";
import { useDebounced } from "../lib/hooks";
import { barEnd, barTime, useView } from "./view";

/** The time window a part of the page describes. Each section follows the main window unless it has
 *  been given its own (view.secWin); graphs inside a section read the section's window from here. */
export interface WindowValue {
  a: number;
  b: number;
  own: boolean; // the section has its own window
}

export const WindowCtx = createContext<WindowValue | null>(null);

/** Spot closes of the selected day, for the scrubber sparklines. */
export const ClosesCtx = createContext<(number | null)[] | undefined>(undefined);

export function useSectionWindow(id: string): WindowValue {
  const a = useView((s) => s.a);
  const b = useView((s) => s.b);
  const own = useView((s) => s.secWin[id]);
  return own ? { ...own, own: true } : { a, b, own: false };
}

/** Window of the surrounding section (or the main window outside any section). */
export function useWindow(): WindowValue {
  const ctx = useContext(WindowCtx);
  const a = useView((s) => s.a);
  const b = useView((s) => s.b);
  return ctx ?? { a, b, own: false };
}

function useSectionUrl(id: string, path: "analysis" | "chain", enabled: boolean): string | null {
  const { symbol, date, lookback, expiry, strikes } = useView();
  const own = useView((s) => s.secWin[id]);
  const [da, db] = useDebounced(own ? `${own.a}-${own.b}` : "", 70).split("-").map(Number);
  if (!own || !enabled || !symbol || !date || !Number.isFinite(da) || !Number.isFinite(db)) return null;
  const params: Record<string, string | number | null> = { date, from: barTime(da), to: barEnd(db), lookback, expiry };
  if (path === "chain") params.strikes = strikes;
  return apiUrl(`${path}/${encodeURIComponent(symbol)}`, params);
}

/** The section's analysis: the main one, or one fetched for the section's own window. */
export function useSectionAnalysis(id: string, main: Analysis | null, mainLoading: boolean): { analysis: Analysis | null; loading: boolean } {
  const { symbol, date } = useView();
  const own = useView((s) => !!s.secWin[id]);
  const res = useApi<Analysis>(useSectionUrl(id, "analysis", true));
  if (!own) return { analysis: main, loading: mainLoading };
  const fresh = res.data && res.data.symbol === symbol && res.data.date === date ? res.data : null;
  return { analysis: fresh ?? main, loading: res.loading || !fresh };
}

/** Same for the option chain. */
export function useSectionChain(id: string, main: Chain | null, mainLoading: boolean, needed: boolean): { chain: Chain | null; loading: boolean } {
  const { symbol, date } = useView();
  const own = useView((s) => !!s.secWin[id]);
  const res = useApi<Chain>(useSectionUrl(id, "chain", needed && !!main?.available));
  if (!own || !needed) return { chain: main, loading: mainLoading };
  const fresh = res.data && res.data.symbol === symbol && res.data.date === date ? res.data : null;
  return { chain: fresh ?? main, loading: res.loading || (!fresh && !!main?.available) };
}
