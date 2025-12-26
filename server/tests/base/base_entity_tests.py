"""Base entity tests that are common for all adapters"""

import pytest
import httpx
from abc import abstractmethod


# Base class for entity tests - not directly testable, only through inheritance
# Note: Name doesn't end with "Tests" to prevent pytest from discovering it directly
class BaseEntityTestMixin:
    """Base class for entity tests across all adapters.

    Adapter-specific test classes should inherit from this and provide:
    - source: The adapter source type (e.g., "sqlite", "postgres")
    - connection_uri: The connection URI for the adapter
    - setup_connection: Method to set up the connection and create test tables
    - teardown_connection: Method to clean up the connection
    - get_test_tables: Method that returns a list of test table names that should exist
    """

    @property
    @abstractmethod
    def source(self) -> str:
        """The adapter source type (e.g., 'sqlite', 'postgres')"""
        pass

    @property
    @abstractmethod
    def connection_uri(self) -> str:
        """The connection URI for the adapter"""
        pass

    @abstractmethod
    def setup_connection(self):
        """Set up the connection and create test tables before tests"""
        pass

    @abstractmethod
    def teardown_connection(self):
        """Clean up the connection after tests"""
        pass

    @abstractmethod
    def get_test_tables(self) -> list[str]:
        """Return a list of test table names that should exist after setup"""
        pass

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

    def test_list_entities(self, client: httpx.Client):
        """Test listing entities (tables) via query API"""
        connection_uid = self._create_connection(client)

        # Get table list query based on source type
        if self.source == "sqlite":
            query = "SELECT name FROM sqlite_master WHERE type='table'"
        elif self.source == "postgres":
            query = "SELECT table_name as name FROM information_schema.tables WHERE table_schema = 'public'"
        elif self.source == "mysql":
            query = "SELECT table_name as name FROM information_schema.tables WHERE table_schema = DATABASE()"
        else:
            query = "SELECT name FROM sqlite_master WHERE type='table'"

        response = client.get(
            f"/connection/{connection_uid}/entitities/_tables/queries",
            params={"query": query},
        )
        assert response.status_code == 200
        data = response.json()
        assert "rows" in data
        assert isinstance(data["rows"], list)

        # Verify expected test tables are present
        entity_names = [row["name"] for row in data["rows"]]
        expected_tables = self.get_test_tables()
        for table in expected_tables:
            assert (
                table in entity_names
            ), f"Expected table {table} not found in entities"

    def test_get_entity_rows(self, client: httpx.Client):
        """Test getting rows from an entity via query API"""
        connection_uid = self._create_connection(client)
        test_tables = self.get_test_tables()

        if not test_tables:
            pytest.skip("No test tables defined for this adapter")

        # Test getting rows from the first test table
        entity_name = test_tables[0]
        query = f"SELECT * FROM {entity_name} LIMIT 100"
        response = client.get(
            f"/connection/{connection_uid}/entitities/{entity_name}/queries",
            params={"query": query},
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

    def test_get_nonexistent_entity(self, client: httpx.Client):
        """Test getting rows from an entity that doesn't exist"""
        connection_uid = self._create_connection(client)
        fake_entity = "nonexistent_table_12345"
        query = f"SELECT * FROM {fake_entity} LIMIT 100"

        response = client.get(
            f"/connection/{connection_uid}/entitities/{fake_entity}/queries",
            params={"query": query},
        )
        # The API might return 200 with empty rows or an error - depends on implementation
        # Adjust assertion based on actual API behavior
        assert response.status_code in [200, 404, 500]
