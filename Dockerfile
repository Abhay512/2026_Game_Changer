# Stock Analyser: one image serves the API and the website.
# Data is NOT baked in. Either mount a built store at /data/store (docker-compose.yml), or set
# DATA_RELEASE + GITHUB_REPO (+ GITHUB_TOKEN for a private repo) and the store is downloaded from that
# GitHub release into /data/store on start (skipped when it is already there), e.g. on Railway.

# ---- 1. build the website -----------------------------------------------------------------
FROM node:22.14-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- 2. runtime ---------------------------------------------------------------------------
FROM python:3.11.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8000 \
    RAW_DATA_DIR=/data/raw \
    STORE_DIR=/data/store
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/app backend/app
COPY backend/ingest backend/ingest
COPY backend/tools backend/tools
COPY --from=web /web/dist frontend/dist
RUN useradd --create-home --uid 10001 analyser && mkdir -p /data/store && chown -R analyser /data
USER analyser
WORKDIR /app/backend
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('PORT', '8000'), timeout=4)"
CMD ["sh", "-c", "python -m tools.data_release fetch && exec python -m app"]
