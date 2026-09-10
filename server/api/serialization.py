"""Turning database values into something a browser can read.

Adapters hand back native Python objects — `datetime`, `Decimal`, `UUID`,
`memoryview`, asyncpg `Range` — none of which survive `json.dumps` unaided.
"""

from __future__ import annotations

import base64
import csv
import io
import json
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any, Iterable, Optional
from uuid import UUID


def to_jsonable(value: Any) -> Any:
    """Coerce one database value into something JSON can carry."""
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        # NaN/Infinity are not valid JSON
        return value if value == value and abs(value) != float("inf") else None
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, timedelta):
        return value.total_seconds()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return base64.b64encode(bytes(value)).decode("ascii")
    if isinstance(value, (list, tuple, set)):
        return [to_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    return str(value)


def jsonable_rows(rows: Iterable[dict]) -> list[dict]:
    return [{key: to_jsonable(value) for key, value in row.items()} for row in rows]


def to_cell(value: Any) -> str:
    """Render one value for a CSV cell, keeping structure readable."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    coerced = to_jsonable(value)
    if isinstance(coerced, (dict, list)):
        return json.dumps(coerced, ensure_ascii=False)
    return str(coerced)


def csv_stream(rows: Iterable[dict], columns: list[str]):
    """Yield a CSV document one row at a time."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")

    def flush() -> str:
        buffer.seek(0)
        chunk = buffer.read()
        buffer.seek(0)
        buffer.truncate(0)
        return chunk

    writer.writerow(columns)
    yield flush()

    for row in rows:
        writer.writerow([to_cell(row.get(column)) for column in columns])
        yield flush()


def ndjson_stream(rows: Iterable[dict], columns: list[str]):
    for row in rows:
        payload = {column: to_jsonable(row.get(column)) for column in columns}
        yield json.dumps(payload, ensure_ascii=False) + "\n"


def json_stream(rows: Iterable[dict], columns: list[str]):
    yield "["
    first = True
    for row in rows:
        payload = {column: to_jsonable(row.get(column)) for column in columns}
        yield ("" if first else ",") + json.dumps(payload, ensure_ascii=False)
        first = False
    yield "]"


FORMATS = {
    "csv": ("text/csv; charset=utf-8", "csv", csv_stream),
    "json": ("application/json", "json", json_stream),
    "ndjson": ("application/x-ndjson", "ndjson", ndjson_stream),
}


def resolve_columns(
    available: list[str], requested: Optional[str]
) -> tuple[list[str], list[str]]:
    """Pick the export columns, keeping the result-set order.

    Returns the chosen columns and any requested names that do not exist.
    """
    if not requested:
        return available, []

    wanted = [name.strip() for name in requested.split(",") if name.strip()]
    unknown = [name for name in wanted if name not in available]
    chosen = [name for name in available if name in wanted]
    return chosen, unknown
