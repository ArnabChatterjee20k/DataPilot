"""Browsing a Redis keyspace, with every type shown as itself."""

import pytest

from api import redis_client


class TestUrls:
    @pytest.mark.parametrize(
        "url,host,port,db,tls",
        [
            ("redis://localhost", "localhost", 6379, 0, False),
            ("redis://localhost:6380", "localhost", 6380, 0, False),
            ("redis://localhost:6379/3", "localhost", 6379, 3, False),
            ("rediss://cache.example.com/1", "cache.example.com", 6379, 1, True),
        ],
    )
    def test_the_address_is_read_out_of_the_url(self, url, host, port, db, tls):
        address = redis_client.parse_url(url)
        assert (address.host, address.port, address.db, address.use_tls) == (
            host,
            port,
            db,
            tls,
        )

    def test_credentials_are_read(self):
        address = redis_client.parse_url("redis://ada:s3cr%40t@host:6379/0")
        assert (address.username, address.password) == ("ada", "s3cr@t")

    def test_something_that_is_not_redis_is_refused(self):
        with pytest.raises(redis_client.RedisError, match="not a Redis address"):
            redis_client.parse_url("postgresql://host/db")

    def test_a_database_that_is_not_a_number_says_so(self):
        """Redis databases are numbered; a name there is a mistake worth naming."""
        with pytest.raises(redis_client.RedisError, match="not a database number"):
            redis_client.parse_url("redis://host:6379/mydb")


class TestConnecting:
    def test_a_redis_connection_can_be_saved(self, client, redis_connection):
        assert redis_connection["source"] == "redis"

    def test_a_bad_url_is_refused_on_save(self, client):
        response = client.post(
            "/connections",
            json={"source": "redis", "name": "Bad", "connection_uri": "http://host"},
        )
        assert response.status_code == 400
        assert "not a Redis address" in response.json()["detail"]

    def test_testing_a_connection_pings_it(self, client, redis_connection_uri):
        response = client.post(
            "/connections/test",
            json={"source": "redis", "connection_uri": redis_connection_uri},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["reachable"] is True
        assert "Redis" in (body["server_version"] or "")

    def test_an_unreachable_server_says_why(self, client):
        response = client.post(
            "/connections/test",
            json={"source": "redis", "connection_uri": "redis://127.0.0.1:1"},
        )
        body = response.json()
        assert body["reachable"] is False
        assert "refused" in body["detail"].lower()
        # a refused local address explains the container case
        assert "host.docker.internal" in body["detail"]

    def test_the_query_endpoints_say_to_use_the_key_browser(
        self, client, redis_connection
    ):
        response = client.get(
            f"/connection/{redis_connection['uid']}/entities/x/queries",
            params={"query": "SELECT 1"},
        )
        assert response.status_code == 400
        assert "key browser" in response.json()["detail"]


class TestScanning:
    def keys_of(self, client, uid, **params) -> dict:
        response = client.get(f"/connection/{uid}/redis/keys", params=params)
        assert response.status_code == 200, response.text
        return response.json()

    def test_the_keyspace_is_listed_with_types(self, client, redis_connection):
        body = self.keys_of(client, redis_connection["uid"], count=1000)
        found = {item["key"]: item for item in body["keys"]}

        assert found["greeting"]["type"] == "string"
        assert found["user:7"]["type"] == "hash"
        assert found["queue:jobs"]["type"] == "list"
        assert found["tags"]["type"] == "set"
        assert found["leaderboard"]["type"] == "zset"
        assert found["events"]["type"] == "stream"
        assert found["leaderboard"]["label"] == "Sorted set"

    def test_a_pattern_narrows_the_listing(self, client, redis_connection):
        body = self.keys_of(client, redis_connection["uid"], pattern="user:*", count=1000)
        assert [item["key"] for item in body["keys"]] == ["user:7"]

    def test_a_pattern_matching_nothing_is_an_empty_answer(
        self, client, redis_connection
    ):
        body = self.keys_of(client, redis_connection["uid"], pattern="nope:*")
        assert body["keys"] == []
        assert body["complete"] is True

    def test_sizes_are_the_element_count_for_a_collection(
        self, client, redis_connection
    ):
        body = self.keys_of(client, redis_connection["uid"], count=1000)
        found = {item["key"]: item for item in body["keys"]}

        assert found["queue:jobs"]["size"] == 3
        assert found["tags"]["size"] == 3
        assert found["leaderboard"]["size"] == 3
        assert found["user:7"]["size"] == 2

    def test_a_ttl_is_reported_and_no_expiry_is_not_an_expiry(
        self, client, redis_connection
    ):
        body = self.keys_of(client, redis_connection["uid"], count=1000)
        found = {item["key"]: item for item in body["keys"]}

        assert found["temporary"]["ttl"] > 0
        # -1 is "no expiry", which is not the same as expired
        assert found["greeting"]["ttl"] == -1

    def test_the_scan_is_cursored(self, client, redis_connection):
        """Paging exists so a big keyspace is never walked in one command."""
        first = self.keys_of(client, redis_connection["uid"], count=2)
        assert len(first["keys"]) <= 2

        seen = {item["key"] for item in first["keys"]}
        cursor = first["cursor"]
        rounds = 0
        while cursor and rounds < 30:
            page = self.keys_of(client, redis_connection["uid"], count=2, cursor=cursor)
            seen.update(item["key"] for item in page["keys"])
            cursor = page["cursor"]
            rounds += 1

        assert "greeting" in seen and "events" in seen


class TestReadingEachType:
    def read(self, client, uid, key) -> dict:
        response = client.get(
            f"/connection/{uid}/redis/keys/value", params={"key": key}
        )
        assert response.status_code == 200, response.text
        return response.json()

    def test_a_string(self, client, redis_connection):
        body = self.read(client, redis_connection["uid"], "greeting")
        assert body["type"] == "string"
        assert body["value"] == "hello"
        assert body["is_text"] is True

    def test_a_binary_string_is_still_readable(self, client, redis_connection):
        """Not everything in Redis is text, and the rest still has to show."""
        body = self.read(client, redis_connection["uid"], "binary")
        assert body["is_text"] is False
        assert body["value"]

    def test_a_hash_keeps_its_fields(self, client, redis_connection):
        body = self.read(client, redis_connection["uid"], "user:7")
        fields = {entry["field"]: entry["value"] for entry in body["entries"]}
        assert fields == {"name": "Ada", "email": "ada@example.com"}

    def test_a_list_keeps_its_order(self, client, redis_connection):
        body = self.read(client, redis_connection["uid"], "queue:jobs")
        assert body["members"] == ["first", "second", "third"]

    def test_a_set_has_members(self, client, redis_connection):
        body = self.read(client, redis_connection["uid"], "tags")
        assert sorted(body["members"]) == ["alpha", "beta", "gamma"]

    def test_a_sorted_set_keeps_its_scores(self, client, redis_connection):
        """A sorted set without its scores is not a sorted set."""
        body = self.read(client, redis_connection["uid"], "leaderboard")
        scored = {entry["member"]: entry["score"] for entry in body["entries"]}
        assert scored == {"bob": 99.0, "ada": 120.5, "carol": 150.0}
        # and in score order, which is the whole point of the type
        assert [entry["member"] for entry in body["entries"]] == ["bob", "ada", "carol"]

    def test_a_stream_keeps_its_entries_and_fields(self, client, redis_connection):
        body = self.read(client, redis_connection["uid"], "events")
        assert len(body["entries"]) == 2
        assert body["entries"][0]["fields"]["kind"] == "signup"
        assert body["entries"][1]["fields"]["kind"] == "login"
        assert "-" in body["entries"][0]["id"]

    def test_a_key_that_is_not_there_says_so(self, client, redis_connection):
        response = client.get(
            f"/connection/{redis_connection['uid']}/redis/keys/value",
            params={"key": "ghost"},
        )
        assert response.status_code == 400
        assert "may have expired" in response.json()["detail"]

    def test_a_key_can_be_deleted(self, client, redis_connection):
        uid = redis_connection["uid"]
        assert (
            client.delete(
                f"/connection/{uid}/redis/keys", params={"key": "greeting"}
            ).status_code
            == 204
        )
        response = client.get(
            f"/connection/{uid}/redis/keys/value", params={"key": "greeting"}
        )
        assert response.status_code == 400

    def test_deleting_a_key_that_is_not_there_is_a_404(self, client, redis_connection):
        response = client.delete(
            f"/connection/{redis_connection['uid']}/redis/keys",
            params={"key": "ghost"},
        )
        assert response.status_code == 404
