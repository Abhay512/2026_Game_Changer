"""Packing the store / raw data into release parts and unpacking them again."""
from __future__ import annotations

import hashlib
import io
import tarfile
import urllib.request

import pytest

from ingest.discover import discover
from tools.data_release import (ConcatReader, MARKER, _DropAuthOnRedirect, extract_store, pack_raw,
                                pack_store)


def digest(root):
    return {p.relative_to(root).as_posix(): hashlib.sha1(p.read_bytes()).hexdigest()
            for p in root.rglob("*") if p.is_file() and p.name != MARKER}


def test_store_round_trip_through_many_parts(market_store, tmp_path):
    parts = pack_store(market_store, tmp_path / "rel", part_size=200_000)
    assert len(parts) > 3 and all(p.stat().st_size <= 200_000 for p in parts)
    out = tmp_path / "unpacked"
    n = extract_store((open(p, "rb") for p in parts), out)
    assert n == len(digest(market_store))
    assert digest(out) == digest(market_store)


def test_extract_replaces_previous_store_but_refuses_foreign_dirs(market_store, tmp_path):
    parts = pack_store(market_store, tmp_path / "rel", part_size=10**9)
    out = tmp_path / "store"
    out.mkdir()
    (out / "manifest.json").write_text("{}")
    (out / "stale.parquet").write_text("old")
    extract_store((open(p, "rb") for p in parts), out)
    assert not (out / "stale.parquet").exists() and digest(out) == digest(market_store)

    foreign = tmp_path / "home"
    foreign.mkdir()
    (foreign / "notes.txt").write_text("keep me")
    with pytest.raises(SystemExit):
        extract_store((open(p, "rb") for p in parts), foreign)
    assert (foreign / "notes.txt").read_text() == "keep me"


def test_extract_rejects_path_traversal(tmp_path):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        data = b"x"
        info = tarfile.TarInfo("../evil.txt")
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
    buf.seek(0)
    with pytest.raises(SystemExit):
        extract_store([buf], tmp_path / "store")
    assert not (tmp_path / "evil.txt").exists()


def test_raw_pack_skips_duplicate_expiry_copies(raw_tree, tmp_path):
    parts = pack_raw(raw_tree, tmp_path / "rel", part_size=50_000)
    out = tmp_path / "restored"  # raw_tree itself lives in tmp_path / "raw"
    with tarfile.open(fileobj=ConcatReader(open(p, "rb") for p in parts), mode="r|gz") as tar:
        tar.extractall(out)
    original, restored = discover(raw_tree), discover(out)
    assert set(restored) == set(original)
    assert sorted(restored["TEST"].futures) == sorted(original["TEST"].futures)
    assert restored["TEST"].duplicates == 0 and original["TEST"].duplicates == 2


def test_token_is_not_sent_to_the_storage_redirect():
    handler = _DropAuthOnRedirect()
    req = urllib.request.Request("https://api.github.com/repos/o/r/releases/assets/1", headers={"Authorization": "Bearer t"})
    same = handler.redirect_request(req, None, 302, "Found", {}, "https://api.github.com/other")
    other = handler.redirect_request(req, None, 302, "Found", {}, "https://objects.githubusercontent.com/x?sig=1")
    assert same.get_header("Authorization") == "Bearer t"
    assert other.get_header("Authorization") is None
