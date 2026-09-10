"""MySQL adapter entity tests"""

import pytest

from tests.base.base_entity_tests import BaseEntityTestMixin


class TestMySQLEntity(BaseEntityTestMixin):
    @property
    def source(self) -> str:
        return "mysql"

    @property
    def connection_uri(self) -> str:
        return self._connection_uri

    def get_test_tables(self) -> list[str]:
        return ["users", "products", "accounts", "nullable", "typed"]

    @pytest.fixture(autouse=True)
    def _setup_connection_uri(self, mysql_connection_uri):
        self._connection_uri = mysql_connection_uri
        yield
        self._connection_uri = None
