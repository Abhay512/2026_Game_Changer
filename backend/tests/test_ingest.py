from __future__ import annotations

import json

import numpy as np
import pandas as pd

from ingest import derive
from ingest.__main__ import main as ingest_main
from ingest.bvc import bvc_split
from ingest.discover import discover


def test_discover_dedupes_identical_expiry_copies(raw_tree):
    src = discover(raw_tree)
    t = src["TEST"]
    assert sorted(t.futures) == ["2025-07-31", "2025-08-28"]
    assert sorted(t.options) == ["2025-07-31", "2025-08-28"]
    assert t.duplicates == 2  # 2025-08-28 fut + opt appear in both 07_jul and 08_aug
    assert t.conflicts == []
    assert not src["EQONLY"].futures and not src["EQONLY"].options


def test_discover_flags_differing_copies(raw_tree):
    f = raw_tree / "2025" / "TEST" / "futures" / "08_aug" / "fut_2025-08-28.csv"
    f.write_text(f.read_text() + f.read_text().splitlines()[-1] + "\n")
    t = discover(raw_tree)["TEST"]
    assert len(t.conflicts) == 1
    assert t.futures["2025-08-28"] == f  # larger copy wins


def test_bvc_conserves_volume_and_follows_direction():
    n = 200
    day = pd.Series(np.repeat(pd.to_datetime(["2025-01-01", "2025-01-02"]), n // 2))
    rng = np.random.default_rng(0)
    close = pd.Series(100 + np.cumsum(rng.normal(0, 1, n)))
    open_ = close.shift(1).fillna(close.iloc[0])
    vol = pd.Series(rng.integers(100, 1000, n))
    buy, sell = bvc_split(close, open_, vol, day)
    assert np.allclose(buy + sell, vol)
    assert (buy >= 0).all() and (sell >= 0).all()
    dp = close.diff()
    up, down = dp > 1.5, dp < -1.5
    assert (buy[up] / vol[up] > 0.5).all()
    assert (buy[down] / vol[down] < 0.5).all()


def test_bvc_zero_move_splits_evenly():
    day = pd.Series(pd.to_datetime(["2025-01-01"] * 30))
    close = pd.Series([100.0] * 30)
    buy, sell = bvc_split(close, close, pd.Series([10] * 30), day)
    assert np.allclose(buy, 5) and np.allclose(sell, 5)


def test_max_pain_known_chain():
    strikes = np.array([90.0, 100.0, 110.0])
    # Heavy call writing at 100, heavy put writing at 100 -> settling at 100 costs writers nothing.
    ce = np.array([[0.0, 1000.0, 0.0]])
    pe = np.array([[0.0, 1000.0, 0.0]])
    pain = derive.max_pain_matrix(strikes, ce, pe)
    assert strikes[np.argmin(pain[0])] == 100.0
    # Calls at 90 (OI 10) and puts at 110 (OI 10): payout(90)=10*20=200, payout(100)=100+100, payout(110)=200
    ce = np.array([[10.0, 0.0, 0.0]])
    pe = np.array([[0.0, 0.0, 10.0]])
    pain = derive.max_pain_matrix(strikes, ce, pe)
    assert pain[0].tolist() == [200.0, 200.0, 200.0]
    # Calls at 110 heavy, puts at 90 heavy -> any strike in [90,110] is free; argmin picks lowest
    ce = np.array([[0.0, 0.0, 50.0]])
    pe = np.array([[50.0, 0.0, 0.0]])
    pain = derive.max_pain_matrix(strikes, ce, pe)
    assert pain[0].tolist() == [0.0, 0.0, 0.0]


def test_day_table_flags_missing_front_month_options():
    d1, d2 = pd.Timestamp("2025-12-22"), pd.Timestamp("2025-12-29")
    dec, jan = pd.Timestamp("2025-12-30"), pd.Timestamp("2026-01-27")
    fut_front = pd.DataFrame({"day": [d1] * 75 + [d2] * 75, "bar": list(range(75)) * 2, "expiry": dec})
    # options file for the Dec expiry is missing: only the Jan chain exists
    chain = pd.DataFrame({"day": [d1] * 75 + [d2] * 75, "bar": list(range(75)) * 2, "expiry": jan})
    days = derive.day_table(None, fut_front, chain)
    assert days["fut_front_ok"].all()
    assert not days["opt_front_ok"].any()  # Jan chain is 29 days out on d2 but is NOT the front month


def test_full_ingest_on_synthetic_tree(raw_tree, tmp_path):
    store = tmp_path / "store"
    assert ingest_main(["--raw", str(raw_tree), "--store", str(store), "--workers", "1"]) == 0
    cat = json.loads((store / "catalog.json").read_text())["symbols"]
    assert set(cat) == {"TEST", "EQONLY"}
    assert cat["TEST"]["has_fno"] and not cat["EQONLY"]["has_fno"]
    assert cat["TEST"]["duplicate_files_skipped"] == 2
    assert [o["day"] for o in cat["TEST"]["odd_sessions"]] == ["2025-07-30"]

    days = pd.read_parquet(store / "days" / "TEST.parquet")
    assert not bool(days.loc[days.day == "2025-07-30", "full_session"].item())
    assert days["full_session"].sum() == 4

    # options grid: the strike with its first 3 bars missing is back-filled, volume 0 on filled bars
    grid = pd.read_parquet(store / "options" / "TEST" / "2025-07-31.parquet")
    first_day = grid[(grid.day == "2025-07-28") & (grid.strike == 90.0) & (grid.right == "CE")]
    assert len(first_day) == 75
    assert first_day.head(3)["filled"].all()
    assert (first_day.head(3)["volume"] == 0).all()
    assert first_day.head(3)["oi"].tolist() == [first_day.iloc[3]["oi"]] * 3
    # later days: missing leading bars carry the previous day's last OI
    day2 = grid[(grid.day == "2025-07-29") & (grid.strike == 90.0) & (grid.right == "CE")]
    assert day2.iloc[0]["oi"] == first_day.iloc[-1]["oi"]

    # chain aggregates: totals match the grid, front futures pick the nearest expiry
    chain = pd.read_parquet(store / "chain" / "TEST.parquet")
    row = chain[(chain.day == "2025-07-28") & (chain.bar == 74) & (chain.expiry == "2025-07-31")].iloc[0]
    g = grid[(grid.day == "2025-07-28") & (grid.bar == 74)]
    assert row.ce_oi == g[g.right == "CE"].oi.sum()
    assert row.pe_oi == g[g.right == "PE"].oi.sum()
    assert abs(row.pcr_oi - row.pe_oi / row.ce_oi) < 1e-12
    assert row.atm_strike == 100.0

    front = pd.read_parquet(store / "futures_front" / "TEST.parquet")
    assert set(front[front.day <= "2025-07-31"].expiry.astype(str).str[:10]) == {"2025-07-31"}
    assert set(front[front.day == "2025-08-01"].expiry.astype(str).str[:10]) == {"2025-08-28"}
    allf = pd.read_parquet(store / "futures" / "TEST.parquet")
    r = front[(front.day == "2025-07-29") & (front.bar == 10)].iloc[0]
    assert r.oi_all == allf[(allf.day == "2025-07-29") & (allf.bar == 10)].oi.sum()

    # second run is a no-op (incremental)
    before = (store / "equity" / "TEST.parquet").stat().st_mtime_ns
    assert ingest_main(["--raw", str(raw_tree), "--store", str(store), "--workers", "1"]) == 0
    assert (store / "equity" / "TEST.parquet").stat().st_mtime_ns == before
