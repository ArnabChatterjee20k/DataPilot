from fastapi import APIRouter, Query
from typing import Annotated, Optional
from ..config import get_adapter, SourceConfig
from . import UPLOAD_DIR
from ..models import QueryResult
from ..database.db import DBSession
from ..database.models import Connections

router = APIRouter(tags=["queries"])


@router.get(
    "/connection/{connection_id}/entitities/{entity_name}/queries",
    response_model=QueryResult,
)
async def execute_query(
    connection_id: str,
    entity_name: str,
    db: DBSession,
    query: Annotated[str, Query()],
    limit: Annotated[Optional[int], Query()] = None,
    offset: Annotated[Optional[int], Query()] = None,
):
    connection = await db.get(Connections, filters=Connections.uid == connection_id)
    if connection.source == SourceConfig.SQLITE.value:
        connection.connection_uri = UPLOAD_DIR / connection.connection_uri
    Adapter = get_adapter(connection.source)
    storage = Adapter(connection_uri=connection.connection_uri)
    async with storage.session() as session:
        # Execute query as-is (frontend controls pagination in SQL)
        result = await session.execute(query, force_commit=True)
        return QueryResult(
            rows=result.rows,
            columns=result.description or [],
            entity_name=entity_name,
            connection_id=connection_id,
            query=query,
            limit=limit,
            offset=offset,
        )
