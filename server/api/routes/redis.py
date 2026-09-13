"""Redis: the keyspace, what the server says about itself, and the pub/sub bus."""

from __future__ import annotations

import asyncio
import json
from typing import Annotated, Optional

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect, status

from .. import redis_client, redis_commands
from ..config import SourceConfig
from ..models import (
    RedisChannelListModel,
    RedisCommandModel,
    RedisCommandResultModel,
    RedisInfoModel,
    RedisKeyCreateModel,
    RedisKeyEditModel,
    RedisKeyListModel,
    RedisKeyModel,
    RedisKeyValueModel,
    RedisPublishResultModel,
    RedisRenameModel,
    RedisTtlModel,
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


def require_writable(connection, allow_writes: bool, doing: str):
    """The same promise a read-only SQL connection makes, kept for Redis.

    A connection marked read-only refused writes in the query tab and then
    let the key browser delete whatever it liked, which made the flag mean
    less than it said.
    """
    if getattr(connection, "read_only", True) and not allow_writes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"This connection is read-only, so {doing} was refused. Turn off "
                "read-only on the connection, or allow writes for this tab."
            ),
        )


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
async def delete_key(
    connection_id: str,
    db: DBSession,
    key: Annotated[str, Query()],
    allow_writes: Annotated[bool, Query()] = False,
):
    connection = require_redis(await load_connection(db, connection_id))
    require_writable(connection, allow_writes, f"deleting {key!r}")
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


async def _write_then_read(connection, key: str, write) -> RedisKeyValueModel:
    """Run a write, then hand back the key as it now is.

    Answering with the result means the editor shows what Redis holds rather
    than what it assumed it sent.
    """
    address = address_of(connection)
    try:
        async with await open_redis(connection) as session:
            await write(session)
            value = await session.read(key)
    except Exception as error:
        raise to_http(address, error) from error

    return RedisKeyValueModel(
        connection_id=connection.uid,
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


@router.post(
    "/connection/{connection_id}/redis/keys",
    response_model=RedisKeyValueModel,
    status_code=status.HTTP_201_CREATED,
)
async def create_key(
    connection_id: str,
    body: RedisKeyCreateModel,
    db: DBSession,
    allow_writes: Annotated[bool, Query()] = False,
):
    """Write a new key of any type, or replace one when asked to."""
    connection = require_redis(await load_connection(db, connection_id))
    require_writable(connection, allow_writes, f"writing {body.key!r}")

    return await _write_then_read(
        connection,
        body.key,
        lambda session: session.create(
            body.key,
            body.type,
            value=body.value,
            entries=body.entries,
            members=body.members,
            ttl=body.ttl,
            replace=body.replace,
        ),
    )


@router.patch(
    "/connection/{connection_id}/redis/keys/items", response_model=RedisKeyValueModel
)
async def edit_key(
    connection_id: str,
    body: RedisKeyEditModel,
    db: DBSession,
    allow_writes: Annotated[bool, Query()] = False,
):
    """Change one field, position or member, rather than rewriting the key."""
    connection = require_redis(await load_connection(db, connection_id))
    require_writable(connection, allow_writes, f"changing {body.key!r}")

    item = body.model_dump(exclude={"key", "action"}, exclude_none=True)
    return await _write_then_read(
        connection, body.key, lambda session: session.edit(body.key, body.action, item)
    )


@router.put(
    "/connection/{connection_id}/redis/keys/ttl", response_model=RedisKeyValueModel
)
async def set_ttl(
    connection_id: str,
    body: RedisTtlModel,
    db: DBSession,
    allow_writes: Annotated[bool, Query()] = False,
):
    connection = require_redis(await load_connection(db, connection_id))
    require_writable(connection, allow_writes, f"changing when {body.key!r} expires")

    return await _write_then_read(
        connection, body.key, lambda session: session.expire(body.key, body.ttl)
    )


@router.post(
    "/connection/{connection_id}/redis/keys/rename", response_model=RedisKeyValueModel
)
async def rename_key(
    connection_id: str,
    body: RedisRenameModel,
    db: DBSession,
    allow_writes: Annotated[bool, Query()] = False,
):
    connection = require_redis(await load_connection(db, connection_id))
    require_writable(connection, allow_writes, f"renaming {body.key!r}")

    return await _write_then_read(
        connection,
        body.to,
        lambda session: session.rename(body.key, body.to, body.replace),
    )


@router.post(
    "/connection/{connection_id}/redis/command", response_model=RedisCommandResultModel
)
async def run_command(
    connection_id: str,
    body: RedisCommandModel,
    db: DBSession,
    allow_writes: Annotated[bool, Query()] = False,
):
    """Run one command, the way redis-cli would.

    Only a command known to read runs on a read-only connection. A command
    that empties a database needs `confirm` as well, because one mistyped
    line should not take a cache with it.
    """
    import time

    connection = require_redis(await load_connection(db, connection_id))
    address = address_of(connection)

    try:
        command = redis_commands.parse(body.command)
    except redis_commands.CommandError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
        ) from error

    if command.writes:
        require_writable(connection, allow_writes, f"running {command.name}")
    if command.wipes and not body.confirm:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{command.name} deletes every key in "
                f"{'every database' if command.name == 'FLUSHALL' else 'this database'}. "
                "Confirm it to run it."
            ),
        )

    started = time.perf_counter()
    try:
        async with await open_redis(connection) as session:
            reply = await session.client.execute_command(*command.parts)
    except Exception as error:
        # a reply error is Redis explaining what was wrong with the command,
        # and its own words are the clearest ones available
        from redis.exceptions import ResponseError

        if isinstance(error, ResponseError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"Redis said: {error}"
            ) from error
        raise to_http(address, error) from error

    rendered = redis_commands.render(reply, command.name)
    return RedisCommandResultModel(
        connection_id=connection_id,
        command=" ".join(command.parts),
        reply=rendered,
        kind=redis_commands.kind_of(rendered),
        writes=command.writes,
        elapsed_ms=round((time.perf_counter() - started) * 1000, 2),
        warning=command.warning,
    )


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
