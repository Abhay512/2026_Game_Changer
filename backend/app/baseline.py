"""20-day "same window" baselines.

For a date D the baseline is the previous N *valid* sessions: full sessions (≥70 bars, so Muhurat
trading is skipped) that have the data the metric needs. Futures need a true front-month contract;
options need a chain of the same expiry rank (front / next) as the one being viewed.
"""
from __future__ import annotations

import math

import numpy as np

from .formulas import percentile_rank
from .store import SymbolData


def select_days(sd: SymbolData, day: str, need: str, n: int, rank: int = 0) -> list[str]:
    """Previous `n` valid sessions before `day`, oldest first. need ∈ {equity, futures, options}."""
    pos = sd.days.pos.get(day)
    if pos is None:
        return []
    out: list[str] = []
    for d in reversed(sd.days.order[:pos]):
        r = sd.days.rec[d]
        if not r["full"]:
            continue
        if need == "equity":
            if not r["eq_bars"]:
                continue
        elif need == "futures":
            if not (r["fut_bars"] and r["fut_ok"] and r["fut_expiry"]):
                continue
        elif need == "options":
            if sd.futures is not None and not r["fut_ok"]:
                continue  # without the true front month the expiry ladder (rank) is unreliable
            if sd.futures is None and not r["opt_ok"]:
                continue
            e = sd.expiry_at(d, rank)
            if e is None or sd.chain is None or sd.chain.row(e, d) < 0:
                continue
        else:
            raise ValueError(f"unknown need {need!r}")
        out.append(d)
        if len(out) >= n:
            break
    return out[::-1]


def num(x, nd: int | None = None):
    """float or None (JSON-safe), optionally rounded."""
    if x is None:
        return None
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f):
        return None
    return round(f, nd) if nd is not None else f


def nums(values, nd: int | None = None) -> list:
    return [num(v, nd) for v in np.asarray(values, dtype="float64").reshape(-1).tolist()]


def compare(today, sample, nd: int | None = 2, absolute: bool = False, hist: bool = True) -> dict:
    """today vs the baseline sample.

    x   = today ÷ baseline mean   ("1.8×"); with absolute=True both sides use |value| (speed of change)
    pct = percentile rank of today among the baseline days (0–100)
    hist = the baseline values themselves (signed), aligned with the baseline day list
    """
    t = float(today) if today is not None else float("nan")
    s = np.asarray(sample, dtype="float64").reshape(-1)
    ts = abs(t) if absolute else t
    ss = np.abs(s) if absolute else s
    fin = ss[np.isfinite(ss)]
    mean = float(fin.mean()) if fin.size else float("nan")
    x = ts / mean if fin.size and mean != 0 and math.isfinite(ts) else float("nan")
    out = {"value": num(t, nd), "avg": num(mean, nd), "x": num(x, 2), "pct": num(percentile_rank(ts, fin), 0),
           "n": int(fin.size)}
    if absolute:
        out["abs"] = True
    if hist:
        out["hist"] = nums(s, nd)
    return out


def unavailable(reason: str) -> dict:
    return {"available": False, "reason": reason}
