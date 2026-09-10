"""MySQL adapter insight tests"""

import pytest

from tests.base.base_insight_tests import BaseInsightTestMixin


class TestMySQLInsights(BaseInsightTestMixin):
    @property
    def source(self) -> str:
        return "mysql"

    @property
    def connection_uri(self) -> str:
        return self._connection_uri


    @pytest.fixture(autouse=True)
    def _setup_connection_uri(self, mysql_connection_uri):
        self._connection_uri = mysql_connection_uri
        yield
        self._connection_uri = None
