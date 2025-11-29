from fastapi import APIRouter, Query
from ..config import get_adapter, SourceConfig
from . import UPLOAD_DIR
from ..models import EntityModel, EntityModelList, QueryResult
from ..database.db import DBSession
from ..database.models import Connections
from ..utils import get_initial_rows_query

router = APIRouter(tags=["entities"])


@router.get("/connections/{connection_id}/entities", response_model=EntityModelList)
async def get_entities(connection_id: str, db: DBSession):
    connection = await db.get(Connections, filters=Connections.uid == connection_id)
    if connection.source == SourceConfig.SQLITE.value:
        connection.connection_uri = UPLOAD_DIR / connection.connection_uri
    Adapter = get_adapter(connection.source)
    storage = Adapter(connection_uri=connection.connection_uri)
    async with storage.session() as session:
        result = await session.execute(
            "SELECT name FROM sqlite_master WHERE type=?", ("table",)
        )
        return EntityModelList(
            entities=[EntityModel(**row) for row in result.rows], total=result.rowcount
        )


@router.get(
    "/connection/{connection_id}/entitities/{entity_name}", response_model=QueryResult
)
async def get_rows(connection_id: str, entity_name: str, db: DBSession):
    connection = await db.get(Connections, filters=Connections.uid == connection_id)
    original_connection_uri = connection.connection_uri
    if connection.source == SourceConfig.SQLITE.value:
        connection.connection_uri = UPLOAD_DIR / connection.connection_uri
    Adapter = get_adapter(connection.source)
    storage = Adapter(connection_uri=connection.connection_uri)
    async with storage.session() as session:
        return await get_initial_rows_query(
            session, connection.source, original_connection_uri, entity_name
        )


@router.delete(
    "/connections/{connection_id}/entities/{entity}", response_model=EntityModelList
)
async def get_entities(connection_id: str, db: DBSession):
    connection = await db.get(Connections, filters=Connections.uid == connection_id)
    if connection.source == SourceConfig.SQLITE.value:
        connection.connection_uri = UPLOAD_DIR / connection.connection_uri
    Adapter = get_adapter(connection.source)
    storage = Adapter(connection_uri=connection.connection_uri)
    async with storage.session() as session:
        result = await session.execute(
            "SELECT name FROM sqlite_master WHERE type=?", ("table",)
        )
        return EntityModelList(
            entities=[EntityModel(**row) for row in result.rows], total=result.rowcount
        )
