"""Buy / sell flow from the Bulk Volume Classification split computed at ingest."""
from __future__ import annotations

import numpy as np

from ..baseline import compare, num
from ..formulas import safe_div
from ..matrix import Matrix, window_sum
from ..window import Window


def flow_block(m: Matrix, row: int, base_rows: np.ndarray, w: Window) -> dict:
    a, b = w.a, w.b
    r = np.array([row])
    buy, sell = window_sum(m, "buy_vol", r, a, b)[0], window_sum(m, "sell_vol", r, a, b)[0]
    b_buy, b_sell = window_sum(m, "buy_vol", base_rows, a, b), window_sum(m, "sell_vol", base_rows, a, b)
    l_buy, l_sell = float(np.nan_to_num(m.v["buy_vol"][row, b])), float(np.nan_to_num(m.v["sell_vol"][row, b]))
    bl_buy = np.nan_to_num(m.v["buy_vol"][base_rows, b]) if len(base_rows) else np.zeros(0)
    bl_sell = np.nan_to_num(m.v["sell_vol"][base_rows, b]) if len(base_rows) else np.zeros(0)
    total = buy + sell
    return {
        "method": "bvc",  # estimated, not exchange-reported
        "buy": compare(buy, b_buy, nd=0),
        "sell": compare(sell, b_sell, nd=0),
        "ratio": compare(float(safe_div(buy, sell)), safe_div(b_buy, b_sell), nd=3),
        "buy_share_pct": num(100 * buy / total if total else np.nan, 2),
        "last5": {
            "buy": compare(l_buy, bl_buy, nd=0),
            "sell": compare(l_sell, bl_sell, nd=0),
            "ratio": num(safe_div(l_buy, l_sell), 3),
        },
    }
