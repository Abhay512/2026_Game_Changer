"""Small pure formulas shared by ingest and the API."""
from __future__ import annotations

import numpy as np


def max_pain_matrix(strikes: np.ndarray, ce_oi: np.ndarray, pe_oi: np.ndarray) -> np.ndarray:
    """Total option-writer payout if the underlying settles at each strike: rows × candidate strikes.

    payout(K) = Σ_s CE_OI(s)·max(0, K − s) + Σ_s PE_OI(s)·max(0, s − K)
    Max pain is the candidate K with the smallest payout.
    """
    k = np.asarray(strikes, dtype="float64")
    call_pay = np.maximum(0.0, k[None, :] - k[:, None])  # [s, K]
    put_pay = np.maximum(0.0, k[:, None] - k[None, :])  # [s, K]
    return np.asarray(ce_oi, dtype="float64") @ call_pay + np.asarray(pe_oi, dtype="float64") @ put_pay


def percentile_rank(value: float, sample) -> float:
    """Share of `sample` below `value` (ties count half), 0–100. NaN if undefined."""
    s = np.asarray(sample, dtype="float64")
    s = s[np.isfinite(s)]
    if not np.isfinite(value) or s.size == 0:
        return float("nan")
    below = np.count_nonzero(s < value)
    equal = np.count_nonzero(s == value)
    return 100.0 * (below + 0.5 * equal) / s.size


def safe_div(a, b):
    a = np.asarray(a, dtype="float64")
    b = np.asarray(b, dtype="float64")
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where((b != 0) & np.isfinite(b), a / np.where(b == 0, 1.0, b), np.nan)
