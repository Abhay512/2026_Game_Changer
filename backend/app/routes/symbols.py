from __future__ import annotations

from fastapi import APIRouter, Depends

from ..config import BAR_MINUTES, BARS_PER_SESSION, LOOKBACK_DAYS, MIN_FULL_SESSION_BARS, SESSION_END_MIN, SESSION_START_MIN
from ..http import dumps, get_store, json_bytes
from ..store import Store
from ..window import BAR_LABELS, fmt_hhmm

router = APIRouter(prefix="/api", tags=["symbols"])


@router.get("/health")
def health(store: Store = Depends(get_store)):
    cat = store.catalog()
    return {"ok": True, "store_version": store.version(), "symbols": cat.get("symbol_count", 0),
            "generated_at": cat.get("generated_at")}


@router.get("/meta")
def meta(store: Store = Depends(get_store)):
    cat = store.catalog()
    return {"session": {"start": fmt_hhmm(SESSION_START_MIN), "end": fmt_hhmm(SESSION_END_MIN),
                        "bar_minutes": BAR_MINUTES, "bars": BARS_PER_SESSION, "labels": BAR_LABELS,
                        "min_full_session_bars": MIN_FULL_SESSION_BARS},
            "lookback_default": LOOKBACK_DAYS, "generated_at": cat.get("generated_at"),
            "pipeline_version": cat.get("pipeline_version")}


@router.get("/symbols")
def symbols(store: Store = Depends(get_store)):
    def build() -> bytes:
        out = []
        for sym, e in store.catalog().get("symbols", {}).items():
            out.append({"symbol": sym, "has_fno": e.get("has_fno", False),
                        "equity": {k: (e.get("equity") or {}).get(k) for k in ("first", "last")},
                        "fno": e.get("fno_front_range"), "warnings": e.get("warnings", [])})
        return dumps({"symbols": out, "count": len(out)})
    return json_bytes(store.cached(("symbols",), build))


@router.get("/symbols/{symbol}/dates")
def dates(symbol: str, store: Store = Depends(get_store)):
    sd = store.symbol(symbol)

    def build() -> bytes:
        days = []
        for d in sd.days.order:
            r = sd.days.rec[d]
            days.append({"date": d, "equity": r["eq_bars"] > 0, "futures": r["fut_bars"] > 0 and r["fut_ok"],
                         "options": r["opt_bars"] > 0 and r["opt_ok"], "full": r["full"],
                         "expiry_day": r["opt_expiry"] == d or r["fut_expiry"] == d, "bars": max(r["eq_bars"], r["fut_bars"])})
        return dumps({"symbol": sd.symbol, "has_fno": sd.has_fno, "default": sd.default_day(), "days": days})
    return json_bytes(store.cached(("dates", sd.symbol), build))
