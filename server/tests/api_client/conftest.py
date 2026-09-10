"""A real upstream service for the API client to call.

The point of the client is to send requests over the network, so the tests do
exactly that against a small server started in-process rather than mocking
httpx and asserting on the mock.
"""

import asyncio
import json
import socket
import threading
import time

import pytest
import uvicorn
import websockets
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, PlainTextResponse


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def build_upstream() -> FastAPI:
    app = FastAPI()

    @app.get("/ping")
    async def ping():
        return {"pong": True}

    @app.api_route(
        "/echo", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
    )
    async def echo(request: Request):
        body = (await request.body()).decode("utf-8", errors="replace")
        return JSONResponse(
            {
                "method": request.method,
                "path": request.url.path,
                "query": dict(request.query_params),
                "headers": {
                    key.lower(): value for key, value in request.headers.items()
                },
                "body": body,
            }
        )

    @app.get("/text")
    async def text():
        return PlainTextResponse("plain body")

    @app.get("/binary")
    async def binary():
        return Response(content=bytes([0, 1, 2, 3, 255]), media_type="image/png")

    @app.get("/status/{code}")
    async def status_code(code: int):
        return JSONResponse({"code": code}, status_code=code)

    @app.get("/slow")
    async def slow():
        await asyncio.sleep(2)
        return {"done": True}

    @app.get("/redirect")
    async def redirect():
        return Response(status_code=307, headers={"location": "/ping"})

    return app


class UpstreamServer:
    """uvicorn in a background thread, so the client really goes over TCP."""

    def __init__(self, app, port: int):
        self.port = port
        config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    def start(self, timeout: float = 15):
        self.thread.start()
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.server.started:
                return
            time.sleep(0.05)
        raise RuntimeError("upstream server did not start")

    def stop(self):
        self.server.should_exit = True
        self.thread.join(timeout=10)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"


@pytest.fixture(scope="session")
def upstream():
    server = UpstreamServer(build_upstream(), free_port())
    server.start()
    yield server
    server.stop()


class EchoSocketServer:
    """A websocket echo server, run on its own loop in a background thread."""

    def __init__(self, port: int):
        self.port = port
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.ready = threading.Event()

    async def _handler(self, connection):
        await connection.send(json.dumps({"type": "welcome"}))
        async for message in connection:
            await connection.send(f"echo:{message}")

    def _run(self):
        asyncio.set_event_loop(self.loop)

        async def serve():
            async with websockets.serve(self._handler, "127.0.0.1", self.port):
                self.ready.set()
                await asyncio.Future()

        self.loop.run_until_complete(serve())

    def start(self):
        self.thread.start()
        if not self.ready.wait(timeout=15):
            raise RuntimeError("echo socket server did not start")

    def stop(self):
        self.loop.call_soon_threadsafe(self.loop.stop)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"


@pytest.fixture(scope="session")
def echo_socket():
    server = EchoSocketServer(free_port())
    server.start()
    yield server
    server.stop()


class Broker:
    """A real MQTT broker, run on its own loop in a background thread.

    The MQTT tests are about acknowledgements and retained messages, which a
    stub would have to fake - and faking them is exactly how you ship a client
    that reports "subscribed" before the broker agrees.
    """

    def __init__(self, port: int):
        self.port = port
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.ready = threading.Event()
        self.broker = None

    def _run(self):
        asyncio.set_event_loop(self.loop)
        from amqtt.broker import Broker as AmqttBroker

        async def serve():
            self.broker = AmqttBroker(
                {
                    "listeners": {
                        "default": {
                            "type": "tcp",
                            "bind": f"127.0.0.1:{self.port}",
                            "max_connections": 50,
                        }
                    },
                    "sys_interval": 0,
                    "auth": {"allow-anonymous": True},
                    "topic-check": {"enabled": False},
                }
            )
            await self.broker.start()
            self.ready.set()
            await asyncio.Future()

        try:
            self.loop.run_until_complete(serve())
        except (RuntimeError, asyncio.CancelledError):
            pass

    def start(self):
        self.thread.start()
        if not self.ready.wait(timeout=30):
            raise RuntimeError("broker did not start")

    def stop(self):
        self.loop.call_soon_threadsafe(self.loop.stop)

    @property
    def base_url(self) -> str:
        return f"mqtt://127.0.0.1:{self.port}"


@pytest.fixture(scope="session")
def broker():
    server = Broker(free_port())
    server.start()
    yield server
    server.stop()


@pytest.fixture()
def mqtt_connection(client, broker):
    response = client.post(
        "/connections",
        json={
            "source": "api",
            "name": "Broker",
            "connection_uri": broker.base_url,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture()
def sqlite_connection_uri(client):
    """A minimal SQLite upload, for asserting the API routes refuse databases."""
    import io
    import sqlite3
    import tempfile
    from pathlib import Path

    temp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    temp.close()
    path = Path(temp.name)
    connection = sqlite3.connect(str(path))
    connection.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)")
    connection.commit()
    connection.close()

    response = client.post(
        "/bucket",
        files={
            "file": (path.name, io.BytesIO(path.read_bytes()), "application/octet-stream")
        },
    )
    path.unlink(missing_ok=True)
    assert response.status_code == 200, response.text
    return response.json()["connection_uri"]


@pytest.fixture()
def api_connection(client, upstream):
    """An API connection pointing at the upstream server."""
    response = client.post(
        "/connections",
        json={
            "source": "api",
            "name": "Upstream",
            "connection_uri": upstream.base_url,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture()
def socket_connection(client, echo_socket):
    response = client.post(
        "/connections",
        json={
            "source": "api",
            "name": "Echo socket",
            "connection_uri": echo_socket.base_url,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()
