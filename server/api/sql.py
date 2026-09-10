"""SQL text analysis: statement classification, risk scoring and pagination.

Everything here works on the query string alone so the frontend can be told what
a query will do before it runs.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

READ_STATEMENTS = {"SELECT", "WITH", "EXPLAIN", "SHOW", "PRAGMA", "VALUES", "TABLE"}
WRITE_STATEMENTS = {"INSERT", "UPDATE", "DELETE", "MERGE", "REPLACE", "UPSERT", "COPY"}
DESTRUCTIVE_STATEMENTS = {"DROP", "TRUNCATE", "ALTER", "VACUUM", "ATTACH", "DETACH"}
SCHEMA_STATEMENTS = {"CREATE", "GRANT", "REVOKE", "COMMENT", "REINDEX", "ANALYZE"}

SAFE = "safe"
CAUTION = "caution"
DANGEROUS = "dangerous"

#: Beyond this an OFFSET scan is slow enough to be worth warning about.
LARGE_OFFSET = 10_000

_COMMENT_BLOCK = re.compile(r"/\*.*?\*/", re.DOTALL)
_COMMENT_LINE = re.compile(r"--[^\n]*")
_STRING_LITERAL = re.compile(r"'(?:[^']|'')*'")
_QUOTED_IDENT = re.compile(r'"(?:[^"]|"")*"')
_LIMIT_CLAUSE = re.compile(r"\blimit\b", re.IGNORECASE)
_OFFSET_CLAUSE = re.compile(r"\boffset\b", re.IGNORECASE)

SENSITIVE_NAME_PATTERNS = (
    "password",
    "passwd",
    "pwd",
    "secret",
    "token",
    "api_key",
    "apikey",
    "access_key",
    "private_key",
    "credential",
    "credit_card",
    "card_number",
    "cvv",
    "ssn",
    "salt",
    "session_key",
)

UUID_VALUE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
)


@dataclass
class QueryRisk:
    level: str = SAFE
    statement: str = "UNKNOWN"
    read_only: bool = True
    statement_count: int = 0
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "level": self.level,
            "statement": self.statement,
            "read_only": self.read_only,
            "statement_count": self.statement_count,
            "warnings": list(self.warnings),
        }


def strip_noise(sql: str) -> str:
    """Remove comments and literal contents so keyword matching is reliable."""
    stripped = _COMMENT_BLOCK.sub(" ", sql)
    stripped = _COMMENT_LINE.sub(" ", stripped)
    stripped = _STRING_LITERAL.sub("''", stripped)
    stripped = _QUOTED_IDENT.sub('""', stripped)
    return stripped


def split_statements(sql: str) -> list[str]:
    """Split on semicolons that are not inside a literal or quoted identifier."""
    statements = []
    current = []
    quote = None

    for index, char in enumerate(sql):
        if quote:
            current.append(char)
            if char == quote:
                quote = None
            continue

        if char in ("'", '"'):
            quote = char
            current.append(char)
            continue

        if char == ";":
            statement = "".join(current).strip()
            if statement:
                statements.append(statement)
            current = []
            continue

        current.append(char)

    statement = "".join(current).strip()
    if statement:
        statements.append(statement)
    return statements


def leading_keyword(sql: str) -> str:
    match = re.search(r"[a-zA-Z]+", strip_noise(sql))
    return match.group(0).upper() if match else "UNKNOWN"


def is_read_only(sql: str) -> bool:
    return analyze(sql).read_only


def analyze(sql: str) -> QueryRisk:
    """Classify a query and describe why it may be risky."""
    statements = split_statements(sql or "")
    if not statements:
        return QueryRisk(level=SAFE, statement="EMPTY", read_only=True)

    warnings: list[str] = []
    level = SAFE
    read_only = True
    keywords = []

    for statement in statements:
        keyword = leading_keyword(statement)
        keywords.append(keyword)
        body = strip_noise(statement)
        has_where = re.search(r"\bwhere\b", body, re.IGNORECASE) is not None

        if keyword in DESTRUCTIVE_STATEMENTS:
            read_only = False
            level = DANGEROUS
            warnings.append(f"{keyword} permanently changes the schema or data")
        elif keyword in WRITE_STATEMENTS:
            read_only = False
            if keyword in ("UPDATE", "DELETE") and not has_where:
                level = DANGEROUS
                warnings.append(f"{keyword} without a WHERE clause affects every row")
            elif level != DANGEROUS:
                level = CAUTION
        elif keyword in SCHEMA_STATEMENTS:
            read_only = False
            if level == SAFE:
                level = CAUTION
            warnings.append(f"{keyword} modifies the database schema")
        elif keyword == "WITH" and re.search(
            r"\b(insert|update|delete)\b", body, re.IGNORECASE
        ):
            read_only = False
            level = max(level, CAUTION, key=[SAFE, CAUTION, DANGEROUS].index)
            warnings.append("CTE contains a data-modifying statement")
        elif keyword not in READ_STATEMENTS:
            if level == SAFE:
                level = CAUTION
            warnings.append(f"Unrecognised statement: {keyword}")

    if len(statements) > 1:
        warnings.append(f"{len(statements)} statements will run in sequence")
        if level == SAFE:
            level = CAUTION

    offset_value = extract_offset(sql)
    if offset_value is not None and offset_value >= LARGE_OFFSET:
        warnings.append(
            f"OFFSET {offset_value:,} scans and discards every earlier row; "
            "prefer keyset pagination"
        )

    if read_only and keywords[0] == "SELECT" and not has_limit(sql):
        warnings.append("SELECT has no LIMIT and may return the whole table")

    return QueryRisk(
        level=level,
        statement=keywords[0],
        read_only=read_only,
        statement_count=len(statements),
        warnings=warnings,
    )


def has_limit(sql: str) -> bool:
    return _LIMIT_CLAUSE.search(strip_noise(sql or "")) is not None


def has_offset(sql: str) -> bool:
    return _OFFSET_CLAUSE.search(strip_noise(sql or "")) is not None


def extract_offset(sql: str) -> Optional[int]:
    match = re.search(r"\boffset\s+(\d+)", strip_noise(sql or ""), re.IGNORECASE)
    return int(match.group(1)) if match else None


def apply_limit_offset(sql: str, limit: Optional[int], offset: Optional[int]) -> str:
    """Append LIMIT/OFFSET to a read query that does not already have them."""
    statement = (sql or "").strip().rstrip(";")
    if not statement or not is_read_only(statement):
        return sql

    if limit is not None and limit >= 0 and not has_limit(statement):
        statement += f" LIMIT {int(limit)}"
    if offset:
        if not has_offset(statement):
            statement += f" OFFSET {max(0, int(offset))}"
    return statement


def semantic_kind(db_type: Optional[str], column_name: str = "") -> str:
    """Map a backend column type to the small set of kinds the UI renders."""
    declared = (db_type or "").lower()
    name = (column_name or "").lower()

    if "uuid" in declared or "guid" in declared:
        return "uuid"
    if "bool" in declared:
        return "boolean"
    if "json" in declared:
        return "json"
    if any(token in declared for token in ("bytea", "blob", "binary")):
        return "binary"
    if any(token in declared for token in ("timestamp", "datetime", "date", "time")):
        return "timestamp"
    if any(
        token in declared
        for token in (
            "int",
            "serial",
            "numeric",
            "decimal",
            "real",
            "double",
            "float",
            "money",
        )
    ):
        return "number"
    if declared:
        return "text"

    # SQLite columns can be declared with no type at all
    if name.endswith("_at") or name in ("created", "updated", "timestamp"):
        return "timestamp"
    if name == "id" or name.endswith("_id"):
        return "text"
    return "text"


def is_sensitive(column_name: str) -> bool:
    name = (column_name or "").lower()
    return any(pattern in name for pattern in SENSITIVE_NAME_PATTERNS)


def is_monospace(kind: str, column_name: str) -> bool:
    """IDs, hashes and structured values read better in a monospace font."""
    if kind in ("uuid", "json", "binary"):
        return True
    name = (column_name or "").lower()
    return name == "id" or name.endswith("_id") or "hash" in name
