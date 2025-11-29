"""SQLite adapter entity tests"""

import pytest
from tests.base.base_entity_tests import BaseEntityTestMixin


class TestSQLiteEntity(BaseEntityTestMixin):
    """SQLite-specific entity tests"""

    @property
    def source(self) -> str:
        return "sqlite"

    @property
    def connection_uri(self) -> str:
        if not hasattr(self, "_connection_uri") or self._connection_uri is None:
            raise ValueError(
                "connection_uri not set. Make sure sqlite_connection_uri fixture is used."
            )
        return self._connection_uri

    def setup_connection(self):
        """Setup is handled by fixtures"""
        pass

    def teardown_connection(self):
        """Teardown is handled by fixtures"""
        pass

    def get_test_tables(self) -> list[str]:
        """Return test tables that should exist after setup"""
        return ["users", "products"]

    @pytest.fixture(autouse=True)
    def _setup_connection_uri(self, sqlite_connection_uri):
        """Set the connection URI for the test instance"""
        self._connection_uri = sqlite_connection_uri
        yield
        # Cleanup
        if hasattr(self, "_connection_uri"):
            delattr(self, "_connection_uri")
