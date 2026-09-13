"""A Redis node in a flow: one command, under the rules the command panel keeps."""

import redis as sync_redis

from api import flows
from tests.api_client.test_flows import (
    constants_node,
    create_flow,
    drain,
    edge,
    read_control,
)

from .conftest import redis_url


def redis_node(node_id, name, connection_id, command, **extra):
    return {
        "id": node_id,
        "name": name,
        "kind": "redis",
        "connection_id": connection_id,
        "command": command,
        **extra,
    }


def writable(client, uri):
    return client.post(
        "/connections",
        json={
            "source": "redis",
            "name": "Writable",
            "connection_uri": uri,
            "read_only": False,
        },
    ).json()


def cache():
    return sync_redis.Redis.from_url(redis_url(), decode_responses=True)


class TestReading:
    def test_a_read_runs_in_a_flow(self, client, redis_connection):
        uid = create_flow(
            client,
            "Read",
            [redis_node("r1", "Greeting", redis_connection["uid"], "GET greeting")],
            [],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, summary = drain(socket)

        assert summary["failed"] == []
        assert states["r1"]["result"]["reply"] == "hello"
        assert states["r1"]["sent"] == "GET greeting"

    def test_a_hash_is_offered_field_by_field(self, client, redis_connection):
        uid = create_flow(
            client,
            "Hash",
            [redis_node("r1", "User", redis_connection["uid"], "HGETALL user:7")],
            [],
        )

        body = client.post(f"/flows/{uid}/nodes/r1/test").json()

        assert body["node"]["state"] == flows.SUCCEEDED, body["node"]["error"]
        assert body["resolved_query"] == "HGETALL user:7"
        offered = {item["reference"]: item["value"] for item in body["offers"]}
        assert offered["{{User.reply.name}}"] == "Ada"

    def test_a_list_is_offered_as_items(self, client, redis_connection):
        uid = create_flow(
            client,
            "List",
            [redis_node("r1", "Jobs", redis_connection["uid"], "LRANGE queue:jobs 0 -1")],
            [],
        )

        body = client.post(f"/flows/{uid}/nodes/r1/test").json()

        assert body["node"]["summary"] == "3 items"
        offered = {item["reference"]: item["value"] for item in body["offers"]}
        assert offered["{{Jobs.first}}"] == "first"

    def test_a_json_value_can_be_read_by_field(self, client, redis_connection):
        client_ = cache()
        client_.set("profile:json", '{"email": "ada@example.com"}')
        client_.close()

        uid = create_flow(
            client,
            "Json",
            [
                redis_node("r1", "Profile", redis_connection["uid"], "GET profile:json"),
                constants_node("c1", "Mail", [("to", "{{Profile.json.email}}")]),
            ],
            [edge("r1", "c1")],
        )

        body = client.post(f"/flows/{uid}/nodes/c1/test").json()

        assert body["node"]["result"]["values"]["to"] == "ada@example.com"


class TestWriting:
    def test_a_reference_with_spaces_stays_one_argument(
        self, client, redis_connection_uri
    ):
        """Splitting after replacing would store `Ada` and choke on `Lovelace`."""
        connection = writable(client, redis_connection_uri)
        uid = create_flow(
            client,
            "Spaces",
            [
                constants_node("c1", "Config", [("who", "Ada Lovelace")]),
                redis_node("r1", "Store", connection["uid"], "SET flow:who {{Config.who}}"),
            ],
            [edge("c1", "r1")],
        )

        body = client.post(f"/flows/{uid}/nodes/r1/test").json()

        assert body["node"]["state"] == flows.SUCCEEDED, body["node"]["error"]
        client_ = cache()
        assert client_.get("flow:who") == "Ada Lovelace"
        client_.close()

    def test_a_write_is_refused_on_a_read_only_connection(self, client, redis_connection):
        uid = create_flow(
            client,
            "Refused",
            [redis_node("r1", "Store", redis_connection["uid"], "SET greeting changed")],
            [],
        )

        body = client.post(f"/flows/{uid}/nodes/r1/test").json()

        assert body["node"]["state"] == flows.FAILED
        assert "read-only" in body["node"]["error"]
        client_ = cache()
        assert client_.get("greeting") == "hello"
        client_.close()

    def test_a_flow_never_empties_the_database(self, client, redis_connection_uri):
        connection = writable(client, redis_connection_uri)
        uid = create_flow(
            client, "Wipe", [redis_node("r1", "Wipe", connection["uid"], "FLUSHDB")], []
        )

        body = client.post(f"/flows/{uid}/nodes/r1/test").json()

        assert body["node"]["state"] == flows.FAILED
        assert "will not run one" in body["node"]["error"]
        client_ = cache()
        assert client_.exists("greeting")
        client_.close()


class TestMistakes:
    def test_a_reply_error_is_redis_explaining(self, client, redis_connection):
        uid = create_flow(
            client,
            "Wrong type",
            [redis_node("r1", "Oops", redis_connection["uid"], "HGETALL greeting")],
            [],
        )

        body = client.post(f"/flows/{uid}/nodes/r1/test").json()

        assert body["node"]["state"] == flows.FAILED
        assert "Redis said" in body["node"]["error"]

    def test_a_blocking_command_is_refused(self, client, redis_connection):
        uid = create_flow(
            client,
            "Blocking",
            [redis_node("r1", "Wait", redis_connection["uid"], "BLPOP queue 0")],
            [],
        )

        body = client.post(f"/flows/{uid}/nodes/r1/test").json()

        assert body["node"]["state"] == flows.FAILED
        assert "blocks" in body["node"]["error"]

    def test_the_command_is_kept_when_the_flow_is_saved(self, client, redis_connection):
        uid = create_flow(
            client,
            "Kept",
            [redis_node("r1", "Get", redis_connection["uid"], "GET greeting")],
            [],
        )

        graph = client.get(f"/flows/{uid}").json()["graph"]

        assert graph["nodes"][0]["command"] == "GET greeting"
