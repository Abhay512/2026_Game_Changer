"""Bulk Volume Classification (Easley, López de Prado & O'Hara, 2012), time-of-day adjusted.

The raw data has no buy/sell quantities, so each bar's volume is split by how large the bar's
price change is relative to the volatility normally seen at that time of day:

    buy_vol  = V · Φ(ΔP / σ)
    sell_vol = V − buy_vol

ΔP is close − previous close within the same session (close − open on a session's first bar, so
overnight gaps do not count).

σ is the standard deviation of ΔP *at the same bar of the day* over the previous `TOD_SESSIONS`
sessions. Intraday volatility is U-shaped — the 09:15 bar moves several times more than a midday
bar — so a single σ for all bars classifies most opening bars as ~100% buy or ~100% sell. Early in
an instrument's history (fewer than `TOD_MIN` sessions) σ falls back to the rolling std of the last
`WINDOW` traded bars. Both estimates use past bars only (no look-ahead), and bars with zero volume
are ignored so illiquid contracts do not shrink σ.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.special import ndtr

WINDOW = 75  # fallback: one full session of 5-minute bars
MIN_PERIODS = 20
TOD_SESSIONS = 20  # time-of-day σ: same bar over the previous 20 sessions
TOD_MIN = 5


def _time_of_day_sigma(traded: np.ndarray, session: np.ndarray, bar: np.ndarray) -> np.ndarray:
    codes, _ = pd.factorize(session, sort=True)
    n_bars = int(bar.max()) + 1 if len(bar) else 0
    grid = np.full((codes.max() + 1 if len(codes) else 0, max(n_bars, 1)), np.nan)
    ok = (bar >= 0)
    grid[codes[ok], bar[ok]] = traded[ok]
    sig = pd.DataFrame(grid).shift(1).rolling(TOD_SESSIONS, min_periods=TOD_MIN).std().to_numpy()
    out = np.full(len(traded), np.nan)
    out[ok] = sig[codes[ok], bar[ok]]
    return out


def bvc_split(
    close: pd.Series,
    open_: pd.Series,
    volume: pd.Series,
    session: pd.Series,
    bar: pd.Series | None = None,
    window: int = WINDOW,
    min_periods: int = MIN_PERIODS,
) -> tuple[np.ndarray, np.ndarray]:
    """Return (buy_vol, sell_vol). Inputs must be time-sorted and belong to a single instrument."""
    c = close.to_numpy(dtype="float64")
    o = open_.to_numpy(dtype="float64")
    v = volume.to_numpy(dtype="float64")
    s = session.to_numpy()

    prev_c = np.roll(c, 1)
    same_session = np.zeros(len(c), dtype=bool)
    if len(c) > 1:
        same_session[1:] = s[1:] == s[:-1]
    dp = np.where(same_session, c - prev_c, c - o)

    traded = np.where(v > 0, dp, np.nan)
    ts = pd.Series(traded)
    fallback = ts.shift(1).rolling(window, min_periods=min_periods).std()
    fallback = fallback.fillna(ts.shift(1).expanding(min_periods=2).std()).to_numpy()
    sigma = fallback
    if bar is not None and len(c):
        tod = _time_of_day_sigma(traded, s, bar.to_numpy().astype(np.int64))
        sigma = np.where(np.isfinite(tod) & (tod > 0), tod, fallback)

    with np.errstate(divide="ignore", invalid="ignore"):
        z = np.where((sigma > 0) & np.isfinite(sigma), dp / sigma, 0.0)
    z = np.nan_to_num(z, nan=0.0, posinf=0.0, neginf=0.0)
    buy = v * ndtr(z)
    return buy, v - buy
