"""JSON helpers: NaN-safe, numpy-aware, compact."""
from __future__ import annotations

import json
import math

import numpy as np
from fastapi import Request, Response

from .store import Store


def clean(o):
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, np.ndarray):
        return [clean(v) for v in o.tolist()]
    if isinstance(o, (float, np.floating)):
        f = float(o)
        return f if math.isfinite(f) else None
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    return o


def dumps(payload) -> bytes:
    return json.dumps(clean(payload), separators=(",", ":"), allow_nan=False).encode("utf-8")


def json_bytes(body: bytes) -> Response:
    return Response(content=body, media_type="application/json")


def get_store(request: Request) -> Store:
    return request.app.state.store
