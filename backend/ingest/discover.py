"""Find every symbol and its raw files under RAW_DATA_DIR.

Expected layout (any number of year folders, any number of symbols):
    {year}/{SYMBOL}/equity/*.csv
    {year}/{SYMBOL}/futures/{MM_mon}/fut_{YYYY-MM-DD}.csv
    {year}/{SYMBOL}/options/{MM_mon}/opt_{YYYY-MM-DD}.csv

The same expiry file is repeated in two month folders (current + next month). Those copies are
identical, so each expiry is kept once (the largest copy wins if they ever differ).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

_EXPIRY_RE = re.compile(r"^(fut|opt)_(\d{4}-\d{2}-\d{2})\.csv$", re.IGNORECASE)


@dataclass
class SymbolSources:
    symbol: str
    equity: list[Path] = field(default_factory=list)
    futures: dict[str, Path] = field(default_factory=dict)  # expiry -> file
    options: dict[str, Path] = field(default_factory=dict)  # expiry -> file
    duplicates: int = 0
    conflicts: list[str] = field(default_factory=list)  # duplicate expiry copies that differ in size

    def all_files(self) -> list[Path]:
        return sorted([*self.equity, *self.futures.values(), *self.options.values()])


def _keep(target: dict[str, Path], expiry: str, path: Path, src: SymbolSources) -> None:
    current = target.get(expiry)
    if current is None:
        target[expiry] = path
        return
    src.duplicates += 1
    a, b = current.stat().st_size, path.stat().st_size
    if a != b:
        src.conflicts.append(f"{expiry}: {current} ({a} B) vs {path} ({b} B)")
    if b > a:
        target[expiry] = path


def discover(raw_dir: Path, only: set[str] | None = None) -> dict[str, SymbolSources]:
    if not raw_dir.is_dir():
        raise FileNotFoundError(f"Raw data directory not found: {raw_dir}")
    out: dict[str, SymbolSources] = {}
    for year_dir in sorted(p for p in raw_dir.iterdir() if p.is_dir()):
        for sym_dir in sorted(p for p in year_dir.iterdir() if p.is_dir()):
            sym = sym_dir.name.upper()
            if only and sym not in only:
                continue
            src = out.setdefault(sym, SymbolSources(sym))
            eq = sym_dir / "equity"
            if eq.is_dir():
                src.equity.extend(sorted(eq.glob("*.csv")))
            for kind, target in (("futures", src.futures), ("options", src.options)):
                base = sym_dir / kind
                if not base.is_dir():
                    continue
                for f in sorted(base.rglob("*.csv")):
                    m = _EXPIRY_RE.match(f.name)
                    if m:
                        _keep(target, m.group(2), f, src)
    return out
