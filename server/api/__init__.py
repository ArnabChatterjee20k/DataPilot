from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.middleware.cors import CORSMiddleware
from .routes import router
from contextlib import asynccontextmanager
from .database.db import init_schema

def generate_sdk_unique_id(route:APIRoute):
    # function name
    return route.name

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_schema()
    yield


def create_api():
    api = FastAPI(lifespan=lifespan,generate_unique_id_function=generate_sdk_unique_id)
    api.add_middleware(CORSMiddleware,allow_origins=["*"],
        allow_credentials=True,  # Allow cookies and other credentials
        allow_methods=["*"],     # Allow all HTTP methods (GET, POST, PUT, DELETE, etc.)
        allow_headers=["*"],     # Allow all headers
)
    api.include_router(router=router)

    @api.get("/")
    @api.get("/health")
    def health():
        return "ok"

    return api
