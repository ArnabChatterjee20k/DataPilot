"""Slow statements read from a real MySQL, through the performance schema."""

import pytest


@pytest.fixture()
def mysql_connection(client, mysql_connection_uri):
    response = client.post(
        "/connections",
        json={
            "source": "mysql",
            "name": "MySQL",
            "connection_uri": mysql_connection_uri,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def report(client, uid, **params) -> dict:
    response = client.get(f"/connection/{uid}/slow-queries", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def requires_schema(body: dict):
    if not body["available"]:
        pytest.skip(f"performance schema not usable here: {body['detail']}")


class TestMysqlSlowQueries:
    def test_the_digest_table_is_read(self, client, mysql_connection):
        body = report(client, mysql_connection["uid"])
        requires_schema(body)

        assert body["source"] == "mysql"
        assert "events_statements_summary_by_digest" in body["origin"]

    def test_timings_arrive_as_milliseconds(self, client, mysql_connection):
        """The performance schema counts in picoseconds, which nobody reads."""
        body = report(client, mysql_connection["uid"])
        requires_schema(body)
        if not body["queries"]:
            pytest.skip("no statements recorded yet")

        query = body["queries"][0]
        # picoseconds would put these in the billions
        assert query["total_ms"] < 1_000_000
        assert query["mean_ms"] <= query["total_ms"] or query["calls"] == 1

    def test_rows_examined_comes_through(self, client, mysql_connection):
        """MySQL knows how many rows were read to produce those returned, and
        the gap between them is the thing that finds a missing index."""
        body = report(client, mysql_connection["uid"])
        requires_schema(body)
        if not body["queries"]:
            pytest.skip("no statements recorded yet")

        assert any(query["rows_examined"] is not None for query in body["queries"])

    def test_the_slowest_is_first(self, client, mysql_connection):
        body = report(client, mysql_connection["uid"])
        requires_schema(body)

        totals = [query["total_ms"] for query in body["queries"]]
        assert totals == sorted(totals, reverse=True)

    def test_a_snapshot_round_trips(self, client, mysql_connection):
        uid = mysql_connection["uid"]
        requires_schema(report(client, uid))

        created = client.post(
            f"/connection/{uid}/slow-queries/snapshots", params={"note": "mysql"}
        )
        assert created.status_code == 200, created.text
        snapshot = created.json()["snapshot"]
        assert snapshot["source"] == "mysql"

        detail = client.get(
            f"/connection/{uid}/slow-queries/snapshots/{snapshot['uid']}"
        ).json()
        assert len(detail["queries"]) == snapshot["query_count"]
