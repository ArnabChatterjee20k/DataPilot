import time

from fastapi import APIRouter, HTTPException, status

from . import UPLOAD_DIR
from ..config import SourceConfig, supports_schemas
from ..models import (
    ConnectionStatusModel,
    ConnectionsModel,
    ConnectionsModelList,
    CreateConnectionsModel,
    UpdateConnectionsModel,
)
from ..database.db import DBSession
from ..database.models import Connections
from ..storage import open_session

router = APIRouter(tags=["connections"])


def to_response(connection) -> ConnectionsModel:
    values = (
        connection.get_values() if hasattr(connection, "get_values") else connection
    )
    return ConnectionsModel(
        uid=values["uid"],
        name=values["name"],
        source=values["source"],
        connection_uri=values["connection_uri"],
        environment=values.get("environment") or "local",
        role=values.get("role") or "primary",
        read_only=bool(values.get("read_only", True)),
        supports_schemas=supports_schemas(values["source"]),
    )


def validate_sqlite_uri(source: str, connection_uri: str) -> None:
    if source != SourceConfig.SQLITE.value:
        return
    if not connection_uri:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A SQLite connection needs an uploaded file. Upload one first.",
        )
    if not (UPLOAD_DIR / connection_uri).exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"SQLite file not found: {connection_uri}. "
                "Upload the file to the bucket first."
            ),
        )


async def load_connection(db: DBSession, connection_uid: str) -> Connections:
    connection = await db.get(Connections, filters=Connections.uid == connection_uid)
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Connection {connection_uid} not found",
        )
    return connection


@router.post("/connections", response_model=ConnectionsModel)
async def create_connection(connection: CreateConnectionsModel, db: DBSession):
    validate_sqlite_uri(connection.source, connection.connection_uri)

    created = await db.create(Connections(**connection.model_dump()))
    await db.commit()
    return to_response(created)


@router.get("/connections", response_model=ConnectionsModelList)
async def list_connections(db: DBSession):
    connections = await db.list(Connections, limit=-1)
    results = [to_response(connection) for connection in connections]
    return ConnectionsModelList(connections=results, total=len(results))


@router.get("/connections/{connection_uid}", response_model=ConnectionsModel)
async def get_connection(connection_uid: str, db: DBSession):
    return to_response(await load_connection(db, connection_uid))


@router.put("/connections/{connection_uid}", response_model=ConnectionsModel)
async def update_connection(
    connection_uid: str,
    connection_update: UpdateConnectionsModel,
    db: DBSession,
):
    connection = await load_connection(db, connection_uid)
    updates = connection_update.model_dump(exclude_unset=True, exclude_none=True)

    source = updates.get("source", connection.source)
    connection_uri = updates.get("connection_uri", connection.connection_uri)
    validate_sqlite_uri(source, connection_uri)

    if updates:
        for field, value in updates.items():
            setattr(connection, field, value)
        await db.update(
            Connections,
            Connections.uid == connection.uid,
            updates,
        )
        await db.commit()

    return to_response(connection)


@router.delete("/connections/{connection_uid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connection(connection_uid: str, db: DBSession):
    await load_connection(db, connection_uid)
    await db.delete(Connections, Connections.uid == connection_uid)
    await db.commit()
    return None


@router.get("/connections/{connection_uid}/status", response_model=ConnectionStatusModel)
async def get_connection_status(connection_uid: str, db: DBSession):
    """Dial the connection and report whether it answers, without running a query."""
    connection = await load_connection(db, connection_uid)

    started = time.perf_counter()
    try:
        async with open_session(connection) as session:
            result = await session.execute(
                "SELECT sqlite_version() AS version"
                if connection.source == SourceConfig.SQLITE.value
                else "SELECT version() AS version"
            )
        rows = result.rows or [{}]
        return ConnectionStatusModel(
            uid=connection_uid,
            reachable=True,
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
            server_version=str(rows[0].get("version")) if rows else None,
        )
    except HTTPException as error:
        return ConnectionStatusModel(
            uid=connection_uid,
            reachable=False,
            detail=str(error.detail),
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
        )
