"""(row × bar) matrices: one row per session of one contract, one column per 5-minute bar.

Every window metric is numpy slicing over [rows, a:b+1], so a 20-day comparison is a handful of
vector operations. Snapshot columns (close, OI, Greeks, PCR inputs…) are forward-filled along the
bars, so "value at bar B" is always the latest known value at that moment.

Key columns are ordered contract-first with `day` last, so the previous session of the same
contract is simply the previous row (`prev`).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .config import BARS_PER_SESSION as BARS


def ffill_rows(a: np.ndarray) -> np.ndarray:
    n, m = a.shape
    if n == 0:
        return a.copy()
    idx = np.where(~np.isnan(a), np.arange(m)[None, :], 0)
    np.maximum.accumulate(idx, axis=1, out=idx)
    return a[np.arange(n)[:, None], idx]


@dataclass
class Matrix:
    key_cols: tuple[str, ...]
    keys: list[tuple]
    index: dict[tuple, int]
    v: dict[str, np.ndarray]  # (rows, BARS); snapshot columns forward-filled
    present: np.ndarray  # (rows, BARS) bool: the bar exists in the data
    prev: np.ndarray  # previous session row of the same contract, -1 if none
    by_day: dict[str, np.ndarray]  # day -> rows (all contracts on that day)

    def row(self, *key) -> int:
        return self.index.get(tuple(key), -1)

    def rows_on(self, day: str) -> np.ndarray:
        return self.by_day.get(day, np.zeros(0, dtype=np.intp))

    def __len__(self) -> int:
        return len(self.keys)


def build_matrix(df: pd.DataFrame, key_cols: tuple[str, ...], cols: tuple[str, ...],
                 snap: tuple[str, ...] = (), float32: tuple[str, ...] = ()) -> Matrix:
    if key_cols[-1] != "day":
        raise ValueError("'day' must be the last key column")
    df = df[(df["bar"] >= 0) & (df["bar"] < BARS)]
    g = df.groupby(list(key_cols), sort=True)
    ri = g.ngroup().to_numpy()
    kdf = g.size().reset_index()[list(key_cols)]
    for c in key_cols:
        if pd.api.types.is_datetime64_any_dtype(kdf[c]):
            kdf[c] = kdf[c].dt.strftime("%Y-%m-%d")
    n = len(kdf)
    keys = list(kdf.itertuples(index=False, name=None))
    bars = df["bar"].to_numpy().astype(np.intp)

    v: dict[str, np.ndarray] = {}
    for c in cols:
        dt = np.float32 if c in float32 else np.float64
        a = np.full((n, BARS), np.nan, dtype=dt)
        a[ri, bars] = df[c].to_numpy(dtype=dt, na_value=np.nan)
        v[c] = ffill_rows(a) if c in snap else a
    present = np.zeros((n, BARS), dtype=bool)
    present[ri, bars] = True

    prev = np.arange(n, dtype=np.intp) - 1
    if n:
        same = np.ones(n, dtype=bool)
        same[0] = False
        for c in key_cols[:-1]:
            col = kdf[c].to_numpy()
            same[1:] &= col[1:] == col[:-1]
        prev[~same] = -1

    by_day: dict[str, np.ndarray] = {}
    if n:
        days = kdf["day"].to_numpy()
        order = np.argsort(days, kind="stable")
        sorted_days = days[order]
        cuts = np.flatnonzero(sorted_days[1:] != sorted_days[:-1]) + 1
        for chunk in np.split(order, cuts):
            by_day[str(days[chunk[0]])] = chunk.astype(np.intp)
    return Matrix(tuple(key_cols), keys, {k: i for i, k in enumerate(keys)}, v, present, prev, by_day)


# ------------------------------------------------------------------------------ window helpers

def _rows(rows) -> np.ndarray:
    return np.asarray(rows, dtype=np.intp).reshape(-1)


def first_valid(a: np.ndarray) -> np.ndarray:
    """First finite value of each row (NaN if the row has none)."""
    if a.shape[1] == 0:
        return np.full(a.shape[0], np.nan)
    ok = np.isfinite(a)
    out = a[np.arange(a.shape[0]), ok.argmax(axis=1)].astype(np.float64)
    out[~ok.any(axis=1)] = np.nan
    return out


def value_at(m: Matrix, col: str, rows, bar: int) -> np.ndarray:
    return m.v[col][_rows(rows), bar].astype(np.float64)


def start_values(m: Matrix, col: str, rows, a: int, b: int | None = None) -> np.ndarray:
    """State at the moment bar `a` begins.

    = last value before `a` in the same session; else the previous session's last value (OI does
    not change overnight); else the first value inside [a, b] — never anything after `b`.
    """
    rows = _rows(rows)
    if rows.size == 0:
        return np.zeros(0)
    v = m.v[col]
    out = v[rows, a - 1].astype(np.float64) if a > 0 else np.full(rows.size, np.nan)
    p = m.prev[rows]
    prev_last = np.where(p >= 0, v[np.maximum(p, 0), BARS - 1], np.nan)
    out = np.where(np.isnan(out), prev_last, out)
    end = BARS if b is None else b + 1
    return np.where(np.isnan(out), first_valid(v[rows, a:end]), out)


def level_at(m: Matrix, col: str, rows, a: int, b: int) -> np.ndarray:
    """Snapshot value at bar `b`, falling back to the window-start state if nothing printed yet."""
    now = value_at(m, col, rows, b)
    if np.isnan(now).any():
        now = np.where(np.isnan(now), start_values(m, col, rows, a, b), now)
    return now


def window_sum(m: Matrix, col: str, rows, a: int, b: int) -> np.ndarray:
    rows = _rows(rows)
    if rows.size == 0:
        return np.zeros(0)
    return np.nansum(m.v[col][rows, a:b + 1].astype(np.float64), axis=1)


def has_data(m: Matrix, rows, a: int, b: int) -> np.ndarray:
    return m.present[_rows(rows), a:b + 1].any(axis=1)


# ------------------------------------------------------------------------------ option chains

@dataclass
class DayChain:
    strikes: np.ndarray  # sorted strikes listed that day
    ce: np.ndarray  # matrix row per strike, -1 if no CE listed
    pe: np.ndarray


@dataclass
class OptionMatrix:
    expiry: str
    m: Matrix
    chains: dict[str, DayChain]


def build_day_chains(m: Matrix) -> dict[str, DayChain]:
    out: dict[str, DayChain] = {}
    for day, rows in m.by_day.items():
        ks = [m.keys[r] for r in rows]  # (strike, right, day)
        strikes = np.array(sorted({float(k[0]) for k in ks}), dtype=np.float64)
        pos = {s: i for i, s in enumerate(strikes.tolist())}
        ce = np.full(len(strikes), -1, dtype=np.intp)
        pe = ce.copy()
        for r, k in zip(rows, ks):
            (ce if k[1] == "CE" else pe)[pos[float(k[0])]] = r
        out[day] = DayChain(strikes, ce, pe)
    return out
