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
        """Paging exists so a big keyspace is never walked in one command.

        A page can hold more than `count` keys: COUNT is a hint, and one hash
        bucket may hand back several. This used to insist a page never did,
        which is the trim that silently lost keys. What matters is that the
        walk sees every key, and that it took more than one page to do it.
        """
        first = self.keys_of(client, redis_connection["uid"], count=2)

        seen = {item["key"] for item in first["keys"]}
        cursor = first["cursor"]
        rounds = 1
        while cursor and rounds < 30:
            page = self.keys_of(client, redis_connection["uid"], count=2, cursor=cursor)
            seen.update(item["key"] for item in page["keys"])
            cursor = page["cursor"]
            rounds += 1

        assert rounds > 1
        assert {
            "greeting", "counter", "temporary", "binary", "user:7",
            "queue:jobs", "tags", "leaderboard", "events",
        } <= seen


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
                f"/connection/{uid}/redis/keys",
                params={"key": "greeting", "allow_writes": True},
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
            params={"key": "ghost", "allow_writes": True},
        )
        assert response.status_code == 404


def write(client, uid, path, method="post", **params):
    """A write, with writes allowed, since the test connection is read-only."""
    json = params.pop("json", None)
    return getattr(client, method)(
        f"/connection/{uid}/redis/{path}",
        params={"allow_writes": True, **params},
        json=json,
    )


class TestReadOnly:
    """A read-only connection keeps its promise in the key browser too."""

    def test_a_delete_is_refused_without_writes_allowed(self, client, redis_connection):
        response = client.delete(
            f"/connection/{redis_connection['uid']}/redis/keys",
            params={"key": "greeting"},
        )

        assert response.status_code == 403
        assert "read-only" in response.json()["detail"]
        # and the key is still there
        assert (
            client.get(
                f"/connection/{redis_connection['uid']}/redis/keys/value",
                params={"key": "greeting"},
            ).status_code
            == 200
        )

    def test_a_create_is_refused_without_writes_allowed(self, client, redis_connection):
        response = client.post(
            f"/connection/{redis_connection['uid']}/redis/keys",
            json={"key": "new", "type": "string", "value": "x"},
        )

        assert response.status_code == 403

    def test_a_writable_connection_needs_no_flag(self, client, redis_connection_uri):
        created = client.post(
            "/connections",
            json={
                "source": "redis",
                "name": "Writable",
                "connection_uri": redis_connection_uri,
                "read_only": False,
            },
        ).json()

        response = client.post(
            f"/connection/{created['uid']}/redis/keys",
            json={"key": "fresh", "type": "string", "value": "yes"},
        )

        assert response.status_code == 201


class TestCreatingKeys:
    """Every type can be created, and none can be clobbered by accident."""

    def test_a_string(self, client, redis_connection):
        response = write(
            client, redis_connection["uid"], "keys",
            json={"key": "note", "type": "string", "value": "hello there"},
        )

        assert response.status_code == 201, response.text
        assert response.json()["value"] == "hello there"

    def test_a_hash(self, client, redis_connection):
        response = write(
            client, redis_connection["uid"], "keys",
            json={
                "key": "user:9",
                "type": "hash",
                "entries": [{"field": "name", "value": "Grace"}],
            },
        )

        assert response.json()["entries"] == [{"field": "name", "value": "Grace"}]

    def test_a_list_keeps_its_order(self, client, redis_connection):
        response = write(
            client, redis_connection["uid"], "keys",
            json={"key": "steps", "type": "list", "members": ["a", "b", "c"]},
        )

        assert response.json()["members"] == ["a", "b", "c"]

    def test_a_set(self, client, redis_connection):
        response = write(
            client, redis_connection["uid"], "keys",
            json={"key": "colours", "type": "set", "members": ["red", "blue"]},
        )

        assert sorted(response.json()["members"]) == ["blue", "red"]

    def test_a_sorted_set_keeps_its_scores(self, client, redis_connection):
        response = write(
            client, redis_connection["uid"], "keys",
            json={
                "key": "ranks",
                "type": "zset",
                "entries": [{"member": "x", "score": 2}, {"member": "y", "score": 1}],
            },
        )

        assert [entry["member"] for entry in response.json()["entries"]] == ["y", "x"]

    def test_a_stream(self, client, redis_connection):
        response = write(
            client, redis_connection["uid"], "keys",
            json={
                "key": "audit",
                "type": "stream",
                "entries": [{"fields": {"who": "ada"}}],
            },
        )

        assert response.json()["entries"][0]["fields"] == {"who": "ada"}

    def test_a_ttl_is_applied(self, client, redis_connection):
        response = write(
            client, redis_connection["uid"], "keys",
            json={"key": "brief", "type": "string", "value": "x", "ttl": 300},
        )

        assert 0 < response.json()["ttl"] <= 300

    def test_an_existing_key_is_not_clobbered(self, client, redis_connection):
        response = write(
            client, redis_connection["uid"], "keys",
            json={"key": "greeting", "type": "string", "value": "overwritten"},
        )

        assert response.status_code == 400
        assert "already a key" in response.json()["detail"]

    def test_replacing_is_an_explicit_choice(self, client, redis_connection):
        response = write(
            client, redis_connection["uid"], "keys",
            json={
                "key": "greeting",
                "type": "list",
                "members": ["now", "a", "list"],
                "replace": True,
            },
        )

        assert response.json()["type"] == "list"

    def test_an_empty_collection_is_refused(self, client, redis_connection):
        """Redis cannot store one: the key simply would not exist afterwards."""
        response = write(
            client, redis_connection["uid"], "keys",
            json={"key": "empty", "type": "set", "members": []},
        )

        assert response.status_code == 400
        assert "at least one" in response.json()["detail"]

    def test_a_score_that_is_not_a_number_says_so(self, client, redis_connection):
        response = write(
            client, redis_connection["uid"], "keys",
            json={
                "key": "bad",
                "type": "zset",
                "entries": [{"member": "x", "score": "high"}],
            },
        )

        assert response.status_code == 422 or "not a number" in response.text


class TestEditingParts:
    """One field, position or member at a time."""

    def edit(self, client, uid, **body):
        return write(client, uid, "keys/items", method="patch", json=body)

    def test_a_string_value(self, client, redis_connection):
        response = self.edit(
            client, redis_connection["uid"], key="greeting", action="set", value="hi"
        )

        assert response.json()["value"] == "hi"

    def test_a_string_edit_keeps_its_expiry(self, client, redis_connection):
        response = self.edit(
            client, redis_connection["uid"], key="temporary", action="set", value="still"
        )

        # SET on its own clears the TTL, which would turn an edit into a leak
        assert response.json()["ttl"] > 0

    def test_a_hash_field_is_set_and_removed(self, client, redis_connection):
        uid = redis_connection["uid"]
        self.edit(client, uid, key="user:7", action="set", field="plan", value="pro")
        response = self.edit(client, uid, key="user:7", action="remove", field="email")

        fields = {entry["field"]: entry["value"] for entry in response.json()["entries"]}
        assert fields == {"name": "Ada", "plan": "pro"}

    def test_a_list_position_is_replaced(self, client, redis_connection):
        response = self.edit(
            client, redis_connection["uid"],
            key="queue:jobs", action="set", index=1, value="SECOND",
        )

        assert response.json()["members"] == ["first", "SECOND", "third"]

    def test_removing_a_list_position_takes_only_that_one(self, client, redis_connection):
        """LREM works by value, so duplicates would all go without care."""
        uid = redis_connection["uid"]
        write(
            client, uid, "keys",
            json={"key": "dupes", "type": "list", "members": ["x", "y", "x", "x"]},
        )

        response = self.edit(client, uid, key="dupes", action="remove", index=2)

        assert response.json()["members"] == ["x", "y", "x"]

    def test_a_list_push_goes_to_the_end_asked_for(self, client, redis_connection):
        uid = redis_connection["uid"]
        self.edit(client, uid, key="queue:jobs", action="push", value="zeroth", end="head")
        response = self.edit(client, uid, key="queue:jobs", action="push", value="last")

        members = response.json()["members"]
        assert members[0] == "zeroth" and members[-1] == "last"

    def test_a_set_member(self, client, redis_connection):
        uid = redis_connection["uid"]
        self.edit(client, uid, key="tags", action="add", member="delta")
        response = self.edit(client, uid, key="tags", action="remove", member="alpha")

        assert sorted(response.json()["members"]) == ["beta", "delta", "gamma"]

    def test_a_sorted_set_score(self, client, redis_connection):
        response = self.edit(
            client, redis_connection["uid"],
            key="leaderboard", action="set", member="bob", score=500,
        )

        assert response.json()["entries"][-1] == {"member": "bob", "score": 500.0}

    def test_a_stream_entry_is_added(self, client, redis_connection):
        response = self.edit(
            client, redis_connection["uid"],
            key="events", action="add", fields={"kind": "logout"},
        )

        assert response.json()["size"] == 3

    def test_the_wrong_action_for_a_type_names_the_right_ones(
        self, client, redis_connection
    ):
        response = self.edit(
            client, redis_connection["uid"], key="tags", action="push", value="x"
        )

        assert response.status_code == 400
        assert "add, remove" in response.json()["detail"]

    def test_a_key_that_expired_since_it_was_opened_says_so(
        self, client, redis_connection
    ):
        response = self.edit(
            client, redis_connection["uid"], key="ghost", action="set", value="x"
        )

        assert response.status_code == 400
        assert "may have expired" in response.json()["detail"]


class TestExpiryAndNames:
    def test_an_expiry_is_set_and_taken_away(self, client, redis_connection):
        uid = redis_connection["uid"]
        set_one = write(client, uid, "keys/ttl", method="put", json={"key": "greeting", "ttl": 90})
        assert 0 < set_one.json()["ttl"] <= 90

        cleared = write(client, uid, "keys/ttl", method="put", json={"key": "greeting", "ttl": None})
        assert cleared.json()["ttl"] == -1

    def test_zero_is_refused_rather_than_deleting(self, client, redis_connection):
        response = write(
            client, redis_connection["uid"], "keys/ttl", method="put",
            json={"key": "greeting", "ttl": 0},
        )

        assert response.status_code == 400
        assert "delete the key immediately" in response.json()["detail"]

    def test_a_rename(self, client, redis_connection):
        response = write(
            client, redis_connection["uid"], "keys/rename",
            json={"key": "greeting", "to": "salutation"},
        )

        assert response.json()["key"] == "salutation"

    def test_a_rename_onto_an_existing_key_is_refused(self, client, redis_connection):
        response = write(
            client, redis_connection["uid"], "keys/rename",
            json={"key": "greeting", "to": "counter"},
        )

        assert response.status_code == 400
        assert "already a key called 'counter'" in response.json()["detail"]


class TestScanPaging:
    """A page is never trimmed after its cursor has moved past it."""

    def test_a_batch_larger_than_the_page_is_kept_whole(self):
        """SCAN's COUNT is a hint, so one bucket can return more than asked.

        Which keys share a bucket depends on the server's hash seed, which
        changes on every restart, so this fakes the oversized batch rather than
        hoping a real server produces one.
        """
        import asyncio

        from api import redis_client

        class OversizedBatch:
            async def scan(self, cursor, match, count):
                return 0, [b"a", b"b", b"c"]

        session = redis_client.RedisSession(redis_client.parse_url("redis://x:1/0"))
        session._client = OversizedBatch()

        async def as_is(keys):
            return keys

        session._describe = as_is

        keys, cursor = asyncio.run(session.scan_keys(count=2))

        assert keys == [b"a", b"b", b"c"]
        assert cursor == 0
