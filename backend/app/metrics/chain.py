"""Chain-level option metrics: PCR, max pain, ATM IV (+ percentiles), total CE/PE OI."""
from __future__ import annotations

import numpy as np

from ..baseline import compare, num
from ..formulas import percentile_rank, safe_div
from ..matrix import Matrix, level_at, start_values, value_at, window_sum
from ..window import Window


def _snap(m: Matrix, col: str, rows, w: Window, scale: float = 1.0, carry: bool = True):
    """(value at B, value at window start). carry=False for IV: a missing IV stays missing."""
    now = level_at(m, col, rows, w.a, w.b) if carry else value_at(m, col, rows, w.b)
    return now * scale, start_values(m, col, rows, w.a, w.b) * scale


def chain_block(cm: Matrix, row: int, base_rows: np.ndarray, hist_rows: np.ndarray, w: Window) -> dict:
    """`hist_rows`: every earlier valid session of the same expiry rank (all-history IV percentile)."""
    r = np.array([row])
    ce, ce_s = _snap(cm, "ce_oi", r, w)
    pe, pe_s = _snap(cm, "pe_oi", r, w)
    bce, bce_s = _snap(cm, "ce_oi", base_rows, w)
    bpe, bpe_s = _snap(cm, "pe_oi", base_rows, w)

    pcr, pcr_s = safe_div(pe, ce)[0], safe_div(pe_s, ce_s)[0]
    bpcr, bpcr_s = safe_div(bpe, bce), safe_div(bpe_s, bce_s)
    pcr_vol = safe_div(window_sum(cm, "pe_vol", r, w.a, w.b), window_sum(cm, "ce_vol", r, w.a, w.b))[0]
    bpcr_vol = safe_div(window_sum(cm, "pe_vol", base_rows, w.a, w.b), window_sum(cm, "ce_vol", base_rows, w.a, w.b))

    mp, mp_s = (x[0] for x in _snap(cm, "max_pain", r, w))
    bmp, bmp_s = _snap(cm, "max_pain", base_rows, w)
    spot = level_at(cm, "spot", r, w.a, w.b)[0]
    atm = level_at(cm, "atm_strike", r, w.a, w.b)[0]

    iv, iv_s = (x[0] for x in _snap(cm, "atm_iv", r, w, 100.0, carry=False))
    biv, biv_s = _snap(cm, "atm_iv", base_rows, w, 100.0, carry=False)
    hiv = value_at(cm, "atm_iv", hist_rows, w.b) * 100.0 if len(hist_rows) else np.zeros(0)
    hiv = hiv[np.isfinite(hiv)]

    return {
        "spot": num(spot, 2), "atm": num(atm, 2),
        "pcr": {
            "oi": compare(pcr, bpcr, nd=3),  # level at B vs the same moment on baseline days
            "start": num(pcr_s, 3),
            "chg": compare(pcr - pcr_s, bpcr - bpcr_s, nd=3, absolute=True),  # change speed
            "vol": compare(pcr_vol, bpcr_vol, nd=3),
        },
        "max_pain": {
            "value": num(mp, 2), "start": num(mp_s, 2),
            "shift": compare(mp - mp_s, bmp - bmp_s, nd=2, absolute=True),
            "vs_spot_pct": num((mp / spot - 1) * 100 if spot else np.nan, 3),
        },
        "iv": {
            "atm": compare(iv, biv, nd=2),
            "start": num(iv_s, 2),
            "chg": compare(iv - iv_s, biv - biv_s, nd=2, absolute=True),
            "pct_all": num(percentile_rank(iv, hiv), 0),
            "n_all": int(hiv.size),
            "min_all": num(hiv.min(), 2) if hiv.size else None,
            "max_all": num(hiv.max(), 2) if hiv.size else None,
        },
        "oi": {
            "ce": {"value": num(ce[0], 0), "start": num(ce_s[0], 0),
                   "chg": compare(ce[0] - ce_s[0], bce - bce_s, nd=0, absolute=True)},
            "pe": {"value": num(pe[0], 0), "start": num(pe_s[0], 0),
                   "chg": compare(pe[0] - pe_s[0], bpe - bpe_s, nd=0, absolute=True)},
        },
    }
