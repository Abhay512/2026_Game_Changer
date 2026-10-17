"""Strike-wise option metrics for spot ±N strikes: OI, ΔOI, last-5-min OI, volume, turnover, LTP,
IV and Greeks, each compared with the same window on baseline days at the same ATM offset.

Strikes move with price, so day-to-day comparison is by moneyness: offset 0 = ATM strike of that
day at bar B, offset +1 = next strike above, and so on.
"""
from __future__ import annotations

import warnings

import numpy as np

from ..baseline import compare, num
from ..formulas import max_pain_matrix
from ..matrix import DayChain, Matrix, OptionMatrix, level_at, start_values, value_at, window_sum
from ..window import Window

GREEKS = ("delta", "gamma", "theta", "vega")

# (metric, compare on |value|?) — signed Greeks (PE delta, theta) and changes compare magnitudes
COMPARED = (("oi_chg", True), ("oi_5m", True), ("vol", False), ("turnover", False), ("iv", False),
            ("iv_chg", True), ("delta", True), ("delta_chg", True), ("gamma", False), ("gamma_chg", True),
            ("theta", True), ("theta_chg", True), ("vega", False), ("vega_chg", True))

# metrics with a "last N sessions" bar graph in the chain (strike_days); same |value| rule as COMPARED
SESSION_METRICS = (("oi", False), ("oi_chg", True), ("vol", False), ("iv", False), ("vega", False),
                   ("theta", True), ("gamma", False), ("delta", True))

DECIMALS = {"ltp": 2, "ltp_chg": 2, "oi": 0, "oi_chg": 0, "oi_chg_pct": 2, "oi_5m": 0, "vol": 0, "turnover": 0,
            "iv": 2, "iv_chg": 2, "delta": 4, "delta_chg": 4, "gamma": 6, "gamma_chg": 6, "theta": 3,
            "theta_chg": 3, "vega": 3, "vega_chg": 3}


def contract_metrics(m: Matrix, rows: np.ndarray, w: Window) -> dict[str, np.ndarray]:
    """Metrics per contract row; rows of -1 (strike not listed on that side) give NaN."""
    valid = rows >= 0
    r = np.where(valid, rows, 0)
    a, b = w.a, w.b

    def snap(col: str, scale: float = 1.0, carry: bool = True):
        # carry: OI/price keep their last value when nothing printed; IV/Greeks are recomputed every
        # bar, so a missing value (e.g. expiry day) must stay missing rather than show yesterday's
        now = level_at(m, col, r, a, b) if carry else value_at(m, col, r, b)
        return now * scale, start_values(m, col, r, a, b) * scale

    out: dict[str, np.ndarray] = {}
    ltp, ltp_s = snap("close")
    oi, oi_s = snap("oi")
    out["ltp"], out["ltp_chg"] = ltp, ltp - ltp_s
    out["oi"], out["oi_chg"] = oi, oi - oi_s
    with np.errstate(divide="ignore", invalid="ignore"):
        out["oi_chg_pct"] = np.where(oi_s > 0, (oi - oi_s) / np.where(oi_s > 0, oi_s, 1) * 100, np.nan)
    out["oi_5m"] = oi - start_values(m, "oi", r, b, b)
    out["vol"] = window_sum(m, "volume", r, a, b)
    out["turnover"] = window_sum(m, "turnover", r, a, b)
    iv, iv_s = snap("iv", 100.0, carry=False)
    out["iv"], out["iv_chg"] = iv, iv - iv_s
    for g in GREEKS:
        now, start = snap(g, carry=False)
        out[g], out[f"{g}_chg"] = now, now - start
    for k in out:
        out[k] = np.where(valid, out[k], np.nan)
    return out


def atm_index(dc: DayChain, atm: float, spot: float) -> int:
    ref = atm if np.isfinite(atm) else spot
    if not np.isfinite(ref) or len(dc.strikes) == 0:
        return len(dc.strikes) // 2
    return int(np.argmin(np.abs(dc.strikes - ref)))


def offset_rows(dc: DayChain, center: int, offsets: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    idx = center + offsets
    ok = (idx >= 0) & (idx < len(dc.strikes))
    safe = np.clip(idx, 0, max(len(dc.strikes) - 1, 0))
    if len(dc.strikes) == 0:
        none = np.full(len(offsets), -1, dtype=np.intp)
        return np.full(len(offsets), np.nan), none, none
    strikes = np.where(ok, dc.strikes[safe], np.nan)
    return strikes, np.where(ok, dc.ce[safe], -1), np.where(ok, dc.pe[safe], -1)


def pain_curve(om: OptionMatrix, dc: DayChain, w: Window) -> dict:
    """Writers' total payout at every listed strike, at bar B (max pain = the minimum)."""
    def oi(rows):
        vals = level_at(om.m, "oi", np.where(rows >= 0, rows, 0), w.a, w.b)
        return np.where(rows >= 0, np.nan_to_num(vals), 0.0)
    ce, pe = oi(dc.ce), oi(dc.pe)
    if len(dc.strikes) == 0 or (ce.sum() + pe.sum()) <= 0:
        return {"strikes": [], "payout": [], "max_pain": None}
    payout = max_pain_matrix(dc.strikes, ce[None, :], pe[None, :])[0]
    return {"strikes": [num(s, 2) for s in dc.strikes], "payout": [num(p, 0) for p in payout],
            "max_pain": num(dc.strikes[int(np.argmin(payout))], 2)}


def strike_rows(om: OptionMatrix, day: str, atm: float, spot: float, n: int, w: Window,
                baseline: list[tuple[OptionMatrix, str, float, float]]) -> dict:
    """Rows for today's ATM ±n strikes; `baseline` = [(option matrix, day, atm, spot)] per baseline day."""
    dc = om.chains.get(day)
    if dc is None or len(dc.strikes) == 0:
        return {"rows": [], "pain": {"strikes": [], "payout": [], "max_pain": None}}
    center = atm_index(dc, atm, spot)
    lo, hi = max(0, center - n), min(len(dc.strikes), center + n + 1)
    offsets = np.arange(lo - center, hi - center)
    strikes, ce_rows, pe_rows = offset_rows(dc, center, offsets)
    today = {"ce": contract_metrics(om.m, ce_rows, w), "pe": contract_metrics(om.m, pe_rows, w)}

    # baseline: same window, same ATM offset, on each baseline day's chain
    stacks: dict[str, dict[str, list[np.ndarray]]] = {"ce": {}, "pe": {}}
    for bom, bday, batm, bspot in baseline:
        bdc = bom.chains.get(bday)
        if bdc is None or len(bdc.strikes) == 0:
            continue
        _, bce, bpe = offset_rows(bdc, atm_index(bdc, batm, bspot), offsets)
        for side, rows in (("ce", bce), ("pe", bpe)):
            met = contract_metrics(bom.m, rows, w)
            for key, absolute in COMPARED:
                stacks[side].setdefault(key, []).append(np.abs(met[key]) if absolute else met[key])

    avgs: dict[str, dict[str, np.ndarray]] = {"ce": {}, "pe": {}}
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        for side in ("ce", "pe"):
            for key, _ in COMPARED:
                vals = stacks[side].get(key)
                avgs[side][key] = np.nanmean(np.vstack(vals), axis=0) if vals else np.full(len(offsets), np.nan)

    rows = []
    for i, off in enumerate(offsets.tolist()):
        row = {"strike": num(strikes[i], 2), "offset": int(off), "atm": off == 0}
        for side in ("ce", "pe"):
            met = today[side]
            if not np.isfinite(met["ltp"][i]) and not np.isfinite(met["oi"][i]):
                row[side] = None  # strike not listed on this side
                continue
            cell = {k: num(met[k][i], DECIMALS[k]) for k in DECIMALS}
            avg, x = {}, {}
            for key, absolute in COMPARED:
                t = abs(met[key][i]) if absolute else met[key][i]
                mval = avgs[side][key][i]
                avg[key] = num(mval, DECIMALS[key])
                x[key] = num(t / mval, 2) if np.isfinite(t) and np.isfinite(mval) and mval != 0 else None
            cell["avg"], cell["x"] = avg, x
            row[side] = cell
        rows.append(row)
    return {"rows": rows, "pain": pain_curve(om, dc, w), "baseline_n": len(baseline)}


def strike_days(om: OptionMatrix, day: str, atm: float, spot: float, offset: int, w: Window,
                baseline: list[tuple[OptionMatrix, str, float, float]]) -> dict | None:
    """One chain row (ATM + `offset`) today and on each baseline day, same window and same offset:
    the per-session values behind the chain's × (one `compare` block per metric and side)."""
    dc = om.chains.get(day)
    if dc is None or len(dc.strikes) == 0:
        return None
    offs = np.array([offset])
    strike, ce_rows, pe_rows = offset_rows(dc, atm_index(dc, atm, spot), offs)
    today = {"ce": contract_metrics(om.m, ce_rows, w), "pe": contract_metrics(om.m, pe_rows, w)}

    days, strikes = [], []
    samples: dict[str, dict[str, list[float]]] = {"ce": {k: [] for k, _ in SESSION_METRICS},
                                                  "pe": {k: [] for k, _ in SESSION_METRICS}}
    for bom, bday, batm, bspot in baseline:
        bdc = bom.chains.get(bday)
        if bdc is None or len(bdc.strikes) == 0:
            continue
        bstrike, bce, bpe = offset_rows(bdc, atm_index(bdc, batm, bspot), offs)
        days.append(bday)
        strikes.append(num(bstrike[0], 2))
        for side, rows in (("ce", bce), ("pe", bpe)):
            met = contract_metrics(bom.m, rows, w)
            for key, _ in SESSION_METRICS:
                samples[side][key].append(met[key][0])

    out: dict = {"strike": num(strike[0], 2), "offset": int(offset), "days": days, "strikes": strikes}
    for side in ("ce", "pe"):
        met = today[side]
        if not np.isfinite(met["ltp"][0]) and not np.isfinite(met["oi"][0]):
            out[side] = None  # strike not listed on this side
            continue
        out[side] = {key: compare(met[key][0], samples[side][key], DECIMALS[key], absolute=absolute)
                     for key, absolute in SESSION_METRICS}
    return out
