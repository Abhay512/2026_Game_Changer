from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from app.baseline import compare
from app.formulas import percentile_rank
from app.window import FULL_DAY, WindowError, parse_window
from ingest.bvc import bvc_split


def test_window_bars():
    assert parse_window(None, None) == FULL_DAY == parse_window("09:15", "15:30")
    w = parse_window("09:30", "10:30")
    assert (w.a, w.b, w.bars, w.start, w.end) == (3, 14, 12, "09:30", "10:30")
    assert parse_window("15:25", "15:30").as_dict() == {"from": "15:25", "to": "15:30", "a": 74, "b": 74, "bars": 1}


@pytest.mark.parametrize("start,end", [("09:10", "10:00"), ("09:15", "15:35"), ("10:00", "10:00"),
                                       ("10:00", "09:30"), ("09:17", "10:00"), ("9-30", "10:00"), ("25:00", "26:00")])
def test_window_rejects_bad_input(start, end):
    with pytest.raises(WindowError):
        parse_window(start, end)


def test_compare_ratio_percentile_and_abs():
    c = compare(30, [10, 20, 30, 40], nd=0)
    assert c["avg"] == 25 and c["x"] == 1.2 and c["pct"] == 62 and c["n"] == 4  # 2 below + half a tie of 4
    assert c["hist"] == [10, 20, 30, 40]
    d = compare(-3.0, [1.0, -1.0, 2.0, -2.0], nd=2, absolute=True)  # speed: magnitudes only
    assert d["avg"] == 1.5 and d["x"] == 2.0 and d["pct"] == 100 and d["value"] == -3.0
    assert d["hist"] == [1.0, -1.0, 2.0, -2.0]  # hist keeps signed values for the chart


def test_compare_degenerate_baselines():
    assert compare(5, [], nd=0)["x"] is None and compare(5, [], nd=0)["n"] == 0
    assert compare(5, [0, 0], nd=0)["x"] is None  # zero mean -> no ratio
    assert compare(float("nan"), [1, 2])["value"] is None
    assert compare(1, [np.nan, 2.0])["n"] == 1


def test_percentile_rank():
    assert percentile_rank(5, [1, 2, 3, 4]) == 100
    assert percentile_rank(0, [1, 2, 3, 4]) == 0
    assert math.isnan(percentile_rank(1, []))


def test_bvc_time_of_day_volatility_tames_the_opening_bar():
    rng = np.random.default_rng(3)
    sessions, bars = 40, 75
    day = pd.Series(np.repeat(pd.bdate_range("2025-01-01", periods=sessions), bars))
    bar = pd.Series(np.tile(np.arange(bars), sessions))
    dp = rng.normal(0, 0.3, sessions * bars)
    dp[bar.to_numpy() == 0] = rng.normal(0, 3.0, sessions)  # opening bar 10x more volatile
    close = pd.Series(100 + np.cumsum(dp))
    open_ = close - dp  # first-bar ΔP = close - open
    vol = pd.Series(np.full(sessions * bars, 1000))

    def extreme_share(buy):
        share = buy / vol.to_numpy()
        first = (bar.to_numpy() == 0) & (day >= day.iloc[0] + pd.Timedelta(days=14)).to_numpy()
        return np.mean((share[first] > 0.99) | (share[first] < 0.01))

    plain, _ = bvc_split(close, open_, vol, day)
    adjusted, sell = bvc_split(close, open_, vol, day, bar)
    assert np.allclose(adjusted + sell, vol)
    assert extreme_share(plain) > 0.4
    assert extreme_share(adjusted) < 0.1
