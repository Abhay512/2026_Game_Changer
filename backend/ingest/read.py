"""Typed readers for the raw CSV files. All timestamps become naive IST (exchange local time)."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from app.config import BAR_MINUTES, SESSION_START_MIN

PRICE = ["open", "high", "low", "close"]


def _read(path: Path) -> pd.DataFrame:
    return pd.read_csv(path, engine="pyarrow")


def _finish_time(df: pd.DataFrame) -> pd.DataFrame:
    raw = df["date"]
    if pd.api.types.is_datetime64_any_dtype(raw):
        ts = raw.dt.tz_convert("Asia/Kolkata").dt.tz_localize(None) if raw.dt.tz is not None else raw
    else:
        # "2025-01-01 09:15:00+05:30": every row in the dataset carries +05:30, so the wall-clock
        # part is already IST.
        ts = pd.to_datetime(raw.astype(str).str.slice(0, 19), format="%Y-%m-%d %H:%M:%S")
    df = df.drop(columns=["date"])
    df.insert(0, "ts", ts.astype("datetime64[ns]"))
    df.insert(1, "day", df["ts"].dt.normalize())
    minute = df["ts"].dt.hour * 60 + df["ts"].dt.minute
    df.insert(2, "bar", ((minute - SESSION_START_MIN) // BAR_MINUTES).astype("int16"))
    return df


def _expiry(df: pd.DataFrame) -> pd.DataFrame:
    df["expiry"] = pd.to_datetime(df["expiry"].astype(str).str.slice(0, 10)).astype("datetime64[ns]")
    return df


def read_equity(paths: list[Path]) -> tuple[pd.DataFrame, dict]:
    df = pd.concat([_read(p) for p in paths], ignore_index=True)
    meta = {
        "icici_code": str(df["icici_code"].iloc[0]) if "icici_code" in df and len(df) else None,
        "exchange": str(df["exchange"].iloc[0]) if "exchange" in df and len(df) else None,
    }
    df = _finish_time(df)
    df = df[["ts", "day", "bar", *PRICE, "volume", "turnover"]]
    df = df.drop_duplicates("ts", keep="last").sort_values("ts", ignore_index=True)
    df["volume"] = df["volume"].fillna(0).astype("int64")
    df["turnover"] = df["turnover"].fillna(0.0).astype("float64")
    return df, meta


def read_futures(path: Path) -> pd.DataFrame:
    df = _expiry(_finish_time(_read(path)))
    df = df[["ts", "day", "bar", "expiry", *PRICE, "volume", "turnover", "oi", "lot_size"]]
    df = df.drop_duplicates("ts", keep="last").sort_values("ts", ignore_index=True)
    df["volume"] = df["volume"].fillna(0).astype("int64")
    df["turnover"] = df["turnover"].fillna(0.0).astype("float64")
    df["oi"] = df["oi"].astype("float64")
    return df


# rho is in the raw files but no metric uses it, so it is not stored (~14% of the options store).
OPTION_GREEKS = ["iv", "delta", "gamma", "theta", "vega"]


def read_options(path: Path) -> pd.DataFrame:
    df = _expiry(_finish_time(_read(path)))
    cols = ["ts", "day", "bar", "expiry", "strike", "right", *PRICE, "volume", "turnover", "oi",
            "lot_size", "spot", "tte_years", *OPTION_GREEKS]
    df = df[[c for c in cols if c in df.columns]]
    for g in OPTION_GREEKS + ["tte_years", "spot"]:
        if g not in df:
            df[g] = np.nan
    df["right"] = df["right"].astype(str).str.upper()
    df["strike"] = df["strike"].astype("float64")
    df["volume"] = df["volume"].fillna(0).astype("int64")
    df["turnover"] = df["turnover"].fillna(0.0).astype("float64")
    df["oi"] = df["oi"].astype("float64")
    return df.drop_duplicates(["ts", "strike", "right"], keep="last")
