import asyncio
import time
import uuid
from types import SimpleNamespace
from typing import Optional

import httpx
import websockets

from fastapi import APIRouter, HTTPException, status

from . import UPLOAD_DIR
from .. import http_client, mqtt_client, redis_client
from ..config import SourceConfig, supports_schemas
from ..models import (
    AppwriteJWTRequest,
    AppwriteJWTResult,
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
        # ws:// and wss:// are accepted for a service that only speaks
        # websocket, and mqtt:// for a broker - the proxies resolve each
        if not str(connection_uri or "").startswith(
            ("http://", "https://", "ws://", "wss://", "mqtt://", "mqtts://")
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "An API connection needs a base URL starting with "
                    "http://, https://, ws://, wss://, mqtt:// or mqtts://"
                ),
            )
        return

    if source == SourceConfig.REDIS.value:
        try:
            redis_client.parse_url(connection_uri)
        except redis_client.RedisError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
            ) from error
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


async def probe_broker(
    base: str, started: float, variables: Optional[dict] = None
) -> ConnectionProbeModel:
    """Connect to a broker and disconnect, which is the whole test.

    The connection's variables are honoured, so authentication is exercised as
    it really will be: Appwrite's MQTT push broker rejects an anonymous client,
    and asks instead for a session or JWT over MQTT 5 enhanced authentication.
    Testing without the credential would report a broker that works perfectly
    as unreachable.
    """
    variables = variables or {}
    try:
        address = mqtt_client.parse_broker_url(
            str(http_client.interpolate(base, variables))
        )
    except ValueError as error:
        return ConnectionProbeModel(reachable=False, detail=str(error))

    options = mqtt_client.options_from(variables, address)
    probe_id = options.client_id or mqtt_client.client_id("dp-probe")

    def latency() -> float:
        return round((time.perf_counter() - started) * 1000, 2)

    async def try_connect(opts):
        """Connect, then close: a probe holds nothing open either way."""
        session = mqtt_client.MqttSession(address, opts, identifier=probe_id)
        try:
            await session.connect(timeout=PROBE_TIMEOUT)
            return session, None
        except Exception as error:
            return session, error
        finally:
            await session.close()

    session, error = await try_connect(options)
    # a broker that only speaks 3.1.1 refuses a v5 CONNECT; retry on 3.1.1 the
    # way the live relay does, so the verdict matches what a real session gets
    if error is not None and options.speaks_v5 and session.refused_protocol:
        _fallback, error = await try_connect(
            options.with_protocol(mqtt_client.PROTOCOL_311)
        )

    if error is not None:
        # connect() already phrases both transport and CONNACK failures for a
        # person (bad credentials, unresolved host, a broker that is not up)
        detail = str(error) or mqtt_client.describe_failure(address, error)
        return ConnectionProbeModel(reachable=False, detail=detail, latency_ms=latency())

    return ConnectionProbeModel(
        reachable=True,
        detail=f"Connected to {address.display}",
        latency_ms=latency(),
    )


async def probe_api(
    connection_uri: str, variables: Optional[dict] = None
) -> ConnectionProbeModel:
    """Dial an API connection for real.

    A websocket base is handshaked and closed; an HTTP base is asked for its
    root. Any HTTP answer counts as reachable - a 404 from the base path still
    proves the host is there and talking.
    """
    base = str(connection_uri or "").strip()
    started = time.perf_counter()

    try:
        if mqtt_client.is_mqtt_url(base):
            return await probe_broker(base, started, variables)

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


async def probe_redis(connection_uri: str) -> ConnectionProbeModel:
    """PING, and read back the version while we are there."""
    started = time.perf_counter()
    try:
        address = redis_client.parse_url(connection_uri)
    except redis_client.RedisError as error:
        return ConnectionProbeModel(reachable=False, detail=str(error))

    try:
        async with redis_client.RedisSession(address) as session:
            await session.ping()
            info = await session.info()
        return ConnectionProbeModel(
            reachable=True,
            detail=f"Connected to {address.display}",
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
            server_version=f"Redis {info.get('redis_version', '')}".strip(),
        )
    except Exception as error:
        return ConnectionProbeModel(
            reachable=False,
            detail=redis_client.describe_failure(address, error),
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
        )


async def probe(
    source: str,
    connection_uri: str,
    name: str = "",
    variables: Optional[dict] = None,
) -> ConnectionProbeModel:
    """Open a session and ask the server its version, nothing more."""
    if source == SourceConfig.API.value:
        return await probe_api(connection_uri, variables)
    if source == SourceConfig.REDIS.value:
        return await probe_redis(connection_uri)

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

    return await probe(
        payload.source, payload.connection_uri, variables=payload.variables
    )


def appwrite_base(endpoint: str) -> str:
    """The API root, whether or not the person kept the /v1 on the URL."""
    base = str(endpoint or "").strip().rstrip("/")
    if not base:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An Appwrite endpoint is required, e.g. http://appwrite-traefik/v1.",
        )
    if not base.endswith("/v1"):
        base = f"{base}/v1"
    return base


def appwrite_error(response: httpx.Response, step: str) -> HTTPException:
    """Turn Appwrite's JSON error into one worth showing a person."""
    try:
        message = response.json().get("message") or response.text
    except ValueError:
        message = response.text or f"HTTP {response.status_code}"
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"Appwrite refused to {step}: {message}",
    )


@router.post("/connections/appwrite/jwt", response_model=AppwriteJWTResult)
async def provision_appwrite_jwt(payload: AppwriteJWTRequest):
    """Mint a short-lived Appwrite JWT for a test user.

    The broker validates a client against an Appwrite session or JWT, so a
    connection to it can only be tested with a real one. This is the
    server-side sign-in the load harness uses: create a user, open a session,
    mint a JWT (`users.create` -> `users.create_session` -> `users.create_jwt`).
    The API key authorises this call only and is never stored; only the JWT is
    kept, masked, as the connection's mqtt_auth_data.
    """
    if not payload.api_key.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An API key with the users scope is required to mint a JWT.",
        )

    base = appwrite_base(payload.endpoint)
    headers = {
        "X-Appwrite-Project": payload.project,
        "X-Appwrite-Key": payload.api_key,
        "Content-Type": "application/json",
    }
    email = payload.email or f"datapilot-{uuid.uuid4().hex[:12]}@example.com"
    password = payload.password or uuid.uuid4().hex

    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT) as client:
            created = await client.post(
                f"{base}/users",
                headers=headers,
                json={"userId": "unique()", "email": email, "password": password},
            )
            if created.status_code >= 400:
                raise appwrite_error(created, "create a user")
            user_id = created.json()["$id"]

            session = await client.post(
                f"{base}/users/{user_id}/sessions", headers=headers, json={}
            )
            if session.status_code >= 400:
                raise appwrite_error(session, "open a session")
            session_id = session.json()["$id"]

            minted = await client.post(
                f"{base}/users/{user_id}/jwts",
                headers=headers,
                json={"sessionId": session_id, "duration": 3600},
            )
            if minted.status_code >= 400:
                raise appwrite_error(minted, "mint a JWT")
            jwt = minted.json()["jwt"]
    except httpx.HTTPError as error:
        # the endpoint is dialled from the server, so localhost is this
        # container - the hint points at the usual sibling-container fix
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=http_client.describe_transport_failure(base, error),
        ) from error

    return AppwriteJWTResult(user_id=user_id, jwt=jwt, project=payload.project)


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
    # the stored variables carry the broker's credential, so an authenticated
    # broker reports its true status instead of a permanent "unreachable"
    result = await probe(
        connection.source,
        connection.connection_uri,
        connection.name,
        variables=getattr(connection, "variables", None) or {},
    )
    return ConnectionStatusModel(uid=connection_uid, **result.model_dump())
