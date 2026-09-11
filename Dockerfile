# syntax=docker/dockerfile:1

# Stage 1: build the console
FROM node:22-alpine AS frontend-builder

RUN corepack enable

WORKDIR /app/console

COPY console/package.json console/pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY console/ ./
RUN pnpm build

# Stage 2: resolve and install the Python dependencies
#
# Everything this stage needs - uv, git for the laserorm source, a compiler if
# a wheel is missing - is needed to *build* the environment and never to run
# it, so none of it belongs in the image that ships.
FROM python:3.12-slim AS python-builder

RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.9.26 /uv /bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/venv

WORKDIR /app/server

# dependencies first, so a source change does not reinstall them
COPY server/pyproject.toml server/uv.lock ./
# `uv sync` honours [tool.uv.sources], which is where laserorm comes from;
# `uv pip install -r pyproject.toml` would ignore it and fail to resolve
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# Stage 3: the API, serving the built console
FROM python:3.12-slim AS backend

# a mounted volume is the only thing written at runtime, so the application
# has no reason to run as root
RUN useradd --create-home --uid 10001 datapilot

ENV PATH="/app/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    MODE=PROD \
    DB_PATH=/app/server/data/config.db \
    BUCKET_DIR=/app/server/data/buckets

WORKDIR /app/server

COPY --from=python-builder /app/venv /app/venv
COPY --chown=datapilot:datapilot server/ ./
COPY --from=frontend-builder --chown=datapilot:datapilot /app/console/dist ./static

# the volume mount point has to exist and be writable before the volume is
# attached, or a first run on a fresh host cannot create the database
RUN mkdir -p /app/server/data/buckets && chown -R datapilot:datapilot /app/server/data

USER datapilot

EXPOSE 8000

# urllib rather than curl: it is already in the image, and installing curl
# cost more than the check does
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health', timeout=4).status == 200 else 1)"]

CMD ["uvicorn", "main:api", "--host", "0.0.0.0", "--port", "8000"]
