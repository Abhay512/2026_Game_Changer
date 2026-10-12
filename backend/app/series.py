"""Per-bar series behind every "click the number → graph" view, plus chart candles.

Each series has today's value per 5-minute bar and the baseline average at the same bar, so the UI
can draw today's bars against the normal profile. Window-aware parts:
  flow metrics      → *_cum: running total from the window start
  snapshot metrics  → *_chg: change since the window-start state (see matrix.start_values)
"""
from __future__ import annotations

import warnings

import numpy as np

from .analysis import option_context
from .baseline import nums, select_days
from .config import BAR_MINUTES, BARS_PER_SESSION as BARS, SESSION_START_MIN
from .formulas import safe_div
from .matrix import Matrix, start_values
from .store import NotFound, SymbolData
from .window import BAR_LABELS, Window

FLOW = {"volume": "volume", "turnover": "turnover", "buy": "buy_vol", "sell": "sell_vol"}
OPT_FLOW = {"ce_vol": "ce_vol", "pe_vol": "pe_vol", "ce_turnover": "ce_turnover", "pe_turnover": "pe_turnover"}
OPT_SNAP = {"max_pain": ("max_pain", 1.0), "atm_iv": ("atm_iv", 100.0), "ce_oi": ("ce_oi", 1.0),
            "pe_oi": ("pe_oi", 1.0), "spot": ("spot", 1.0), "atm_strike": ("atm_strike", 1.0)}
METRICS = {
    "spot": [*FLOW, "bs_ratio", "move", "chg"],
    "fut": [*FLOW, "bs_ratio", "move", "chg", "oi", "oi_all"],
    "opt": [*OPT_FLOW, *OPT_SNAP, "pcr_oi", "pcr_vol"],
}
DECIMALS = {"volume": 0, "turnover": 0, "buy": 0, "sell": 0, "bs_ratio": 3, "move": 4, "chg": 3, "oi": 0,
            "oi_all": 0, "ce_vol": 0, "pe_vol": 0, "ce_turnover": 0, "pe_turnover": 0, "max_pain": 2, "atm_iv": 2,
            "ce_oi": 0, "pe_oi": 0, "spot": 2, "atm_strike": 2, "pcr_oi": 4, "pcr_vol": 4}
UNITS = {"volume": "shares", "turnover": "inr", "buy": "shares", "sell": "shares", "bs_ratio": "ratio",
         "move": "pct", "chg": "pct", "oi": "shares", "oi_all": "shares", "ce_vol": "shares", "pe_vol": "shares",
         "ce_turnover": "inr", "pe_turnover": "inr", "max_pain": "price", "atm_iv": "pct", "ce_oi": "shares",
         "pe_oi": "shares", "spot": "price", "atm_strike": "price", "pcr_oi": "ratio", "pcr_vol": "ratio"}


def _mean(a: np.ndarray) -> np.ndarray:
    if a.shape[0] == 0:
        return np.full(BARS, np.nan)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmean(a, axis=0)


def _from(a: int, arr: np.ndarray) -> np.ndarray:
    """Blank out bars before the window start."""
    out = np.array(arr, dtype=np.float64, copy=True)
    out[..., :a] = np.nan
    return out


def _cum_from(a: int, flows: np.ndarray) -> np.ndarray:
    out = np.full(flows.shape, np.nan)
    out[..., a:] = np.cumsum(np.nan_to_num(flows[..., a:]), axis=-1)
    return out


def _flows(m: Matrix, col: str, rows) -> np.ndarray:
    rows = np.asarray(rows, dtype=np.intp)
    return np.where(m.present[rows], np.nan_to_num(m.v[col][rows]), np.nan)


def _levels(m: Matrix, col: str, rows) -> np.ndarray:
    rows = np.asarray(rows, dtype=np.intp)
    return np.where(m.present[rows], m.v[col][rows].astype(np.float64), np.nan)


def _prev_close(m: Matrix, rows) -> np.ndarray:
    rows = np.asarray(rows, dtype=np.intp)
    p = m.prev[rows]
    return np.where(p >= 0, m.v["close"][np.maximum(p, 0), BARS - 1], np.nan)


class _Ctx:
    def __init__(self, m: Matrix, row: int, brows: np.ndarray, bdays: list[str], expiry: str | None = None):
        self.m, self.row, self.brows, self.bdays, self.expiry = m, row, brows, bdays, expiry


def _context(sd: SymbolData, day: str, src: str, lookback: int, expiry: str | None) -> _Ctx:
    if src == "spot":
        if sd.equity is None or sd.equity.row(day) < 0:
            raise NotFound("No equity data for this date")
        bdays = select_days(sd, day, "equity", lookback)
        return _Ctx(sd.equity, sd.equity.row(day), np.array([sd.equity.row(d) for d in bdays], dtype=np.intp), bdays)
    if src == "fut":
        exp = sd.days.rec[day]["fut_expiry"]
        if sd.futures is None or not exp:
            raise NotFound("No futures data for this date")
        bdays = select_days(sd, day, "futures", lookback)
        brows = np.array([sd.futures.row(sd.days.rec[d]["fut_expiry"], d) for d in bdays], dtype=np.intp)
        return _Ctx(sd.futures, sd.futures.row(exp, day), brows, bdays, exp)
    ctx = option_context(sd, day, expiry, lookback)
    if ctx is None:
        raise NotFound("No options data for this date")
    brows = np.array([sd.chain.row(e, d) for d, e in zip(ctx.base_days, ctx.base_expiries)], dtype=np.intp)
    return _Ctx(sd.chain, sd.chain.row(ctx.expiry, day), brows, ctx.base_days, ctx.expiry)


def _snapshot(levels_today, start_today, levels_base, start_base, a):
    chg_t = _from(a, levels_today - start_today)
    chg_b = _from(a, levels_base - start_base[:, None])
    return {"today": levels_today, "base": _mean(levels_base), "today_chg": chg_t,
            "base_chg": _mean(chg_b), "base_abs_chg": _mean(np.abs(chg_b))}


def _oi_all_levels(m: Matrix, day: str, w: Window) -> tuple[np.ndarray, float]:
    rows = m.rows_on(day)
    lv = m.v["oi"][rows].astype(np.float64)
    open_state = start_values(m, "oi", rows, 0)  # yesterday's close for contracts not yet printed today
    lv = np.where(np.isnan(lv), open_state[:, None], lv)
    present = m.present[rows].any(axis=0)
    total = np.where(present, np.nansum(lv, axis=0), np.nan)
    return total, float(np.nansum(start_values(m, "oi", rows, w.a, w.b)))


def build_series(sd: SymbolData, day: str, w: Window, lookback: int, src: str, metric: str,
                 expiry: str | None = None) -> dict:
    if src not in METRICS:
        raise NotFound(f"Unknown source '{src}' (use spot, fut or opt)")
    if metric not in METRICS[src]:
        raise NotFound(f"Unknown metric '{metric}' for {src}; available: {', '.join(METRICS[src])}")
    c = _context(sd, day, src, lookback, expiry)
    m, row, brows, a, b = c.m, c.row, c.brows, w.a, w.b
    kind = "flow"

    if metric in FLOW or metric in OPT_FLOW:
        col = FLOW.get(metric) or OPT_FLOW[metric]
        t, bs = _flows(m, col, [row])[0], _flows(m, col, brows)
        data = {"today": t, "base": _mean(bs), "today_cum": _cum_from(a, t), "base_cum": _mean(_cum_from(a, bs))}
    elif metric == "bs_ratio":
        kind = "ratio"
        tb, ts = _flows(m, "buy_vol", [row])[0], _flows(m, "sell_vol", [row])[0]
        bb, bsl = _flows(m, "buy_vol", brows), _flows(m, "sell_vol", brows)
        data = {"today": safe_div(tb, ts), "base": safe_div(_mean(bb), _mean(bsl)),
                "today_cum": safe_div(_cum_from(a, tb), _cum_from(a, ts)),
                "base_cum": safe_div(_mean(_cum_from(a, bb)), _mean(_cum_from(a, bsl)))}
    elif metric == "pcr_vol":
        kind = "ratio"
        tp, tc = _flows(m, "pe_vol", [row])[0], _flows(m, "ce_vol", [row])[0]
        bp, bc = _flows(m, "pe_vol", brows), _flows(m, "ce_vol", brows)
        data = {"today": safe_div(tp, tc), "base": safe_div(_mean(bp), _mean(bc)),
                "today_cum": safe_div(_cum_from(a, tp), _cum_from(a, tc)),
                "base_cum": _mean(safe_div(_cum_from(a, bp), _cum_from(a, bc)))}
    elif metric == "move":
        def moves(rows):
            close = m.v["close"][np.asarray(rows, dtype=np.intp)].astype(np.float64)
            prev = np.concatenate([_prev_close(m, rows)[:, None], close[:, :-1]], axis=1)
            mv = np.abs(safe_div(close, prev) - 1) * 100
            return np.where(m.present[np.asarray(rows, dtype=np.intp)], mv, np.nan)
        t, bs = moves([row])[0], moves(brows)
        data = {"today": t, "base": _mean(bs)}
    elif metric == "chg":
        kind = "snapshot"
        def chg(rows):
            close = _levels(m, "close", rows)
            start = start_values(m, "close", rows, a, b)
            return _from(a, (safe_div(close, start[:, None]) - 1) * 100)
        t, bs = chg([row])[0], chg(brows)
        data = {"today": t, "base": _mean(np.abs(bs)), "base_signed": _mean(bs)}
    elif metric == "oi":
        kind = "snapshot"
        data = _snapshot(_levels(m, "oi", [row])[0], start_values(m, "oi", [row], a, b)[0],
                         _levels(m, "oi", brows), start_values(m, "oi", brows, a, b), a)
    elif metric == "oi_all":
        kind = "snapshot"
        t, ts = _oi_all_levels(m, day, w)
        base = [_oi_all_levels(m, d, w) for d in c.bdays]
        bl = np.array([x[0] for x in base]).reshape(-1, BARS)
        bst = np.array([x[1] for x in base], dtype=np.float64)
        data = _snapshot(t, ts, bl, bst, a)
    elif metric == "pcr_oi":
        kind = "snapshot"
        def pcr(rows):
            return safe_div(_levels(m, "pe_oi", rows), _levels(m, "ce_oi", rows)), \
                safe_div(start_values(m, "pe_oi", rows, a, b), start_values(m, "ce_oi", rows, a, b))
        (tl, tst), (bl, bst) = pcr([row]), pcr(brows)
        data = _snapshot(tl[0], tst[0], bl, bst, a)
    else:  # option chain snapshot columns
        kind = "snapshot"
        col, scale = OPT_SNAP[metric]
        data = _snapshot(_levels(m, col, [row])[0] * scale, start_values(m, col, [row], a, b)[0] * scale,
                         _levels(m, col, brows) * scale, start_values(m, col, brows, a, b) * scale, a)

    nd = DECIMALS[metric]
    return {"symbol": sd.symbol, "date": day, "src": src, "metric": metric, "kind": kind, "unit": UNITS[metric],
            "expiry": c.expiry, "window": w.as_dict(), "labels": BAR_LABELS,
            "baseline": {"days": c.bdays, "n": len(c.bdays), "lookback": lookback},
            **{k: nums(v, nd) for k, v in data.items()}}


# ------------------------------------------------------------------------------- chart candles

def _epoch(day: str, bars: np.ndarray) -> np.ndarray:
    """IST wall-clock as a UTC timestamp — what TradingView Lightweight Charts expects for local time."""
    base = int(np.datetime64(day, "s").astype(np.int64))
    return base + (SESSION_START_MIN + bars * BAR_MINUTES) * 60


def build_bars(sd: SymbolData, day: str, src: str, ndays: int) -> dict:
    if src == "spot":
        m = sd.equity
        if m is None:
            raise NotFound("No equity data")
        keyed = [(d, (d,)) for d in sd.days.order if sd.days.rec[d]["eq_bars"]]
    elif src == "fut":
        m = sd.futures
        if m is None:
            raise NotFound("No futures data")
        keyed = [(d, (sd.days.rec[d]["fut_expiry"], d)) for d in sd.days.order if sd.days.rec[d]["fut_expiry"]]
    else:
        raise NotFound(f"Unknown source '{src}' (use spot or fut)")
    keyed = [k for k in keyed if k[0] <= day][-ndays:]
    if not keyed or keyed[-1][0] != day:
        raise NotFound(f"No {src} bars for {day}")

    cols = {k: [] for k in ("t", "o", "h", "l", "c", "v", "vwap", "buy", "sell")}
    if src == "fut":
        cols["oi"], cols["expiry"] = [], []
    sessions = []
    for d, key in keyed:
        r = m.row(*key)
        idx = np.flatnonzero(m.present[r])
        vol, turn = np.nan_to_num(m.v["volume"][r]), np.nan_to_num(m.v["turnover"][r])
        vwap = safe_div(np.cumsum(turn), np.cumsum(vol))
        sessions.append({"date": d, "start": len(cols["t"]), "bars": int(idx.size)})
        cols["t"].extend(_epoch(d, idx).tolist())
        for out, col, nd in (("o", "open", 2), ("h", "high", 2), ("l", "low", 2), ("c", "close", 2),
                             ("v", "volume", 0), ("buy", "buy_vol", 0), ("sell", "sell_vol", 0)):
            cols[out].extend(nums(m.v[col][r, idx], nd))
        cols["vwap"].extend(nums(vwap[idx], 2))
        if src == "fut":
            cols["oi"].extend(nums(m.v["oi"][r, idx], 0))
            cols["expiry"].append(key[0])
    return {"symbol": sd.symbol, "src": src, "date": day, "sessions": sessions, **cols}


def build_strike(sd: SymbolData, day: str, expiry: str, strike: float, right: str) -> dict:
    om = sd.options(expiry)
    r = om.m.row(float(strike), right.upper(), day)
    if r < 0:
        raise NotFound(f"No {right.upper()} {strike} contract for expiry {expiry} on {day}")
    m = om.m
    idx = np.flatnonzero(m.present[r])
    p = m.prev[r]
    out = {"symbol": sd.symbol, "date": day, "expiry": expiry, "strike": float(strike), "right": right.upper(),
           "labels": [BAR_LABELS[i] for i in idx.tolist()], "bars": idx.tolist(),
           "prev_close": None if p < 0 else nums([m.v["close"][p, BARS - 1]], 2)[0],
           "prev_oi": None if p < 0 else nums([m.v["oi"][p, BARS - 1]], 0)[0]}
    for col, nd, scale in (("close", 2, 1), ("oi", 0, 1), ("volume", 0, 1), ("turnover", 0, 1), ("iv", 2, 100),
                           ("delta", 4, 1), ("gamma", 6, 1), ("theta", 3, 1), ("vega", 3, 1)):
        out[col] = nums(m.v[col][r, idx].astype(np.float64) * scale, nd)
    return out
