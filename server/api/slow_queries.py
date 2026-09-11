"""The slow statements the database itself already knows about.

Timing the queries DataPilot happens to run tells you about DataPilot. Both
PostgreSQL and MySQL keep their own record of every statement the server has
executed, normalised into a digest with call counts and timings, and that is
the thing worth reading: it covers the application's traffic, not this tool's.

* PostgreSQL: `pg_stat_statements`, which needs the extension installed and
  the library preloaded.
* MySQL: `performance_schema.events_statements_summary_by_digest`, which is on
  by default but can be compiled or configured out.
* SQLite: there is no such view, and saying so is better than an empty table.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional

from .config import SourceConfig

#: Rows read from the server's own view in one go.
DEFAULT_LIMIT = 50
MAX_LIMIT = 500

#: MySQL's performance schema counts in picoseconds.
PICOSECONDS_PER_MS = 1_000_000_000


@dataclass
class SlowQuery:
    """One normalised statement, in the same shape whatever the backend."""

    digest: str
    statement: str
    calls: int = 0
    total_ms: float = 0.0
    mean_ms: float = 0.0
    max_ms: Optional[float] = None
    rows: int = 0
    rows_per_call: float = 0.0
    #: MySQL knows how many rows were read to produce those returned.
    rows_examined: Optional[int] = None
    first_seen: Optional[str] = None
    last_seen: Optional[str] = None


@dataclass
class SlowQueryReport:
    source: str
    available: bool
    queries: list[SlowQuery] = field(default_factory=list)
    #: Why there is nothing to show, and what to do about it.
    detail: str = ""
    #: The view the numbers came from, so they can be checked at the source.
    origin: str = ""


UNAVAILABLE = {
    SourceConfig.SQLITE.value: (
        "SQLite does not keep statement statistics - there is no equivalent of "
        "pg_stat_statements, because there is no server to keep them. Use the "
        "Plan tab on an individual query instead."
    ),
}

MISSING_PG_EXTENSION = (
    "pg_stat_statements is not installed on this server. Run "
    "CREATE EXTENSION pg_stat_statements; as a superuser - and if that says "
    "the library is not loaded, add pg_stat_statements to "
    "shared_preload_libraries in postgresql.conf and restart first."
)

PG_NOT_PRELOADED = (
    "pg_stat_statements is installed but not loaded. Add it to "
    "shared_preload_libraries in postgresql.conf and restart the server - the "
    "extension has to be there from startup to be able to count anything."
)

MISSING_MYSQL_SCHEMA = (
    "The performance schema is not available on this server. It is on by "
    "default; check performance_schema=ON in the configuration, and that the "
    "statements_digest consumer is enabled."
)

#: What to sort by. "total" is the default because the statement costing the
#: server most is usually a cheap one run constantly, not a slow one run twice.
ORDERINGS = ("total", "mean", "calls", "rows")
DEFAULT_ORDER = "total"

#: PostgreSQL 13 renamed the timing columns when it split planning from execution.
POSTGRES_MODERN = """
SELECT queryid::text AS digest,
       query AS statement,
       calls,
       total_exec_time AS total_ms,
       mean_exec_time AS mean_ms,
       max_exec_time AS max_ms,
       rows
FROM pg_stat_statements
ORDER BY {order} DESC
LIMIT {limit}
"""

POSTGRES_LEGACY = """
SELECT queryid::text AS digest,
       query AS statement,
       calls,
       total_time AS total_ms,
       mean_time AS mean_ms,
       max_time AS max_ms,
       rows
FROM pg_stat_statements
ORDER BY {order} DESC
LIMIT {limit}
"""

MYSQL_DIGEST = """
SELECT DIGEST AS digest,
       DIGEST_TEXT AS statement,
       COUNT_STAR AS calls,
       SUM_TIMER_WAIT AS total_picoseconds,
       AVG_TIMER_WAIT AS mean_picoseconds,
       MAX_TIMER_WAIT AS max_picoseconds,
       SUM_ROWS_SENT AS rows_sent,
       SUM_ROWS_EXAMINED AS rows_examined,
       FIRST_SEEN AS first_seen,
       LAST_SEEN AS last_seen
FROM performance_schema.events_statements_summary_by_digest
WHERE DIGEST_TEXT IS NOT NULL
ORDER BY {order} DESC
LIMIT {limit}
"""

#: Column names per backend, so the ordering never comes from user input.
ORDER_COLUMNS = {
    SourceConfig.POSTGRES.value: {
        "modern": {
            "total": "total_exec_time",
            "mean": "mean_exec_time",
            "calls": "calls",
            "rows": "rows",
        },
        "legacy": {
            "total": "total_time",
            "mean": "mean_time",
            "calls": "calls",
            "rows": "rows",
        },
    },
    SourceConfig.MYSQL.value: {
        "modern": {
            "total": "SUM_TIMER_WAIT",
            "mean": "AVG_TIMER_WAIT",
            "calls": "COUNT_STAR",
            "rows": "SUM_ROWS_SENT",
        }
    },
}


def clamp(limit: Optional[int]) -> int:
    if not limit or limit < 1:
        return DEFAULT_LIMIT
    return min(int(limit), MAX_LIMIT)


def is_supported(source: str) -> bool:
    return source in (SourceConfig.POSTGRES.value, SourceConfig.MYSQL.value)


def unavailable(source: str, detail: str = "") -> SlowQueryReport:
    return SlowQueryReport(
        source=source,
        available=False,
        detail=detail or UNAVAILABLE.get(source, "This connection keeps no statement statistics."),
    )


def missing_source(source: str, error: Exception) -> Optional[str]:
    """Recognise "the view is not there" and say what to do about it.

    The driver's own words for this are "relation pg_stat_statements does not
    exist", which reads like a bug in DataPilot rather than a server that has
    not had the extension enabled.
    """
    text = str(error).lower()
    if source == SourceConfig.POSTGRES.value and "pg_stat_statements" in text:
        # two different problems with two different fixes: the extension is
        # not created, or it is created but was never loaded at startup
        if "shared_preload_libraries" in text or "must be loaded" in text:
            return PG_NOT_PRELOADED
        return MISSING_PG_EXTENSION
    if source == SourceConfig.MYSQL.value and (
        "performance_schema" in text or "events_statements_summary_by_digest" in text
    ):
        return MISSING_MYSQL_SCHEMA
    return None


def is_legacy_postgres(error: Exception) -> bool:
    """PostgreSQL below 13 has total_time where 13 and above have total_exec_time."""
    text = str(error).lower()
    return "total_exec_time" in text or "mean_exec_time" in text or "max_exec_time" in text


def digest_of(statement: str) -> str:
    """A stable id for a statement that came without one."""
    import hashlib

    return hashlib.sha1(normalise(statement).encode("utf-8")).hexdigest()[:16]


WHITESPACE = re.compile(r"\s+")


def normalise(statement: str) -> str:
    return WHITESPACE.sub(" ", str(statement or "")).strip()


def from_postgres(rows: list[dict]) -> list[SlowQuery]:
    queries = []
    for row in rows:
        calls = int(row.get("calls") or 0)
        rows_returned = int(row.get("rows") or 0)
        queries.append(
            SlowQuery(
                digest=str(row.get("digest") or digest_of(row.get("statement", ""))),
                statement=normalise(row.get("statement", "")),
                calls=calls,
                total_ms=round(float(row.get("total_ms") or 0.0), 3),
                mean_ms=round(float(row.get("mean_ms") or 0.0), 3),
                max_ms=(
                    round(float(row["max_ms"]), 3) if row.get("max_ms") is not None else None
                ),
                rows=rows_returned,
                rows_per_call=round(rows_returned / calls, 2) if calls else 0.0,
            )
        )
    return queries


def from_mysql(rows: list[dict]) -> list[SlowQuery]:
    queries = []
    for row in rows:
        calls = int(row.get("calls") or 0)
        rows_sent = int(row.get("rows_sent") or 0)
        queries.append(
            SlowQuery(
                digest=str(row.get("digest") or digest_of(row.get("statement", ""))),
                statement=normalise(row.get("statement", "")),
                calls=calls,
                total_ms=to_ms(row.get("total_picoseconds")),
                mean_ms=to_ms(row.get("mean_picoseconds")),
                max_ms=to_ms(row.get("max_picoseconds")),
                rows=rows_sent,
                rows_per_call=round(rows_sent / calls, 2) if calls else 0.0,
                rows_examined=int(row.get("rows_examined") or 0),
                first_seen=as_text(row.get("first_seen")),
                last_seen=as_text(row.get("last_seen")),
            )
        )
    return queries


def to_ms(picoseconds: Any) -> float:
    try:
        return round(float(picoseconds or 0) / PICOSECONDS_PER_MS, 3)
    except (TypeError, ValueError):
        return 0.0


def as_text(value: Any) -> Optional[str]:
    return None if value is None else str(value)


def normalise_order(order: Optional[str]) -> str:
    order = (order or "").lower()
    return order if order in ORDERINGS else DEFAULT_ORDER


def statements_for(source: str, limit: int, order: str = DEFAULT_ORDER) -> list[str]:
    """The queries to try, in order; the second is the fallback for an older server.

    The sort column is looked up rather than interpolated, so `order` never
    reaches SQL as anything but one of a handful of known names.
    """
    order = normalise_order(order)
    columns = ORDER_COLUMNS.get(source, {})

    if source == SourceConfig.POSTGRES.value:
        return [
            POSTGRES_MODERN.format(limit=limit, order=columns["modern"][order]),
            POSTGRES_LEGACY.format(limit=limit, order=columns["legacy"][order]),
        ]
    if source == SourceConfig.MYSQL.value:
        return [MYSQL_DIGEST.format(limit=limit, order=columns["modern"][order])]
    return []


def parse(source: str, rows: list[dict]) -> list[SlowQuery]:
    if source == SourceConfig.POSTGRES.value:
        return from_postgres(rows)
    if source == SourceConfig.MYSQL.value:
        return from_mysql(rows)
    return []


def compare(before: list[SlowQuery], after: list[SlowQuery]) -> list[SlowQuery]:
    """What changed between two snapshots, as the difference in each counter.

    The server's counters only ever go up, so two readings apart are what say
    what happened in between - the absolute numbers include every statement
    since the last reset, which may be weeks of unrelated traffic.
    """
    earlier = {query.digest: query for query in before}
    changed: list[SlowQuery] = []

    for query in after:
        was = earlier.get(query.digest)
        calls = query.calls - (was.calls if was else 0)
        total = round(query.total_ms - (was.total_ms if was else 0.0), 3)
        if calls <= 0 and total <= 0:
            continue
        changed.append(
            SlowQuery(
                digest=query.digest,
                statement=query.statement,
                calls=calls,
                total_ms=total,
                mean_ms=round(total / calls, 3) if calls else 0.0,
                max_ms=query.max_ms,
                rows=query.rows - (was.rows if was else 0),
                rows_per_call=(
                    round((query.rows - (was.rows if was else 0)) / calls, 2)
                    if calls
                    else 0.0
                ),
                rows_examined=query.rows_examined,
                first_seen=query.first_seen,
                last_seen=query.last_seen,
            )
        )

    changed.sort(key=lambda query: query.total_ms, reverse=True)
    return changed
