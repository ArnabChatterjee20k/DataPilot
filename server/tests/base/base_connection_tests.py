"""Connection tests that are common to all adapters"""

import httpx
from abc import abstractmethod


# Name deliberately does not end in "Tests" so pytest does not collect the mixin
class BaseConnectionTestMixin:
    """Adapter-specific classes provide `source` and `connection_uri`."""

    @property
    @abstractmethod
    def source(self) -> str: ...

    @property
    @abstractmethod
    def connection_uri(self) -> str: ...

    @property
    def has_schemas(self) -> bool:
        """Backends with a namespace above the table."""
        return self.source in ("postgres", "mysql")

    def _payload(self, **overrides) -> dict:
        payload = {
            "source": self.source,
            "name": f"Test {self.source} Connection",
            "connection_uri": self.connection_uri,
        }
        payload.update(overrides)
        return payload

    def _create(self, client: httpx.Client, **overrides) -> dict:
        response = client.post("/connections", json=self._payload(**overrides))
        assert response.status_code == 200, response.text
        return response.json()

    def test_create_connection(self, client: httpx.Client):
        data = self._create(client)

        assert len(data["uid"]) > 0
        assert data["name"] == f"Test {self.source} Connection"
        assert data["source"] == self.source
        assert data["connection_uri"] == self.connection_uri

    def test_create_connection_defaults_to_safe_metadata(self, client: httpx.Client):
        data = self._create(client)

        assert data["environment"] == "local"
        assert data["role"] == "primary"
        assert data["read_only"] is True
        assert data["supports_schemas"] is self.has_schemas

    def test_create_connection_with_metadata(self, client: httpx.Client):
        data = self._create(
            client, environment="production", role="replica", read_only=False
        )

        assert data["environment"] == "production"
        assert data["role"] == "replica"
        assert data["read_only"] is False

    def test_create_connection_rejects_unknown_environment(self, client: httpx.Client):
        response = client.post("/connections", json=self._payload(environment="mars"))
        assert response.status_code == 422

    def test_list_connections(self, client: httpx.Client):
        created_uid = self._create(client)["uid"]

        response = client.get("/connections")
        assert response.status_code == 200
        data = response.json()

        assert data["total"] > 0
        assert created_uid in [connection["uid"] for connection in data["connections"]]

    def test_get_connection_by_uid(self, client: httpx.Client):
        connection_uid = self._create(client)["uid"]

        response = client.get(f"/connections/{connection_uid}")
        assert response.status_code == 200
        data = response.json()

        assert data["uid"] == connection_uid
        assert data["source"] == self.source
        assert data["connection_uri"] == self.connection_uri

    def test_update_connection_metadata(self, client: httpx.Client):
        connection_uid = self._create(client)["uid"]

        response = client.put(
            f"/connections/{connection_uid}",
            json={"name": "Renamed", "environment": "staging", "read_only": False},
        )
        assert response.status_code == 200, response.text
        data = response.json()

        assert data["name"] == "Renamed"
        assert data["environment"] == "staging"
        assert data["read_only"] is False

        reloaded = client.get(f"/connections/{connection_uid}").json()
        assert reloaded["name"] == "Renamed"
        assert reloaded["environment"] == "staging"
        assert reloaded["read_only"] is False

    def test_delete_connection(self, client: httpx.Client):
        connection_uid = self._create(client)["uid"]

        assert client.delete(f"/connections/{connection_uid}").status_code == 204
        assert client.get(f"/connections/{connection_uid}").status_code == 404

    def test_delete_nonexistent_connection(self, client: httpx.Client):
        fake_uid = "00000000-0000-0000-0000-000000000000"
        assert client.delete(f"/connections/{fake_uid}").status_code == 404

    def test_get_nonexistent_connection(self, client: httpx.Client):
        fake_uid = "00000000-0000-0000-0000-000000000000"
        assert client.get(f"/connections/{fake_uid}").status_code == 404

    def test_connection_status_reports_reachable(self, client: httpx.Client):
        connection_uid = self._create(client)["uid"]

        response = client.get(f"/connections/{connection_uid}/status")
        assert response.status_code == 200
        data = response.json()

        assert data["reachable"] is True
        assert data["latency_ms"] >= 0
        assert data["server_version"]
