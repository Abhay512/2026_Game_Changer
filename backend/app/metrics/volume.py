"""Volume and turnover: window total, day-so-far total and last-5-minute bar, each vs baseline."""
from __future__ import annotations

import numpy as np

from ..baseline import compare
from ..matrix import Matrix, window_sum
from ..window import Window


def total_block(m: Matrix, col: str, row: int, base_rows: np.ndarray, w: Window) -> dict:
    a, b = w.a, w.b
    r = np.array([row])
    last = float(np.nan_to_num(m.v[col][row, b]))
    base_last = np.nan_to_num(m.v[col][base_rows, b]) if len(base_rows) else np.zeros(0)
    return {
        "window": compare(window_sum(m, col, r, a, b)[0], window_sum(m, col, base_rows, a, b), nd=0),
        "day": compare(window_sum(m, col, r, 0, b)[0], window_sum(m, col, base_rows, 0, b), nd=0),
        "last5": compare(last, base_last, nd=0),
    }
