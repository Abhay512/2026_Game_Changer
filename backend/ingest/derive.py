"""Derived tables built at ingest time so the API never has to touch raw rows.

- options_grid:      dense (day × bar × strike × right) chain per expiry, gaps forward-filled
- chain_aggregates:  per-bar chain stats — CE/PE OI & volume totals, PCR, max pain, ATM strike, ATM IV
- futures_front:     continuous front-month futures + OI summed across all live expiries
- day_table:         one row per trading day with coverage flags used by baselines and the UI
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd

from app.config import BAR_MINUTES, MIN_FULL_SESSION_BARS, SESSION_START_MIN
from app.formulas import max_pain_matrix  # noqa: F401  (re-exported for tests)

from .bvc import bvc_split
from .read import OPTION_GREEKS

# The nearest available expiry is treated as the true front month only if it is at most this many
# calendar days away. Earlier days in the dataset only have the 2nd-month contract.
FRONT_MAX_DAYS = 35


def add_bvc(df: pd.DataFrame) -> pd.DataFrame:
    buy, sell = bvc_split(df["close"], df["open"], df["volume"], df["day"], df["bar"])
    df["buy_vol"] = buy
    df["sell_vol"] = sell
    return df


def _bar_ts(day: pd.Series, bar: pd.Series) -> pd.Series:
    return day + pd.to_timedelta(SESSION_START_MIN + bar.astype("int64") * BAR_MINUTES, unit="min")


# --------------------------------------------------------------------------------------- options

def options_grid(df: pd.DataFrame) -> pd.DataFrame:
    """Every contract listed on a day gets a row for every bar of that day.

    Missing bars (illiquid strikes) carry the last close/OI forward (across days, so a strike that
    starts late in the day keeps yesterday's OI); IV/Greeks carry forward within the day only.
    Leading gaps on a contract's first day are back-filled so no artificial OI jump appears.
    """
    keys = df[["day", "strike", "right"]].drop_duplicates()
    bars = df[["day", "bar"]].drop_duplicates()
    spot = df.groupby(["day", "bar"], sort=False)["spot"].median().rename("spot").reset_index()

    grid = keys.merge(bars, on="day", how="inner")
    grid = grid.merge(df.drop(columns=["spot", "ts", "expiry"]), on=["day", "bar", "strike", "right"], how="left")
    grid = grid.merge(spot, on=["day", "bar"], how="left")
    grid["filled"] = grid["close"].isna()
    grid = grid.sort_values(["strike", "right", "day", "bar"], ignore_index=True)

    by_contract = grid.groupby(["strike", "right"], sort=False)
    for c in ("close", "oi", "lot_size"):
        grid[c] = by_contract[c].ffill()
    by_day = grid.groupby(["strike", "right", "day"], sort=False)
    for c in ("close", "oi", "lot_size"):
        grid[c] = by_day[c].bfill()
    for c in (*OPTION_GREEKS, "tte_years"):
        grid[c] = by_day[c].ffill()

    grid["volume"] = grid["volume"].fillna(0).astype("int64")
    grid["turnover"] = grid["turnover"].fillna(0.0)
    for c in ("open", "high", "low"):
        grid[c] = grid[c].fillna(grid["close"])
    grid["oi"] = grid["oi"].fillna(0.0)
    grid["expiry"] = df["expiry"].iloc[0]
    grid["ts"] = _bar_ts(grid["day"], grid["bar"])
    for g in (*OPTION_GREEKS, "tte_years"):
        grid[g] = grid[g].astype("float32")

    cols = ["ts", "day", "bar", "expiry", "strike", "right", "open", "high", "low", "close", "volume",
            "turnover", "oi", "lot_size", "spot", "tte_years", *OPTION_GREEKS, "filled"]
    return grid[cols].sort_values(["day", "bar", "strike", "right"], ignore_index=True)


def chain_aggregates(grid: pd.DataFrame) -> pd.DataFrame:
    idx_cols = ["day", "bar"]
    index = pd.MultiIndex.from_frame(grid[idx_cols].drop_duplicates().sort_values(idx_cols))
    strikes = np.sort(grid["strike"].unique())
    ce = grid[grid["right"] == "CE"].set_index([*idx_cols, "strike"])
    pe = grid[grid["right"] == "PE"].set_index([*idx_cols, "strike"])

    def mat(part: pd.DataFrame, col: str) -> np.ndarray:
        if part.empty:
            return np.full((len(index), len(strikes)), np.nan)
        return part[col].unstack("strike").reindex(index=index, columns=strikes).to_numpy(dtype="float64")

    ce_oi, pe_oi = np.nan_to_num(mat(ce, "oi")), np.nan_to_num(mat(pe, "oi"))
    ce_vol, pe_vol = np.nan_to_num(mat(ce, "volume")), np.nan_to_num(mat(pe, "volume"))
    ce_turn, pe_turn = np.nan_to_num(mat(ce, "turnover")), np.nan_to_num(mat(pe, "turnover"))
    listed = ~np.isnan(mat(ce, "close")) | ~np.isnan(mat(pe, "close"))
    ce_iv, pe_iv = mat(ce, "iv"), mat(pe, "iv")
    spot = grid.groupby(idx_cols)["spot"].first().reindex(index).to_numpy(dtype="float64")

    pain = max_pain_matrix(strikes, ce_oi, pe_oi)
    pain[~listed] = np.inf
    total_oi = ce_oi.sum(1) + pe_oi.sum(1)
    max_pain = np.where(total_oi > 0, strikes[np.argmin(pain, axis=1)], np.nan)

    dist = np.abs(strikes[None, :] - spot[:, None])
    dist[~listed] = np.inf
    dist[np.isnan(dist)] = np.inf
    atm_i = np.argmin(dist, axis=1)
    rows = np.arange(len(index))
    atm_strike = np.where(np.isfinite(dist[rows, atm_i]), strikes[atm_i], np.nan)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        atm_iv = np.nanmean(np.stack([ce_iv[rows, atm_i], pe_iv[rows, atm_i]]), axis=0)

    ce_tot, pe_tot = ce_oi.sum(1), pe_oi.sum(1)
    out = index.to_frame(index=False)
    out["expiry"] = grid["expiry"].iloc[0]
    out["spot"] = spot
    out["ce_oi"] = ce_tot
    out["pe_oi"] = pe_tot
    out["ce_vol"] = ce_vol.sum(1)
    out["pe_vol"] = pe_vol.sum(1)
    out["ce_turnover"] = ce_turn.sum(1)
    out["pe_turnover"] = pe_turn.sum(1)
    out["pcr_oi"] = np.where(ce_tot > 0, pe_tot / np.where(ce_tot > 0, ce_tot, 1), np.nan)
    out["max_pain"] = max_pain
    out["atm_strike"] = atm_strike
    out["atm_iv"] = atm_iv.astype("float32")
    out["n_strikes"] = listed.sum(1).astype("int16")
    return out


# --------------------------------------------------------------------------------------- futures

def front_expiry_map(day_expiry: pd.DataFrame) -> pd.Series:
    """day -> nearest expiry on/after that day, from (day, expiry) pairs that have data."""
    de = day_expiry.drop_duplicates()
    de = de[de["expiry"] >= de["day"]]
    return de.groupby("day")["expiry"].min()


def futures_front(fut: pd.DataFrame) -> pd.DataFrame:
    """Continuous front-month series; `oi_all` = OI summed over every live expiry at that bar."""
    front = front_expiry_map(fut[["day", "expiry"]]).rename("expiry").reset_index()
    cont = fut.merge(front, on=["day", "expiry"], how="inner").sort_values("ts", ignore_index=True)

    oi = fut.pivot_table(index=["day", "bar"], columns="expiry", values="oi", aggfunc="last").sort_index()
    oi = oi.groupby(level="day").ffill().groupby(level="day").bfill()
    oi_all = oi.sum(axis=1, min_count=1).rename("oi_all").reset_index()
    n_live = oi.notna().sum(axis=1).rename("n_expiries").reset_index()
    cont = cont.merge(oi_all, on=["day", "bar"], how="left").merge(n_live, on=["day", "bar"], how="left")
    return cont


# ------------------------------------------------------------------------------------------ days

def day_table(eq: pd.DataFrame | None, fut_front: pd.DataFrame | None, chain: pd.DataFrame | None) -> pd.DataFrame:
    parts = []
    if eq is not None and len(eq):
        parts.append(eq.groupby("day").size().rename("eq_bars"))
    if fut_front is not None and len(fut_front):
        g = fut_front.groupby("day")
        parts.append(g.size().rename("fut_bars"))
        parts.append(g["expiry"].first().rename("fut_expiry"))
    if chain is not None and len(chain):
        front = front_expiry_map(chain[["day", "expiry"]]).rename("opt_expiry")
        parts.append(front)
        parts.append(chain.groupby("day")["expiry"].nunique().rename("opt_expiries"))
        fc = chain.merge(front.reset_index().rename(columns={"opt_expiry": "expiry"}), on=["day", "expiry"])
        parts.append(fc.groupby("day").size().rename("opt_bars"))
    if not parts:
        return pd.DataFrame(columns=["day"])
    days = pd.concat(parts, axis=1).sort_index()
    days.index.name = "day"
    days = days.reset_index()
    for c in ("eq_bars", "fut_bars", "opt_bars", "opt_expiries"):
        if c not in days:
            days[c] = 0
        days[c] = days[c].fillna(0).astype("int16")
    for c in ("fut_expiry", "opt_expiry"):
        if c not in days:
            days[c] = pd.NaT
        days[c] = pd.to_datetime(days[c])
    session_bars = days["eq_bars"].where(days["eq_bars"] > 0, days["fut_bars"])
    days["full_session"] = session_bars >= MIN_FULL_SESSION_BARS
    days["fut_front_ok"] = (days["fut_expiry"] - days["day"]).dt.days.le(FRONT_MAX_DAYS).fillna(False)
    # Futures carry every monthly expiry, so when they exist they define the true front month: an
    # options chain is "front" only if its expiry matches (catches missing monthly options files).
    near = (days["opt_expiry"] - days["day"]).dt.days.le(FRONT_MAX_DAYS).fillna(False)
    matches_fut = days["opt_expiry"] == days["fut_expiry"]
    days["opt_front_ok"] = (matches_fut & days["fut_front_ok"]).where(days["fut_expiry"].notna(), near)
    days["opt_front_ok"] = days["opt_front_ok"].astype(bool)
    return days
