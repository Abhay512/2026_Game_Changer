"""Build every store table for one symbol. Runs inside a worker process."""
from __future__ import annotations

import os
import time
from pathlib import Path

import pandas as pd

from . import derive, quality
from .discover import SymbolSources
from .read import read_equity, read_futures, read_options

# store/ layout (one file per symbol keeps reads scoped to the symbol being viewed)
EQUITY = "equity"
FUTURES = "futures"
FUTURES_FRONT = "futures_front"
OPTIONS = "options"  # options/{SYMBOL}/{EXPIRY}.parquet
CHAIN = "chain"
DAYS = "days"


def _write(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    df.to_parquet(tmp, engine="pyarrow", compression="zstd", index=False, row_group_size=100_000)
    os.replace(tmp, path)


def _remove(path: Path) -> None:
    if path.exists():
        path.unlink()


def symbol_paths(store: Path, sym: str) -> dict[str, Path]:
    return {
        EQUITY: store / EQUITY / f"{sym}.parquet",
        FUTURES: store / FUTURES / f"{sym}.parquet",
        FUTURES_FRONT: store / FUTURES_FRONT / f"{sym}.parquet",
        OPTIONS: store / OPTIONS / sym,
        CHAIN: store / CHAIN / f"{sym}.parquet",
        DAYS: store / DAYS / f"{sym}.parquet",
    }


def remove_symbol(store: Path, sym: str) -> None:
    for kind, p in symbol_paths(store, sym).items():
        if kind == OPTIONS:
            if p.is_dir():
                for f in p.glob("*.parquet"):
                    f.unlink()
                p.rmdir()
        else:
            _remove(p)


def process_symbol(src: SymbolSources, store: Path) -> dict:
    t0 = time.perf_counter()
    sym = src.symbol
    paths = symbol_paths(store, sym)
    meta: dict = {}

    eq = None
    if src.equity:
        eq, meta = read_equity(src.equity)
        eq = derive.add_bvc(eq)
        _write(eq, paths[EQUITY])
    else:
        _remove(paths[EQUITY])

    fut = fut_front = None
    if src.futures:
        frames = [derive.add_bvc(read_futures(p)) for _, p in sorted(src.futures.items())]
        fut = pd.concat(frames, ignore_index=True).sort_values(["expiry", "ts"], ignore_index=True)
        fut_front = derive.futures_front(fut)
        _write(fut, paths[FUTURES])
        _write(fut_front, paths[FUTURES_FRONT])
    else:
        _remove(paths[FUTURES])
        _remove(paths[FUTURES_FRONT])

    chain = None
    opt_dir = paths[OPTIONS]
    keep: set[str] = set()
    filled_rows = total_rows = 0
    if src.options:
        aggs = []
        for exp, p in sorted(src.options.items()):
            grid = derive.options_grid(read_options(p))
            filled_rows += int(grid["filled"].sum())
            total_rows += len(grid)
            _write(grid, opt_dir / f"{exp}.parquet")
            keep.add(f"{exp}.parquet")
            aggs.append(derive.chain_aggregates(grid))
        chain = pd.concat(aggs, ignore_index=True).sort_values(["expiry", "day", "bar"], ignore_index=True)
        _write(chain, paths[CHAIN])
    else:
        _remove(paths[CHAIN])
    if opt_dir.is_dir():  # drop expiries that no longer exist in raw
        for f in opt_dir.glob("*.parquet"):
            if f.name not in keep:
                f.unlink()

    days = derive.day_table(eq, fut_front, chain)
    _write(days, paths[DAYS])

    entry = quality.summarize(src, meta, eq, fut, chain, days,
                              filled_rows / total_rows if total_rows else None)
    entry["ingest_seconds"] = round(time.perf_counter() - t0, 2)
    return entry
