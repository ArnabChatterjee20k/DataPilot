"""Postgres adapter connection tests"""

import pytest
from tests.base.base_connection_tests import BaseConnectionTestMixin


class TestPostgresConnection(BaseConnectionTestMixin):
    """Postgres-specific connection tests"""

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

    def setup_connection(self):
        """Setup is handled by fixtures"""
        pass

    def teardown_connection(self):
        """Teardown is handled by fixtures"""
        pass

    @pytest.fixture(autouse=True)
    def _setup_connection_uri(self, postgres_connection_uri):
        """Set the connection URI for the test instance"""
        self._connection_uri = postgres_connection_uri
        yield
        # Cleanup
        if hasattr(self, "_connection_uri"):
            delattr(self, "_connection_uri")
