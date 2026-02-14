from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from .routes import router
from contextlib import asynccontextmanager
from .database.db import init_schema
import os


def generate_sdk_unique_id(route: APIRoute):
    # function name
    return route.name


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_schema()
    yield


def create_api():
    api = FastAPI(lifespan=lifespan, generate_unique_id_function=generate_sdk_unique_id)
    api.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,  # Allow cookies and other credentials
        allow_methods=["*"],  # Allow all HTTP methods (GET, POST, PUT, DELETE, etc.)
        allow_headers=["*"],  # Allow all headers
    )
    api.include_router(router=router)

    @api.get("/health")
    def health():
        return "ok"

    # Serve static files if static directory exists (for Docker/production)
    # This allows the FastAPI server to serve the built React frontend
    static_dir = os.path.join(os.path.dirname(__file__), "..", "static")
    if os.path.exists(static_dir):
        # Mount static assets (JS, CSS, images, etc.) at /assets
        assets_dir = os.path.join(static_dir, "assets")
        if os.path.exists(assets_dir):
            api.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
        
        # Serve index.html for root path (only if no API route handles it)
        @api.get("/")
        async def serve_index():
            index_path = os.path.join(static_dir, "index.html")
            if os.path.exists(index_path):
                return FileResponse(index_path)
            return {"message": "Frontend not built"}
        
        # Catch-all route for SPA routing (must be registered last)
        # FastAPI will match more specific routes first, so API routes take precedence
        @api.get("/{full_path:path}")
        async def serve_spa(full_path: str):
            # Explicitly exclude known API paths to avoid conflicts
            api_paths = ["connections", "connection", "buckets", "bucket", "docs", "openapi.json", "redoc"]
            if any(full_path.startswith(path) for path in api_paths):
                from fastapi import HTTPException
                raise HTTPException(status_code=404, detail="Not found")
            
            # Try to serve the static file if it exists
            file_path = os.path.join(static_dir, full_path)
            if os.path.exists(file_path) and os.path.isfile(file_path):
                return FileResponse(file_path)
            
            # For SPA client-side routing, serve index.html
            # This allows React Router to handle the routing
            index_path = os.path.join(static_dir, "index.html")
            if os.path.exists(index_path):
                return FileResponse(index_path)
            
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Not found")

    return api
