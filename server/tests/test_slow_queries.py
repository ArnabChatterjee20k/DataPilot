"""Reading, normalising and comparing the server's own statement statistics."""

import pytest

from api import slow_queries
from api.config import SourceConfig


class TestNormalising:
    def test_postgres_rows_become_the_common_shape(self):
        [query] = slow_queries.from_postgres(
            [
                {
                    "digest": "-12345",
                    "statement": "SELECT  *\n  FROM users WHERE id = $1",
                    "calls": 4,
                    "total_ms": 12.3456,
                    "mean_ms": 3.0864,
                    "max_ms": 9.9,
                    "rows": 8,
                }
            ]
        )

        assert query.digest == "-12345"
        # whitespace is flattened, so the same statement reads the same twice
        assert query.statement == "SELECT * FROM users WHERE id = $1"
        assert (query.calls, query.total_ms, query.rows) == (4, 12.346, 8)
        assert query.rows_per_call == 2.0

    def test_mysql_picoseconds_become_milliseconds(self):
        """The performance schema counts in picoseconds, which nobody reads."""
        [query] = slow_queries.from_mysql(
            [
                {
                    "digest": "abc",
                    "statement": "SELECT * FROM `users`",
                    "calls": 2,
                    "total_picoseconds": 2_500_000_000,
                    "mean_picoseconds": 1_250_000_000,
                    "max_picoseconds": 2_000_000_000,
                    "rows_sent": 6,
                    "rows_examined": 600,
                    "first_seen": "2026-09-10 12:00:00",
                    "last_seen": "2026-09-10 12:05:00",
                }
            ]
        )

        assert (query.total_ms, query.mean_ms, query.max_ms) == (2.5, 1.25, 2.0)
        assert query.rows_examined == 600
        assert query.first_seen == "2026-09-10 12:00:00"

    def test_a_statement_with_no_calls_does_not_divide_by_zero(self):
        [query] = slow_queries.from_postgres(
            [{"digest": "x", "statement": "SELECT 1", "calls": 0, "rows": 0}]
        )
        assert query.rows_per_call == 0.0

    def test_a_missing_digest_is_derived_from_the_statement(self):
        [one] = slow_queries.from_postgres([{"statement": "SELECT 1"}])
        [two] = slow_queries.from_postgres([{"statement": "SELECT     1"}])
        assert one.digest == two.digest


class TestAvailability:
    def test_sqlite_says_why_there_is_nothing_to_show(self):
        report = slow_queries.unavailable(SourceConfig.SQLITE.value)
        assert report.available is False
        assert "no server to keep them" in report.detail

    def test_a_missing_postgres_extension_says_how_to_install_it(self):
        detail = slow_queries.missing_source(
            SourceConfig.POSTGRES.value,
            Exception('relation "pg_stat_statements" does not exist'),
        )
        assert "CREATE EXTENSION" in detail

    def test_an_unloaded_postgres_extension_is_a_different_fix(self):
        """Installed and loaded are two problems with two different answers."""
        detail = slow_queries.missing_source(
            SourceConfig.POSTGRES.value,
            Exception("pg_stat_statements must be loaded via shared_preload_libraries"),
        )
        assert "shared_preload_libraries" in detail
        assert "CREATE EXTENSION" not in detail

    def test_a_missing_mysql_schema_says_what_to_check(self):
        detail = slow_queries.missing_source(
            SourceConfig.MYSQL.value,
            Exception("Table 'performance_schema.events_statements_summary_by_digest' doesn't exist"),
        )
        assert "performance_schema=ON" in detail

    def test_an_unrelated_error_is_not_swallowed(self):
        assert (
            slow_queries.missing_source(
                SourceConfig.POSTGRES.value, Exception("connection refused")
            )
            is None
        )

    def test_an_older_postgres_is_recognised_by_its_column_names(self):
        assert slow_queries.is_legacy_postgres(
            Exception('column "total_exec_time" does not exist')
        )
        assert not slow_queries.is_legacy_postgres(Exception("permission denied"))


class TestComparing:
    """The counters only go up, so the difference is what actually happened."""

    def _query(self, digest, calls, total, rows=0):
        return slow_queries.SlowQuery(
            digest=digest,
            statement=f"SELECT {digest}",
            calls=calls,
            total_ms=total,
            rows=rows,
        )

    def test_only_the_difference_is_reported(self):
        before = [self._query("a", 10, 100.0, rows=50)]
        after = [self._query("a", 12, 130.0, rows=60)]

        [changed] = slow_queries.compare(before, after)
        assert (changed.calls, changed.total_ms, changed.rows) == (2, 30.0, 10)
        assert changed.mean_ms == 15.0

    def test_a_statement_that_did_not_run_is_left_out(self):
        before = [self._query("a", 10, 100.0), self._query("b", 3, 9.0)]
        after = [self._query("a", 10, 100.0), self._query("b", 4, 12.0)]

        assert [query.digest for query in slow_queries.compare(before, after)] == ["b"]

    def test_a_new_statement_counts_from_zero(self):
        [changed] = slow_queries.compare([], [self._query("new", 5, 25.0)])
        assert (changed.calls, changed.total_ms) == (5, 25.0)

    def test_the_slowest_comes_first(self):
        before = []
        after = [self._query("small", 1, 1.0), self._query("big", 1, 900.0)]

        assert [query.digest for query in slow_queries.compare(before, after)] == [
            "big",
            "small",
        ]


class TestLimits:
    @pytest.mark.parametrize(
        "asked,expected",
        [
            (None, slow_queries.DEFAULT_LIMIT),
            (0, slow_queries.DEFAULT_LIMIT),
            (-5, slow_queries.DEFAULT_LIMIT),
            (10, 10),
            (100_000, slow_queries.MAX_LIMIT),
        ],
    )
    def test_a_limit_is_kept_within_reason(self, asked, expected):
        assert slow_queries.clamp(asked) == expected


class TestSlowQueryRoutes:
    def test_sqlite_reports_that_it_keeps_no_statistics(self, client, sqlite_connection_uri):
        created = client.post(
            "/connections",
            json={
                "source": "sqlite",
                "name": "A database",
                "connection_uri": sqlite_connection_uri,
            },
        ).json()

        response = client.get(f"/connection/{created['uid']}/slow-queries")
        assert response.status_code == 200
        body = response.json()
        assert body["available"] is False
        assert "no server to keep them" in body["detail"]
        assert body["queries"] == []

    def test_a_snapshot_of_nothing_is_refused_with_a_reason(
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

        response = client.post(f"/connection/{created['uid']}/slow-queries/snapshots")
        assert response.status_code == 400
        assert "no server to keep them" in response.json()["detail"]

    def test_an_api_connection_is_refused(self, client):
        created = client.post(
            "/connections",
            json={
                "source": "api",
                "name": "An API",
                "connection_uri": "http://127.0.0.1:1",
            },
        ).json()

        response = client.get(f"/connection/{created['uid']}/slow-queries")
        assert response.status_code == 200
        assert response.json()["available"] is False

    def test_an_unknown_connection_is_a_404(self, client):
        response = client.get(
            "/connection/00000000-0000-0000-0000-000000000000/slow-queries"
        )
        assert response.status_code == 404
