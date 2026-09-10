from fastapi import APIRouter

from ..config import UPLOAD_DIR

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
from .insights import router as InsightsRouter
from .requests import router as RequestsRouter

router.include_router(ConnectionsRouter)
router.include_router(BucketRouter)
router.include_router(QueryRouter)
router.include_router(InsightsRouter)
router.include_router(RequestsRouter)

__all__ = ["router", "UPLOAD_DIR"]
