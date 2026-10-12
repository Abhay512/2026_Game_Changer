from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..analysis import build_analysis, build_chain, resolve_day
from ..http import dumps, get_store, json_bytes
from ..store import Store
from ..window import parse_window
from .params import DATE, EXPIRY, FROM, LOOKBACK, TO

router = APIRouter(prefix="/api", tags=["analysis"])


@router.get("/analysis/{symbol}")
def analysis(symbol: str, date: str | None = DATE, from_: str | None = FROM, to: str | None = TO,
             lookback: int = LOOKBACK, expiry: str | None = EXPIRY, store: Store = Depends(get_store)):
    """Every metric card for one symbol, date and time window, each compared with the same window on
    the previous `lookback` valid sessions."""
    sd = store.symbol(symbol)
    day = resolve_day(sd, date)
    w = parse_window(from_, to)
    key = ("analysis", sd.symbol, day, w.a, w.b, lookback, expiry)
    return json_bytes(store.cached(key, lambda: dumps(build_analysis(sd, day, w, lookback, expiry))))


@router.get("/chain/{symbol}")
def chain(symbol: str, date: str | None = DATE, from_: str | None = FROM, to: str | None = TO,
          lookback: int = LOOKBACK, expiry: str | None = EXPIRY,
          strikes: int = Query(10, ge=1, le=25, description="Strikes on each side of ATM"),
          store: Store = Depends(get_store)):
    """Option chain for ATM ±`strikes`: OI, ΔOI, last-5-min OI, volume, turnover, LTP, IV and Greeks,
    each compared with the same window and ATM offset on baseline days, plus the max-pain curve."""
    sd = store.symbol(symbol)
    day = resolve_day(sd, date)
    w = parse_window(from_, to)
    key = ("chain", sd.symbol, day, w.a, w.b, lookback, expiry, strikes)
    return json_bytes(store.cached(key, lambda: dumps(build_chain(sd, day, w, lookback, expiry, strikes))))
