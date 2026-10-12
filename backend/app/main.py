"""FastAPI app: JSON API under /api, and the built frontend (frontend/dist) at / when present."""
from __future__ import annotations

import base64
import binascii
import secrets
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .config import PROJECT_ROOT, Settings, settings
from .routes import analysis, series, symbols
from .store import NotFound, Store, StoreMissing
from .window import WindowError

DIST = PROJECT_ROOT / "frontend" / "dist"


def create_app(store_dir: Path | None = None, cfg: Settings = settings, dist: Path = DIST) -> FastAPI:
    app = FastAPI(title="Stock Analyser API", version="1.0", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.state.store = Store(store_dir or cfg.store_dir, cfg.cache_symbols, cfg.cache_expiries, cfg.cache_responses)
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    if cfg.app_password:
        password = cfg.app_password

        @app.middleware("http")
        async def basic_auth(request: Request, call_next):
            if request.url.path == "/api/health":
                return await call_next(request)
            header = request.headers.get("authorization", "")
            if header.startswith("Basic "):
                try:
                    _, _, given = base64.b64decode(header[6:]).decode("utf-8").partition(":")
                except (binascii.Error, UnicodeDecodeError):
                    given = ""
                if secrets.compare_digest(given.encode(), password.encode()):
                    return await call_next(request)
            return Response(status_code=401, headers={"WWW-Authenticate": 'Basic realm="Stock Analyser"'})

    @app.exception_handler(StoreMissing)
    async def _missing(_: Request, exc: StoreMissing):
        return JSONResponse({"detail": str(exc)}, status_code=503)

    @app.exception_handler(NotFound)
    async def _not_found(_: Request, exc: NotFound):
        return JSONResponse({"detail": str(exc)}, status_code=404)

    @app.exception_handler(WindowError)
    async def _bad_window(_: Request, exc: WindowError):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    for module in (symbols, analysis, series):
        app.include_router(module.router)

    if (dist / "index.html").exists():  # production: serve the built single-page app
        if (dist / "assets").is_dir():
            app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            if path.startswith("api/"):
                return JSONResponse({"detail": "Not Found"}, status_code=404)
            target = (dist / path).resolve()
            if path and target.is_file() and dist.resolve() in target.parents:
                return FileResponse(target)
            return FileResponse(dist / "index.html")

    return app


app = create_app()
