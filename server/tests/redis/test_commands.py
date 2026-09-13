"""The command runner: what runs, what is refused, and how a reply reads."""

import pytest

from api import redis_commands


def run(client, uid, command, allow_writes=True, **extra):
    return client.post(
        f"/connection/{uid}/redis/command",
        params={"allow_writes": allow_writes},
        json={"command": command, **extra},
    )


class TestParsing:
    def test_quotes_keep_a_value_with_spaces_together(self):
        command = redis_commands.parse('SET note "hello there"')

        assert command.parts == ["SET", "note", "hello there"]

    def test_an_unclosed_quote_says_so(self):
        with pytest.raises(redis_commands.CommandError, match="unclosed quote"):
            redis_commands.parse('SET note "hello')

    def test_a_known_read_is_a_read(self):
        assert redis_commands.parse("hgetall user:7").writes is False

    def test_an_unknown_command_is_treated_as_a_write(self):
        """A typo or a module command must not slip past a read-only connection."""
        assert redis_commands.parse("JSON.SET doc $ 1").writes is True

    def test_a_subcommand_decides(self):
        assert redis_commands.parse("CONFIG GET maxmemory").writes is False
        assert redis_commands.parse("CONFIG SET maxmemory 1").writes is True

    def test_a_blocking_command_is_refused_with_somewhere_to_go(self):
        with pytest.raises(redis_commands.CommandError, match="Pub/Sub panel"):
            redis_commands.parse("SUBSCRIBE news")


class TestRunning:
    def test_a_read_returns_its_value(self, client, redis_connection):
        response = run(client, redis_connection["uid"], "GET greeting", allow_writes=False)

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["reply"] == "hello"
        assert body["kind"] == "string"
        assert body["writes"] is False

    def test_an_array_reply_stays_a_list(self, client, redis_connection):
        body = run(client, redis_connection["uid"], "LRANGE queue:jobs 0 -1").json()

        assert body["reply"] == ["first", "second", "third"]
        assert body["kind"] == "array"

    def test_a_missing_key_is_nil(self, client, redis_connection):
        body = run(client, redis_connection["uid"], "GET ghost").json()

        assert body["reply"] is None
        assert body["kind"] == "nil"

    def test_a_write_runs_when_writes_are_allowed(self, client, redis_connection):
        uid = redis_connection["uid"]
        assert run(client, uid, 'SET note "a b c"').json()["reply"] in ("OK", True)

        assert run(client, uid, "GET note").json()["reply"] == "a b c"

    def test_a_write_is_refused_on_a_read_only_connection(self, client, redis_connection):
        response = run(client, redis_connection["uid"], "DEL greeting", allow_writes=False)

        assert response.status_code == 403
        assert "running DEL" in response.json()["detail"]

    def test_wiping_a_database_needs_confirming(self, client, redis_connection):
        uid = redis_connection["uid"]
        refused = run(client, uid, "FLUSHDB")
        assert refused.status_code == 409
        assert "Confirm it" in refused.json()["detail"]
        # and nothing went
        assert run(client, uid, "DBSIZE").json()["reply"] > 0

    def test_a_wrong_type_is_redis_explaining_itself(self, client, redis_connection):
        response = run(client, redis_connection["uid"], "HGETALL greeting")

        assert response.status_code == 400
        assert "WRONGTYPE" in response.json()["detail"]

    def test_keys_runs_but_says_why_it_is_risky(self, client, redis_connection):
        body = run(client, redis_connection["uid"], "KEYS user:*", allow_writes=False).json()

        assert body["reply"] == ["user:7"]
        assert "blocking" in body["warning"]
