"""FastAPI app: JSON API under /api, and the built frontend (frontend/dist) at / when present."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .auth import LoginGate
from .config import PROJECT_ROOT, Settings, settings
from .routes import analysis, series, symbols
from .store import NotFound, Store, StoreMissing
from .window import WindowError

DIST = PROJECT_ROOT / "frontend" / "dist"


def create_app(store_dir: Path | None = None, cfg: Settings = settings, dist: Path = DIST) -> FastAPI:
    app = FastAPI(title="Stock Analyser API", version="1.0", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.state.store = Store(store_dir or cfg.store_dir, cfg.cache_symbols, cfg.cache_expiries, cfg.cache_responses)
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    gate = LoginGate(cfg.app_password, cfg.login_idle_minutes) if cfg.app_password else None
    if gate:  # everything except the health check and the login page needs a login
        app.middleware("http")(gate.middleware)
        app.add_api_route("/api/login", gate.login, methods=["POST"], include_in_schema=False)
        app.add_api_route("/api/logout", gate.logout, methods=["POST"], include_in_schema=False)

    @app.get("/api/session", include_in_schema=False)
    async def session():
        return {"auth": gate is not None, "idle_minutes": cfg.login_idle_minutes if gate else None}

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
            # never cached, so Back after logging out cannot show the app again
            return FileResponse(dist / "index.html", headers={"Cache-Control": "no-store"})

    return app


app = create_app()
