"""Ship data through GitHub Releases instead of git.

Large data does not belong in the git history, so it travels as release assets (each asset must
stay under GitHub's 2 GiB limit, so archives are split into numbered parts):

  pack-store   store/          -> store.tar.part001, part002 …   (what the server needs: Parquet)
  pack-raw     h2_2025/h2_2025 -> raw.tar.gz.part001 …           (source CSVs, duplicate copies skipped)
  fetch        downloads the store parts of release DATA_RELEASE from GITHUB_REPO and unpacks them
               into STORE_DIR. Runs before the server starts (see Dockerfile); it does nothing when
               DATA_RELEASE is unset, or when that release is already unpacked there.

Usage (from backend/):
  python -m tools.data_release pack-store --out ../release
  python -m tools.data_release pack-raw   --out ../release
  python -m tools.data_release fetch                       # env: DATA_RELEASE, GITHUB_REPO, GITHUB_TOKEN
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import BinaryIO, Iterable, Iterator

PART_SIZE = 1_900_000_000  # bytes per asset (GitHub's limit is 2 GiB)
MARKER = ".release"  # written into STORE_DIR after a successful fetch
API = "https://api.github.com"


# ------------------------------------------------------------------------------------- parts

class PartWriter:
    """Write-only file object that rolls over to name.part001, name.part002 … every `limit` bytes."""

    def __init__(self, out_dir: Path, name: str, limit: int = PART_SIZE):
        self.out_dir, self.name, self.limit = out_dir, name, limit
        self.parts: list[Path] = []
        self._f: BinaryIO | None = None
        self._left = 0

    def _roll(self) -> None:
        if self._f:
            self._f.close()
        path = self.out_dir / f"{self.name}.part{len(self.parts) + 1:03d}"
        self.parts.append(path)
        self._f = open(path, "wb")
        self._left = self.limit

    def write(self, data: bytes) -> int:
        view = memoryview(data)
        while view:
            if self._f is None or self._left == 0:
                self._roll()
            n = min(self._left, len(view))
            self._f.write(view[:n])
            self._left -= n
            view = view[n:]
        return len(data)

    def close(self) -> None:
        if self._f:
            self._f.close()
            self._f = None


class ConcatReader:
    """Read-only stream over several byte streams in order (the parts of one archive)."""

    def __init__(self, streams: Iterable[BinaryIO]):
        self._it: Iterator[BinaryIO] = iter(streams)
        self._cur: BinaryIO | None = next(self._it, None)

    def read(self, n: int = -1) -> bytes:
        out = bytearray()
        while self._cur is not None and (n < 0 or len(out) < n):
            chunk = self._cur.read(-1 if n < 0 else n - len(out))
            if chunk:
                out += chunk
                continue
            self._cur.close()
            self._cur = next(self._it, None)
        return bytes(out)


def _remove_old_parts(out_dir: Path, name: str) -> None:
    for old in out_dir.glob(f"{name}.part*"):
        old.unlink()


# ------------------------------------------------------------------------------------- pack

def pack_store(store: Path, out_dir: Path, part_size: int = PART_SIZE) -> list[Path]:
    """Plain tar (Parquet is already compressed) of the store, split into parts."""
    if not (store / "manifest.json").exists():
        raise SystemExit(f"{store} is not a built store (no manifest.json). Run `python -m ingest` first.")
    out_dir.mkdir(parents=True, exist_ok=True)
    _remove_old_parts(out_dir, "store.tar")
    w = PartWriter(out_dir, "store.tar", part_size)
    with tarfile.open(fileobj=w, mode="w|") as tar:
        for f in sorted(p for p in store.rglob("*") if p.is_file() and not p.name.endswith(".tmp")):
            tar.add(f, arcname=f.relative_to(store).as_posix())
    w.close()
    return w.parts


def pack_raw(raw: Path, out_dir: Path, part_size: int = PART_SIZE) -> list[Path]:
    """gzip tar of the raw CSV tree; the byte-identical duplicate expiry copies are left out
    (ingest keeps one copy per expiry anyway, so nothing is lost)."""
    from ingest.discover import discover

    out_dir.mkdir(parents=True, exist_ok=True)
    _remove_old_parts(out_dir, "raw.tar.gz")
    files = sorted({f for src in discover(raw).values() for f in src.all_files()})
    w = PartWriter(out_dir, "raw.tar.gz", part_size)
    with tarfile.open(fileobj=w, mode="w|gz") as tar:
        for f in files:
            tar.add(f, arcname=f.relative_to(raw).as_posix())
    w.close()
    return w.parts


# ------------------------------------------------------------------------------------- fetch

class _DropAuthOnRedirect(urllib.request.HTTPRedirectHandler):
    """GitHub redirects asset downloads to a signed storage URL; sending our token there fails."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None and urllib.parse.urlparse(newurl).netloc != urllib.parse.urlparse(req.full_url).netloc:
            new.headers.pop("Authorization", None)
            new.unredirected_hdrs.pop("Authorization", None)
        return new


def _open(url: str, token: str | None, accept: str) -> BinaryIO:
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": "stock-analyser-fetch"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    return urllib.request.build_opener(_DropAuthOnRedirect).open(req, timeout=120)


def release_assets(repo: str, tag: str, token: str | None) -> list[dict]:
    with _open(f"{API}/repos/{repo}/releases/tags/{urllib.parse.quote(tag)}", token, "application/vnd.github+json") as r:
        return json.load(r)["assets"]


def extract_store(streams: Iterable[BinaryIO], store: Path) -> int:
    """Unpack a store archive (given as its part streams, in order) into `store`. Returns file count."""
    store.mkdir(parents=True, exist_ok=True)
    looks_like_store = (store / "manifest.json").exists() or (store / MARKER).exists()
    leftovers = [c for c in store.iterdir() if c.name != "lost+found"]
    if leftovers and not looks_like_store:  # never wipe a directory that isn't a store (misconfigured STORE_DIR)
        raise SystemExit(f"refusing to replace {store}: it has files but is not a data store")
    for child in leftovers:  # drop the previous store, but keep the directory (it may be a volume)
        shutil.rmtree(child) if child.is_dir() else child.unlink()
    n = 0
    with tarfile.open(fileobj=ConcatReader(streams), mode="r|") as tar:
        for member in tar:
            target = (store / member.name).resolve()
            if store.resolve() not in target.parents or not (member.isfile() or member.isdir()):
                raise SystemExit(f"refusing unexpected archive entry {member.name!r}")
            tar.extract(member, store)
            n += member.isfile()
    return n


def fetch(store: Path, tag: str | None, repo: str | None, token: str | None) -> bool:
    if not tag:
        print("fetch: DATA_RELEASE not set, using the store as it is")
        return False
    if not repo:
        raise SystemExit("fetch: set GITHUB_REPO (owner/name) to download DATA_RELEASE")
    marker = store / MARKER
    if marker.exists() and marker.read_text().strip() == tag and (store / "manifest.json").exists():
        print(f"fetch: store already at release {tag}")
        return False
    try:
        listed = release_assets(repo, tag, token)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise SystemExit(f"fetch: GitHub refused the token (HTTP {e.code}); check GITHUB_TOKEN") from None
        if e.code == 404:  # GitHub answers 404 for private repos the token cannot see
            raise SystemExit(f"fetch: release {tag} not found in {repo}. Either it does not exist, or GITHUB_TOKEN "
                             "has no access to this repo (it needs Contents: read on it)") from None
        raise
    assets = sorted((a for a in listed if a["name"].startswith("store.tar.part")), key=lambda a: a["name"])
    if not assets:
        raise SystemExit(f"fetch: release {tag} of {repo} has no store.tar.part* assets")
    total = sum(a["size"] for a in assets)
    print(f"fetch: downloading release {tag}: {len(assets)} part(s), {total / 2**30:.2f} GB -> {store}", flush=True)
    t0 = time.perf_counter()
    streams = (_open(f"{API}/repos/{repo}/releases/assets/{a['id']}", token, "application/octet-stream") for a in assets)
    n = extract_store(streams, store)
    marker.write_text(tag)
    print(f"fetch: {n} files unpacked in {time.perf_counter() - t0:.0f}s", flush=True)
    return True


def main(argv: list[str] | None = None) -> int:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # so `ingest` imports from backend/
    from app.config import settings

    ap = argparse.ArgumentParser(prog="python -m tools.data_release")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("pack-store", "pack-raw"):
        p = sub.add_parser(name)
        p.add_argument("--out", type=Path, required=True)
        p.add_argument("--part-size", type=int, default=PART_SIZE)
    sub.add_parser("fetch")
    args = ap.parse_args(argv)

    if args.cmd == "pack-store":
        parts = pack_store(settings.store_dir, args.out, args.part_size)
    elif args.cmd == "pack-raw":
        parts = pack_raw(settings.raw_dir, args.out, args.part_size)
    else:
        fetch(settings.store_dir, os.environ.get("DATA_RELEASE"), os.environ.get("GITHUB_REPO"), os.environ.get("GITHUB_TOKEN"))
        return 0
    for p in parts:
        print(f"{p}  {p.stat().st_size / 2**20:.0f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
