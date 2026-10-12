"""Vectorized generator for a ~3-month synthetic market in the exact vendor CSV format.

MKT    — equity + futures + options for three monthly expiries (Jun/Jul/Aug 2025)
GAP    — like MKT but the Jul-2025 options file is missing (futures present), as in the real data
EQONLY — equity only
2025-07-15 is a short (Muhurat-like) session: 16 bars from 13:45.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

DAYS = [d.strftime("%Y-%m-%d") for d in pd.bdate_range("2025-06-02", "2025-08-29")]
SHORT_DAY = "2025-07-15"
EXPIRIES = ["2025-06-26", "2025-07-31", "2025-08-28"]
STRIKES = np.arange(80.0, 121.0, 5.0)
BARS = 75


def _bars_for(day: str) -> np.ndarray:
    return np.arange(54, 70) if day == SHORT_DAY else np.arange(BARS)


def _stamp(days: np.ndarray, bars: np.ndarray) -> np.ndarray:
    ts = pd.to_datetime(days) + pd.to_timedelta(9 * 60 + 15 + bars * 5, unit="min")
    return (pd.Series(ts).dt.strftime("%Y-%m-%d %H:%M:%S") + "+05:30").to_numpy()


def spot_path(seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = [(d, b) for d in DAYS for b in _bars_for(d)]
    df = pd.DataFrame(rows, columns=["day", "bar"])
    steps = rng.normal(0, 0.12, len(df))
    steps[df["bar"].to_numpy() == 0] *= 4  # opening bar is more volatile, as in real data
    df["close"] = np.round(100 + np.cumsum(steps), 2)
    df["open"] = np.round(np.r_[100.0, df["close"].to_numpy()[:-1]], 2)
    df["high"] = np.round(np.maximum(df["open"], df["close"]) + 0.05, 2)
    df["low"] = np.round(np.minimum(df["open"], df["close"]) - 0.05, 2)
    u_shape = 1 + 2 * np.exp(-df["bar"].to_numpy() / 6) + np.exp((df["bar"].to_numpy() - 74) / 6)
    df["volume"] = (rng.integers(2_000, 6_000, len(df)) * u_shape).astype(np.int64)
    df["turnover"] = np.round(df["volume"] * df["close"], 2)
    return df


def equity_csv(spot: pd.DataFrame, sym: str) -> pd.DataFrame:
    out = pd.DataFrame({"date": _stamp(spot["day"].to_numpy(), spot["bar"].to_numpy()), "name": sym,
                        "icici_code": sym[:6], "exchange": "NSE"})
    for c in ("open", "high", "low", "close", "volume", "turnover"):
        out[c] = spot[c].to_numpy()
    return out


def _contract_days(expiry: str) -> list[str]:
    first = (pd.Timestamp(expiry) - pd.Timedelta(days=60)).strftime("%Y-%m-%d")
    return [d for d in DAYS if first <= d <= expiry]


def futures_csv(spot: pd.DataFrame, expiry: str, sym: str, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    days = set(_contract_days(expiry))
    f = spot[spot["day"].isin(days)].reset_index(drop=True)
    k = 1.002
    px = np.round(f["close"].to_numpy() * k, 2)
    vol = (rng.integers(1, 20, len(f)) * 500).astype(np.int64)
    oi = 1_000_000 + np.cumsum(rng.integers(-40, 60, len(f)) * 500)
    return pd.DataFrame({
        "date": _stamp(f["day"].to_numpy(), f["bar"].to_numpy()), "name": sym, "icici_code": sym[:6],
        "exchange": "NFO", "expiry": expiry, "open": np.round(f["open"].to_numpy() * k, 2),
        "high": np.round(f["high"].to_numpy() * k, 2), "low": np.round(f["low"].to_numpy() * k, 2),
        "close": px, "volume": vol, "turnover": np.round(vol * px, 2), "oi": oi, "lot_size": 500,
    })


def options_csv(spot: pd.DataFrame, expiry: str, sym: str, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    days = set(_contract_days(expiry))
    s = spot[spot["day"].isin(days)].reset_index(drop=True)
    n, k = len(s), len(STRIKES)
    rep = np.repeat(np.arange(n), k * 2)
    strike = np.tile(np.repeat(STRIKES, 2), n)
    right = np.tile(np.array(["CE", "PE"]), n * k)
    spot_px = s["close"].to_numpy()[rep]
    is_ce = right == "CE"
    intrinsic = np.where(is_ce, np.maximum(spot_px - strike, 0), np.maximum(strike - spot_px, 0))
    close = np.round(intrinsic + 1.0, 2)
    # OI: each contract follows its own random walk through its life
    contract = np.tile(np.arange(k * 2), n)
    steps = rng.integers(-30, 50, n * k * 2) * 500
    oi = 50_000 + pd.Series(steps).groupby(contract).cumsum().to_numpy()
    oi = np.maximum(oi, 0)
    vol = (rng.integers(0, 30, n * k * 2) * 500).astype(np.int64)
    delta_ce = np.clip(0.5 + (spot_px - strike) / 40, 0.01, 0.99)
    expiry_day = s["day"].to_numpy()[rep] == expiry
    nan_if_expiry = lambda x: np.where(expiry_day, np.nan, x)  # vendor leaves Greeks empty on expiry day
    return pd.DataFrame({
        "date": _stamp(s["day"].to_numpy()[rep], s["bar"].to_numpy()[rep]), "name": sym, "icici_code": sym[:6],
        "exchange": "NFO", "expiry": expiry, "strike": strike, "right": right, "open": close, "high": close,
        "low": close, "close": close, "volume": vol, "turnover": np.round(vol * close, 2), "oi": oi,
        "lot_size": 500, "spot": spot_px, "tte_years": 0.05,
        "iv": nan_if_expiry(np.round(0.2 + 0.02 * np.sin(strike / 7) + 0.0001 * rep / k, 6)),
        "delta": nan_if_expiry(np.round(np.where(is_ce, delta_ce, delta_ce - 1), 6)),
        "gamma": nan_if_expiry(np.round(0.02 + 0.001 * np.cos(strike), 6)),
        "theta": nan_if_expiry(np.round(-0.5 - intrinsic / 100, 6)), "vega": nan_if_expiry(0.1),
        "rho": nan_if_expiry(0.01),
    })


def _month_dir(expiry: str) -> str:
    ts = pd.Timestamp(expiry)
    return f"{ts.month:02d}_{ts.strftime('%b').lower()}"


def write_market(raw: Path) -> Path:
    spot = spot_path()
    for sym, seed, skip_opt in (("MKT", 1, None), ("GAP", 2, "2025-07-31")):
        base = raw / "2025" / sym
        (base / "equity").mkdir(parents=True, exist_ok=True)
        equity_csv(spot, sym).to_csv(base / "equity" / "2025.csv", index=False)
        for i, exp in enumerate(EXPIRIES):
            for kind, prefix, maker in (("futures", "fut", futures_csv), ("options", "opt", options_csv)):
                if kind == "options" and exp == skip_opt:
                    continue
                d = base / kind / _month_dir(exp)
                d.mkdir(parents=True, exist_ok=True)
                maker(spot, exp, sym, seed * 10 + i).to_csv(d / f"{prefix}_{exp}.csv", index=False)
    eq = raw / "2025" / "EQONLY" / "equity"
    eq.mkdir(parents=True, exist_ok=True)
    equity_csv(spot_path(seed=3), "EQONLY").to_csv(eq / "2025.csv", index=False)
    return raw
