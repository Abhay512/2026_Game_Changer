"""Futures open interest: front contract and all live expiries combined, plus the build-up tag."""
from __future__ import annotations

import numpy as np

from ..baseline import compare, num
from ..formulas import safe_div
from ..matrix import Matrix, level_at, start_values
from ..window import Window


def buildup(price_chg: float, oi_chg: float) -> str | None:
    """Classic price/OI quadrant."""
    if not (np.isfinite(price_chg) and np.isfinite(oi_chg)):
        return None
    if oi_chg > 0:
        return "long_buildup" if price_chg > 0 else "short_buildup" if price_chg < 0 else "oi_up"
    if oi_chg < 0:
        return "short_covering" if price_chg > 0 else "long_unwinding" if price_chg < 0 else "oi_down"
    return "neutral"


def _oi(m: Matrix, rows: np.ndarray, w: Window) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(OI at B, OI at window start, OI just before bar B) per row."""
    return (level_at(m, "oi", rows, w.a, w.b), start_values(m, "oi", rows, w.a, w.b),
            start_values(m, "oi", rows, w.b, w.b))


def _oi_all(m: Matrix, day: str, w: Window) -> tuple[float, float, float]:
    rows = m.rows_on(day)
    now, start, before = _oi(m, rows, w)
    return float(np.nansum(now)), float(np.nansum(start)), float(np.nansum(before))


def _block(now, start, before, b_now, b_start, b_before) -> dict:
    chg = now - start
    return {
        "value": num(now, 0), "start": num(start, 0),
        "chg": compare(chg, b_now - b_start, nd=0, absolute=True),
        "chg_pct": num(safe_div(chg, start) * 100, 3),
        "last5": compare(now - before, b_now - b_before, nd=0, absolute=True),
    }


def oi_block(m: Matrix, day: str, row: int, base_days: list[str], base_rows: np.ndarray, w: Window,
             price_chg: float) -> dict:
    r = np.array([row])
    now, start, before = (x[0] for x in _oi(m, r, w))
    b_now, b_start, b_before = _oi(m, base_rows, w)
    front = _block(now, start, before, b_now, b_start, b_before)

    a_now, a_start, a_before = _oi_all(m, day, w)
    base_all = np.array([_oi_all(m, d, w) for d in base_days]).reshape(-1, 3)
    combined = _block(a_now, a_start, a_before, base_all[:, 0], base_all[:, 1], base_all[:, 2])
    combined["expiries"] = int(len(m.rows_on(day)))

    return {
        "front": front,
        "all": combined,
        "buildup": buildup(price_chg, now - start),
        "buildup_all": buildup(price_chg, a_now - a_start),
        "lot_size": num(level_at(m, "lot_size", r, w.a, w.b)[0], 0),
    }
