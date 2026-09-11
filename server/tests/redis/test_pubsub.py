"""The server's own numbers, and the pub/sub bus.

Pub/sub has no replay of any kind: a message published before a subscriber is
registered is gone, with nothing anywhere to say so. That is why "subscribed"
has to mean the server agreed, not that we asked - the same rule the MQTT and
websocket proxies follow.
"""

import json
import threading
import time

import pytest

from api import redis_client
from api.routes.requests import CONTROL_KEY


def read_control(socket, expected: str | None = None) -> dict:
    frame = json.loads(socket.receive_text())
    assert CONTROL_KEY in frame, f"expected a control frame, got {frame}"
    if expected:
        assert frame[CONTROL_KEY] == expected, frame
    return frame


def publish_soon(url: str, channel: str, message: str, delay: float = 0.3):
    """Publish from another thread, once the subscriber is definitely there."""
    import redis as sync_redis

    def send():
        time.sleep(delay)
        client = sync_redis.Redis.from_url(url)
        client.publish(channel, message)
        client.close()

    thread = threading.Thread(target=send, daemon=True)
    thread.start()
    return thread


class TestServerInfo:
    def test_the_dashboard_reports_what_the_server_says(
        self, client, redis_connection
    ):
        response = client.get(f"/connection/{redis_connection['uid']}/redis/info")
        assert response.status_code == 200, response.text
        body = response.json()

        labels = {field["label"]: field["value"] for field in body["fields"]}
        assert "Version" in labels
        assert "Memory used" in labels
        assert "Clients" in labels
        assert body["server"].startswith("redis://")

    def test_the_keyspace_is_counted_per_database(self, client, redis_connection):
        """Redis reports this as `db0: keys=12,...`, which nothing else can read."""
        body = client.get(
            f"/connection/{redis_connection['uid']}/redis/info"
        ).json()

        databases = {item["db"]: item for item in body["keyspace"]}
        assert 0 in databases
        assert databases[0]["keys"] >= 9
        assert databases[0]["expires"] >= 1

    def test_the_hit_rate_is_worked_out(self, client, redis_connection):
        body = client.get(
            f"/connection/{redis_connection['uid']}/redis/info"
        ).json()
        assert body["hit_rate"] is None or 0 <= body["hit_rate"] <= 100

    def test_uptime_is_readable_rather_than_a_second_count(self):
        assert redis_client.readable_uptime(90) == "1m"
        assert redis_client.readable_uptime(3700) == "1h 1m"
        assert redis_client.readable_uptime(90000) == "1d 1h"

    def test_the_keyspace_line_is_parsed_either_way_redis_reports_it(self):
        """Older servers give a string, newer ones a dictionary."""
        as_string = redis_client.keyspace({"db0": "keys=4,expires=1,avg_ttl=0"})
        as_dict = redis_client.keyspace({"db0": {"keys": 4, "expires": 1}})
        assert as_string == as_dict == [{"db": 0, "keys": 4, "expires": 1}]


class TestChannels:
    def test_no_listeners_means_no_channels(self, client, redis_connection):
        """A channel exists only while something is listening to it."""
        body = client.get(
            f"/connection/{redis_connection['uid']}/redis/channels"
        ).json()
        assert body["channels"] == []

    def test_a_subscribed_channel_turns_up_with_its_count(
        self, client, redis_connection, redis_connection_uri
    ):
        import redis as sync_redis

        listener = sync_redis.Redis.from_url(redis_connection_uri)
        pubsub = listener.pubsub()
        pubsub.subscribe("notifications")
        # read the confirmation, so the subscription is really registered
        assert pubsub.get_message(timeout=5)["type"] == "subscribe"

        try:
            body = client.get(
                f"/connection/{redis_connection['uid']}/redis/channels"
            ).json()
            found = {item["channel"]: item["subscribers"] for item in body["channels"]}
            assert found.get("notifications") == 1
        finally:
            pubsub.close()
            listener.close()

    def test_publishing_says_how_many_received_it(self, client, redis_connection):
        response = client.post(
            f"/connection/{redis_connection['uid']}/redis/publish",
            params={"channel": "nobody-here", "message": "hello"},
        )
        assert response.status_code == 200
        # nobody is listening, and saying so is the useful answer
        assert response.json()["received_by"] == 0


class TestSubscribing:
    def test_subscribing_is_confirmed_before_anything_is_reported(
        self, client, redis_connection
    ):
        with client.websocket_connect(
            f"/connection/{redis_connection['uid']}/redis/subscribe?channels=updates"
        ) as socket:
            frame = read_control(socket, "ready")
            detail = json.loads(frame["detail"])
            assert detail["subscribed"] == ["updates"]
            assert detail["server"].startswith("redis://")

    def test_a_message_arrives_on_the_channel_it_was_sent_to(
        self, client, redis_connection, redis_connection_uri
    ):
        with client.websocket_connect(
            f"/connection/{redis_connection['uid']}/redis/subscribe?channels=updates"
        ) as socket:
            read_control(socket, "ready")
            publish_soon(redis_connection_uri, "updates", "something happened")

            message = json.loads(socket.receive_text())
            assert message["channel"] == "updates"
            assert message["payload"] == "something happened"
            assert message["pattern"] is None

    def test_several_channels_at_once(self, client, redis_connection, redis_connection_uri):
        with client.websocket_connect(
            f"/connection/{redis_connection['uid']}/redis/subscribe?channels=one,two"
        ) as socket:
            detail = json.loads(read_control(socket, "ready")["detail"])
            assert sorted(detail["subscribed"]) == ["one", "two"]

            publish_soon(redis_connection_uri, "two", "from two")
            message = json.loads(socket.receive_text())
            assert message["channel"] == "two"

    def test_a_pattern_subscription_reports_which_pattern_matched(
        self, client, redis_connection, redis_connection_uri
    ):
        with client.websocket_connect(
            f"/connection/{redis_connection['uid']}/redis/subscribe?patterns=events:*"
        ) as socket:
            read_control(socket, "ready")
            publish_soon(redis_connection_uri, "events:signup", "user 7")

            message = json.loads(socket.receive_text())
            assert message["channel"] == "events:signup"
            assert message["pattern"] == "events:*"

    def test_subscribing_to_nothing_says_so(self, client, redis_connection):
        with client.websocket_connect(
            f"/connection/{redis_connection['uid']}/redis/subscribe"
        ) as socket:
            frame = read_control(socket, "error")
            assert "channel or a pattern" in frame["detail"]

    def test_a_connection_that_is_not_redis_is_refused(
        self, client, sqlite_connection_uri
    ):
        created = client.post(
            "/connections",
            json={
                "source": "sqlite",
                "name": "A database",
                "connection_uri": sqlite_connection_uri,
            },
        ).json()

        with client.websocket_connect(
            f"/connection/{created['uid']}/redis/subscribe?channels=x"
        ) as socket:
            frame = read_control(socket, "error")
            assert "not a Redis one" in frame["detail"]

    def test_an_unreachable_server_reports_why(self, client):
        created = client.post(
            "/connections",
            json={
                "source": "redis",
                "name": "Nowhere",
                "connection_uri": "redis://127.0.0.1:1",
            },
        ).json()

        with client.websocket_connect(
            f"/connection/{created['uid']}/redis/subscribe?channels=x"
        ) as socket:
            frame = read_control(socket, "error")
            assert "refused" in frame["detail"].lower()

    def test_a_publish_reaches_a_subscriber(
        self, client, redis_connection, redis_connection_uri
    ):
        """Both halves together, which is what the tab is for."""
        uid = redis_connection["uid"]
        with client.websocket_connect(
            f"/connection/{uid}/redis/subscribe?channels=roundtrip"
        ) as socket:
            read_control(socket, "ready")

            sent = client.post(
                f"/connection/{uid}/redis/publish",
                params={"channel": "roundtrip", "message": "there and back"},
            ).json()
            assert sent["received_by"] == 1

            message = json.loads(socket.receive_text())
            assert message["payload"] == "there and back"
