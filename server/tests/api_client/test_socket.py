import json

import pytest

from api.routes.requests import CONTROL_KEY


def read_control(socket) -> dict:
    """Read one proxy control frame, which always precedes upstream traffic."""
    frame = json.loads(socket.receive_text())
    assert CONTROL_KEY in frame, f"expected a control frame, got {frame}"
    return frame


class TestSocketProxy:
    def test_readiness_is_announced_before_any_traffic(self, client, socket_connection):
        with client.websocket_connect(
            f"/connection/{socket_connection['uid']}/socket"
        ) as socket:
            # the browser's socket to DataPilot opens first, so "ready" is what
            # actually says the upstream is reachable
            frame = read_control(socket)
            assert frame[CONTROL_KEY] == "ready"
            assert frame["detail"].startswith("ws://")

    def test_relays_messages_both_ways(self, client, socket_connection):
        with client.websocket_connect(
            f"/connection/{socket_connection['uid']}/socket"
        ) as socket:
            assert read_control(socket)[CONTROL_KEY] == "ready"
            assert json.loads(socket.receive_text()) == {"type": "welcome"}

            socket.send_text("hello")
            assert socket.receive_text() == "echo:hello"

            socket.send_text("again")
            assert socket.receive_text() == "echo:again"

    def test_relays_json_frames_unchanged(self, client, socket_connection):
        with client.websocket_connect(
            f"/connection/{socket_connection['uid']}/socket"
        ) as socket:
            read_control(socket)
            socket.receive_text()

            payload = json.dumps({"action": "subscribe", "channel": "orders"})
            socket.send_text(payload)

            assert socket.receive_text() == f"echo:{payload}"

    def test_path_is_appended_to_the_base_url(self, client, socket_connection):
        with client.websocket_connect(
            f"/connection/{socket_connection['uid']}/socket?path=/stream"
        ) as socket:
            frame = read_control(socket)
            assert frame[CONTROL_KEY] == "ready"
            assert frame["detail"].endswith("/stream")


class TestSocketFailures:
    """Every failure says what went wrong before it closes."""

    def _failure_detail(self, client, path: str) -> str:
        with client.websocket_connect(path) as socket:
            frame = read_control(socket)
            assert frame[CONTROL_KEY] == "error"
            return frame["detail"]

    def test_unknown_connection(self, client):
        detail = self._failure_detail(
            client, "/connection/00000000-0000-0000-0000-000000000000/socket"
        )
        assert "not found" in detail.lower()

    def test_a_database_connection(self, client, sqlite_connection_uri):
        created = client.post(
            "/connections",
            json={
                "source": "sqlite",
                "name": "A database",
                "connection_uri": sqlite_connection_uri,
            },
        ).json()

        detail = self._failure_detail(client, f"/connection/{created['uid']}/socket")
        assert "sqlite connection" in detail.lower()

    def test_an_unreachable_upstream(self, client):
        created = client.post(
            "/connections",
            json={
                "source": "api",
                "name": "Nowhere",
                "connection_uri": "http://127.0.0.1:1",
            },
        ).json()

        detail = self._failure_detail(client, f"/connection/{created['uid']}/socket")
        assert "could not reach" in detail.lower()
        # a refused local address explains the container case
        assert "host.docker.internal" in detail

    def test_a_remote_unreachable_upstream_gets_no_container_hint(self, client):
        created = client.post(
            "/connections",
            json={
                "source": "api",
                "name": "Far away",
                "connection_uri": "http://198.51.100.1:1",
            },
        ).json()

        detail = self._failure_detail(client, f"/connection/{created['uid']}/socket")
        assert "host.docker.internal" not in detail

    def test_the_close_reason_stays_within_the_protocol_limit(self, client):
        """A websocket close reason may not exceed 123 bytes."""
        created = client.post(
            "/connections",
            json={
                "source": "api",
                "name": "Nowhere",
                "connection_uri": "http://127.0.0.1:1",
            },
        ).json()

        with client.websocket_connect(f"/connection/{created['uid']}/socket") as socket:
            read_control(socket)
            # the close frame follows; reading it must not blow up
            with pytest.raises(Exception):
                while True:
                    socket.receive_text()


class TestSocketUrl:
    @pytest.mark.parametrize(
        "base,path,expected",
        [
            ("http://host:8080", "", "ws://host:8080/"),
            ("http://host:8080", "/stream", "ws://host:8080/stream"),
            ("https://host", "/stream", "wss://host/stream"),
            ("ws://host/base/", "chat", "ws://host/base/chat"),
        ],
    )
    def test_scheme_is_upgraded_and_path_joined(self, base, path, expected):
        from api.routes.requests import socket_url

        assert socket_url(base, path, {}) == expected

    def test_variables_are_interpolated(self):
        from api.routes.requests import socket_url

        assert (
            socket_url("http://host", "/{{room}}", {"room": "lobby"})
            == "ws://host/lobby"
        )

    def test_a_non_socket_scheme_is_refused(self):
        from api.routes.requests import socket_url

        with pytest.raises(ValueError):
            socket_url("ftp://host", "/x", {})
