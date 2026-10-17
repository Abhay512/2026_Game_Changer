"""API contract + numerical tests against the synthetic market (tests/synth.py).

Expected values are recomputed independently with pandas straight from the store files.
"""
from __future__ import annotations

import base64
import os
import time
from dataclasses import replace

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import create_app
from app.store import Store
from synth import DAYS, EXPIRIES, SHORT_DAY

D = "2025-07-30"  # its 20-session baseline straddles the short session on 2025-07-15
W = {"from": "09:30", "to": "10:30"}  # bars 3..14
A, B = 3, 14


@pytest.fixture(scope="module")
def tables(market_store):
    def load(rel):
        df = pd.read_parquet(market_store / rel)
        for c in ("day", "expiry"):
            if c in df:
                df[c] = df[c].dt.strftime("%Y-%m-%d")
        return df
    return {"eq": load("equity/MKT.parquet"), "fut": load("futures/MKT.parquet"), "chain": load("chain/MKT.parquet"),
            "opt": {e: load(f"options/MKT/{e}.parquet") for e in EXPIRIES}}


def prior_full_days(day: str, n: int = 20) -> list[str]:
    return [d for d in DAYS if d < day and d != SHORT_DAY][-n:]


def front(day: str) -> str:
    return min(e for e in EXPIRIES if e >= day)


def get(client, url, **params):
    r = client.get(url, params=params)
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------------------- catalog / dates

def test_symbols_and_dates(client):
    syms = {s["symbol"]: s for s in get(client, "/api/symbols")["symbols"]}
    assert set(syms) == {"MKT", "GAP", "EQONLY"}
    assert syms["MKT"]["has_fno"] and not syms["EQONLY"]["has_fno"]
    assert any("2025-07-31" in w for w in syms["GAP"]["warnings"])

    dates = get(client, "/api/symbols/MKT/dates")
    by_day = {d["date"]: d for d in dates["days"]}
    assert not by_day[SHORT_DAY]["full"] and by_day[SHORT_DAY]["bars"] == 16
    assert by_day["2025-08-28"]["expiry_day"]
    # default = latest full session with front-month F&O that is not an expiry day
    assert dates["default"] == "2025-08-27"
    assert get(client, "/api/symbols/EQONLY/dates")["default"] == DAYS[-1]


def test_errors(client):
    assert client.get("/api/analysis/NOPE").status_code == 404
    assert client.get("/api/analysis/MKT", params={"date": "2025-07-05"}).status_code == 404  # Saturday
    assert client.get("/api/analysis/MKT", params={"date": D, "from": "10:30", "to": "09:30"}).status_code == 422
    assert client.get("/api/analysis/MKT", params={"date": D, "from": "09:17"}).status_code == 422
    assert client.get("/api/series/MKT", params={"src": "spot", "metric": "nope", "date": D}).status_code == 404
    # an expiry that is not trading that day falls back to the default with a note (no error)
    fb = get(client, "/api/chain/MKT", date=D, expiry="2025-06-26")
    assert fb["expiry"] == "2025-07-31" and any("not trading" in n for n in fb["notes"])


# ------------------------------------------------------------------------------- spot

def test_spot_volume_and_turnover_match_manual(client, tables):
    eq = tables["eq"]
    j = get(client, "/api/analysis/MKT", date=D, **W)
    base_days = prior_full_days(D)
    assert j["spot"]["baseline"]["days"] == base_days and SHORT_DAY not in base_days

    def wsum(day, col, a=A, b=B):
        return eq[(eq.day == day) & eq.bar.between(a, b)][col].sum()

    for col in ("volume", "turnover"):
        blk = j["spot"][col]
        today = wsum(D, col)
        avg = np.mean([wsum(d, col) for d in base_days])
        assert blk["window"]["value"] == pytest.approx(today, abs=1)
        assert blk["window"]["avg"] == pytest.approx(avg, abs=1)
        assert blk["window"]["x"] == pytest.approx(today / avg, abs=0.006)
        assert blk["window"]["hist"] == pytest.approx([wsum(d, col) for d in base_days], abs=1)
        last = eq[(eq.day == D) & (eq.bar == B)][col].item()
        assert blk["last5"]["value"] == pytest.approx(last, abs=1)
        assert blk["day"]["value"] == pytest.approx(wsum(D, col, 0, B), abs=1)

    flow = j["spot"]["flow"]
    buy, sell = wsum(D, "buy_vol"), wsum(D, "sell_vol")
    assert flow["buy"]["value"] + flow["sell"]["value"] == pytest.approx(wsum(D, "volume"), abs=2)
    assert flow["ratio"]["value"] == pytest.approx(buy / sell, abs=0.001)


def test_price_change_uses_previous_close_at_0915(client, tables):
    eq = tables["eq"]
    j = get(client, "/api/analysis/MKT", date=D, **{"from": "09:15", "to": "10:00"})
    p = j["spot"]["price"]
    prev_day = [d for d in DAYS if d < D][-1]
    prev_close = eq[(eq.day == prev_day) & (eq.bar == 74)].close.item()
    close_b = eq[(eq.day == D) & (eq.bar == 8)].close.item()
    assert p["start"] == pytest.approx(prev_close) and p["close"] == pytest.approx(close_b)
    assert p["chg_pct"] == pytest.approx((close_b / prev_close - 1) * 100, abs=0.001)
    today = eq[(eq.day == D) & (eq.bar <= 8)]
    assert p["vwap"] == pytest.approx(today.turnover.sum() / today.volume.sum(), abs=0.01)
    assert p["vs_vwap"] == ("above" if close_b > p["vwap"] else "below")

    # mid-day window starts from the close of the bar before it
    q = get(client, "/api/analysis/MKT", date=D, **W)["spot"]["price"]
    assert q["start"] == pytest.approx(eq[(eq.day == D) & (eq.bar == A - 1)].close.item())


# ------------------------------------------------------------------------------- futures

def test_futures_oi_rollover_and_all_expiries(client, tables):
    fut = tables["fut"]
    day, prev = "2025-07-01", "2025-06-30"  # first session after the Jun-26 expiry
    j = get(client, "/api/analysis/MKT", date=day, **{"from": "09:15", "to": "11:00"})
    f = j["futures"]
    assert f["expiry"] == "2025-07-31"

    def oi(e, d, bar):
        return fut[(fut.expiry == e) & (fut.day == d) & (fut.bar == bar)].oi.item()

    b = 20
    jul_start, aug_start = oi("2025-07-31", prev, 74), oi("2025-08-28", prev, 74)
    assert f["oi"]["front"]["start"] == jul_start  # same contract's previous close, not the expired one
    assert f["oi"]["front"]["value"] == oi("2025-07-31", day, b)
    assert f["oi"]["front"]["chg"]["value"] == oi("2025-07-31", day, b) - jul_start
    assert f["oi"]["all"]["expiries"] == 2  # Jun contract has expired
    assert f["oi"]["all"]["start"] == jul_start + aug_start
    assert f["oi"]["all"]["value"] == oi("2025-07-31", day, b) + oi("2025-08-28", day, b)
    assert f["oi"]["front"]["last5"]["value"] == oi("2025-07-31", day, b) - oi("2025-07-31", day, b - 1)

    price_up = f["price"]["chg"] > 0
    oi_up = f["oi"]["front"]["chg"]["value"] > 0
    expected = {(True, True): "long_buildup", (False, True): "short_buildup",
                (True, False): "short_covering", (False, False): "long_unwinding"}[(price_up, oi_up)]
    assert f["oi"]["buildup"] == expected


# ------------------------------------------------------------------------------- options

def test_chain_level_pcr_and_max_pain(client, tables):
    ch = tables["chain"]
    r = ch[(ch.day == D) & (ch.expiry == "2025-07-31") & (ch.bar == B)].iloc[0]
    o = get(client, "/api/analysis/MKT", date=D, **W)["options"]
    assert o["expiry"] == "2025-07-31" and o["front_ok"] and o["rank"] == 0
    assert o["pcr"]["oi"]["value"] == pytest.approx(r.pe_oi / r.ce_oi, abs=0.001)
    assert o["max_pain"]["value"] == r.max_pain
    assert o["atm"] == r.atm_strike
    start = ch[(ch.day == D) & (ch.expiry == "2025-07-31") & (ch.bar == A - 1)].iloc[0]
    assert o["pcr"]["start"] == pytest.approx(start.pe_oi / start.ce_oi, abs=0.001)
    assert o["iv"]["atm"]["value"] == pytest.approx(r.atm_iv * 100, abs=0.01)
    assert o["atm_contracts"]["strike"] == r.atm_strike


def test_chain_rows_and_offset_baseline(client, tables):
    day = "2025-07-10"  # baseline spans the Jun-26 and Jul-31 expiries
    ch, opt = tables["chain"], tables["opt"]
    j = get(client, "/api/chain/MKT", date=day, strikes=2, **W)
    assert j["available"] and j["expiry"] == "2025-07-31"
    assert [r["offset"] for r in j["rows"]] == [-2, -1, 0, 1, 2]
    atm_row = next(r for r in j["rows"] if r["atm"])
    assert atm_row["strike"] == j["atm"]

    def atm_of(d):
        e = front(d)
        return e, ch[(ch.day == d) & (ch.expiry == e) & (ch.bar == B)].atm_strike.item()

    def ce_oi(e, d, k, bar):
        o = opt[e]
        return o[(o.day == d) & (o.strike == k) & (o.right == "CE") & (o.bar == bar)].oi.item()

    e0, k0 = atm_of(day)
    assert k0 == j["atm"]
    today_chg = ce_oi(e0, day, k0, B) - ce_oi(e0, day, k0, A - 1)
    assert atm_row["ce"]["oi_chg"] == today_chg

    base_days = j["baseline"]["days"]
    assert base_days == prior_full_days(day)
    assert {front(d) for d in base_days} == {"2025-06-26", "2025-07-31"}
    base = []
    for d in base_days:  # each baseline day: its own front expiry and its own ATM strike at bar B
        e, k = atm_of(d)
        base.append(abs(ce_oi(e, d, k, B) - ce_oi(e, d, k, A - 1)))
    assert atm_row["ce"]["avg"]["oi_chg"] == pytest.approx(np.mean(base), abs=1)
    assert atm_row["ce"]["x"]["oi_chg"] == pytest.approx(abs(today_chg) / np.mean(base), abs=0.006)

    # max-pain curve: its minimum is the reported max pain
    pain = j["pain"]
    assert pain["strikes"][int(np.argmin(pain["payout"]))] == pain["max_pain"] == j["max_pain"]


def test_chain_days_match_the_chain_and_the_raw_data(client, tables):
    day = "2025-07-10"
    ch, opt = tables["chain"], tables["opt"]
    chain = get(client, "/api/chain/MKT", date=day, strikes=2, **W)
    shared = ("oi_chg", "vol", "iv", "vega", "theta", "gamma", "delta")
    for row in chain["rows"]:
        j = get(client, "/api/chain/MKT/days", date=day, offset=row["offset"], **W)
        assert j["available"] and j["strike"] == row["strike"] and j["offset"] == row["offset"]
        assert j["baseline"]["days"] == chain["baseline"]["days"] and len(j["strikes"]) == j["baseline"]["n"]
        for side in ("ce", "pe"):
            cell, days = row[side], j[side]
            for key in shared:  # the bar graph agrees with the chain's own value, average and ×
                assert days[key]["value"] == cell[key]
                assert days[key]["avg"] == pytest.approx(cell["avg"][key], rel=1e-6, abs=1e-6)
                assert days[key]["x"] == cell["x"][key]
                assert len(days[key]["hist"]) == j["baseline"]["n"]
            assert days["oi"]["value"] == cell["oi"]
            assert days["oi_chg"].get("abs") and not days["oi"].get("abs")  # OI chg compares size; OI compares level

    # OI on each baseline session, recomputed from the store: that day's front expiry, its own ATM strike, bar B
    j = get(client, "/api/chain/MKT/days", date=day, offset=0, **W)
    for i, d in enumerate(j["baseline"]["days"]):
        e = front(d)
        k = ch[(ch.day == d) & (ch.expiry == e) & (ch.bar == B)].atm_strike.item()
        o = opt[e]
        oi = o[(o.day == d) & (o.strike == k) & (o.right == "CE") & (o.bar == B)].oi.item()
        assert j["strikes"][i] == k and j["ce"]["oi"]["hist"][i] == oi


def test_chain_days_follow_the_lookback_and_edges(client):
    j = get(client, "/api/chain/MKT/days", date="2025-07-30", lookback=10, offset=1, **W)
    assert j["baseline"]["n"] == 10 and j["lookback"] == 10 and len(j["ce"]["vol"]["hist"]) == 10
    far = get(client, "/api/chain/MKT/days", date="2025-07-30", offset=25, **W)
    assert far["available"] and far["strike"] is None and far["ce"] is None and far["pe"] is None
    assert not get(client, "/api/chain/EQONLY/days", date=D)["available"]
    assert client.get("/api/chain/MKT/days", params={"offset": 99}).status_code == 422


def test_missing_front_month_options_file(client):
    # GAP has no Jul-31 options file: in early July the chain falls back to Aug-28 (rank 1) with a note
    o = get(client, "/api/analysis/GAP", date="2025-07-10", **W)["options"]
    assert o["available"] and o["expiry"] == "2025-08-28" and o["rank"] == 1 and not o["front_ok"]
    assert any("missing" in n for n in o["notes"])
    # its baseline only uses days whose rank-1 chain exists (July days; June's rank 1 is the missing Jul)
    assert all(d >= "2025-06-27" for d in o["baseline"]["days"])
    # in August the front month exists again; baseline skips July (front chain missing) and goes back to June
    a = get(client, "/api/analysis/GAP", date="2025-08-05", **W)["options"]
    assert a["front_ok"] and a["expiry"] == "2025-08-28"
    assert not any("2025-07-01" <= d <= "2025-07-31" for d in a["baseline"]["days"])


def test_expiry_day_has_no_greeks_and_says_so(client):
    o = get(client, "/api/analysis/MKT", date="2025-07-31", **W)["options"]
    assert o["iv"]["atm"]["value"] is None
    assert any("Expiry day" in n for n in o["notes"])


# ------------------------------------------------------------------------------- edge cases

def test_equity_only_symbol(client):
    j = get(client, "/api/analysis/EQONLY", date=D, **W)
    assert j["spot"]["available"]
    assert not j["futures"]["available"] and not j["options"]["available"]
    assert not get(client, "/api/chain/EQONLY", date=D)["available"]


def test_short_session(client):
    j = get(client, "/api/analysis/MKT", date=SHORT_DAY)
    assert not j["session"]["full"] and any("Short session" in n for n in j["notes"])
    early = get(client, "/api/analysis/MKT", date=SHORT_DAY, **{"from": "09:15", "to": "10:00"})
    assert not early["spot"]["available"] and "No trades" in early["spot"]["reason"]


# ------------------------------------------------------------------------------- series / bars

def test_series_flow_profile(client, tables):
    eq = tables["eq"]
    s = get(client, "/api/series/MKT", src="spot", metric="volume", date=D, **W)
    assert s["kind"] == "flow" and len(s["today"]) == 75 and s["labels"][A] == "09:30"
    today = eq[eq.day == D].set_index("bar").volume
    assert s["today"][10] == today[10]
    base = [eq[(eq.day == d) & (eq.bar == 10)].volume.item() for d in prior_full_days(D)]
    assert s["base"][10] == pytest.approx(np.mean(base), abs=1)
    assert s["today_cum"][A - 1] is None and s["today_cum"][B] == today.loc[A:B].sum()


def test_series_snapshot_profile(client, tables):
    ch = tables["chain"]
    s = get(client, "/api/series/MKT", src="opt", metric="pcr_oi", date=D, **W)
    r = ch[(ch.day == D) & (ch.expiry == "2025-07-31")].set_index("bar")
    assert s["kind"] == "snapshot"
    assert s["today"][B] == pytest.approx(r.pe_oi[B] / r.ce_oi[B], abs=1e-4)
    start = r.pe_oi[A - 1] / r.ce_oi[A - 1]
    assert s["today_chg"][B] == pytest.approx(r.pe_oi[B] / r.ce_oi[B] - start, abs=1e-4)
    for metric in ("oi", "oi_all", "chg", "move", "bs_ratio", "buy", "sell", "turnover"):
        assert get(client, "/api/series/MKT", src="fut", metric=metric, date=D, **W)["metric"] == metric
    for metric in ("max_pain", "atm_iv", "pcr_vol", "ce_oi", "pe_vol"):
        assert get(client, "/api/series/MKT", src="opt", metric=metric, date=D, **W)["metric"] == metric


def test_bars_and_strike(client, tables):
    eq = tables["eq"]
    j = get(client, "/api/bars/MKT", src="spot", date=D, days=2)
    assert [s["date"] for s in j["sessions"]] == [[d for d in DAYS if d < D][-1], D]
    assert len(j["t"]) == 150 and j["t"][1] - j["t"][0] == 300
    today = eq[eq.day == D]
    assert j["vwap"][-1] == pytest.approx(today.turnover.sum() / today.volume.sum(), abs=0.01)
    f = get(client, "/api/bars/MKT", src="fut", date=D)
    assert len(f["oi"]) == 75 and f["expiry"] == ["2025-07-31"]
    k = get(client, "/api/analysis/MKT", date=D)["options"]["atm"]
    s = get(client, "/api/strike/MKT", date=D, expiry="2025-07-31", strike=k, right="pe")
    assert len(s["oi"]) == 75 and s["right"] == "PE" and s["prev_oi"] is not None


# ------------------------------------------------------------------------------- platform

def test_latency_warm(client):
    get(client, "/api/analysis/MKT", date=D, **W)  # warm the symbol caches
    t0 = time.perf_counter()
    get(client, "/api/analysis/MKT", date=D, **{"from": "10:00", "to": "12:00"})  # new window: computed
    computed = time.perf_counter() - t0
    t0 = time.perf_counter()
    get(client, "/api/analysis/MKT", date=D, **{"from": "10:00", "to": "12:00"})  # same window: cached
    cached = time.perf_counter() - t0
    assert computed < 0.3 and cached < 0.05


@pytest.fixture()
def dist(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><title>Analyser</title><div id=root></div>")
    (tmp_path / "assets" / "app.js").write_text("console.log('app')")
    return tmp_path


def secured_client(market_store, dist, clock=None, base_url="http://testserver"):
    app = create_app(market_store, cfg=replace(settings, app_password="s3cret", login_idle_minutes=30), dist=dist)
    if clock:  # swap the gate's clock (the middleware is the gate's bound method)
        gate = next(m.kwargs["dispatch"].__self__ for m in app.user_middleware if "dispatch" in m.kwargs)
        gate.clock = clock
    return TestClient(app, base_url=base_url)


def login(client, password="s3cret", ip="1.2.3.4"):
    return client.post("/api/login", data={"password": password}, headers={"X-Real-IP": ip})


def test_login_gate_hides_everything_but_health_and_login_page(market_store, dist):
    c = secured_client(market_store, dist)
    assert c.get("/api/health").status_code == 200  # health check stays open for Docker / Railway
    assert c.get("/api/symbols").status_code == 401
    assert c.get("/api/session").status_code == 401
    assert c.get("/assets/app.js").status_code == 401  # the app itself is behind the login too
    page = c.get("/?s=MKT")
    assert page.status_code == 401 and 'type="password"' in page.text and "console.log" not in page.text
    assert page.headers["cache-control"] == "no-store" and len(page.content) < 8000
    assert "www-authenticate" not in page.headers  # no browser password box, which would remember it
    assert c.get("/api/symbols", headers={"Authorization": "Basic " + base64.b64encode(b"x:s3cret").decode()}).status_code == 401


def test_login_sets_a_browser_session_cookie(market_store, dist):
    c = secured_client(market_store, dist)
    r = login(c, "nope")
    assert r.status_code == 401 and "sa_session" not in r.cookies
    r = login(c)
    assert r.status_code == 200
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie and "path=/" in cookie
    assert "max-age" not in cookie and "expires" not in cookie  # dropped when the browser closes
    assert "s3cret" not in cookie
    assert c.get("/api/symbols").status_code == 200
    assert c.get("/api/session").json() == {"auth": True, "idle_minutes": 30}
    page = c.get("/?s=MKT")
    assert page.status_code == 200 and "Analyser" in page.text and page.headers["cache-control"] == "no-store"
    assert c.get("/assets/app.js").status_code == 200


def test_cookie_is_secure_behind_https_proxy(market_store, dist):
    c = secured_client(market_store, dist)
    r = c.post("/api/login", data={"password": "s3cret"}, headers={"X-Forwarded-Proto": "https"})
    assert "secure" in r.headers["set-cookie"].lower()


def test_session_ends_after_idle_time_and_slides_with_use(market_store, dist):
    now = [1_000_000.0]
    c = secured_client(market_store, dist, clock=lambda: now[0])
    assert login(c).status_code == 200
    now[0] += 29 * 60
    r = c.get("/api/symbols")  # used within 30 min: still in, and the cookie is renewed
    assert r.status_code == 200 and "sa_session" in r.headers.get("set-cookie", "")
    now[0] += 29 * 60
    assert c.get("/api/symbols").status_code == 200  # 58 min after login, but only 29 idle
    now[0] += 31 * 60
    assert c.get("/api/symbols").status_code == 401  # idle too long
    assert c.get("/").status_code == 401


def test_session_has_a_hard_limit(market_store, dist):
    now = [1_000_000.0]
    c = secured_client(market_store, dist, clock=lambda: now[0])
    assert login(c).status_code == 200
    for _ in range(12 * 3):  # busy for 12 hours, never idle
        now[0] += 20 * 60
        status = c.get("/api/symbols").status_code
    assert status == 401


def test_tampered_or_foreign_cookie_is_refused(market_store, dist):
    c = secured_client(market_store, dist)
    login(c)
    good = c.cookies["sa_session"]
    login_at, exp, sig = good.split(".")
    c.cookies.set("sa_session", f"{login_at}.{int(exp) + 99999}.{sig}")
    assert c.get("/api/symbols").status_code == 401
    other = create_app(market_store, cfg=replace(settings, app_password="different"), dist=dist)
    oc = TestClient(other)
    oc.cookies.set("sa_session", good)  # signed with another password
    assert oc.get("/api/symbols").status_code == 401


def test_wrong_passwords_are_rate_limited_per_client(market_store, dist):
    now = [1_000_000.0]
    c = secured_client(market_store, dist, clock=lambda: now[0])
    details = [login(c, "nope", ip="9.9.9.9").json()["detail"] for _ in range(5)]
    assert details[0] == "Wrong password." and details[3] == "Wrong password. 1 try left." and details[4] == "Wrong password."
    r = login(c, ip="9.9.9.9")  # even the right password waits now
    assert r.status_code == 429 and "Try again in" in r.json()["detail"] and int(r.headers["retry-after"]) > 0
    assert login(c, ip="5.5.5.5").status_code == 200  # other visitors are not affected
    now[0] += 601
    assert login(c, ip="9.9.9.9").status_code == 200


def test_logout_clears_the_session(market_store, dist):
    c = secured_client(market_store, dist)
    login(c)
    assert c.get("/api/symbols").status_code == 200
    r = c.post("/api/logout")
    assert r.status_code == 204 and "sa_session" in r.headers["set-cookie"]
    assert c.get("/api/symbols").status_code == 401


def test_no_password_means_no_gate(market_store, dist):
    c = TestClient(create_app(market_store, cfg=replace(settings, app_password=""), dist=dist))
    assert c.get("/api/symbols").status_code == 200
    assert c.get("/api/session").json() == {"auth": False, "idle_minutes": None}
    assert c.post("/api/login", data={"password": "x"}).status_code in (404, 405)


def test_store_reloads_after_ingest(market_store):
    store = Store(market_store)
    v1 = store.version()
    store.symbol("MKT")
    assert store._symbol.cache_info().currsize == 1
    manifest = market_store / "manifest.json"
    st = manifest.stat()
    os.utime(manifest, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000))
    assert store.version() != v1
    assert store._symbol.cache_info().currsize == 0
