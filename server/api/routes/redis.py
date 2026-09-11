"""Redis: the keyspace, what the server says about itself, and the pub/sub bus."""

from __future__ import annotations

import asyncio
import json
from typing import Annotated, Optional

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect, status

from .. import redis_client
from ..config import SourceConfig
from ..models import (
    RedisChannelListModel,
    RedisInfoModel,
    RedisKeyListModel,
    RedisKeyModel,
    RedisKeyValueModel,
    RedisPublishResultModel,
)
from ..database.db import DBSession
from .connections import load_connection
from .requests import CONTROL_KEY

router = APIRouter(tags=["redis"])


def require_redis(connection):
    if connection.source != SourceConfig.REDIS.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"'{connection.name}' is a {connection.source} connection, not "
                "a Redis one."
            ),
        )
    return connection


def address_of(connection) -> redis_client.RedisAddress:
    try:
        return redis_client.parse_url(str(connection.connection_uri))
    except redis_client.RedisError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
        ) from error


async def open_redis(connection):
    """A session, with every failure already phrased for a person."""
    return redis_client.RedisSession(address_of(require_redis(connection)))


def to_http(address: redis_client.RedisAddress, error: Exception) -> HTTPException:
    if isinstance(error, HTTPException):
        return error
    if isinstance(error, redis_client.RedisError):
        return HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
        )
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=redis_client.describe_failure(address, error),
    )


@router.get("/connection/{connection_id}/redis/keys", response_model=RedisKeyListModel)
async def scan_keys(
    connection_id: str,
    db: DBSession,
    pattern: Annotated[str, Query()] = "*",
    cursor: Annotated[int, Query(ge=0)] = 0,
    count: Annotated[Optional[int], Query(ge=1, le=redis_client.MAX_PAGE)] = None,
):
    """One page of keys.

    Cursored, because `KEYS *` walks the whole keyspace in a single blocking
    command - which on a real server is an outage rather than a slow page.
    """
    connection = require_redis(await load_connection(db, connection_id))
    address = address_of(connection)

    try:
        async with await open_redis(connection) as session:
            keys, next_cursor = await session.scan_keys(
                pattern=pattern, cursor=cursor, count=redis_client.clamp_page(count)
            )
    except Exception as error:
        raise to_http(address, error) from error

    return RedisKeyListModel(
        connection_id=connection_id,
        pattern=pattern,
        cursor=next_cursor,
        # a zero cursor is Redis saying the scan is complete, which is the
        # only reliable end signal - an empty page is not one
        complete=next_cursor == 0,
        keys=[
            RedisKeyModel(
                key=item.key,
                type=item.type,
                label=item.label,
                ttl=item.ttl,
                size=item.size,
            )
            for item in keys
        ],
    )


@router.get(
    "/connection/{connection_id}/redis/keys/value", response_model=RedisKeyValueModel
)
async def read_key(connection_id: str, db: DBSession, key: Annotated[str, Query()]):
    """One key, shown as whatever it actually is."""
    connection = require_redis(await load_connection(db, connection_id))
    address = address_of(connection)

    try:
        async with await open_redis(connection) as session:
            value = await session.read(key)
    except Exception as error:
        raise to_http(address, error) from error

    return RedisKeyValueModel(
        connection_id=connection_id,
        key=value.key,
        type=value.type,
        label=redis_client.TYPE_LABELS.get(value.type, value.type),
        ttl=value.ttl,
        size=value.size,
        encoding=value.encoding,
        value=value.value,
        is_text=value.is_text,
        entries=value.entries,
        members=value.members,
        truncated=value.truncated,
    )


@router.delete(
    "/connection/{connection_id}/redis/keys",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_key(connection_id: str, db: DBSession, key: Annotated[str, Query()]):
    connection = require_redis(await load_connection(db, connection_id))
    address = address_of(connection)

    try:
        async with await open_redis(connection) as session:
            if not await session.delete(key):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"There is no key called {key!r} to delete.",
                )
    except Exception as error:
        raise to_http(address, error) from error


@router.get("/connection/{connection_id}/redis/info", response_model=RedisInfoModel)
async def server_info(connection_id: str, db: DBSession):
    """What the server reports about itself."""
    connection = require_redis(await load_connection(db, connection_id))
    address = address_of(connection)

    try:
        async with await open_redis(connection) as session:
            info = await session.info()
            patterns = await session.pattern_count()
    except Exception as error:
        raise to_http(address, error) from error

    return RedisInfoModel(
        connection_id=connection_id,
        server=address.display,
        fields=redis_client.summarise(info),
        keyspace=redis_client.keyspace(info),
        hit_rate=redis_client.hit_rate(info),
        pattern_subscriptions=patterns,
    )


@router.get(
    "/connection/{connection_id}/redis/channels", response_model=RedisChannelListModel
)
async def list_channels(
    connection_id: str, db: DBSession, pattern: Annotated[str, Query()] = "*"
):
    """Channels with a subscriber right now.

    Redis has no registry of channel names: a channel exists only while
    something is listening to it, so this is a live picture rather than a list.
    """
    connection = require_redis(await load_connection(db, connection_id))
    address = address_of(connection)

    try:
        async with await open_redis(connection) as session:
            channels = await session.channels(pattern)
            patterns = await session.pattern_count()
    except Exception as error:
        raise to_http(address, error) from error

    return RedisChannelListModel(
        connection_id=connection_id,
        channels=channels,
        pattern_subscriptions=patterns,
    )


@router.post(
    "/connection/{connection_id}/redis/publish", response_model=RedisPublishResultModel
)
async def publish(
    connection_id: str,
    db: DBSession,
    channel: Annotated[str, Query()],
    message: Annotated[str, Query()] = "",
):
    connection = require_redis(await load_connection(db, connection_id))
    address = address_of(connection)

    try:
        async with await open_redis(connection) as session:
            received = await session.publish(channel, message)
    except Exception as error:
        raise to_http(address, error) from error

    return RedisPublishResultModel(
        connection_id=connection_id, channel=channel, received_by=received
    )


@router.websocket("/connection/{connection_id}/redis/subscribe")
async def subscribe(
    websocket: WebSocket,
    connection_id: str,
    channels: Annotated[str, Query()] = "",
    patterns: Annotated[str, Query()] = "",
):
    """Watch messages arrive, live.

    Nothing is reported as subscribed until Redis has confirmed it: a publish
    sent straight after an unconfirmed subscribe goes nowhere, because pub/sub
    has no replay of any kind. This is the same rule the MQTT and websocket
    proxies follow.
    """
    await websocket.accept()

    from ..database.db import storage
    from ..database.models import Connections

    async def control(state: str, detail: str = ""):
        await websocket.send_text(json.dumps({CONTROL_KEY: state, "detail": detail}))

    wanted = [name for name in channels.split(",") if name.strip()]
    wanted_patterns = [name for name in patterns.split(",") if name.strip()]
    if not wanted and not wanted_patterns:
        await control("error", "Give a channel or a pattern to subscribe to.")
        await websocket.close(code=1008)
        return

    try:
        async with storage.session() as session:
            connection = await session.get(
                Connections, filters=Connections.uid == connection_id
            )
    except Exception as error:
        await control("error", f"Could not load the connection: {error}")
        await websocket.close(code=1011)
        return

    if not connection:
        await control("error", "Connection not found")
        await websocket.close(code=1008)
        return
    if connection.source != SourceConfig.REDIS.value:
        await control(
            "error",
            f"'{connection.name}' is a {connection.source} connection, not a Redis one",
        )
        await websocket.close(code=1008)
        return

    try:
        address = redis_client.parse_url(str(connection.connection_uri))
    except redis_client.RedisError as error:
        await control("error", str(error))
        await websocket.close(code=1008)
        return

    session = redis_client.RedisSession(address)
    pubsub = None

    try:
        await session.__aenter__()
        pubsub = session.client.pubsub(ignore_subscribe_messages=False)

        if wanted:
            await pubsub.subscribe(*wanted)
        if wanted_patterns:
            await pubsub.psubscribe(*wanted_patterns)

        # the confirmations come back as messages; reading them is what makes
        # "subscribed" mean the server agreed rather than that we asked
        confirmed: list[str] = []
        expected = len(wanted) + len(wanted_patterns)
        while len(confirmed) < expected:
            message = await asyncio.wait_for(
                pubsub.get_message(timeout=redis_client.COMMAND_TIMEOUT),
                timeout=redis_client.COMMAND_TIMEOUT + 1,
            )
            if message is None:
                break
            if message.get("type") in ("subscribe", "psubscribe"):
                confirmed.append(redis_client.as_text(message.get("channel")))

        if len(confirmed) < expected:
            await control(
                "error",
                f"{address.display} did not confirm the subscription in time.",
            )
            await websocket.close(code=1011)
            return

        await control(
            "ready",
            json.dumps({"server": address.display, "subscribed": confirmed}),
        )

        while True:
            message = await pubsub.get_message(timeout=1.0)
            if message is None:
                continue
            if message.get("type") not in ("message", "pmessage"):
                continue

            await websocket.send_text(
                json.dumps(
                    {
                        "channel": redis_client.as_text(message.get("channel")),
                        "pattern": redis_client.as_text(message.get("pattern"))
                        or None,
                        "payload": redis_client.as_text(message.get("data")),
                        "is_text": redis_client.is_text(message.get("data")),
                    }
                )
            )
    except WebSocketDisconnect:
        return
    except asyncio.CancelledError:
        raise
    except Exception as error:
        try:
            await control("error", redis_client.describe_failure(address, error))
        except Exception:
            pass
    finally:
        if pubsub is not None:
            try:
                await pubsub.aclose()
            except Exception:
                pass
        try:
            await session.__aexit__(None, None, None)
        except Exception:
            pass
        try:
            await websocket.close()
        except Exception:
            pass
