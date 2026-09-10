"""Postgres adapter entity tests"""

import pytest

from tests.base.base_entity_tests import BaseEntityTestMixin


class TestPostgresEntity(BaseEntityTestMixin):
    @property
    def source(self) -> str:
        return "postgres"

    @property
    def connection_uri(self) -> str:
        return self._connection_uri

    def get_test_tables(self) -> list[str]:
        return ["users", "products", "accounts"]

    @pytest.fixture(autouse=True)
    def _setup_connection_uri(self, postgres_connection_uri):
        self._connection_uri = postgres_connection_uri
        yield
        self._connection_uri = None
