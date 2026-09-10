"""Entity (table) tests that are common to all adapters"""

import httpx
import pytest
from abc import abstractmethod


class BaseEntityTestMixin:
    """Adapter-specific classes provide `source`, `connection_uri` and the tables
    the fixture seeded."""

    @property
    @abstractmethod
    def source(self) -> str: ...

    @property
    @abstractmethod
    def connection_uri(self) -> str: ...

    @abstractmethod
    def get_test_tables(self) -> list[str]: ...

    @property
    def has_schemas(self) -> bool:
        return self.source in ("postgres", "mysql")

    def _create_connection(self, client: httpx.Client, read_only: bool = True) -> str:
        response = client.post(
            "/connections",
            json={
                "source": self.source,
                "name": f"Test {self.source} Connection",
                "connection_uri": self.connection_uri,
                "read_only": read_only,
            },
        )
        assert response.status_code == 200, response.text
        return response.json()["uid"]

    def test_list_tables(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(f"/connection/{connection_uid}/table")
        assert response.status_code == 200, response.text
        data = response.json()

        names = [table["name"] for table in data["tables"]]
        assert data["total"] == len(names)
        for table in self.get_test_tables():
            assert table in names

    def test_list_schemas(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(f"/connection/{connection_uid}/schema")
        assert response.status_code == 200
        data = response.json()

        if self.has_schemas:
            # Postgres calls it a schema, MySQL calls it a database
            assert data["total"] > 0
            assert all(schema["name"] for schema in data["schemas"])
        else:
            assert data["total"] == 0

    def test_get_entity_columns(self, client: httpx.Client):
        connection_uid = self._create_connection(client)
        entity_name = self.get_test_tables()[0]

        response = client.get(
            f"/connection/{connection_uid}/entities/{entity_name}/columns"
        )
        assert response.status_code == 200, response.text
        data = response.json()

        assert data["entity_name"] == entity_name
        assert data["total"] == len(data["columns"])
        assert data["primary_key"] == ["id"]
        assert data["row_count"] == 2

        by_name = {column["name"]: column for column in data["columns"]}
        assert by_name["id"]["primary_key"] is True
        assert by_name["id"]["kind"] == "number"
        assert by_name["name"]["nullable"] is False
        assert by_name["name"]["kind"] == "text"
        assert by_name["id"]["monospace"] is True

    def test_get_columns_of_unknown_entity(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/does_not_exist/columns"
        )
        assert response.status_code == 404

    def test_get_entity_rows_uses_keyset_pagination(self, client: httpx.Client):
        connection_uid = self._create_connection(client)
        entity_name = "users"

        first = client.get(
            f"/connection/{connection_uid}/entities/{entity_name}/rows",
            params={"limit": 1},
        )
        assert first.status_code == 200, first.text
        first_page = first.json()

        assert first_page["row_count"] == 1
        assert first_page["total_rows"] == 2
        assert first_page["cursor_column"] == "id"
        assert first_page["next_cursor"] is not None
        assert first_page["columns"]

        second = client.get(
            f"/connection/{connection_uid}/entities/{entity_name}/rows",
            params={"limit": 1, "after": first_page["next_cursor"]},
        )
        assert second.status_code == 200
        second_page = second.json()

        assert second_page["keyset"] is True
        assert second_page["row_count"] == 1
        assert second_page["rows"][0]["id"] != first_page["rows"][0]["id"]

    def test_get_entity_rows_rejects_unknown_order_column(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/users/rows",
            params={"order_by": "nope"},
        )
        assert response.status_code == 400

    def test_get_entity_rows_of_unknown_entity(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/does_not_exist/rows"
        )
        assert response.status_code == 404

    def test_query_returns_rows_and_column_metadata(self, client: httpx.Client):
        connection_uid = self._create_connection(client)
        entity_name = "users"

        response = client.get(
            f"/connection/{connection_uid}/entities/{entity_name}/queries",
            params={"query": f"SELECT * FROM {entity_name}"},
        )
        assert response.status_code == 200, response.text
        data = response.json()

        assert data["entity_name"] == entity_name
        assert data["connection_id"] == connection_uid
        assert data["returns_rows"] is True
        assert data["row_count"] == len(data["rows"]) == 2
        assert data["execution_time_ms"] >= 0
        assert data["risk"]["level"] == "safe"
        assert data["risk"]["read_only"] is True

        by_name = {column["name"]: column for column in data["columns"]}
        assert by_name["id"]["primary_key"] is True
        assert by_name["email"]["kind"] == "text"

    def test_empty_result_still_describes_columns(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/users/queries",
            params={"query": "SELECT id, name FROM users WHERE name = 'nobody'"},
        )
        assert response.status_code == 200
        data = response.json()

        assert data["rows"] == []
        assert data["returns_rows"] is True
        assert [column["name"] for column in data["columns"]] == ["id", "name"]

    def test_query_rejects_writes_on_read_only_connection(self, client: httpx.Client):
        connection_uid = self._create_connection(client, read_only=True)

        response = client.get(
            f"/connection/{connection_uid}/entities/users/queries",
            params={"query": "DELETE FROM users"},
        )
        assert response.status_code == 403
        assert "read-only" in response.json()["detail"]

    def test_query_reports_risk_for_unguarded_delete(self, client: httpx.Client):
        connection_uid = self._create_connection(client, read_only=False)

        response = client.get(
            f"/connection/{connection_uid}/entities/users/queries",
            params={"query": "DELETE FROM users WHERE name = 'nobody'"},
        )
        assert response.status_code == 200, response.text
        data = response.json()

        assert data["risk"]["level"] == "caution"
        assert data["risk"]["read_only"] is False
        assert data["returns_rows"] is False

    def test_query_applies_limit_and_offset(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/users/queries",
            params={"query": "SELECT * FROM users", "limit": 1, "offset": 0},
        )
        assert response.status_code == 200
        data = response.json()

        assert data["query"].endswith("LIMIT 1")
        assert len(data["rows"]) == 1
        assert data["truncated"] is True
        # the applied LIMIT clears the "unbounded SELECT" warning
        assert data["risk"]["warnings"] == []

    def test_empty_query_is_rejected(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/users/queries",
            params={"query": "   "},
        )
        assert response.status_code == 400

    def test_query_against_missing_table_reports_the_error(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/nope/queries",
            params={"query": "SELECT * FROM nonexistent_table_12345"},
        )
        assert response.status_code == 400
        assert "not found" in response.json()["detail"].lower()

    def test_write_roundtrip(self, client: httpx.Client):
        connection_uid = self._create_connection(client, read_only=False)

        insert = client.get(
            f"/connection/{connection_uid}/entities/users/queries",
            params={
                "query": (
                    "INSERT INTO users (name, email) "
                    "VALUES ('RoundTrip', 'roundtrip@example.com')"
                )
            },
        )
        assert insert.status_code == 200, insert.text
        assert insert.json()["rows_affected"] == 1

        update = client.get(
            f"/connection/{connection_uid}/entities/users/queries",
            params={
                "query": (
                    "UPDATE users SET email = 'changed@example.com' "
                    "WHERE name = 'RoundTrip'"
                )
            },
        )
        assert update.status_code == 200, update.text
        assert update.json()["rows_affected"] == 1

        verify = client.get(
            f"/connection/{connection_uid}/entities/users/queries",
            params={"query": "SELECT * FROM users WHERE name = 'RoundTrip'"},
        )
        assert verify.json()["rows"][0]["email"] == "changed@example.com"

        delete = client.get(
            f"/connection/{connection_uid}/entities/users/queries",
            params={"query": "DELETE FROM users WHERE name = 'RoundTrip'"},
        )
        assert delete.status_code == 200, delete.text
        assert delete.json()["rows_affected"] == 1

        after = client.get(
            f"/connection/{connection_uid}/entities/users/queries",
            params={"query": "SELECT * FROM users WHERE name = 'RoundTrip'"},
        )
        assert after.json()["rows"] == []

    def test_sensitive_columns_are_flagged(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/accounts/columns"
        )
        assert response.status_code == 200, response.text
        by_name = {column["name"]: column for column in response.json()["columns"]}

        assert by_name["password_hash"]["sensitive"] is True
        assert by_name["api_token"]["sensitive"] is True
        assert by_name["username"]["sensitive"] is False

    def test_indexed_columns_are_reported(self, client: httpx.Client):
        connection_uid = self._create_connection(client)

        response = client.get(
            f"/connection/{connection_uid}/entities/accounts/columns"
        )
        assert response.status_code == 200
        data = response.json()
        by_name = {column["name"]: column for column in data["columns"]}

        assert by_name["username"]["indexed"] is True
        assert by_name["api_token"]["indexed"] is False
        assert any(index["columns"] == ["username"] for index in data["indexes"])
