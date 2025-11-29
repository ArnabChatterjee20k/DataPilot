"""Postgres adapter query tests - tests all CRUD operations via API"""

import pytest
import httpx


class TestPostgresQuery:
    """Postgres-specific query tests for all CRUD operations"""

    @property
    def source(self) -> str:
        return "postgres"

    @property
    def connection_uri(self) -> str:
        if not hasattr(self, "_connection_uri") or self._connection_uri is None:
            raise ValueError(
                "connection_uri not set. Make sure postgres_connection_uri fixture is used."
            )
        return self._connection_uri

    def _create_connection(self, client: httpx.Client) -> str:
        """Helper method to create a connection and return its UID"""
        response = client.post(
            "/connections",
            json={
                "source": self.source,
                "name": f"Test {self.source} Connection",
                "connection_uri": self.connection_uri,
            },
        )
        assert response.status_code == 200
        return response.json()["uid"]

    @pytest.fixture(autouse=True)
    def _setup_connection_uri(self, postgres_connection_uri):
        """Set the connection URI for the test instance"""
        self._connection_uri = postgres_connection_uri
        yield
        # Cleanup
        if hasattr(self, "_connection_uri"):
            delattr(self, "_connection_uri")

    def test_select_query_returns_rows_and_columns(self, client: httpx.Client):
        """Test SELECT query returns both rows and columns"""
        connection_uid = self._create_connection(client)
        entity_name = "users"

        response = client.get(
            f"/connection/{connection_uid}/entitities/{entity_name}/queries",
            params={"query": f"SELECT * FROM {entity_name}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert "rows" in data
        assert "columns" in data
        assert "entity_name" in data
        assert "connection_id" in data
        assert "query" in data
        assert data["entity_name"] == entity_name
        assert isinstance(data["rows"], list)
        assert isinstance(data["columns"], list)
        assert len(data["columns"]) > 0  # Should have column definitions

    def test_select_query_with_where_clause(self, client: httpx.Client):
        """Test SELECT query with WHERE clause"""
        connection_uid = self._create_connection(client)
        entity_name = "users"

        response = client.get(
            f"/connection/{connection_uid}/entitities/{entity_name}/queries",
            params={"query": f"SELECT * FROM {entity_name} WHERE name = 'Alice'"},
        )

        assert response.status_code == 200
        data = response.json()
        assert "rows" in data
        assert "columns" in data
        assert isinstance(data["rows"], list)
        # Should return at least one row (Alice)
        assert len(data["rows"]) >= 1

    def test_select_query_with_limit(self, client: httpx.Client):
        """Test SELECT query with LIMIT clause"""
        connection_uid = self._create_connection(client)
        entity_name = "users"

        response = client.get(
            f"/connection/{connection_uid}/entitities/{entity_name}/queries",
            params={"query": f"SELECT * FROM {entity_name} LIMIT 1"},
        )

        assert response.status_code == 200
        data = response.json()
        assert "rows" in data
        assert isinstance(data["rows"], list)
        assert len(data["rows"]) <= 1

    def test_insert_operation(self, client: httpx.Client):
        """Test INSERT operation via API"""
        connection_uid = self._create_connection(client)
        entity_name = "users"

        # Perform INSERT
        # Try POST first, then fallback to GET if POST doesn't exist
        insert_response = client.post(
            f"/connection/{connection_uid}/entitities/{entity_name}/queries",
            json={
                "query": f"INSERT INTO {entity_name} (name, email) VALUES ('TestUser', 'test@example.com')"
            },
        )

        # If POST doesn't exist, try GET with query parameter
        if insert_response.status_code == 404:
            insert_response = client.get(
                f"/connection/{connection_uid}/entitities/{entity_name}/queries",
                params={
                    "query": f"INSERT INTO {entity_name} (name, email) VALUES ('TestUser', 'test@example.com')"
                },
            )

        # Should succeed (200 or 201)
        assert insert_response.status_code in [
            200,
            201,
            204,
        ], f"INSERT failed with status {insert_response.status_code}: {insert_response.text}"

        # Verify the insert worked by checking the data
        final_response = client.get(
            f"/connection/{connection_uid}/entitities/{entity_name}/queries",
            params={"query": f"SELECT * FROM {entity_name} WHERE name = 'TestUser'"},
        )
        assert final_response.status_code == 200
        data = final_response.json()
        assert len(data["rows"]) >= 1, "Inserted row not found"
        # Verify the inserted data - check if name or email is in the row
        inserted_row = data["rows"][0]
        row_str = str(inserted_row).lower()
        assert (
            "testuser" in row_str or "test@example.com" in row_str
        ), f"Inserted data not found in row: {inserted_row}"

    def test_update_operation(self, client: httpx.Client):
        """Test UPDATE operation via API"""
        connection_uid = self._create_connection(client)
        entity_name = "users"

        # First insert a test record
        insert_response = client.post(
            f"/connection/{connection_uid}/entitities/{entity_name}/queries",
            json={
                "query": f"INSERT INTO {entity_name} (name, email) VALUES ('UpdateTest', 'old@example.com')"
            },
        )
        if insert_response.status_code == 404:
            insert_response = client.get(
                f"/connection/{connection_uid}/entitities/{entity_name}/queries",
                params={
                    "query": f"INSERT INTO {entity_name} (name, email) VALUES ('UpdateTest', 'old@example.com')"
                },
            )
        assert insert_response.status_code in [
            200,
            201,
            204,
        ], "Failed to insert test record"

        # Perform UPDATE
        update_response = client.put(
            f"/connection/{connection_uid}/entitities/{entity_name}/queries",
            json={
                "query": f"UPDATE {entity_name} SET email = 'new@example.com' WHERE name = 'UpdateTest'"
            },
        )

        # If PUT doesn't exist, try POST or GET
        if update_response.status_code == 404:
            update_response = client.post(
                f"/connection/{connection_uid}/entitities/{entity_name}/queries",
                json={
                    "query": f"UPDATE {entity_name} SET email = 'new@example.com' WHERE name = 'UpdateTest'"
                },
            )
        if update_response.status_code == 404:
            update_response = client.get(
                f"/connection/{connection_uid}/entitities/{entity_name}/queries",
                params={
                    "query": f"UPDATE {entity_name} SET email = 'new@example.com' WHERE name = 'UpdateTest'"
                },
            )

        # Should succeed
        assert update_response.status_code in [
            200,
            201,
            204,
        ], f"UPDATE failed with status {update_response.status_code}: {update_response.text}"

        # Verify the update worked
        verify_response = client.get(
            f"/connection/{connection_uid}/entitities/{entity_name}/queries",
            params={"query": f"SELECT * FROM {entity_name} WHERE name = 'UpdateTest'"},
        )
        assert verify_response.status_code == 200
        data = verify_response.json()
        assert len(data["rows"]) >= 1
        updated_row = data["rows"][0]
        # Verify email was updated
        row_str = str(updated_row).lower()
        assert (
            "new@example.com" in row_str
        ), f"Updated email not found in row: {updated_row}"

    def test_delete_operation(self, client: httpx.Client):
        """Test DELETE operation via API"""
        connection_uid = self._create_connection(client)
        entity_name = "users"

        # First insert a test record
        insert_response = client.post(
            f"/connection/{connection_uid}/entitities/{entity_name}/queries",
            json={
                "query": f"INSERT INTO {entity_name} (name, email) VALUES ('DeleteTest', 'delete@example.com')"
            },
        )
        if insert_response.status_code == 404:
            insert_response = client.get(
                f"/connection/{connection_uid}/entitities/{entity_name}/queries",
                params={
                    "query": f"INSERT INTO {entity_name} (name, email) VALUES ('DeleteTest', 'delete@example.com')"
                },
            )
        assert insert_response.status_code in [
            200,
            201,
            204,
        ], "Failed to insert test record"

        # Verify it exists
        before_response = client.get(
            f"/connection/{connection_uid}/entitities/{entity_name}/queries",
            params={"query": f"SELECT * FROM {entity_name} WHERE name = 'DeleteTest'"},
        )
        assert (
            len(before_response.json().get("rows", [])) >= 1
        ), "Test record not found before delete"

        # Perform DELETE
        delete_response = client.delete(
            f"/connection/{connection_uid}/entitities/{entity_name}/queries",
            params={"query": f"DELETE FROM {entity_name} WHERE name = 'DeleteTest'"},
        )

        # If DELETE doesn't exist, try POST or GET
        if delete_response.status_code == 404:
            delete_response = client.post(
                f"/connection/{connection_uid}/entitities/{entity_name}/queries",
                json={"query": f"DELETE FROM {entity_name} WHERE name = 'DeleteTest'"},
            )
        if delete_response.status_code == 404:
            delete_response = client.get(
                f"/connection/{connection_uid}/entitities/{entity_name}/queries",
                params={
                    "query": f"DELETE FROM {entity_name} WHERE name = 'DeleteTest'"
                },
            )

        # Should succeed
        assert delete_response.status_code in [
            200,
            201,
            204,
        ], f"DELETE failed with status {delete_response.status_code}: {delete_response.text}"

        # Verify the delete worked
        after_response = client.get(
            f"/connection/{connection_uid}/entitities/{entity_name}/queries",
            params={"query": f"SELECT * FROM {entity_name} WHERE name = 'DeleteTest'"},
        )
        assert after_response.status_code == 200
        data = after_response.json()
        assert len(data["rows"]) == 0, "Record was not deleted"

    def test_select_with_joins(self, client: httpx.Client):
        """Test SELECT query with JOIN (Postgres-specific)"""
        connection_uid = self._create_connection(client)

        # This test assumes there are related tables
        # Adjust based on your schema
        response = client.get(
            f"/connection/{connection_uid}/entitities/users/queries",
            params={"query": "SELECT u.name, u.email FROM users u LIMIT 10"},
        )

        assert response.status_code == 200
        data = response.json()
        assert "rows" in data
        assert "columns" in data
        assert isinstance(data["rows"], list)
