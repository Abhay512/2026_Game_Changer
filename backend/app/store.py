"""Read-side of the Parquet store.

Everything is loaded lazily per symbol and kept in bounded LRU caches, so memory depends on how many
symbols are being looked at, not on how many exist (51 today, 180 later). When `ingest` rewrites the
store, `manifest.json` changes and every cache is dropped on the next request.
"""
from __future__ import annotations

import json
import threading
from collections import OrderedDict
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd

from .matrix import Matrix, OptionMatrix, build_day_chains, build_matrix


class StoreMissing(RuntimeError):
    pass


class NotFound(LookupError):
    pass


EQ_COLS = ("open", "high", "low", "close", "volume", "turnover", "buy_vol", "sell_vol")
FUT_COLS = EQ_COLS + ("oi", "lot_size")
CHAIN_COLS = ("spot", "ce_oi", "pe_oi", "ce_vol", "pe_vol", "ce_turnover", "pe_turnover", "max_pain",
              "atm_strike", "atm_iv")
OPT_COLS = ("close", "volume", "turnover", "oi", "iv", "delta", "gamma", "theta", "vega")
OPT_SNAP = ("close", "oi", "iv", "delta", "gamma", "theta", "vega")
GREEKS_F32 = ("iv", "delta", "gamma", "theta", "vega")


def _day(ts) -> str | None:
    return None if ts is None or pd.isna(ts) else pd.Timestamp(ts).strftime("%Y-%m-%d")


@dataclass
class Days:
    order: list[str]  # trading days, ascending
    pos: dict[str, int]
    rec: dict[str, dict]


def _load_days(path: Path) -> Days:
    df = pd.read_parquet(path)
    order: list[str] = []
    rec: dict[str, dict] = {}
    for r in df.itertuples(index=False):
        d = _day(r.day)
        order.append(d)
        rec[d] = {
            "eq_bars": int(r.eq_bars), "fut_bars": int(r.fut_bars), "opt_bars": int(r.opt_bars),
            "fut_expiry": _day(r.fut_expiry), "opt_expiry": _day(r.opt_expiry),
            "full": bool(r.full_session), "fut_ok": bool(r.fut_front_ok), "opt_ok": bool(r.opt_front_ok),
        }
    return Days(order, {d: i for i, d in enumerate(order)}, rec)


class SymbolData:
    """All small per-symbol matrices + expiry helpers. Option chains load per expiry on demand."""

    def __init__(self, store: "Store", symbol: str, entry: dict):
        self.symbol = symbol
        self.entry = entry
        self._store = store
        root = store.root
        self.days = _load_days(root / "days" / f"{symbol}.parquet")
        self.equity = self._matrix(root / "equity" / f"{symbol}.parquet", ("day",), EQ_COLS, ("close",))
        self.futures = self._matrix(root / "futures" / f"{symbol}.parquet", ("expiry", "day"), FUT_COLS,
                                    ("close", "oi", "lot_size"))
        self.chain = self._matrix(root / "chain" / f"{symbol}.parquet", ("expiry", "day"), CHAIN_COLS,
                                  ("spot", "ce_oi", "pe_oi", "max_pain", "atm_strike", "atm_iv"))

    @staticmethod
    def _matrix(path: Path, keys, cols, snap) -> Matrix | None:
        if not path.exists():
            return None
        df = pd.read_parquet(path, columns=[*keys, "bar", *cols])
        return build_matrix(df, keys, cols, snap)

    @property
    def has_fno(self) -> bool:
        return self.futures is not None and self.chain is not None

    def options(self, expiry: str) -> OptionMatrix:
        return self._store.options(self.symbol, expiry)

    # ---- expiries -------------------------------------------------------------------------
    @staticmethod
    def _expiries(m: Matrix | None, day: str) -> list[str]:
        if m is None:
            return []
        return sorted({m.keys[r][0] for r in m.rows_on(day)})

    def fut_expiries(self, day: str) -> list[str]:
        return self._expiries(self.futures, day)

    def opt_expiries(self, day: str) -> list[str]:
        return self._expiries(self.chain, day)

    def ladder(self, day: str) -> list[str]:
        """Live expiries in order (front, next, …). Futures carry every monthly expiry, so they define
        the ladder; options files can be missing for a month."""
        return self.fut_expiries(day) or self.opt_expiries(day)

    def rank_of(self, day: str, expiry: str) -> int | None:
        lad = self.ladder(day)
        if expiry in lad:
            return lad.index(expiry)
        opts = self.opt_expiries(day)
        return opts.index(expiry) if expiry in opts else None

    def expiry_at(self, day: str, rank: int) -> str | None:
        lad = self.ladder(day)
        return lad[rank] if 0 <= rank < len(lad) else None

    def default_day(self) -> str:
        """Latest complete session; for F&O symbols one with front-month F&O that is not an expiry day
        (the vendor leaves IV/Greeks empty on expiry day)."""
        for d in reversed(self.days.order):
            r = self.days.rec[d]
            if not (r["full"] and r["eq_bars"]):
                continue
            if self.has_fno and not (r["fut_ok"] and r["opt_ok"] and r["opt_expiry"] != d):
                continue
            return d
        return self.days.order[-1]


class Store:
    def __init__(self, root: Path, cache_symbols: int = 48, cache_expiries: int = 16, cache_responses: int = 512):
        self.root = Path(root)
        self._lock = threading.Lock()
        self._version: int | None = None
        self._catalog: dict = {}
        self._symbol = lru_cache(maxsize=cache_symbols)(self._load_symbol)
        self._opts = lru_cache(maxsize=cache_expiries)(self._load_options)
        self._responses: OrderedDict[tuple, bytes] = OrderedDict()
        self._max_responses = cache_responses

    # ---- versioning ------------------------------------------------------------------------
    def version(self) -> int:
        try:
            v = (self.root / "manifest.json").stat().st_mtime_ns
        except FileNotFoundError:
            raise StoreMissing(f"No data store at {self.root}. Run `python -m ingest` first.") from None
        if v != self._version:
            with self._lock:
                if v != self._version:
                    self._catalog = json.loads((self.root / "catalog.json").read_text(encoding="utf-8"))
                    self._symbol.cache_clear()
                    self._opts.cache_clear()
                    self._responses.clear()
                    self._version = v
        return v

    def catalog(self) -> dict:
        self.version()
        return self._catalog

    # ---- data ------------------------------------------------------------------------------
    def symbol(self, symbol: str) -> SymbolData:
        sym = symbol.strip().upper()
        version = self.version()
        entry = self._catalog.get("symbols", {}).get(sym)
        if entry is None:
            raise NotFound(f"Unknown symbol '{symbol}'")
        return self._symbol(sym, version)

    def _load_symbol(self, sym: str, version: int) -> SymbolData:
        return SymbolData(self, sym, self._catalog["symbols"][sym])

    def options(self, sym: str, expiry: str) -> OptionMatrix:
        return self._opts(sym, expiry, self.version())

    def _load_options(self, sym: str, expiry: str, version: int) -> OptionMatrix:
        path = self.root / "options" / sym / f"{expiry}.parquet"
        if not path.exists():
            raise NotFound(f"No options data for {sym} expiry {expiry}")
        df = pd.read_parquet(path, columns=["strike", "right", "day", "bar", *OPT_COLS])
        m = build_matrix(df, ("strike", "right", "day"), OPT_COLS, OPT_SNAP, float32=GREEKS_F32)
        return OptionMatrix(expiry, m, build_day_chains(m))

    # ---- response cache ---------------------------------------------------------------------
    def cached(self, key: tuple, build: Callable[[], bytes]) -> bytes:
        version = self.version()
        full = (version, *key)
        with self._lock:
            hit = self._responses.get(full)
            if hit is not None:
                self._responses.move_to_end(full)
                return hit
        body = build()
        with self._lock:
            self._responses[full] = body
            while len(self._responses) > self._max_responses:
                self._responses.popitem(last=False)
        return body


def empty_rows() -> np.ndarray:
    return np.zeros(0, dtype=np.intp)
