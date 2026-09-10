# Stage 1: build the console
FROM node:22-alpine AS frontend-builder

RUN corepack enable

WORKDIR /app/console

COPY console/package.json console/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY console/ ./
RUN pnpm build

# Stage 2: the API, serving the built console
FROM python:3.12-slim AS backend

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.9.26 /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/venv

WORKDIR /app/server

# dependencies first, so a source change does not reinstall them
COPY server/pyproject.toml server/uv.lock ./
# `uv sync` honours [tool.uv.sources], which is where laserorm comes from;
# `uv pip install -r pyproject.toml` would ignore it and fail to resolve
RUN uv sync --frozen --no-dev --no-install-project

COPY server/ ./
COPY --from=frontend-builder /app/console/dist ./static

ENV PATH="/app/venv/bin:$PATH" \
    MODE=PROD \
    DB_PATH=/app/server/data/config.db \
    BUCKET_DIR=/app/server/data/buckets

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:api", "--host", "0.0.0.0", "--port", "8000"]
