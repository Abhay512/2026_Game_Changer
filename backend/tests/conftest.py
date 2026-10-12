"""Synthetic raw-data tree in the exact vendor CSV format, small enough for fast tests."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

STRIKES = [90.0, 95.0, 100.0, 105.0, 110.0]


def session_times(day: str, bars: int = 75, start: str = "09:15") -> list[str]:
    t0 = pd.Timestamp(f"{day} {start}")
    return [(t0 + pd.Timedelta(minutes=5 * i)).strftime("%Y-%m-%d %H:%M:%S") + "+05:30" for i in range(bars)]


def make_equity(days: list[str], sym: str = "TEST", short_day: str | None = None) -> pd.DataFrame:
    rng = np.random.default_rng(1)
    rows = []
    px = 100.0
    for d in days:
        n = 16 if d == short_day else 75
        for t in session_times(d, n, "13:45" if d == short_day else "09:15"):
            o = px
            px = max(1.0, px + rng.normal(0, 0.3))
            vol = int(rng.integers(1000, 5000))
            rows.append([t, sym, "TST", "NSE", o, max(o, px) + 0.1, min(o, px) - 0.1, px, vol, vol * px])
    return pd.DataFrame(rows, columns=["date", "name", "icici_code", "exchange", "open", "high", "low", "close",
                                       "volume", "turnover"])


def make_futures(days: list[str], expiry: str, sym: str = "TEST", oi0: float = 10_000) -> pd.DataFrame:
    rows = []
    for di, d in enumerate(days):
        for i, t in enumerate(session_times(d)):
            px = 100 + i * 0.01
            oi = oi0 + di * 1000 + i * 10
            rows.append([t, sym, "TST", "NFO", expiry, px, px + 0.1, px - 0.1, px, 300, 300 * px, oi, 300])
    return pd.DataFrame(rows, columns=["date", "name", "icici_code", "exchange", "expiry", "open", "high", "low",
                                       "close", "volume", "turnover", "oi", "lot_size"])


def make_options(days: list[str], expiry: str, sym: str = "TEST", drop_bars: int = 0) -> pd.DataFrame:
    rows = []
    for d in days:
        for i, t in enumerate(session_times(d)):
            for k in STRIKES:
                for right in ("CE", "PE"):
                    if drop_bars and k == STRIKES[0] and right == "CE" and i < drop_bars:
                        continue  # illiquid strike: first bars missing
                    oi = 1000 + i * (5 if right == "PE" else 3)
                    rows.append([t, sym, "TST", "NFO", expiry, k, right, 2.0, 2.0, 2.0, 2.0, 30, 60.0, oi, 300,
                                 100.0, 0.05, 0.25, 0.5 if right == "CE" else -0.5, 0.01, -0.1, 0.05, 0.01])
    return pd.DataFrame(rows, columns=["date", "name", "icici_code", "exchange", "expiry", "strike", "right",
                                       "open", "high", "low", "close", "volume", "turnover", "oi", "lot_size",
                                       "spot", "tte_years", "iv", "delta", "gamma", "theta", "vega", "rho"])


@pytest.fixture
def raw_tree(tmp_path: Path) -> Path:
    """2025/TEST with equity, two futures/options expiries duplicated across month folders."""
    days = ["2025-07-28", "2025-07-29", "2025-07-30", "2025-07-31", "2025-08-01"]
    base = tmp_path / "raw" / "2025" / "TEST"
    (base / "equity").mkdir(parents=True)
    make_equity(days, short_day="2025-07-30").to_csv(base / "equity" / "2025.csv", index=False)
    for month, expiries in (("07_jul", ["2025-07-31", "2025-08-28"]), ("08_aug", ["2025-08-28"])):
        for kind, maker, prefix in (("futures", make_futures, "fut"), ("options", make_options, "opt")):
            d = base / kind / month
            d.mkdir(parents=True, exist_ok=True)
            for exp in expiries:
                live = [x for x in days if x <= exp]
                df = maker(live, exp) if kind == "futures" else maker(live, exp, drop_bars=3)
                df.to_csv(d / f"{prefix}_{exp}.csv", index=False)
    eq_only = tmp_path / "raw" / "2025" / "EQONLY" / "equity"
    eq_only.mkdir(parents=True)
    make_equity(days[:2], sym="EQONLY").to_csv(eq_only / "2025.csv", index=False)
    return tmp_path / "raw"


@pytest.fixture(scope="session")
def market_store(tmp_path_factory) -> Path:
    """Synthetic 3-month market (tests/synth.py) ingested into a store, built once per test run."""
    from ingest.__main__ import main as ingest_main

    from synth import write_market

    root = tmp_path_factory.mktemp("market")
    raw = write_market(root / "raw")
    store = root / "store"
    assert ingest_main(["--raw", str(raw), "--store", str(store), "--workers", "2"]) == 0
    return store


@pytest.fixture(scope="session")
def client(market_store):
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app(market_store))
