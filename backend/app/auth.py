"""Password gate for a deployed server (on when APP_PASSWORD is set).

A visitor without a valid session gets only a small login page (or 401 under /api): the app, its scripts
and all data stay behind the login, so strangers cannot make the server do any real work.

A login is a signed session cookie, not the password: it is gone when the browser closes, ends after
LOGIN_IDLE_MINUTES without requests and at most MAX_SESSION_HOURS after login. The signing key is derived
from the password, so every worker process accepts the same cookies and changing APP_PASSWORD signs
everyone out. Wrong passwords are limited per client (counted per worker process).
"""
from __future__ import annotations

import hashlib
import hmac
import time
from collections import deque
from typing import Callable
from urllib.parse import parse_qs

from fastapi import Request
from fastapi.responses import HTMLResponse, JSONResponse, Response

COOKIE = "sa_session"
MAX_SESSION_HOURS = 12
MAX_FAILURES = 5  # wrong passwords per client within FAILURE_WINDOW_S; then that client waits
FAILURE_WINDOW_S = 600
RENEW_AFTER_S = 60  # re-issue the cookie (sliding idle timeout) at most once a minute
OPEN_PATHS = {"/api/health", "/api/login", "/api/logout", "/favicon.svg"}
MAX_BODY = 4096


class LoginGate:
    def __init__(self, password: str, idle_minutes: int, clock: Callable[[], float] = time.time):
        self.password = password.encode()
        self.idle_s = max(1, idle_minutes) * 60
        self.clock = clock
        self.key = hmac.new(self.password, b"stock-analyser session v1", hashlib.sha256).digest()
        self.failures: dict[str, deque[float]] = {}

    # ---------------------------------------------------------------------------- sessions

    def _sign(self, body: str) -> str:
        return hmac.new(self.key, body.encode(), hashlib.sha256).hexdigest()

    def issue(self, login_at: int | None = None) -> str:
        """Token `login_at.expires.signature`; renewing keeps the original login time."""
        now = int(self.clock())
        body = f"{now if login_at is None else login_at}.{now + self.idle_s}"
        return f"{body}.{self._sign(body)}"

    def check(self, token: str | None) -> tuple[int, int] | None:
        """(login_at, expires) of a valid, unexpired token, else None."""
        try:
            login_s, exp_s, sig = (token or "").split(".")
            login_at, exp = int(login_s), int(exp_s)
        except ValueError:
            return None
        if not hmac.compare_digest(sig, self._sign(f"{login_at}.{exp}")):
            return None
        now = self.clock()
        if now >= exp or now - login_at >= MAX_SESSION_HOURS * 3600:
            return None
        return login_at, exp

    def _set_cookie(self, response: Response, request: Request, token: str) -> None:
        # no max_age: a browser-session cookie, dropped when the browser closes
        response.set_cookie(COOKIE, token, httponly=True, samesite="strict", secure=_https(request), path="/")

    # ---------------------------------------------------------------------------- wrong passwords

    @staticmethod
    def client(request: Request) -> str:
        # behind Railway / a reverse proxy the socket peer is the proxy, which passes the visitor's address on
        forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        return request.headers.get("x-real-ip") or forwarded or (request.client.host if request.client else "?")

    def wait_seconds(self, who: str) -> int:
        """How long `who` must wait before the next try (0 = may try now)."""
        now = self.clock()
        q = self.failures.get(who)
        while q and now - q[0] >= FAILURE_WINDOW_S:
            q.popleft()
        if not q:
            self.failures.pop(who, None)
            return 0
        return int(FAILURE_WINDOW_S - (now - q[0])) + 1 if len(q) >= MAX_FAILURES else 0

    def _fail(self, who: str) -> int:
        now = self.clock()
        if len(self.failures) > 10_000:  # bound memory: forget clients whose window has passed
            self.failures = {k: q for k, q in self.failures.items() if now - q[-1] < FAILURE_WINDOW_S}
        q = self.failures.setdefault(who, deque())
        q.append(now)
        return MAX_FAILURES - len(q)

    # ---------------------------------------------------------------------------- endpoints

    async def login(self, request: Request) -> Response:
        who = self.client(request)
        wait = self.wait_seconds(who)
        if wait:
            return JSONResponse({"detail": f"Too many wrong passwords. Try again in {-(-wait // 60)} min."},
                                status_code=429, headers={"Retry-After": str(wait)})
        body = b""
        async for chunk in request.stream():
            body += chunk
            if len(body) > MAX_BODY:
                return JSONResponse({"detail": "Request too large"}, status_code=413)
        given = (parse_qs(body.decode("utf-8", "replace")).get("password") or [""])[0]
        if not hmac.compare_digest(given.encode(), self.password):
            left = self._fail(who)
            hint = f" {left} {'try' if left == 1 else 'tries'} left." if 0 < left <= 2 else ""
            return JSONResponse({"detail": "Wrong password." + hint}, status_code=401)
        self.failures.pop(who, None)
        response = JSONResponse({"ok": True}, headers={"Cache-Control": "no-store"})
        self._set_cookie(response, request, self.issue())
        return response

    def logout(self, request: Request) -> Response:
        response = Response(status_code=204)
        response.delete_cookie(COOKIE, path="/", secure=_https(request), httponly=True, samesite="strict")
        return response

    async def middleware(self, request: Request, call_next):
        path = request.url.path
        if path in OPEN_PATHS:
            return await call_next(request)
        session = self.check(request.cookies.get(COOKIE))
        if session is None:
            if path.startswith("/api/"):
                return JSONResponse({"detail": "Login required"}, status_code=401)
            if path.startswith("/assets/"):
                return Response(status_code=401)
            return HTMLResponse(LOGIN_PAGE.replace("{IDLE}", str(self.idle_s // 60)), status_code=401,
                                headers={"Cache-Control": "no-store"})
        response = await call_next(request)
        login_at, exp = session
        if self.clock() - (exp - self.idle_s) >= RENEW_AFTER_S:
            self._set_cookie(response, request, self.issue(login_at))
        return response


def _https(request: Request) -> bool:
    return request.headers.get("x-forwarded-proto", request.url.scheme) == "https"


# Self-contained (the app's own CSS and scripts are behind the login). Colours are the app's theme tokens.
LOGIN_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>Analyser · Log in</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<script>
  try {
    var t = localStorage.getItem("sa.theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
</script>
<style>
  :root { color-scheme: light; --page: #f4f3ef; --surface: #fcfcfb; --ink-1: #0b0b0b; --ink-2: #52514e;
    --ink-3: #807e78; --border: rgba(11, 11, 11, 0.1); --border-strong: rgba(11, 11, 11, 0.2);
    --accent: #2a78d6; --accent-wash: rgba(42, 120, 214, 0.1); --up: #0a8f84; --down: #dc4b2c;
    --down-ink: #b83a1f; --btn: #1c5cab; --on-btn: #fff; }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) { color-scheme: dark; --page: #0f0f0e; --surface: #1a1a19;
      --ink-1: #f0efec; --ink-2: #c3c2b7; --ink-3: #8f8d86; --border: rgba(255, 255, 255, 0.1);
      --border-strong: rgba(255, 255, 255, 0.2); --accent: #3987e5; --accent-wash: rgba(57, 135, 229, 0.14);
      --up: #22a090; --down: #ea6440; --down-ink: #f08a6c; --btn: #3987e5; --on-btn: #0f0f0e; }
  }
  :root[data-theme="dark"] { color-scheme: dark; --page: #0f0f0e; --surface: #1a1a19; --ink-1: #f0efec;
    --ink-2: #c3c2b7; --ink-3: #8f8d86; --border: rgba(255, 255, 255, 0.1); --border-strong: rgba(255, 255, 255, 0.2);
    --accent: #3987e5; --accent-wash: rgba(57, 135, 229, 0.14); --up: #22a090; --down: #ea6440; --down-ink: #f08a6c;
    --btn: #3987e5; --on-btn: #0f0f0e; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--page);
    color: var(--ink-1); font: 14px/1.45 "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width: 100%; max-width: 340px; background: var(--surface); border: 1px solid var(--border);
    border-radius: 6px; padding: 24px; }
  .brand { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; font-weight: 600; font-size: 15px; }
  .brand svg { width: 22px; height: 22px; }
  label { display: block; color: var(--ink-2); margin-bottom: 6px; }
  input { width: 100%; height: 38px; padding: 0 10px; border: 1px solid var(--border-strong); border-radius: 4px;
    background: var(--page); color: var(--ink-1); font: inherit; }
  input:focus, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  button { width: 100%; height: 38px; margin-top: 12px; border: 0; border-radius: 4px; background: var(--btn);
    color: var(--on-btn); font: inherit; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: default; }
  .msg { min-height: 20px; margin: 10px 0 0; color: var(--down-ink); }
  .note { margin: 14px 0 0; color: var(--ink-3); font-size: 12px; }
</style>
</head>
<body>
<main>
  <div class="brand">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4v16M12 2v20M18 6v12" stroke="var(--ink-3)" stroke-width="1.5" stroke-linecap="round"/>
      <rect x="4" y="8" width="4" height="7" rx="1" fill="var(--up)"/>
      <rect x="10" y="5" width="4" height="9" rx="1" fill="var(--down)"/>
      <rect x="16" y="9" width="4" height="5" rx="1" fill="var(--up)"/>
    </svg>
    Analyser
  </div>
  <form id="f" autocomplete="off">
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="off" required autofocus>
    <button id="go" type="submit">Log in</button>
    <p class="msg" id="msg" role="alert"></p>
  </form>
  <noscript><p class="msg">This site needs JavaScript.</p></noscript>
  <p class="note">You will be asked again after you close the browser, after {IDLE} minutes without use, or when you log out.</p>
</main>
<script>
  var f = document.getElementById("f"), pw = document.getElementById("pw"),
      go = document.getElementById("go"), msg = document.getElementById("msg");
  f.addEventListener("submit", function (e) {
    e.preventDefault();
    go.disabled = true;
    msg.textContent = "";
    fetch("/api/login", { method: "POST", body: new URLSearchParams({ password: pw.value }), credentials: "same-origin" })
      .then(function (r) {
        if (r.ok) { pw.value = ""; location.reload(); return; }
        return r.json().catch(function () { return {}; }).then(function (d) {
          msg.textContent = d.detail || "Could not log in.";
          go.disabled = false;
          pw.select();
        });
      })
      .catch(function () { msg.textContent = "Network error. Try again."; go.disabled = false; });
  });
</script>
</body>
</html>
"""
