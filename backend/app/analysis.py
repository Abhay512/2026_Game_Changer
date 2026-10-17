"""Builds the /api/analysis and /api/chain payloads from the metric blocks."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .baseline import num, select_days, unavailable
from .matrix import level_at
from .metrics.chain import chain_block
from .metrics.flow import flow_block
from .metrics.futures import oi_block
from .metrics.price import price_block
from .metrics.strikes import strike_days, strike_rows
from .metrics.volume import total_block
from .store import NotFound, SymbolData
from .window import Window

ALL_HISTORY = 100_000


def resolve_day(sd: SymbolData, day: str | None) -> str:
    if not day:
        return sd.default_day()
    if day not in sd.days.rec:
        raise NotFound(f"No data for {sd.symbol} on {day}")
    return day


def _rows(m, keys: list[tuple]) -> np.ndarray:
    return np.array([m.row(*k) for k in keys], dtype=np.intp)


def _baseline_info(days: list[str], lookback: int) -> dict:
    return {"days": days, "n": len(days), "lookback": lookback}


# ------------------------------------------------------------------------------- spot / futures

def spot_section(sd: SymbolData, day: str, w: Window, lookback: int) -> dict:
    eq = sd.equity
    row = eq.row(day) if eq is not None else -1
    if row < 0:
        return unavailable("No equity data for this date")
    bdays = select_days(sd, day, "equity", lookback)
    brows = _rows(eq, [(d,) for d in bdays])
    price = price_block(eq, row, brows, w)
    if not price.get("available"):
        return price
    return {"available": True, "baseline": _baseline_info(bdays, lookback), "price": price,
            "volume": total_block(eq, "volume", row, brows, w),
            "turnover": total_block(eq, "turnover", row, brows, w),
            "flow": flow_block(eq, row, brows, w)}


def futures_section(sd: SymbolData, day: str, w: Window, lookback: int) -> dict:
    fut = sd.futures
    rec = sd.days.rec[day]
    if fut is None:
        return unavailable(f"No futures data for {sd.symbol}")
    expiry = rec["fut_expiry"]
    row = fut.row(expiry, day) if expiry else -1
    if row < 0:
        return unavailable("No futures data for this date")
    bdays = select_days(sd, day, "futures", lookback)
    brows = _rows(fut, [(sd.days.rec[d]["fut_expiry"], d) for d in bdays])
    price = price_block(fut, row, brows, w)
    if not price.get("available"):
        return price
    out = {"available": True, "expiry": expiry, "front_ok": rec["fut_ok"],
           "baseline": _baseline_info(bdays, lookback), "price": price,
           "volume": total_block(fut, "volume", row, brows, w),
           "turnover": total_block(fut, "turnover", row, brows, w),
           "flow": flow_block(fut, row, brows, w),
           "oi": oi_block(fut, day, row, bdays, brows, w, price["chg"] if price["chg"] is not None else np.nan)}
    if sd.equity is not None and sd.equity.row(day) >= 0:
        spot = level_at(sd.equity, "close", [sd.equity.row(day)], w.a, w.b)[0]
        fclose = price["close"]
        if fclose is not None and np.isfinite(spot):
            out["premium"] = {"points": num(fclose - spot, 2), "pct": num((fclose / spot - 1) * 100, 3)}
    return out


# ------------------------------------------------------------------------------- options

@dataclass
class OptionContext:
    day: str
    expiry: str
    expiries: list[str]
    rank: int
    front_ok: bool
    base_days: list[str]
    base_expiries: list[str]
    notes: list[str]


def option_context(sd: SymbolData, day: str, expiry: str | None, lookback: int) -> OptionContext | None:
    if sd.chain is None:
        return None
    available = sd.opt_expiries(day)
    if not available:
        return None
    notes: list[str] = []
    ladder = sd.ladder(day)
    if expiry and expiry not in available:
        # e.g. the user changed date and the chosen expiry has already expired: fall back, say so
        notes.append(f"Expiry {expiry} is not trading on {day}; showing the default expiry instead.")
        expiry = None
    if not expiry:
        expiry = next((e for e in ladder if e in available), available[0])
        if ladder and expiry != ladder[0]:
            notes.append(f"Front-month options ({ladder[0]}) are missing in the data for this date; "
                         f"showing the {expiry} expiry instead.")
    rank = sd.rank_of(day, expiry) or 0
    rec = sd.days.rec[day]
    front_ok = bool(ladder) and expiry == ladder[0] and (rec["fut_ok"] or sd.futures is None)
    if sd.futures is not None and not rec["fut_ok"]:
        notes.append("The true front-month contract is not in the dataset for this date "
                     "(data starts 2 months before each expiry).")
    if expiry == day:
        notes.append("Expiry day: the data has no IV or Greeks on expiry day.")
    base_days = select_days(sd, day, "options", lookback, rank)
    base_exps = [sd.expiry_at(d, rank) for d in base_days]
    return OptionContext(day, expiry, available, rank, front_ok, base_days, base_exps, notes)


def _strike_baseline(sd: SymbolData, ctx: OptionContext, w: Window) -> list:
    out = []
    cm = sd.chain
    for d, e in zip(ctx.base_days, ctx.base_expiries):
        row = cm.row(e, d)
        try:
            bom = sd.options(e)
        except NotFound:
            continue
        atm = level_at(cm, "atm_strike", [row], w.a, w.b)[0]
        spot = level_at(cm, "spot", [row], w.a, w.b)[0]
        out.append((bom, d, atm, spot))
    return out


def options_section(sd: SymbolData, day: str, w: Window, lookback: int, expiry: str | None) -> dict:
    ctx = option_context(sd, day, expiry, lookback)
    if ctx is None:
        return unavailable(f"No options data for {sd.symbol} on this date" if sd.chain is not None
                           else f"No F&O data for {sd.symbol}")
    cm = sd.chain
    row = cm.row(ctx.expiry, day)
    brows = _rows(cm, list(zip(ctx.base_expiries, ctx.base_days)))
    hist_days = select_days(sd, day, "options", ALL_HISTORY, ctx.rank)
    hrows = _rows(cm, [(sd.expiry_at(d, ctx.rank), d) for d in hist_days])
    block = chain_block(cm, row, brows, hrows, w)

    # ATM CE/PE Greeks for the summary cards (offset 0 of the strike engine)
    om = sd.options(ctx.expiry)
    atm = level_at(cm, "atm_strike", [row], w.a, w.b)[0]
    spot = level_at(cm, "spot", [row], w.a, w.b)[0]
    atm_rows = strike_rows(om, day, atm, spot, 0, w, _strike_baseline(sd, ctx, w))["rows"]
    return {"available": True, "expiry": ctx.expiry, "expiries": ctx.expiries, "rank": ctx.rank,
            "front_ok": ctx.front_ok, "baseline": _baseline_info(ctx.base_days, lookback),
            "notes": ctx.notes, **block, "atm_contracts": atm_rows[0] if atm_rows else None}


def build_analysis(sd: SymbolData, day: str, w: Window, lookback: int, expiry: str | None) -> dict:
    rec = sd.days.rec[day]
    notes = []
    if not rec["full"]:
        notes.append("Short session (e.g. Muhurat trading): today is compared normally, but such days are "
                     "never used in anyone's 20-day baseline.")
    out = {"symbol": sd.symbol, "date": day, "window": w.as_dict(), "lookback": lookback,
           "session": {"bars": max(rec["eq_bars"], rec["fut_bars"]), "full": rec["full"]},
           "spot": spot_section(sd, day, w, lookback),
           "futures": futures_section(sd, day, w, lookback),
           "options": options_section(sd, day, w, lookback, expiry)}
    for key in ("spot", "futures", "options"):
        sec = out[key]
        if sec.get("available") and sec["baseline"]["n"] < lookback:
            notes.append(f"{key.capitalize()}: only {sec['baseline']['n']} comparable sessions exist before this "
                         f"date (wanted {lookback}).")
    out["notes"] = notes + (out["options"].get("notes", []) if out["options"].get("available") else [])
    return out


def build_chain(sd: SymbolData, day: str, w: Window, lookback: int, expiry: str | None, n: int) -> dict:
    ctx = option_context(sd, day, expiry, lookback)
    base = {"symbol": sd.symbol, "date": day, "window": w.as_dict(), "lookback": lookback}
    if ctx is None:
        return {**base, **unavailable(f"No options data for {sd.symbol} on this date")}
    cm = sd.chain
    row = cm.row(ctx.expiry, day)
    om = sd.options(ctx.expiry)
    atm = level_at(cm, "atm_strike", [row], w.a, w.b)[0]
    spot = level_at(cm, "spot", [row], w.a, w.b)[0]
    lot = None
    if sd.futures is not None:
        frow = sd.futures.row(ctx.expiry, day)
        if frow >= 0:
            lot = num(level_at(sd.futures, "lot_size", [frow], w.a, w.b)[0], 0)
    body = strike_rows(om, day, atm, spot, n, w, _strike_baseline(sd, ctx, w))
    return {**base, "available": True, "expiry": ctx.expiry, "expiries": ctx.expiries, "rank": ctx.rank,
            "front_ok": ctx.front_ok, "notes": ctx.notes, "spot": num(spot, 2), "atm": num(atm, 2),
            "max_pain": num(level_at(cm, "max_pain", [row], w.a, w.b)[0], 2), "lot_size": lot,
            "strikes_each_side": n, "baseline": _baseline_info(ctx.base_days, lookback), **body}


def build_chain_days(sd: SymbolData, day: str, w: Window, lookback: int, expiry: str | None, offset: int) -> dict:
    """One chain row on the last `lookback` sessions (the chain's "last N sessions" bar graphs)."""
    ctx = option_context(sd, day, expiry, lookback)
    base = {"symbol": sd.symbol, "date": day, "window": w.as_dict(), "lookback": lookback}
    if ctx is None:
        return {**base, **unavailable(f"No options data for {sd.symbol} on this date")}
    cm = sd.chain
    row = cm.row(ctx.expiry, day)
    om = sd.options(ctx.expiry)
    atm = level_at(cm, "atm_strike", [row], w.a, w.b)[0]
    spot = level_at(cm, "spot", [row], w.a, w.b)[0]
    body = strike_days(om, day, atm, spot, offset, w, _strike_baseline(sd, ctx, w))
    if body is None:
        return {**base, **unavailable(f"No option chain for {sd.symbol} on this date")}
    days = body.pop("days")
    return {**base, "available": True, "expiry": ctx.expiry, "baseline": _baseline_info(days, lookback), **body}
