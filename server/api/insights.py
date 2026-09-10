"""Reading query plans, without running the query.

`EXPLAIN` speaks a different dialect on every backend; this reduces both to the
handful of facts a UI can act on: which scans happen, whether an index is used,
how many rows are expected and roughly how fast that will be.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Optional

FAST = "fast"
MEDIUM = "medium"
SLOW = "slow"

#: PostgreSQL total-cost thresholds separating the three speed buckets.
PG_FAST_COST = 100.0
PG_SLOW_COST = 10_000.0

#: Row-count thresholds used when only an estimate is available (SQLite).
FAST_ROWS = 1_000
SLOW_ROWS = 100_000

_SQLITE_SCAN = re.compile(
    r"^(?P<kind>SCAN|SEARCH)\s+(?:TABLE\s+)?(?P<table>[^\s]+)"
    r"(?:.*?USING\s+(?:COVERING\s+)?(?:INDEX|PRIMARY KEY)\s*(?P<index>[^\s(]+)?)?",
    re.IGNORECASE,
)


@dataclass
class Scan:
    table: Optional[str]
    type: str
    index: Optional[str] = None
    detail: str = ""
    estimated_rows: Optional[int] = None

    def to_dict(self) -> dict:
        return {
            "table": self.table,
            "type": self.type,
            "index": self.index,
            "detail": self.detail,
            "estimated_rows": self.estimated_rows,
        }


@dataclass
class QueryInsight:
    supported: bool = True
    scans: list[Scan] = field(default_factory=list)
    estimated_rows: Optional[int] = None
    estimated_cost: Optional[float] = None
    speed: Optional[str] = None
    uses_index: bool = False
    warnings: list[str] = field(default_factory=list)
    plan: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "supported": self.supported,
            "scans": [scan.to_dict() for scan in self.scans],
            "estimated_rows": self.estimated_rows,
            "estimated_cost": self.estimated_cost,
            "speed": self.speed,
            "uses_index": self.uses_index,
            "warnings": list(self.warnings),
            "plan": list(self.plan),
        }


def explain_statement(source: str, query: str) -> str:
    statement = (query or "").strip().rstrip(";")
    if source == "postgres":
        return f"EXPLAIN (FORMAT JSON) {statement}"
    if source == "mysql":
        return f"EXPLAIN FORMAT=JSON {statement}"
    return f"EXPLAIN QUERY PLAN {statement}"


def speed_from_cost(cost: Optional[float], rows: Optional[int]) -> Optional[str]:
    if cost is not None:
        if cost < PG_FAST_COST:
            return FAST
        return MEDIUM if cost < PG_SLOW_COST else SLOW
    if rows is not None:
        if rows < FAST_ROWS:
            return FAST
        return MEDIUM if rows < SLOW_ROWS else SLOW
    return None


def parse(source: str, rows: list[dict]) -> QueryInsight:
    if source == "postgres":
        return _parse_postgres(rows)
    if source == "mysql":
        return _parse_mysql(rows)
    return _parse_sqlite(rows)


def _parse_postgres(rows: list[dict]) -> QueryInsight:
    if not rows:
        return QueryInsight(supported=False)

    payload = next(iter(rows[0].values()))
    if isinstance(payload, str):
        payload = json.loads(payload)
    if not payload:
        return QueryInsight(supported=False)

    root = payload[0].get("Plan", {}) if isinstance(payload, list) else {}
    insight = QueryInsight(plan=payload if isinstance(payload, list) else [payload])
    insight.estimated_cost = root.get("Total Cost")
    insight.estimated_rows = root.get("Plan Rows")

    def walk(node: dict):
        node_type = node.get("Node Type", "")
        relation = node.get("Relation Name")
        if "Scan" in node_type:
            if node_type.startswith("Seq Scan"):
                scan_type = "sequential"
            elif "Index" in node_type or "Bitmap" in node_type:
                scan_type = "index"
            else:
                scan_type = node_type.lower()
            insight.scans.append(
                Scan(
                    table=relation,
                    type=scan_type,
                    index=node.get("Index Name"),
                    detail=node_type,
                    estimated_rows=node.get("Plan Rows"),
                )
            )
        for child in node.get("Plans", []) or []:
            walk(child)

    walk(root)
    _finalise(insight)
    return insight


#: MySQL access types that read rows without consulting an index.
MYSQL_SEQUENTIAL_ACCESS = {"ALL", "unknown"}


def _parse_mysql(rows: list[dict]) -> QueryInsight:
    """MySQL nests its plan under query_block, with tables appearing inside
    nested_loop, ordering_operation, grouping_operation and materialised
    subqueries - so every "table" entry is collected by walking the tree."""
    if not rows:
        return QueryInsight(supported=False)

    payload = next(iter(rows[0].values()))
    if isinstance(payload, (bytes, bytearray)):
        payload = payload.decode("utf-8")
    if isinstance(payload, str):
        payload = json.loads(payload)
    if not isinstance(payload, dict):
        return QueryInsight(supported=False)

    block = payload.get("query_block", {})
    insight = QueryInsight(plan=[payload])

    cost = (block.get("cost_info") or {}).get("query_cost")
    if cost is not None:
        try:
            insight.estimated_cost = float(cost)
        except (TypeError, ValueError):
            insight.estimated_cost = None

    def walk(node):
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, dict):
            return

        table = node.get("table")
        if isinstance(table, dict):
            access = table.get("access_type") or "unknown"
            insight.scans.append(
                Scan(
                    table=table.get("table_name"),
                    type=(
                        "sequential"
                        if access in MYSQL_SEQUENTIAL_ACCESS
                        else "index"
                    ),
                    index=table.get("key"),
                    detail=access,
                    estimated_rows=table.get("rows_examined_per_scan"),
                )
            )

        for key, value in node.items():
            if key != "table":
                walk(value)

    walk(block)

    if insight.scans:
        insight.estimated_rows = max(
            (scan.estimated_rows or 0) for scan in insight.scans
        )

    _finalise(insight)
    return insight


def _parse_sqlite(rows: list[dict]) -> QueryInsight:
    insight = QueryInsight(plan=rows)

    for row in rows:
        detail = str(row.get("detail") or "")
        if not detail:
            continue
        match = _SQLITE_SCAN.match(detail.strip())
        if not match:
            continue
        uses_index = bool(match.group("index")) or "USING" in detail.upper()
        insight.scans.append(
            Scan(
                table=match.group("table"),
                type="index" if uses_index else "sequential",
                index=match.group("index"),
                detail=detail,
            )
        )

    _finalise(insight)
    return insight


def _finalise(insight: QueryInsight) -> None:
    insight.uses_index = any(scan.type == "index" for scan in insight.scans)
    sequential = [scan for scan in insight.scans if scan.type == "sequential"]

    insight.speed = speed_from_cost(insight.estimated_cost, insight.estimated_rows)
    if insight.speed is None and insight.scans:
        insight.speed = MEDIUM if sequential else FAST

    for scan in sequential:
        where = f" on {scan.table}" if scan.table else ""
        insight.warnings.append(
            f"Sequential scan{where}: every row is read because no index matches "
            "the filter"
        )
    if len(sequential) > 1 and insight.speed == MEDIUM:
        insight.speed = SLOW
