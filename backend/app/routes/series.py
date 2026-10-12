from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..analysis import resolve_day
from ..http import dumps, get_store, json_bytes
from ..series import build_bars, build_series, build_strike
from ..store import Store
from ..window import parse_window
from .params import DATE, EXPIRY, FROM, LOOKBACK, TO

router = APIRouter(prefix="/api", tags=["series"])


@router.get("/series/{symbol}")
def series(symbol: str, src: str = Query(..., pattern="^(spot|fut|opt)$"), metric: str = Query(...),
           date: str | None = DATE, from_: str | None = FROM, to: str | None = TO, lookback: int = LOOKBACK,
           expiry: str | None = EXPIRY, store: Store = Depends(get_store)):
    """Per-bar series for one metric: today vs the baseline-average profile."""
    sd = store.symbol(symbol)
    day = resolve_day(sd, date)
    w = parse_window(from_, to)
    key = ("series", sd.symbol, day, w.a, w.b, lookback, src, metric, expiry)
    return json_bytes(store.cached(key, lambda: dumps(build_series(sd, day, w, lookback, src, metric, expiry))))


@router.get("/bars/{symbol}")
def bars(symbol: str, src: str = Query("spot", pattern="^(spot|fut)$"), date: str | None = DATE,
         days: int = Query(1, ge=1, le=10, description="Sessions ending at `date`"),
         store: Store = Depends(get_store)):
    """OHLC candles + volume + session VWAP (+ OI for futures) for the main chart."""
    sd = store.symbol(symbol)
    day = resolve_day(sd, date)
    key = ("bars", sd.symbol, day, src, days)
    return json_bytes(store.cached(key, lambda: dumps(build_bars(sd, day, src, days))))


@router.get("/strike/{symbol}")
def strike(symbol: str, expiry: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"), strike: float = Query(...),
           right: str = Query(..., pattern="^(CE|PE|ce|pe)$"), date: str | None = DATE,
           store: Store = Depends(get_store)):
    """Intraday series of a single option contract (chain row click)."""
    sd = store.symbol(symbol)
    day = resolve_day(sd, date)
    key = ("strike", sd.symbol, day, expiry, float(strike), right.upper())
    return json_bytes(store.cached(key, lambda: dumps(build_strike(sd, day, expiry, strike, right))))
