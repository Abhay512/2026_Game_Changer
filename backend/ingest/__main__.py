"""CLI: python -m ingest [--symbols A,B] [--force] [--workers N] [--raw DIR] [--store DIR]

Incremental by default — only symbols whose raw files changed are rebuilt. Adding stocks is just
dropping their folders into RAW_DATA_DIR and running this again.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

from app.config import settings

from . import PIPELINE_VERSION, manifest
from .discover import discover
from .pipeline import process_symbol, remove_symbol


def _load_catalog(store: Path) -> dict:
    p = store / "catalog.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8")).get("symbols", {})
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _save_catalog(store: Path, symbols: dict) -> None:
    p = store / "catalog.json"
    tmp = p.with_suffix(".json.tmp")
    doc = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "pipeline_version": PIPELINE_VERSION,
        "symbol_count": len(symbols),
        "symbols": dict(sorted(symbols.items())),
    }
    tmp.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    tmp.replace(p)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m ingest", description=__doc__.splitlines()[0])
    ap.add_argument("--raw", type=Path, default=settings.raw_dir)
    ap.add_argument("--store", type=Path, default=settings.store_dir)
    ap.add_argument("--symbols", default="", help="comma-separated subset (default: all)")
    ap.add_argument("--force", action="store_true", help="rebuild even if unchanged")
    ap.add_argument("--workers", type=int, default=settings.ingest_workers)
    args = ap.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True)  # progress shows up live in logs / docker

    only ={s.strip().upper() for s in args.symbols.split(",") if s.strip()} or None
    store: Path = args.store
    store.mkdir(parents=True, exist_ok=True)

    sources = discover(args.raw, only)
    if not sources:
        print(f"No symbols found under {args.raw}", file=sys.stderr)
        return 1

    prints = manifest.load(store)
    catalog = _load_catalog(store)

    if only is None:  # prune symbols that disappeared from raw
        for gone in sorted(set(catalog) - set(sources)):
            remove_symbol(store, gone)
            catalog.pop(gone, None)
            prints.pop(gone, None)
            print(f"  pruned {gone}")

    todo = {}
    for sym, src in sources.items():
        fp = manifest.fingerprint(src, args.raw)
        if args.force or prints.get(sym) != fp or sym not in catalog:
            todo[sym] = (src, fp)
    print(f"{len(sources)} symbols found, {len(todo)} to build, {len(sources) - len(todo)} up to date "
          f"({args.workers} workers)")

    t0 = time.perf_counter()
    failed: dict[str, str] = {}
    if todo:
        with ProcessPoolExecutor(max_workers=max(1, min(args.workers, len(todo)))) as pool:
            futs = {pool.submit(process_symbol, src, store): sym for sym, (src, _) in todo.items()}
            for i, fut in enumerate(as_completed(futs), 1):
                sym = futs[fut]
                try:
                    entry = fut.result()
                except Exception as exc:  # keep going; report at the end
                    failed[sym] = f"{type(exc).__name__}: {exc}"
                    print(f"  [{i}/{len(todo)}] {sym:<12} FAILED  {failed[sym]}")
                    continue
                catalog[sym] = entry
                prints[sym] = todo[sym][1]
                warn = f"  ({len(entry['warnings'])} warnings)" if entry["warnings"] else ""
                print(f"  [{i}/{len(todo)}] {sym:<12} {entry['ingest_seconds']:>6.1f}s{warn}")
                # persist progress so an interrupted run resumes where it stopped
                if i % 5 == 0:
                    _save_catalog(store, catalog)
                    manifest.save(store, prints)  # written last: the API treats it as the store version

    _save_catalog(store, catalog)
    manifest.save(store, prints)  # written last: the API treats it as the store version
    print(f"done in {time.perf_counter() - t0:.1f}s - catalog has {len(catalog)} symbols"
          + (f", {len(failed)} FAILED: {', '.join(failed)}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
