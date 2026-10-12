"""Price vs VWAP and price speed (works for spot and futures matrices)."""
from __future__ import annotations

import warnings

import numpy as np

from ..baseline import compare, num, unavailable
from ..formulas import safe_div
from ..matrix import Matrix, first_valid, has_data, start_values, value_at
from ..window import Window


def price_block(m: Matrix, row: int, base_rows: np.ndarray, w: Window) -> dict:
    a, b = w.a, w.b
    r = np.array([row])
    if not has_data(m, r, a, b)[0]:
        return unavailable("No trades in this window")

    open_a = first_valid(m.v["open"][r, a:b + 1])[0]
    close_b = value_at(m, "close", r, b)[0]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        high = float(np.nanmax(m.v["high"][row, a:b + 1]))
        low = float(np.nanmin(m.v["low"][row, a:b + 1]))
    start = start_values(m, "close", r, a, b)[0]

    vol = np.nan_to_num(m.v["volume"][row])
    turn = np.nan_to_num(m.v["turnover"][row])
    cum_v, cum_t = np.cumsum(vol), np.cumsum(turn)
    run_vwap = safe_div(cum_t, cum_v)  # session VWAP at the end of every bar
    vwap = run_vwap[b]
    vwap_window = safe_div(turn[a:b + 1].sum(), vol[a:b + 1].sum())
    closes = m.v["close"][row, a:b + 1]
    pres = m.present[row, a:b + 1] & np.isfinite(run_vwap[a:b + 1])
    above_share = 100.0 * np.mean(closes[pres] > run_vwap[a:b + 1][pres]) if pres.any() else np.nan

    chg_pct = (close_b / start - 1) * 100 if start else np.nan
    b_start = start_values(m, "close", base_rows, a, b)
    b_close = value_at(m, "close", base_rows, b)
    b_chg = (safe_div(b_close, b_start) - 1) * 100

    if np.isfinite(vwap):
        side = "above" if close_b > vwap else "below" if close_b < vwap else "at"
    else:
        side = None
    return {
        "available": True,
        "start": num(start, 2), "open": num(open_a, 2), "high": num(high, 2), "low": num(low, 2),
        "close": num(close_b, 2),
        "chg": num(close_b - start, 2), "chg_pct": num(chg_pct, 3),
        "from_open_pct": num((close_b / open_a - 1) * 100 if open_a else np.nan, 3),
        "range_pct": num((high - low) / start * 100 if start else np.nan, 3),
        "vwap": num(vwap, 2), "vwap_window": num(vwap_window, 2), "vs_vwap": side,
        "vwap_dist_pct": num((close_b / vwap - 1) * 100 if vwap else np.nan, 3),
        "above_vwap_pct": num(above_share, 1),
        # speed: |price change over the window| vs the same window on baseline days
        "speed": compare(chg_pct, b_chg, nd=3, absolute=True),
    }
