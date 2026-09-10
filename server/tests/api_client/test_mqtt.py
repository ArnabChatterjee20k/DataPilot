"""The MQTT proxy, against a real broker.

Acknowledgements are the whole point here, so there is nothing to be learned
from a stub: faking a SUBACK is exactly how you ship a client that reports
"subscribed" before the broker agrees.
"""

import json

import pytest

from api import mqtt_client
from api.routes.requests import CONTROL_KEY


def read_control(socket, expected: str | None = None) -> dict:
    frame = json.loads(socket.receive_text())
    assert CONTROL_KEY in frame, f"expected a control frame, got {frame}"
    if expected:
        assert frame[CONTROL_KEY] == expected, frame
    return frame


def read_message(socket) -> dict:
    frame = json.loads(socket.receive_text())
    assert CONTROL_KEY not in frame, f"expected a message, got a control frame: {frame}"
    return frame


def send(socket, **command):
    socket.send_text(json.dumps(command))


class TestBrokerUrls:
    @pytest.mark.parametrize(
        "url,host,port,tls",
        [
            ("mqtt://broker.example.com", "broker.example.com", 1883, False),
            ("mqtt://broker.example.com:1884", "broker.example.com", 1884, False),
            ("mqtts://broker.example.com", "broker.example.com", 8883, True),
            # a broker on the TLS port that is asked for plaintext just hangs up
            ("mqtt://broker.example.com:8883", "broker.example.com", 8883, True),
        ],
    )
    def test_the_address_is_read_out_of_the_url(self, url, host, port, tls):
        address = mqtt_client.parse_broker_url(url)
        assert (address.host, address.port, address.use_tls) == (host, port, tls)

    def test_credentials_in_the_url_are_read(self):
        address = mqtt_client.parse_broker_url("mqtt://ada:s3cr%40t@host:1883")
        assert (address.username, address.password) == ("ada", "s3cr@t")

    def test_variables_win_over_the_url(self):
        """A password in a URL is visible everywhere the URL is; a variable is masked."""
        address = mqtt_client.parse_broker_url("mqtt://ada:old@host")
        assert mqtt_client.credentials(
            address, {"mqtt_username": "eve", "mqtt_password": "new"}
        ) == ("eve", "new")

    def test_a_token_counts_as_a_password(self):
        address = mqtt_client.parse_broker_url("mqtt://host")
        assert mqtt_client.credentials(address, {"mqtt_token": "t-1"}) == (None, "t-1")

    def test_something_that_is_not_a_broker_url_is_refused(self):
        with pytest.raises(ValueError, match="not a broker address"):
            mqtt_client.parse_broker_url("http://host")


class TestClientIds:
    def test_each_connection_gets_its_own(self):
        """A broker evicts the existing session when the id is reused."""
        ids = {mqtt_client.client_id() for _ in range(100)}
        assert len(ids) == 100

    def test_it_fits_what_a_3_1_broker_accepts(self):
        assert len(mqtt_client.client_id()) <= mqtt_client.MAX_CLIENT_ID


class TestTopicValidation:
    @pytest.mark.parametrize("topic", ["a/b", "a/+/b", "a/#", "#", "+", "a/+/#"])
    def test_a_valid_filter_passes(self, topic):
        assert mqtt_client.valid_topic_filter(topic) is None

    @pytest.mark.parametrize(
        "topic,reason",
        [
            ("", "cannot be empty"),
            ("a/x+/b", "matches exactly one whole level"),
            ("a/#/b", "only be the last level"),
            ("a/x#", "matches the rest of the topic"),
        ],
    )
    def test_an_invalid_filter_says_what_is_wrong(self, topic, reason):
        assert reason in (mqtt_client.valid_topic_filter(topic) or "")

    def test_a_wildcard_cannot_be_published_to(self):
        problem = mqtt_client.valid_topic_name("sensors/+/temp")
        assert "belong in a subscription" in (problem or "")


class TestMqttProxy:
    def test_readiness_is_announced_with_the_client_id(self, client, mqtt_connection):
        with client.websocket_connect(
            f"/connection/{mqtt_connection['uid']}/mqtt"
        ) as socket:
            frame = read_control(socket, "ready")
            assert "mqtt://127.0.0.1" in frame["detail"]
            assert "datapilot-" in frame["detail"]

    def test_a_subscribe_is_acknowledged_before_it_is_reported(
        self, client, mqtt_connection
    ):
        with client.websocket_connect(
            f"/connection/{mqtt_connection['uid']}/mqtt"
        ) as socket:
            read_control(socket, "ready")
            send(socket, action="subscribe", topic="sensors/+/temp", qos=1)

            frame = read_control(socket, "subscribed")
            assert json.loads(frame["detail"]) == {"topic": "sensors/+/temp", "qos": 1}

    def test_a_message_published_after_subscribing_comes_back(
        self, client, mqtt_connection
    ):
        with client.websocket_connect(
            f"/connection/{mqtt_connection['uid']}/mqtt"
        ) as socket:
            read_control(socket, "ready")
            send(socket, action="subscribe", topic="sensors/+/temp", qos=1)
            read_control(socket, "subscribed")

            send(socket, action="publish", topic="sensors/1/temp", payload="21.5", qos=1)
            read_control(socket, "published")

            message = read_message(socket)
            assert message["topic"] == "sensors/1/temp"
            assert message["payload"] == "21.5"
            assert message["is_text"] is True

    def test_a_retained_message_carries_its_flag(self, client, mqtt_connection):
        with client.websocket_connect(
            f"/connection/{mqtt_connection['uid']}/mqtt"
        ) as socket:
            read_control(socket, "ready")
            send(
                socket,
                action="publish",
                topic="state/door",
                payload="open",
                qos=1,
                retain=True,
            )
            frame = read_control(socket, "published")
            assert json.loads(frame["detail"])["retain"] is True

        # a new session gets the retained message on subscribing, which is the
        # thing retain is for
        with client.websocket_connect(
            f"/connection/{mqtt_connection['uid']}/mqtt"
        ) as socket:
            read_control(socket, "ready")
            send(socket, action="subscribe", topic="state/door", qos=1)
            read_control(socket, "subscribed")

            message = read_message(socket)
            assert message["topic"] == "state/door"
            assert message["payload"] == "open"
            assert message["retain"] is True

            # an empty retained payload clears it, which is how MQTT forgets
            send(
                socket,
                action="publish",
                topic="state/door",
                payload="",
                qos=1,
                retain=True,
            )
            read_control(socket, "published")

    def test_unsubscribing_stops_the_messages(self, client, mqtt_connection):
        with client.websocket_connect(
            f"/connection/{mqtt_connection['uid']}/mqtt"
        ) as socket:
            read_control(socket, "ready")
            send(socket, action="subscribe", topic="chatter", qos=1)
            read_control(socket, "subscribed")

            send(socket, action="unsubscribe", topic="chatter")
            frame = read_control(socket, "unsubscribed")
            assert json.loads(frame["detail"]) == {"topic": "chatter"}

            # a publish to a topic nobody is subscribed to is acknowledged and
            # nothing comes back
            send(socket, action="publish", topic="chatter", payload="hello", qos=1)
            read_control(socket, "published")

            send(socket, action="subscribe", topic="afterwards", qos=1)
            read_control(socket, "subscribed")

    def test_an_invalid_filter_is_refused_without_dropping_the_session(
        self, client, mqtt_connection
    ):
        with client.websocket_connect(
            f"/connection/{mqtt_connection['uid']}/mqtt"
        ) as socket:
            read_control(socket, "ready")
            send(socket, action="subscribe", topic="a/#/b")

            frame = read_control(socket, "error")
            assert "last level" in frame["detail"]

            # the session survives, so a typo does not cost a reconnect
            send(socket, action="subscribe", topic="a/b", qos=0)
            read_control(socket, "subscribed")

    def test_publishing_to_a_wildcard_is_refused(self, client, mqtt_connection):
        with client.websocket_connect(
            f"/connection/{mqtt_connection['uid']}/mqtt"
        ) as socket:
            read_control(socket, "ready")
            send(socket, action="publish", topic="sensors/+/temp", payload="x")

            frame = read_control(socket, "error")
            assert "belong in a subscription" in frame["detail"]

    def test_an_unknown_command_says_so(self, client, mqtt_connection):
        with client.websocket_connect(
            f"/connection/{mqtt_connection['uid']}/mqtt"
        ) as socket:
            read_control(socket, "ready")
            send(socket, action="explode")

            assert "Unknown command" in read_control(socket, "error")["detail"]


class TestMqttFailures:
    def _failure(self, client, path: str) -> str:
        with client.websocket_connect(path) as socket:
            return read_control(socket, "error")["detail"]

    def test_an_unreachable_broker(self, client):
        created = client.post(
            "/connections",
            json={
                "source": "api",
                "name": "Nowhere",
                "connection_uri": "mqtt://127.0.0.1:1",
            },
        ).json()

        detail = self._failure(client, f"/connection/{created['uid']}/mqtt")
        assert "refused" in detail.lower() or "reach" in detail.lower()
        # a refused local address explains the container case
        assert "host.docker.internal" in detail

    def test_a_connection_that_is_not_a_broker(self, client, api_connection):
        detail = self._failure(client, f"/connection/{api_connection['uid']}/mqtt")
        assert "not a broker address" in detail

    def test_a_database_connection(self, client, sqlite_connection_uri):
        created = client.post(
            "/connections",
            json={
                "source": "sqlite",
                "name": "A database",
                "connection_uri": sqlite_connection_uri,
            },
        ).json()

        detail = self._failure(client, f"/connection/{created['uid']}/mqtt")
        assert "sqlite connection" in detail.lower()


class TestBrokerConnections:
    def test_a_broker_url_can_be_saved_as_an_api_connection(self, client, broker):
        response = client.post(
            "/connections",
            json={"source": "api", "name": "Broker", "connection_uri": broker.base_url},
        )
        assert response.status_code == 200, response.text

    def test_testing_a_broker_connection_dials_it(self, client, broker):
        response = client.post(
            "/connections/test",
            json={"source": "api", "connection_uri": broker.base_url},
        )
        assert response.status_code == 200
        assert response.json()["reachable"] is True

    def test_an_unreachable_broker_reports_why(self, client):
        response = client.post(
            "/connections/test",
            json={"source": "api", "connection_uri": "mqtt://127.0.0.1:1"},
        )
        assert response.json()["reachable"] is False

    def test_a_request_to_a_broker_says_to_use_the_mqtt_tab(
        self, client, mqtt_connection
    ):
        response = client.post(
            f"/connection/{mqtt_connection['uid']}/request", json={"path": ""}
        )
        assert response.status_code == 400
        assert "MQTT tab" in response.json()["detail"]
