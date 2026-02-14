# Multi-stage Dockerfile for DataPilot
# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app/console

# Copy package files
COPY console/package.json console/pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy frontend source
COPY console/ ./

# Build frontend
RUN pnpm build

# Stage 2: Python backend
FROM python:3.12-slim AS backend

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install uv
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#installing-uv
COPY --from=ghcr.io/astral-sh/uv:0.9.26 /uv /uvx /bin/

# Compile bytecode
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#compiling-bytecode
ENV UV_COMPILE_BYTECODE=1

# uv Cache
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#caching
ENV UV_LINK_MODE=copy

WORKDIR /app

# Copy backend files
COPY server/ ./server/

# Install Python dependencies
WORKDIR /app/server
RUN uv pip install --system -r pyproject.toml

# Place executables in the environment at the front of the path
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#using-the-environment
ENV PATH="/app/.venv/bin:$PATH"

# Copy built frontend from previous stage
COPY --from=frontend-builder /app/console/dist ./static

# Expose port
EXPOSE 8000

# Create startup script
RUN echo '#!/bin/bash\n\
cd /app/server\n\
# Start FastAPI with uvicorn, serving static files from ./static\n\
exec uvicorn main:api --host 0.0.0.0 --port 8000\n\
' > /app/start.sh && chmod +x /app/start.sh

WORKDIR /app/server

CMD ["/app/start.sh"]
