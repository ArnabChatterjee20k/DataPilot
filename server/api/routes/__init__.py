from fastapi import APIRouter
from pathlib import Path
from ..config import AppConfig

UPLOAD_DIR = Path(AppConfig.BUCKET_DIR)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

router = APIRouter()

# connections -> databases, apis, etc
# entites -> tables, endpoints, etc
# buckets -> for uploading files(in case of sqlite)

# fields -> columns, payload, etc
# records -> rows, data, etc
# here replacing fields, records with query as it will be a plain query any ways


from .connections import router as ConnectionsRouter
from .bucket import router as BucketRouter
from .queries import router as QueryRouter

router.include_router(ConnectionsRouter)
router.include_router(BucketRouter)
router.include_router(QueryRouter)

__all__ = [router]
