"""Shared query parameters."""
from __future__ import annotations

from fastapi import Query

from ..config import LOOKBACK_DAYS

DATE = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$", description="Trading day YYYY-MM-DD (default: latest complete)")
FROM = Query(None, alias="from", description="Window start HH:MM (default 09:15)")
TO = Query(None, description="Window end HH:MM (default 15:30)")
LOOKBACK = Query(LOOKBACK_DAYS, ge=5, le=60, description="Baseline sessions")
EXPIRY = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$", description="Option expiry (default: front month)")
