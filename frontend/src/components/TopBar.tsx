import { useRef, useState } from "react";
import { useApi } from "../api/client";
import type { DayInfo, SessionInfo, SymbolInfo } from "../api/types";
import { METRIC_INFO } from "../content/metricInfo";
import { useDismiss } from "../lib/hooks";
import { useHints } from "../state/hints";
import { useView } from "../state/view";
import { useTheme } from "../theme/theme";
import { DatePicker } from "./DatePicker";
import { LogoutIcon, Mark, MoonIcon, SlidersIcon, SunIcon } from "./Icons";
import { SymbolSearch } from "./SymbolSearch";

export function TopBar({ symbols, days }: { symbols: SymbolInfo[]; days: DayInfo[] }) {
  const { symbol, date, setSymbol, setDate } = useView();
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);
  return (
    <header className="topbar">
      <div className="wrap topbar-in">
        <a className="brand" href="./" aria-label="Analyser home">
          <Mark />
          <span className="brand-name">Analyser</span>
          <span className="brand-sub">NSE F&amp;O · 5-min</span>
        </a>
        <SymbolSearch symbols={symbols} value={symbol} onChange={setSymbol} />
        <DatePicker days={days} value={date} onChange={setDate} />
        <div className="topbar-end">
          <Settings />
          <button className="icon-btn" onClick={toggleTheme} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} aria-label="Toggle colour theme">
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          <Logout />
        </div>
      </div>
    </header>
  );
}

/** Shown only when the server asks for a password (APP_PASSWORD). */
function Logout() {
  const session = useApi<SessionInfo>("/api/session").data;
  const [busy, setBusy] = useState(false);
  if (!session?.auth) return null;
  const logout = () => {
    setBusy(true);
    fetch("/api/logout", { method: "POST" }).finally(() => window.location.reload());
  };
  return (
    <button className="icon-btn" onClick={logout} disabled={busy} title="Log out" aria-label="Log out">
      <LogoutIcon />
    </button>
  );
}

function Settings() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), box);
  const lookback = useView((s) => s.lookback);
  const setLookback = useView((s) => s.setLookback);
  const resetTips = useHints((s) => s.resetAll);
  const hideAll = useHints((s) => s.hideAll);
  const dismissedCount = useHints((s) => Object.keys(s.dismissed).length);
  return (
    <div className="settings" ref={box}>
      <button className="icon-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Settings">
        <SlidersIcon />
      </button>
      {open && (
        <div className="popover settings-pop" role="dialog" aria-label="Settings">
          <div className="set-row">
            <div>
              <div className="set-k">Compare with</div>
              <div className="muted set-help">Previous sessions, same time window</div>
            </div>
            <div className="seg" role="group" aria-label="Baseline sessions">
              {[10, 20, 30].map((n) => (
                <button key={n} aria-pressed={lookback === n} onClick={() => setLookback(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="set-row">
            <div>
              <div className="set-k">Explanations</div>
              <div className="muted set-help">{dismissedCount ? `${dismissedCount} hidden with “Don't show again”` : "Shown under every metric"}</div>
            </div>
            <div className="set-actions">
              <button className="link" onClick={resetTips} disabled={!dismissedCount}>
                Show all
              </button>
              <button className="link" onClick={() => hideAll(Object.keys(METRIC_INFO))}>
                Hide all
              </button>
            </div>
          </div>
          <p className="set-note muted">Buy/sell split is estimated from price and volume (Bulk Volume Classification); the data has no exchange buy/sell quantities.</p>
        </div>
      )}
    </div>
  );
}
