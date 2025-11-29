"""Base connection tests that are common for all adapters"""

import pytest
import httpx
from abc import abstractmethod


# Base class for connection tests - not directly testable, only through inheritance
# Note: Name doesn't end with "Tests" to prevent pytest from discovering it directly
class BaseConnectionTestMixin:
    """Base class for connection tests across all adapters.

    Adapter-specific test classes should inherit from this and provide:
    - source: The adapter source type (e.g., "sqlite", "postgres")
    - connection_uri: The connection URI for the adapter
    - setup_connection: Method to set up the connection (e.g., create DB file, start container)
    - teardown_connection: Method to clean up the connection
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
        """Set up the connection before tests (e.g., create DB file, start container)"""
        pass

    @abstractmethod
    def teardown_connection(self):
        """Clean up the connection after tests"""
        pass

    def test_create_connection(self, client: httpx.Client):
        """Test creating a connection via API"""
        response = client.post(
            "/connections",
            json={
                "source": self.source,
                "name": f"Test {self.source} Connection",
                "connection_uri": self.connection_uri,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert "uid" in data
        assert data["name"] == f"Test {self.source} Connection"
        assert data["source"] == self.source
        assert data["connection_uri"] == self.connection_uri
        assert len(data["uid"]) > 0  # Should be a UUID

    def test_list_connections(self, client: httpx.Client):
        """Test listing all connections via API"""
        # First create a connection
        create_response = client.post(
            "/connections",
            json={
                "source": self.source,
                "name": f"Test {self.source} Connection",
                "connection_uri": self.connection_uri,
            },
        )
        assert create_response.status_code == 200
        created_uid = create_response.json()["uid"]

        # Then list all connections
        list_response = client.get("/connections")
        assert list_response.status_code == 200
        data = list_response.json()
        assert "connections" in data
        assert "total" in data
        assert data["total"] > 0

        # Verify our created connection is in the list
        connection_uids = [conn["uid"] for conn in data["connections"]]
        assert created_uid in connection_uids

    def test_get_connection_by_uid(self, client: httpx.Client):
        """Test getting a specific connection by UID via API"""
        # First create a connection
        create_response = client.post(
            "/connections",
            json={
                "source": self.source,
                "name": f"Test {self.source} Connection",
                "connection_uri": self.connection_uri,
            },
        )
        assert create_response.status_code == 200
        created_data = create_response.json()
        connection_uid = created_data["uid"]

        # Then get it by UID
        get_response = client.get(f"/connections/{connection_uid}")
        assert get_response.status_code == 200
        data = get_response.json()
        assert data["uid"] == connection_uid
        assert data["name"] == f"Test {self.source} Connection"
        assert data["source"] == self.source
        assert data["connection_uri"] == self.connection_uri

    def test_get_nonexistent_connection(self, client: httpx.Client):
        """Test getting a connection that doesn't exist"""
        fake_uid = "00000000-0000-0000-0000-000000000000"
        response = client.get(f"/connections/{fake_uid}")
        assert response.status_code == 404
