import json

import pytest


class TestSocketProxy:
    def test_relays_messages_both_ways(self, client, socket_connection):
        with client.websocket_connect(
            f"/connection/{socket_connection['uid']}/socket"
        ) as socket:
            assert json.loads(socket.receive_text()) == {"type": "welcome"}

            socket.send_text("hello")
            assert socket.receive_text() == "echo:hello"

            socket.send_text("again")
            assert socket.receive_text() == "echo:again"

    def test_relays_json_frames_unchanged(self, client, socket_connection):
        with client.websocket_connect(
            f"/connection/{socket_connection['uid']}/socket"
        ) as socket:
            socket.receive_text()

            payload = json.dumps({"action": "subscribe", "channel": "orders"})
            socket.send_text(payload)

            assert socket.receive_text() == f"echo:{payload}"

    def test_path_is_appended_to_the_base_url(self, client, socket_connection):
        with client.websocket_connect(
            f"/connection/{socket_connection['uid']}/socket?path=/stream"
        ) as socket:
            assert json.loads(socket.receive_text()) == {"type": "welcome"}

    def test_unknown_connection_is_closed(self, client):
        with pytest.raises(Exception):
            with client.websocket_connect(
                "/connection/00000000-0000-0000-0000-000000000000/socket"
            ) as socket:
                socket.receive_text()

    def test_a_database_connection_is_closed(self, client, sqlite_connection_uri):
        created = client.post(
            "/connections",
            json={
                "source": "sqlite",
                "name": "A database",
                "connection_uri": sqlite_connection_uri,
            },
        ).json()

        with pytest.raises(Exception):
            with client.websocket_connect(
                f"/connection/{created['uid']}/socket"
            ) as socket:
                socket.receive_text()

    def test_an_unreachable_upstream_is_closed(self, client):
        created = client.post(
            "/connections",
            json={
                "source": "api",
                "name": "Nowhere",
                "connection_uri": "http://127.0.0.1:1",
            },
        ).json()

        with pytest.raises(Exception):
            with client.websocket_connect(
                f"/connection/{created['uid']}/socket"
            ) as socket:
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
