import pytest

from api import sql


class TestStatementSplitting:
    def test_splits_on_semicolons(self):
        assert sql.split_statements("SELECT 1; SELECT 2;") == ["SELECT 1", "SELECT 2"]

    def test_ignores_semicolons_inside_literals(self):
        query = "UPDATE t SET note = 'a;b' WHERE id = 1"
        assert sql.split_statements(query) == [query]

    def test_ignores_semicolons_inside_quoted_identifiers(self):
        query = 'SELECT "we;ird" FROM t'
        assert sql.split_statements(query) == [query]

    def test_blank_input(self):
        assert sql.split_statements("   ") == []


class TestRiskClassification:
    def test_select_is_safe_and_read_only(self):
        risk = sql.analyze("SELECT * FROM users LIMIT 10")
        assert risk.level == sql.SAFE
        assert risk.read_only is True
        assert risk.statement == "SELECT"
        assert risk.warnings == []

    def test_select_without_limit_is_flagged(self):
        risk = sql.analyze("SELECT * FROM users")
        assert risk.level == sql.SAFE
        assert any("LIMIT" in warning for warning in risk.warnings)

    def test_update_with_where_is_caution(self):
        risk = sql.analyze("UPDATE users SET name = 'x' WHERE id = 1")
        assert risk.level == sql.CAUTION
        assert risk.read_only is False

    @pytest.mark.parametrize("statement", ["UPDATE users SET a = 1", "DELETE FROM users"])
    def test_write_without_where_is_dangerous(self, statement):
        risk = sql.analyze(statement)
        assert risk.level == sql.DANGEROUS
        assert any("WHERE" in warning for warning in risk.warnings)

    def test_where_inside_a_string_does_not_count(self):
        risk = sql.analyze("DELETE FROM users -- WHERE id = 1")
        assert risk.level == sql.DANGEROUS

    @pytest.mark.parametrize("statement", ["DROP TABLE users", "TRUNCATE users", "ALTER TABLE users ADD c INT"])
    def test_destructive_ddl_is_dangerous(self, statement):
        risk = sql.analyze(statement)
        assert risk.level == sql.DANGEROUS
        assert risk.read_only is False

    def test_create_is_caution(self):
        risk = sql.analyze("CREATE TABLE t (id INT)")
        assert risk.level == sql.CAUTION
        assert risk.read_only is False

    def test_data_modifying_cte_is_not_read_only(self):
        risk = sql.analyze("WITH d AS (DELETE FROM users RETURNING *) SELECT * FROM d")
        assert risk.read_only is False

    def test_plain_cte_stays_read_only(self):
        risk = sql.analyze("WITH d AS (SELECT 1) SELECT * FROM d LIMIT 1")
        assert risk.read_only is True
        assert risk.level == sql.SAFE

    def test_multiple_statements_are_reported(self):
        risk = sql.analyze("SELECT 1 LIMIT 1; SELECT 2 LIMIT 1")
        assert risk.statement_count == 2
        assert risk.level == sql.CAUTION

    def test_large_offset_is_warned_about(self):
        risk = sql.analyze("SELECT * FROM t LIMIT 10 OFFSET 50000")
        assert any("OFFSET" in warning for warning in risk.warnings)

    def test_empty_query(self):
        risk = sql.analyze("")
        assert risk.statement == "EMPTY"
        assert risk.read_only is True


class TestLimitOffset:
    def test_appends_limit_and_offset(self):
        assert (
            sql.apply_limit_offset("SELECT * FROM t", 100, 20)
            == "SELECT * FROM t LIMIT 100 OFFSET 20"
        )

    def test_keeps_existing_limit(self):
        assert sql.apply_limit_offset("SELECT * FROM t LIMIT 5", 100, 0) == (
            "SELECT * FROM t LIMIT 5"
        )

    def test_does_not_touch_writes(self):
        query = "DELETE FROM t WHERE id = 1"
        assert sql.apply_limit_offset(query, 100, 0) == query

    def test_ignores_negative_limit(self):
        assert sql.apply_limit_offset("SELECT * FROM t", -1, 0) == "SELECT * FROM t"

    def test_strips_trailing_semicolon(self):
        assert (
            sql.apply_limit_offset("SELECT * FROM t;", 10, None)
            == "SELECT * FROM t LIMIT 10"
        )


class TestColumnClassification:
    @pytest.mark.parametrize(
        "db_type,expected",
        [
            ("uuid", "uuid"),
            ("boolean", "boolean"),
            ("INTEGER", "number"),
            ("numeric(10,2)", "number"),
            ("timestamp without time zone", "timestamp"),
            ("jsonb", "json"),
            ("bytea", "binary"),
            ("character varying", "text"),
        ],
    )
    def test_semantic_kind_from_type(self, db_type, expected):
        assert sql.semantic_kind(db_type) == expected

    def test_untyped_sqlite_column_falls_back_to_name(self):
        assert sql.semantic_kind("", "created_at") == "timestamp"
        assert sql.semantic_kind(None, "title") == "text"

    @pytest.mark.parametrize(
        "name,expected",
        [
            ("created_at", "timestamp"),
            ("updated_at", "timestamp"),
            ("published_on", "timestamp"),
            ("start_date", "timestamp"),
            ("uuid", "uuid"),
            ("session_uuid", "uuid"),
            ("title", "text"),
        ],
    )
    def test_text_column_named_like_a_timestamp(self, name, expected):
        assert sql.semantic_kind("TEXT", name) == expected

    def test_name_never_overrides_a_meaningful_type(self):
        # a numeric epoch column stays a number
        assert sql.semantic_kind("INTEGER", "created_at") == "number"
        assert sql.semantic_kind("jsonb", "config_at") == "json"

    @pytest.mark.parametrize(
        "name", ["password", "api_key", "access_token", "user_secret", "card_number"]
    )
    def test_sensitive_names(self, name):
        assert sql.is_sensitive(name) is True

    @pytest.mark.parametrize("name", ["name", "email", "title"])
    def test_non_sensitive_names(self, name):
        assert sql.is_sensitive(name) is False

    def test_monospace_targets(self):
        assert sql.is_monospace("uuid", "uid") is True
        assert sql.is_monospace("text", "user_id") is True
        assert sql.is_monospace("text", "password_hash") is True
        assert sql.is_monospace("text", "name") is False
