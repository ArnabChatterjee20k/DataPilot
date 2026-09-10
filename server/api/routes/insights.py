import time
from typing import Annotated, Optional

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from .. import insights as plan_insights
from .. import serialization
from .. import sql as sql_analysis
from ..config import AppConfig
from ..models import (
    ColumnStatsModel,
    QueryInsightModel,
    TableStatsModel,
    ValueCountModel,
)
from ..database.db import DBSession
from ..storage import open_session
from .connections import load_connection
from .queries import columns_from_info, split_entity

router = APIRouter(tags=["insights"])

#: Stats read at most this many rows before falling back to a sample.
STATS_SAMPLE_ROWS = 20_000
#: Beyond this many columns, per-column top values cost more than they are worth.
TOP_VALUE_COLUMN_LIMIT = 40
TOP_VALUES = 5
#: Kinds that have no usable equality/ordering for GROUP BY on every backend.
UNGROUPABLE_KINDS = {"json", "binary"}

MAX_EXPORT_ROWS = 100_000


@router.get(
    "/connection/{connection_id}/entities/{entity_name}/explain",
    response_model=QueryInsightModel,
)
async def explain_query(
    connection_id: str,
    entity_name: str,
    db: DBSession,
    query: Annotated[str, Query()],
):
    """Report the plan for a query without executing it.

    Says whether an index is used, how many rows the planner expects and which
    speed bucket that falls into.
    """
    connection = await load_connection(db, connection_id)

    if not (query or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Query is empty"
        )

    risk = sql_analysis.analyze(query)
    if risk.statement_count > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Explain works on a single statement at a time",
        )

    statement = plan_insights.explain_statement(connection.source, query)
    async with open_session(connection) as session:
        result = await session.execute(statement)

    insight = plan_insights.parse(connection.source, result.rows or [])
    return QueryInsightModel(
        connection_id=connection_id,
        query=query,
        **insight.to_dict(),
    )


@router.get(
    "/connection/{connection_id}/entities/{entity_name}/stats",
    response_model=TableStatsModel,
)
async def get_entity_stats(
    connection_id: str,
    entity_name: str,
    db: DBSession,
    schema: Annotated[Optional[str], Query()] = None,
    top_values: Annotated[bool, Query()] = True,
    sample: Annotated[int, Query(ge=100, le=1_000_000)] = STATS_SAMPLE_ROWS,
):
    """Null share, distinct count and most common values, per column."""
    connection = await load_connection(db, connection_id)
    entity_schema, table = split_entity(entity_name, schema)
    started = time.perf_counter()

    async with open_session(connection) as session:
        column_info = await session.get_columns(table, entity_schema)
        if not column_info:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Table '{entity_name}' was not found on this connection",
            )

        columns = columns_from_info(column_info)
        quote = session.quote_identifier
        qualified = quote(table, entity_schema)
        source = f"(SELECT * FROM {qualified} LIMIT {sample}) AS stats_sample"

        aggregates = ["COUNT(*) AS total_rows"]
        for index, column in enumerate(columns):
            name = quote(column.name)
            aggregates.append(f"COUNT({name}) AS nonnull_{index}")
            if column.kind not in UNGROUPABLE_KINDS:
                aggregates.append(f"COUNT(DISTINCT {name}) AS distinct_{index}")

        summary = await session.execute(
            f"SELECT {', '.join(aggregates)} FROM {source}"
        )
        totals = (summary.rows or [{}])[0]
        scanned = int(totals.get("total_rows") or 0)

        try:
            row_count = await session.count(table, entity_schema)
        except Exception:
            row_count = scanned

        stats = []
        for index, column in enumerate(columns):
            non_null = int(totals.get(f"nonnull_{index}") or 0)
            nulls = max(scanned - non_null, 0)
            distinct = totals.get(f"distinct_{index}")
            stats.append(
                ColumnStatsModel(
                    name=column.name,
                    kind=column.kind,
                    null_count=nulls,
                    null_percent=round(nulls / scanned * 100, 2) if scanned else 0.0,
                    distinct_count=None if distinct is None else int(distinct),
                )
            )

        should_rank = (
            top_values and scanned > 0 and len(columns) <= TOP_VALUE_COLUMN_LIMIT
        )
        if should_rank:
            for column, entry in zip(columns, stats):
                if column.kind in UNGROUPABLE_KINDS or column.sensitive:
                    continue
                name = quote(column.name)
                ranked = await session.execute(
                    f"SELECT {name} AS value, COUNT(*) AS occurrences FROM {source} "
                    f"WHERE {name} IS NOT NULL "
                    f"GROUP BY {name} ORDER BY COUNT(*) DESC, {name} ASC "
                    f"LIMIT {TOP_VALUES}"
                )
                entry.top_values = [
                    ValueCountModel(
                        value=serialization.to_jsonable(row.get("value")),
                        count=int(row.get("occurrences") or 0),
                    )
                    for row in (ranked.rows or [])
                ]

    return TableStatsModel(
        connection_id=connection_id,
        entity_name=entity_name,
        schema_name=entity_schema,
        row_count=row_count,
        scanned_rows=scanned,
        sampled=scanned >= sample and row_count > scanned,
        columns=stats,
        execution_time_ms=round((time.perf_counter() - started) * 1000, 2),
    )


@router.get("/connection/{connection_id}/entities/{entity_name}/export")
async def export_entity(
    connection_id: str,
    entity_name: str,
    db: DBSession,
    schema: Annotated[Optional[str], Query()] = None,
    query: Annotated[Optional[str], Query()] = None,
    columns: Annotated[Optional[str], Query()] = None,
    format: Annotated[str, Query(pattern="^(csv|json|ndjson)$")] = "csv",
    limit: Annotated[int, Query(ge=1, le=MAX_EXPORT_ROWS)] = AppConfig.MAX_ROWS,
):
    """Export rows as CSV, JSON or NDJSON.

    Exports what the user is looking at: pass the same `query` the grid ran and
    a `columns` list to keep only the visible columns, in their displayed order.
    Values keep their type — timestamps go out as ISO 8601, UUIDs as text, JSON
    as JSON, binary as base64.
    """
    connection = await load_connection(db, connection_id)
    entity_schema, table = split_entity(entity_name, schema)

    if query and not sql_analysis.is_read_only(query):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only read-only queries can be exported",
        )

    async with open_session(connection) as session:
        if query:
            statement = sql_analysis.apply_limit_offset(query, limit, None)
        else:
            column_info = await session.get_columns(table, entity_schema)
            if not column_info:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Table '{entity_name}' was not found on this connection",
                )
            primary_key = [column.name for column in column_info if column.primary_key]
            ordering = (
                f" ORDER BY {session.quote_identifier(primary_key[0])} ASC"
                if len(primary_key) == 1
                else ""
            )
            statement = (
                f"SELECT * FROM {session.quote_identifier(table, entity_schema)}"
                f"{ordering} LIMIT {limit}"
            )

        result = await session.execute(statement)

    available = result.columns
    chosen, unknown = serialization.resolve_columns(available, columns)
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown column(s): {', '.join(unknown)}",
        )
    if not chosen:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No columns selected for export",
        )

    media_type, extension, renderer = serialization.FORMATS[format]
    filename = f"{table}.{extension}"
    return StreamingResponse(
        renderer(result.rows or [], chosen),
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Row-Count": str(len(result.rows or [])),
        },
    )
