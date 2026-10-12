"""python -m app  →  serve the API (and the built frontend, if present) on HOST:PORT."""
import uvicorn

from .config import settings

if __name__ == "__main__":
    # several worker processes let first-time loads of different stocks run in parallel (the GIL
    # serialises them inside one process); each worker keeps its own caches
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, workers=settings.workers, log_level="info")
