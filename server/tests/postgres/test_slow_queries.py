"""Slow statements read from a real PostgreSQL, through pg_stat_statements."""

import pytest


@pytest.fixture()
def pg_connection(client, postgres_connection_uri):
    response = client.post(
        "/connections",
        json={
            "source": "postgres",
            "name": "Postgres",
            "connection_uri": postgres_connection_uri,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def report(client, uid, **params) -> dict:
    response = client.get(f"/connection/{uid}/slow-queries", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def requires_extension(body: dict):
    """The extension is optional, so skip rather than fail where it is absent."""
    if not body["available"]:
        pytest.skip(f"pg_stat_statements not usable here: {body['detail']}")


class TestPostgresSlowQueries:
    def test_the_server_own_statistics_are_read(self, client, pg_connection):
        uid = pg_connection["uid"]
        body = report(client, uid)
        requires_extension(body)

        assert body["origin"] == "pg_stat_statements"
        assert body["source"] == "postgres"
        assert isinstance(body["queries"], list)

    def test_the_traffic_the_server_saw_is_what_is_reported(self, client, pg_connection):
        """The seed inserts are in there; they are the only traffic this server had."""
        uid = pg_connection["uid"]
        requires_extension(report(client, uid))

        statements = [
            query["statement"] for query in report(client, uid, limit=500)["queries"]
        ]
        assert any("INSERT INTO users" in statement for statement in statements)
        # constants are normalised by the server, which is what makes a digest
        # worth grouping by at all
        assert any("$1" in statement for statement in statements)

    def test_the_order_can_be_changed(self, client, pg_connection):
        uid = pg_connection["uid"]
        requires_extension(report(client, uid))

        by_calls = report(client, uid, order_by="calls")["queries"]
        counts = [query["calls"] for query in by_calls]
        assert counts == sorted(counts, reverse=True)

    def test_an_unknown_ordering_falls_back_rather_than_failing(
        self, client, pg_connection
    ):
        """`order_by` never reaches SQL; it is looked up in a fixed table."""
        uid = pg_connection["uid"]
        body = report(client, uid, order_by="rows; DROP TABLE users")
        requires_extension(body)

        totals = [query["total_ms"] for query in body["queries"]]
        assert totals == sorted(totals, reverse=True)

    def test_every_query_carries_the_numbers_worth_ordering_by(
        self, client, pg_connection
    ):
        uid = pg_connection["uid"]
        body = report(client, uid)
        requires_extension(body)
        if not body["queries"]:
            pytest.skip("no statements recorded yet")

        query = body["queries"][0]
        assert query["calls"] >= 1
        assert query["total_ms"] >= 0
        assert query["mean_ms"] >= 0
        assert query["digest"]

    def test_the_slowest_is_first(self, client, pg_connection):
        body = report(client, pg_connection["uid"])
        requires_extension(body)

        totals = [query["total_ms"] for query in body["queries"]]
        assert totals == sorted(totals, reverse=True)


class TestSnapshots:
    def test_a_snapshot_is_stored_and_can_be_read_back(self, client, pg_connection):
        uid = pg_connection["uid"]
        requires_extension(report(client, uid))

        created = client.post(
            f"/connection/{uid}/slow-queries/snapshots", params={"note": "before"}
        )
        assert created.status_code == 200, created.text
        snapshot = created.json()["snapshot"]
        assert snapshot["note"] == "before"
        assert snapshot["source"] == "postgres"

        listed = client.get(f"/connection/{uid}/slow-queries/snapshots").json()
        assert snapshot["uid"] in [item["uid"] for item in listed["snapshots"]]

        detail = client.get(
            f"/connection/{uid}/slow-queries/snapshots/{snapshot['uid']}"
        ).json()
        assert detail["snapshot"]["uid"] == snapshot["uid"]
        assert len(detail["queries"]) == snapshot["query_count"]

    def test_comparing_against_now_shows_only_what_ran_in_between(
        self, client, pg_connection
    ):
        """The absolute numbers include everything since the counters were reset."""
        uid = pg_connection["uid"]
        requires_extension(report(client, uid))

        before = client.post(f"/connection/{uid}/slow-queries/snapshots").json()

        # reading the report is itself traffic the server records, which makes
        # it the one statement guaranteed to have run in the window
        for _ in range(3):
            report(client, uid)

        comparison = client.get(
            f"/connection/{uid}/slow-queries/compare",
            params={"before": before["snapshot"]["uid"]},
        )
        assert comparison.status_code == 200, comparison.text
        body = comparison.json()

        assert body["queries"], "something ran between the two readings"
        statements = [query["statement"] for query in body["queries"]]
        assert any("pg_stat_statements" in statement for statement in statements)

        # everything reported actually ran in the window, rather than being the
        # running total since the counters were last reset
        assert all(
            query["calls"] > 0 or query["total_ms"] > 0 for query in body["queries"]
        )
        assert body["after"]["total_ms"] >= sum(
            query["total_ms"] for query in body["queries"]
        )

    def test_comparing_two_stored_snapshots(self, client, pg_connection):
        uid = pg_connection["uid"]
        requires_extension(report(client, uid))

        first = client.post(f"/connection/{uid}/slow-queries/snapshots").json()
        report(client, uid)
        second = client.post(f"/connection/{uid}/slow-queries/snapshots").json()

        body = client.get(
            f"/connection/{uid}/slow-queries/compare",
            params={
                "before": first["snapshot"]["uid"],
                "after": second["snapshot"]["uid"],
            },
        ).json()

        assert body["before"]["uid"] == first["snapshot"]["uid"]
        assert body["after"]["uid"] == second["snapshot"]["uid"]

    def test_a_snapshot_can_be_deleted(self, client, pg_connection):
        uid = pg_connection["uid"]
        requires_extension(report(client, uid))

        snapshot = client.post(f"/connection/{uid}/slow-queries/snapshots").json()[
            "snapshot"
        ]
        assert (
            client.delete(
                f"/connection/{uid}/slow-queries/snapshots/{snapshot['uid']}"
            ).status_code
            == 204
        )
        assert (
            client.get(
                f"/connection/{uid}/slow-queries/snapshots/{snapshot['uid']}"
            ).status_code
            == 404
        )

    def test_a_snapshot_from_another_connection_is_not_found(
        self, client, pg_connection, sqlite_connection_uri
    ):
        uid = pg_connection["uid"]
        requires_extension(report(client, uid))
        snapshot = client.post(f"/connection/{uid}/slow-queries/snapshots").json()[
            "snapshot"
        ]

        other = client.post(
            "/connections",
            json={
                "source": "sqlite",
                "name": "Elsewhere",
                "connection_uri": sqlite_connection_uri,
            },
        ).json()

        response = client.get(
            f"/connection/{other['uid']}/slow-queries/snapshots/{snapshot['uid']}"
        )
        assert response.status_code == 404
