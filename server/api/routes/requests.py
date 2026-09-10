import asyncio
import json
from typing import Annotated, Optional
from urllib.parse import urlparse, urlunparse

import websockets
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect, status

from .. import http_client, mqtt_client
from ..config import SourceConfig
from ..models import (
    RequestResultModel,
    RequestSpecModel,
    ResponseModel,
    SavedRequestListModel,
    SavedRequestModel,
    SentRequestModel,
    VariablesModel,
)
from ..database.db import DBSession
from ..database.models import ApiRequests
from .connections import load_connection

router = APIRouter(tags=["api-client"])

#: How long the proxy waits for the upstream socket to accept the connection.
SOCKET_CONNECT_TIMEOUT = 15

#: Frames the proxy sends about itself rather than from upstream. The browser
#: has to be told when the *upstream* is up, because its own socket to
#: DataPilot opens first and would otherwise look like success.
CONTROL_KEY = "__datapilot"

#: A websocket close reason may not exceed 123 bytes.
MAX_CLOSE_REASON = 123


async def send_control(websocket: WebSocket, status: str, detail: str = ""):
    await websocket.send_text(
        json.dumps({CONTROL_KEY: status, "detail": detail})
    )


async def fail_socket(websocket: WebSocket, detail: str, code: int = 1011):
    """Report a failure in full, then close.

    The close reason is capped at 123 bytes by the protocol, so the readable
    version goes out as a control frame first and the close carries a summary.
    """
    try:
        await send_control(websocket, "error", detail)
    except Exception:
        pass
    await websocket.close(code=code, reason=detail.encode("utf-8")[:MAX_CLOSE_REASON].decode("utf-8", "ignore"))


def require_api_connection(connection):
    if connection.source != SourceConfig.API.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"'{connection.name}' is a {connection.source} connection. "
                "Requests can only be sent on API connections."
            ),
        )
    return connection


def connection_variables(connection) -> dict:
    return getattr(connection, "variables", None) or {}


def to_saved_model(record) -> SavedRequestModel:
    values = record.get_values()
    return SavedRequestModel(
        uid=values["uid"],
        connection_id=values["connection_id"],
        name=values["name"],
        method=values.get("method") or "GET",
        path=values.get("path") or "",
        params=values.get("params") or [],
        headers=values.get("headers") or [],
        body_type=values.get("body_type") or "none",
        body=values.get("body") or "",
        auth=values.get("auth"),
        position=values.get("position") or 0,
    )


async def run_request(
    spec: RequestSpecModel,
    *,
    base_url: str,
    variables: dict,
    connection_id: str = "",
) -> RequestResultModel:
    """Build and send one request, turning every failure into an explanation.

    Running server-side is what makes this usable at all: the browser cannot
    call an arbitrary origin because of CORS, and any credential it sent would
    be readable by the page.
    """
    try:
        url = http_client.resolve_url(base_url, spec.path, variables)
        params = http_client.active_pairs(
            [pair.model_dump() for pair in spec.params], variables
        )
        headers = http_client.active_pairs(
            [pair.model_dump() for pair in spec.headers], variables
        )
        headers = http_client.apply_auth(
            headers, spec.auth.model_dump() if spec.auth else None, variables
        )
        content, form, content_type = http_client.build_body(
            spec.body_type, spec.body, variables
        )
        if content_type and not any(key.lower() == "content-type" for key, _ in headers):
            headers.append(("Content-Type", content_type))
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
        ) from error

    try:
        sent, received = await http_client.send(
            method=spec.method,
            url=url,
            params=params,
            headers=headers,
            content=content,
            data=form,
            timeout=spec.timeout,
            follow_redirects=spec.follow_redirects,
            verify_tls=spec.verify_tls,
        )
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
        ) from error
    except Exception as error:
        # a request that cannot be delivered is a result to show, not a 500
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=http_client.describe_transport_failure(url, error),
        ) from error

    return RequestResultModel(
        connection_id=connection_id,
        request=SentRequestModel(**vars(sent)),
        response=ResponseModel(**vars(received)),
    )


@router.post("/request", response_model=RequestResultModel)
async def send_ad_hoc_request(spec: RequestSpecModel):
    """Send a one-off request that belongs to no connection.

    A URL you want to try once should not require inventing a connection for
    it, so this takes an absolute URL and no saved base.
    """
    return await run_request(spec, base_url="", variables={})


@router.post(
    "/connection/{connection_id}/request", response_model=RequestResultModel
)
async def send_request(
    connection_id: str,
    spec: RequestSpecModel,
    db: DBSession,
):
    """Send a request against a saved API connection."""
    connection = require_api_connection(await load_connection(db, connection_id))
    return await run_request(
        spec,
        base_url=connection.connection_uri,
        variables=connection_variables(connection),
        connection_id=connection_id,
    )


@router.get(
    "/connection/{connection_id}/requests", response_model=SavedRequestListModel
)
async def list_requests(connection_id: str, db: DBSession):
    await load_connection(db, connection_id)
    records = await db.list(
        ApiRequests, filters=ApiRequests.connection_id == connection_id, limit=-1
    )
    saved = sorted(
        (to_saved_model(record) for record in records),
        key=lambda request: (request.position, request.name.lower()),
    )
    return SavedRequestListModel(requests=saved, total=len(saved))


@router.post(
    "/connection/{connection_id}/requests", response_model=SavedRequestModel
)
async def create_request(connection_id: str, spec: RequestSpecModel, db: DBSession):
    require_api_connection(await load_connection(db, connection_id))

    existing = await db.list(
        ApiRequests, filters=ApiRequests.connection_id == connection_id, limit=-1
    )
    record = await db.create(
        ApiRequests(
            connection_id=connection_id,
            name=spec.name,
            method=spec.method,
            path=spec.path,
            params=[pair.model_dump() for pair in spec.params],
            headers=[pair.model_dump() for pair in spec.headers],
            body_type=spec.body_type,
            body=spec.body if isinstance(spec.body, str) else "",
            auth=spec.auth.model_dump() if spec.auth else None,
            position=len(existing),
        )
    )
    await db.commit()
    return to_saved_model(record)


@router.get(
    "/connection/{connection_id}/requests/{request_uid}",
    response_model=SavedRequestModel,
)
async def get_request(connection_id: str, request_uid: str, db: DBSession):
    await load_connection(db, connection_id)
    record = await db.get(ApiRequests, filters=ApiRequests.uid == request_uid)
    if not record or record.connection_id != connection_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Request {request_uid} not found",
        )
    return to_saved_model(record)


@router.put(
    "/connection/{connection_id}/requests/{request_uid}",
    response_model=SavedRequestModel,
)
async def update_request(
    connection_id: str, request_uid: str, spec: RequestSpecModel, db: DBSession
):
    await load_connection(db, connection_id)
    record = await db.get(ApiRequests, filters=ApiRequests.uid == request_uid)
    if not record or record.connection_id != connection_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Request {request_uid} not found",
        )

    updates = {
        "name": spec.name,
        "method": spec.method,
        "path": spec.path,
        "params": [pair.model_dump() for pair in spec.params],
        "headers": [pair.model_dump() for pair in spec.headers],
        "body_type": spec.body_type,
        "body": spec.body if isinstance(spec.body, str) else "",
        "auth": spec.auth.model_dump() if spec.auth else None,
    }
    for field, value in updates.items():
        setattr(record, field, value)

    await db.update(ApiRequests, ApiRequests.uid == request_uid, updates)
    await db.commit()
    return to_saved_model(record)


@router.delete(
    "/connection/{connection_id}/requests/{request_uid}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_request(connection_id: str, request_uid: str, db: DBSession):
    await load_connection(db, connection_id)
    record = await db.get(ApiRequests, filters=ApiRequests.uid == request_uid)
    if not record or record.connection_id != connection_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Request {request_uid} not found",
        )
    await db.delete(ApiRequests, ApiRequests.uid == request_uid)
    await db.commit()
    return None


def masked_view(variables: dict) -> VariablesModel:
    secret = [name for name in variables if http_client.is_secret_variable(name)]
    return VariablesModel(
        variables={
            name: http_client.mask(value) if name in secret else value
            for name, value in variables.items()
        },
        secret=secret,
    )


def keep_unchanged_secrets(incoming: dict, stored: dict) -> dict:
    """Let an editor save without having to retype every secret.

    Reading gives masked values, so saving them back verbatim would replace
    each secret with its own mask. A value that still equals the mask of what
    is stored means it was never edited.
    """
    merged = dict(incoming)
    for name, value in incoming.items():
        if name in stored and value == http_client.mask(str(stored[name])):
            merged[name] = stored[name]
    return merged


@router.get(
    "/connection/{connection_id}/variables", response_model=VariablesModel
)
async def get_variables(connection_id: str, db: DBSession):
    """Variables for a connection, with secret-looking values masked."""
    connection = await load_connection(db, connection_id)
    return masked_view(connection_variables(connection))


@router.put(
    "/connection/{connection_id}/variables", response_model=VariablesModel
)
async def set_variables(connection_id: str, payload: VariablesModel, db: DBSession):
    from ..database.models import Connections

    connection = await load_connection(db, connection_id)
    variables = keep_unchanged_secrets(
        dict(payload.variables), connection_variables(connection)
    )

    await db.update(
        Connections, Connections.uid == connection_id, {"variables": variables}
    )
    await db.commit()
    connection.variables = variables

    return masked_view(variables)


def describe_socket_failure(url: str, error: Exception) -> str:
    """Turn a driver exception into something worth showing a person."""
    from .connections import unreachable_hint

    text = str(error) or type(error).__name__
    lowered = text.lower()
    if isinstance(error, (ConnectionRefusedError, OSError)) or "refused" in lowered:
        detail = (
            f"Could not reach {url}: the connection was refused. Nothing is "
            "listening on that host and port."
        )
    elif "name or service not known" in lowered or "getaddrinfo" in lowered:
        detail = f"Could not resolve the host in {url}. Check the hostname."
    elif "handshake" in lowered or "invalid status" in lowered:
        detail = (
            f"{url} answered, but not with a websocket handshake: {text}. "
            "Check the path - many servers only speak websocket on one route."
        )
    else:
        detail = f"Could not connect to {url}: {text}"

    return unreachable_hint(SourceConfig.API.value, url, detail)


def socket_url(base_url: str, path: str, variables: dict) -> str:
    """Resolve a websocket URL, upgrading http(s) to ws(s)."""
    resolved = http_client.resolve_url(base_url, path, variables)
    parsed = urlparse(resolved)
    scheme = {"http": "ws", "https": "wss"}.get(parsed.scheme, parsed.scheme)
    if scheme not in ("ws", "wss"):
        raise ValueError(f"Not a websocket URL: {resolved}")
    return urlunparse(parsed._replace(scheme=scheme))


@router.websocket("/connection/{connection_id}/socket")
async def proxy_socket(
    websocket: WebSocket,
    connection_id: str,
    path: Annotated[Optional[str], Query()] = "",
):
    """Pipe a websocket between the browser and the upstream service.

    Same reasoning as the HTTP path: the server holds the upstream socket, so
    the page never needs reachability or credentials of its own.
    """
    await websocket.accept()

    from ..database.db import storage
    from ..database.models import Connections

    try:
        async with storage.session() as session:
            connection = await session.get(
                Connections, filters=Connections.uid == connection_id
            )
    except Exception as error:
        await fail_socket(websocket, f"Could not load the connection: {error}")
        return

    if not connection:
        await fail_socket(websocket, "Connection not found", code=1008)
        return
    if connection.source != SourceConfig.API.value:
        await fail_socket(
            websocket,
            f"'{connection.name}' is a {connection.source} connection, not an API one",
            code=1008,
        )
        return

    try:
        upstream_url = socket_url(
            connection.connection_uri, path or "", connection_variables(connection)
        )
    except ValueError as error:
        await fail_socket(websocket, str(error), code=1008)
        return

    try:
        upstream = await asyncio.wait_for(
            websockets.connect(upstream_url), timeout=SOCKET_CONNECT_TIMEOUT
        )
    except asyncio.TimeoutError:
        await fail_socket(
            websocket,
            f"Timed out after {SOCKET_CONNECT_TIMEOUT}s connecting to {upstream_url}",
        )
        return
    except Exception as error:
        await fail_socket(websocket, describe_socket_failure(upstream_url, error))
        return

    # only now is the connection genuinely usable
    await send_control(websocket, "ready", upstream_url)

    async def browser_to_upstream():
        while True:
            message = await websocket.receive_text()
            await upstream.send(message)

    async def upstream_to_browser():
        async for message in upstream:
            if isinstance(message, bytes):
                message = message.decode("utf-8", errors="replace")
            await websocket.send_text(message)

    tasks = [
        asyncio.create_task(browser_to_upstream()),
        asyncio.create_task(upstream_to_browser()),
    ]
    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        for task in done:
            error = task.exception()
            if error and not isinstance(error, WebSocketDisconnect):
                raise error
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        for task in tasks:
            task.cancel()
        await upstream.close()
        try:
            await websocket.close()
        except RuntimeError:
            pass


@router.websocket("/connection/{connection_id}/mqtt")
async def proxy_mqtt(websocket: WebSocket, connection_id: str):
    """Hold an MQTT session for the browser and relay it over one socket.

    The browser cannot speak MQTT unless the broker happens to expose it over
    websockets, and the credentials would be readable by the page if it did.
    Control frames carry subscribe, publish and unsubscribe in; messages,
    acknowledgements and failures come back out.
    """
    await websocket.accept()

    from ..database.db import storage
    from ..database.models import Connections

    try:
        async with storage.session() as session:
            connection = await session.get(
                Connections, filters=Connections.uid == connection_id
            )
    except Exception as error:
        await fail_socket(websocket, f"Could not load the connection: {error}")
        return

    if not connection:
        await fail_socket(websocket, "Connection not found", code=1008)
        return
    if connection.source != SourceConfig.API.value:
        await fail_socket(
            websocket,
            f"'{connection.name}' is a {connection.source} connection, not an API one",
            code=1008,
        )
        return

    variables = connection_variables(connection)
    try:
        address = mqtt_client.parse_broker_url(
            str(http_client.interpolate(connection.connection_uri, variables))
        )
    except ValueError as error:
        await fail_socket(websocket, str(error), code=1008)
        return

    username, password = mqtt_client.credentials(address, variables)
    session = mqtt_client.MqttSession(
        address, username=username, password=password
    )

    try:
        await session.connect()
    except mqtt_client.MqttError as error:
        await fail_socket(websocket, str(error))
        return
    except Exception as error:
        await fail_socket(websocket, mqtt_client.describe_failure(address, error))
        return

    # only now is there a session; the client id is worth showing, because a
    # broker evicts a session when a second one arrives with the same id
    await send_control(
        websocket, "ready", f"{address.display} as {session.identifier}"
    )

    async def broker_to_browser():
        async for message in session.messages():
            await websocket.send_text(json.dumps(vars(message)))

    async def browser_to_broker():
        while True:
            raw = await websocket.receive_text()
            try:
                command = json.loads(raw)
            except ValueError:
                await send_control(
                    websocket,
                    "error",
                    "That was not a command. Use the topic and payload fields.",
                )
                continue
            await run_mqtt_command(websocket, session, command)

    try:
        await asyncio.gather(broker_to_browser(), browser_to_broker())
    except WebSocketDisconnect:
        pass
    except mqtt_client.MqttError as error:
        await try_control(websocket, "error", str(error))
    except Exception as error:
        await try_control(
            websocket, "error", mqtt_client.describe_failure(address, error)
        )
    finally:
        await session.close()


async def try_control(websocket: WebSocket, status_name: str, detail: str):
    """Report on a socket that may already be gone."""
    try:
        await send_control(websocket, status_name, detail)
    except Exception:
        pass


async def run_mqtt_command(websocket: WebSocket, session, command: dict):
    """Carry out one browser command, and say what happened either way.

    Every branch waits for the broker's acknowledgement, so "subscribed" and
    "published" report agreement rather than that a packet was written.
    """
    action = str(command.get("action") or "").lower()
    topic = str(command.get("topic") or "")
    qos = mqtt_client.normalise_qos(command.get("qos"))

    handlers = {
        "subscribe": (
            lambda: session.subscribe(topic, qos=qos),
            "subscribed",
            lambda: {"topic": topic, "qos": qos},
        ),
        "unsubscribe": (
            lambda: session.unsubscribe(topic),
            "unsubscribed",
            lambda: {"topic": topic},
        ),
        "publish": (
            lambda: session.publish(
                topic,
                str(command.get("payload") or ""),
                qos=qos,
                retain=bool(command.get("retain")),
            ),
            "published",
            lambda: {
                "topic": topic,
                "qos": qos,
                "retain": bool(command.get("retain")),
            },
        ),
    }

    entry = handlers.get(action)
    if not entry:
        await send_control(websocket, "error", f"Unknown command '{action}'")
        return

    run, acknowledged, describe = entry
    try:
        await run()
    except mqtt_client.MqttError as error:
        # a refused command must not cost the session: a typo in a filter
        # should not mean reconnecting
        await send_control(websocket, "error", str(error))
        return
    except Exception as error:
        await send_control(
            websocket, "error", f"Could not {action} '{topic}': {error}"
        )
        return

    await send_control(websocket, acknowledged, json.dumps(describe()))
