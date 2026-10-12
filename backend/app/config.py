"""Runtime configuration, read from environment (or a .env file at the project root)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]

try:  # optional: python-dotenv
    from dotenv import load_dotenv

    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:  # pragma: no cover
    pass

# NSE cash/F&O session on 5-minute bars: 09:15 .. 15:25 bar starts, session closes 15:30.
SESSION_START_MIN = 9 * 60 + 15
SESSION_END_MIN = 15 * 60 + 30
BAR_MINUTES = 5
BARS_PER_SESSION = (SESSION_END_MIN - SESSION_START_MIN) // BAR_MINUTES  # 75

# A session with fewer bars than this (e.g. Muhurat trading) is excluded from 20-day baselines.
MIN_FULL_SESSION_BARS = 70
LOOKBACK_DAYS = 20


def _path(env: str, default: Path) -> Path:
    raw = os.environ.get(env)
    if not raw:
        return default
    p = Path(raw)
    return p if p.is_absolute() else (PROJECT_ROOT / p).resolve()


@dataclass(frozen=True)
class Settings:
    raw_dir: Path
    store_dir: Path
    host: str
    port: int
    workers: int  # server processes; each has its own caches (memory × workers)
    app_password: str
    login_idle_minutes: int  # with APP_PASSWORD: a login ends after this long without requests
    ingest_workers: int
    cache_symbols: int  # per-symbol matrices kept in memory (~5 MB each)
    cache_expiries: int  # per-expiry option matrices kept in memory (~10 MB each)
    cache_responses: int  # serialized API responses kept in memory (~5-40 KB each)


def _int(env: str, default: int) -> int:
    try:
        return int(os.environ.get(env, "") or default)
    except ValueError:
        return default


def load_settings() -> Settings:
    workers = _int("INGEST_WORKERS", 0)
    if workers <= 0:
        workers = max(1, min(8, (os.cpu_count() or 2) - 2))
    return Settings(
        raw_dir=_path("RAW_DATA_DIR", PROJECT_ROOT / "h2_2025" / "h2_2025"),
        store_dir=_path("STORE_DIR", PROJECT_ROOT / "store"),
        host=os.environ.get("HOST", "127.0.0.1"),
        port=_int("PORT", 8000),
        workers=max(1, _int("WORKERS", 1)),
        app_password=os.environ.get("APP_PASSWORD", ""),
        login_idle_minutes=max(1, _int("LOGIN_IDLE_MINUTES", 30)),
        ingest_workers=workers,
        cache_symbols=_int("CACHE_SYMBOLS", 48),
        cache_expiries=_int("CACHE_EXPIRIES", 16),
        cache_responses=_int("CACHE_RESPONSES", 512),
    )


settings = load_settings()
