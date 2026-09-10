"""Insight, stats and export tests that are common to all adapters"""

import csv
import io
import json
from abc import abstractmethod

import httpx


class BaseInsightTestMixin:
    @property
    @abstractmethod
    def source(self) -> str: ...

    @property
    @abstractmethod
    def connection_uri(self) -> str: ...

    def _create_connection(self, client: httpx.Client) -> str:
        response = client.post(
            "/connections",
            json={
                "source": self.source,
                "name": f"Test {self.source} Connection",
                "connection_uri": self.connection_uri,
            },
        )
        assert response.status_code == 200, response.text
        return response.json()["uid"]

    # ---------------------------------------------------------------- explain
    def test_explain_reports_a_plan(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/users/explain",
            params={"query": "SELECT * FROM users"},
        )
        assert response.status_code == 200, response.text
        data = response.json()

        assert data["supported"] is True
        assert data["speed"] in ("fast", "medium", "slow")
        assert data["scans"]
        assert data["plan"]

    def test_explain_flags_a_sequential_scan(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/users/explain",
            params={"query": "SELECT * FROM users WHERE email = 'alice@example.com'"},
        )
        assert response.status_code == 200, response.text
        data = response.json()

        assert data["uses_index"] is False
        assert any(scan["type"] == "sequential" for scan in data["scans"])
        assert any("Sequential scan" in warning for warning in data["warnings"])

    def test_explain_does_not_run_the_query(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        before = client.get(
            f"/connection/{connection_uid}/entities/users/queries",
            params={"query": "SELECT * FROM users"},
        ).json()["row_count"]

        client.get(
            f"/connection/{connection_uid}/entities/users/explain",
            params={"query": "DELETE FROM users"},
        )

        after = client.get(
            f"/connection/{connection_uid}/entities/users/queries",
            params={"query": "SELECT * FROM users"},
        ).json()["row_count"]
        assert after == before

    def test_explain_rejects_multiple_statements(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/users/explain",
            params={"query": "SELECT 1; SELECT 2"},
        )
        assert response.status_code == 400

    def test_explain_rejects_empty_query(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/users/explain",
            params={"query": " "},
        )
        assert response.status_code == 400

    # ------------------------------------------------------------------ stats
    def test_stats_report_nulls_and_distincts(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(f"/connection/{connection_uid}/entities/users/stats")
        assert response.status_code == 200, response.text
        data = response.json()

        assert data["row_count"] == 2
        assert data["scanned_rows"] == 2
        assert data["sampled"] is False

        by_name = {column["name"]: column for column in data["columns"]}
        assert by_name["name"]["null_count"] == 0
        assert by_name["name"]["null_percent"] == 0.0
        assert by_name["name"]["distinct_count"] == 2

    def test_stats_count_nulls(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(f"/connection/{connection_uid}/entities/nullable/stats")
        assert response.status_code == 200, response.text
        by_name = {column["name"]: column for column in response.json()["columns"]}

        assert by_name["note"]["null_count"] == 2
        assert by_name["note"]["null_percent"] == 50.0

    def test_stats_report_top_values(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(f"/connection/{connection_uid}/entities/nullable/stats")
        assert response.status_code == 200
        by_name = {column["name"]: column for column in response.json()["columns"]}

        top = by_name["category"]["top_values"]
        assert top[0]["value"] == "a"
        assert top[0]["count"] == 3

    def test_stats_skip_top_values_for_unique_columns(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(f"/connection/{connection_uid}/entities/users/stats")
        assert response.status_code == 200
        by_name = {column["name"]: column for column in response.json()["columns"]}

        # every id and every name is unique here, so there is no "top" value
        assert by_name["id"]["top_values"] == []
        assert by_name["name"]["top_values"] == []

    def test_stats_skip_sensitive_top_values(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(f"/connection/{connection_uid}/entities/accounts/stats")
        assert response.status_code == 200
        by_name = {column["name"]: column for column in response.json()["columns"]}

        assert by_name["password_hash"]["top_values"] == []
        assert by_name["username"]["top_values"]

    def test_stats_can_skip_top_values(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/users/stats",
            params={"top_values": False},
        )
        assert response.status_code == 200
        assert all(
            column["top_values"] == [] for column in response.json()["columns"]
        )

    def test_stats_of_unknown_entity(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(f"/connection/{connection_uid}/entities/nope/stats")
        assert response.status_code == 404

    # ----------------------------------------------------------------- export
    def test_export_csv(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(f"/connection/{connection_uid}/entities/users/export")
        assert response.status_code == 200, response.text
        assert response.headers["content-type"].startswith("text/csv")
        assert 'filename="users.csv"' in response.headers["content-disposition"]
        assert response.headers["x-row-count"] == "2"

        rows = list(csv.reader(io.StringIO(response.text)))
        assert rows[0] == ["id", "name", "email"]
        assert rows[1][1] == "Alice"

    def test_export_only_visible_columns_in_order(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/users/export",
            params={"columns": "email,name"},
        )
        assert response.status_code == 200

        rows = list(csv.reader(io.StringIO(response.text)))
        assert rows[0] == ["name", "email"]

    def test_export_rejects_unknown_column(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/users/export",
            params={"columns": "name,ghost"},
        )
        assert response.status_code == 400
        assert "ghost" in response.json()["detail"]

    def test_export_json(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/users/export",
            params={"format": "json"},
        )
        assert response.status_code == 200

        payload = json.loads(response.text)
        assert len(payload) == 2
        assert payload[0]["name"] == "Alice"

    def test_export_ndjson(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/users/export",
            params={"format": "ndjson"},
        )
        assert response.status_code == 200

        lines = [line for line in response.text.splitlines() if line]
        assert len(lines) == 2
        assert json.loads(lines[0])["name"] == "Alice"

    def test_export_honours_a_filtered_query(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/users/export",
            params={"query": "SELECT name FROM users WHERE name = 'Alice'"},
        )
        assert response.status_code == 200

        rows = list(csv.reader(io.StringIO(response.text)))
        assert rows == [["name"], ["Alice"]]

    def test_export_rejects_a_writing_query(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/users/export",
            params={"query": "DELETE FROM users"},
        )
        assert response.status_code == 400

    def test_export_respects_limit(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/users/export",
            params={"limit": 1},
        )
        assert response.status_code == 200
        assert response.headers["x-row-count"] == "1"

    def test_export_of_unknown_entity(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(f"/connection/{connection_uid}/entities/nope/export")
        assert response.status_code == 404

    def test_export_preserves_types(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/typed/export",
            params={"format": "json"},
        )
        assert response.status_code == 200, response.text
        row = json.loads(response.text)[0]

        assert row["created_at"].startswith("2024-01-02")
        assert row["payload"] in ({"a": 1}, '{"a": 1}')
        assert isinstance(row["amount"], (int, float))
