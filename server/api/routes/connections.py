import asyncio
import time
from types import SimpleNamespace

import httpx
import websockets

from fastapi import APIRouter, HTTPException, status

from . import UPLOAD_DIR
from .. import http_client
from ..config import SourceConfig, supports_schemas
from ..models import (
    ConnectionProbeModel,
    ConnectionStatusModel,
    ConnectionsModel,
    ConnectionsModelList,
    CreateConnectionsModel,
    TestConnectionModel,
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


def validate_uri(source: str, connection_uri: str) -> None:
    """Reject a connection URI that cannot possibly work for its source."""
    if source == SourceConfig.API.value:
        # ws:// and wss:// are accepted too, for a service that only speaks
        # websocket - the proxy resolves either scheme
        if not str(connection_uri or "").startswith(
            ("http://", "https://", "ws://", "wss://")
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "An API connection needs a base URL starting with "
                    "http://, https://, ws:// or wss://"
                ),
            )
        return

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


VERSION_QUERY = {
    SourceConfig.SQLITE.value: "SELECT sqlite_version() AS version",
    SourceConfig.POSTGRES.value: "SELECT version() AS version",
    SourceConfig.MYSQL.value: "SELECT VERSION() AS version",
}


#: A connection test should answer quickly, or say it could not.
PROBE_TIMEOUT = 10.0


def unreachable_hint(source: str, connection_uri: str, detail: str) -> str:
    """Point at the usual cause when a local address is refused.

    Inside a container `localhost` is the container itself, which is by far the
    most common reason a database that is plainly running looks refused.
    """
    if source == SourceConfig.SQLITE.value:
        return detail
    return http_client.container_hint(connection_uri, detail)


async def probe_api(connection_uri: str) -> ConnectionProbeModel:
    """Dial an API connection for real.

    A websocket base is handshaked and closed; an HTTP base is asked for its
    root. Any HTTP answer counts as reachable - a 404 from the base path still
    proves the host is there and talking.
    """
    base = str(connection_uri or "").strip()
    started = time.perf_counter()

    try:
        if base.startswith(("ws://", "wss://")):
            connection = await asyncio.wait_for(
                websockets.connect(base), timeout=PROBE_TIMEOUT
            )
            await connection.close()
            return ConnectionProbeModel(
                reachable=True,
                detail="WebSocket handshake succeeded",
                latency_ms=round((time.perf_counter() - started) * 1000, 2),
            )

        async with httpx.AsyncClient(
            timeout=PROBE_TIMEOUT, follow_redirects=True
        ) as client:
            response = await client.get(base)
        return ConnectionProbeModel(
            reachable=True,
            detail=f"HTTP {response.status_code} {response.reason_phrase}".strip(),
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
            server_version=response.headers.get("server"),
        )
    except asyncio.TimeoutError:
        return ConnectionProbeModel(
            reachable=False,
            detail=unreachable_hint(
                SourceConfig.API.value,
                base,
                f"Timed out after {PROBE_TIMEOUT:g}s connecting to {base}.",
            ),
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
        )
    except Exception as error:
        return ConnectionProbeModel(
            reachable=False,
            detail=http_client.describe_transport_failure(base, error),
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
        )


async def probe(source: str, connection_uri: str, name: str = "") -> ConnectionProbeModel:
    """Open a session and ask the server its version, nothing more."""
    if source == SourceConfig.API.value:
        return await probe_api(connection_uri)

    probe_target = SimpleNamespace(
        source=source, connection_uri=connection_uri, name=name or "connection"
    )

    started = time.perf_counter()
    try:
        async with open_session(probe_target) as session:
            result = await session.execute(VERSION_QUERY.get(source, "SELECT 1"))
        rows = result.rows or [{}]
        return ConnectionProbeModel(
            reachable=True,
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
            server_version=str(rows[0].get("version")) if rows else None,
        )
    except HTTPException as error:
        return ConnectionProbeModel(
            reachable=False,
            detail=unreachable_hint(source, connection_uri, str(error.detail)),
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
        )


@router.post("/connections/test", response_model=ConnectionProbeModel)
async def test_connection(payload: TestConnectionModel):
    """Dial a connection before saving it, so a typo is caught here rather than
    at the first query."""
    try:
        validate_uri(payload.source, payload.connection_uri)
    except HTTPException as error:
        # testing always answers with a verdict; a bad URI is an unreachable
        # connection, not a failed request
        return ConnectionProbeModel(reachable=False, detail=str(error.detail))

    return await probe(payload.source, payload.connection_uri)


@router.post("/connections", response_model=ConnectionsModel)
async def create_connection(connection: CreateConnectionsModel, db: DBSession):
    validate_uri(connection.source, connection.connection_uri)

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
    validate_uri(source, connection_uri)

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
    result = await probe(
        connection.source, connection.connection_uri, connection.name
    )
    return ConnectionStatusModel(uid=connection_uid, **result.model_dump())
