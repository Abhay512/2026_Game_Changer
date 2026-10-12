"""Per-symbol data-quality summary written into store/catalog.json."""
from __future__ import annotations

import pandas as pd

from app.config import BARS_PER_SESSION

from .discover import SymbolSources


def _d(ts) -> str | None:
    return None if ts is None or pd.isna(ts) else pd.Timestamp(ts).strftime("%Y-%m-%d")


def _span(df: pd.DataFrame | None) -> dict | None:
    if df is None or df.empty:
        return None
    return {"first": _d(df["day"].min()), "last": _d(df["day"].max()), "days": int(df["day"].nunique()),
            "rows": int(len(df))}


def summarize(src: SymbolSources, meta: dict, eq, fut, chain, days: pd.DataFrame, options_filled: float | None) -> dict:
    entry: dict = {
        "symbol": src.symbol,
        "icici_code": meta.get("icici_code"),
        "exchange": meta.get("exchange"),
        "equity": _span(eq),
        "futures": _span(fut),
        "options": _span(chain),
        "has_fno": bool(src.futures) and bool(src.options),
        "futures_expiries": sorted(src.futures),
        "options_expiries": sorted(src.options),
        "duplicate_files_skipped": src.duplicates,
        "warnings": [],
    }
    if src.conflicts:
        entry["warnings"].extend(f"duplicate expiry copies differ: {c}" for c in src.conflicts)
    if not src.equity:
        entry["warnings"].append("no equity data")
    if not entry["has_fno"]:
        entry["warnings"].append("no F&O data (futures/options missing)")
    else:
        for exp in sorted(set(src.futures) - set(src.options)):
            entry["warnings"].append(f"options file missing for expiry {exp} (futures present)")
        for exp in sorted(set(src.options) - set(src.futures)):
            entry["warnings"].append(f"futures file missing for expiry {exp} (options present)")

    if len(days):
        odd = days[~days["full_session"]]
        entry["odd_sessions"] = [
            {"day": _d(r.day), "bars": int(max(r.eq_bars, r.fut_bars))} for r in odd.itertuples()
        ]
        full = days[days["full_session"] & (days["eq_bars"] > 0)]
        entry["missing_equity_bars"] = int((BARS_PER_SESSION - full["eq_bars"]).clip(lower=0).sum())
        fno = days[days["fut_front_ok"] & days["opt_front_ok"]]
        entry["fno_front_range"] = {"first": _d(fno["day"].min()), "last": _d(fno["day"].max()),
                                    "days": int(len(fno))} if len(fno) else None
    else:
        entry["odd_sessions"] = []
        entry["missing_equity_bars"] = 0
        entry["fno_front_range"] = None
    entry["options_filled_pct"] = None if options_filled is None else round(100 * options_filled, 2)
    return entry
