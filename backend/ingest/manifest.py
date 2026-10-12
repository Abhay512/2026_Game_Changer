"""Incremental ingest: a symbol is rebuilt only when one of its raw files changed."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from . import PIPELINE_VERSION
from .discover import SymbolSources


def fingerprint(src: SymbolSources, raw_dir: Path) -> str:
    h = hashlib.sha1(f"v{PIPELINE_VERSION}".encode())
    for f in src.all_files():
        st = f.stat()
        h.update(f"{f.relative_to(raw_dir).as_posix()}|{st.st_size}|{st.st_mtime_ns}\n".encode())
    return h.hexdigest()


def load(store_dir: Path) -> dict[str, str]:
    p = store_dir / "manifest.json"
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8")).get("symbols", {})
    except (json.JSONDecodeError, OSError):
        return {}


def save(store_dir: Path, symbols: dict[str, str]) -> None:
    p = store_dir / "manifest.json"
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps({"pipeline_version": PIPELINE_VERSION, "symbols": symbols}, indent=1, sort_keys=True),
        encoding="utf-8",
    )
    tmp.replace(p)
