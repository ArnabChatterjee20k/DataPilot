import time
from typing import Annotated, Any, Optional

from fastapi import APIRouter, HTTPException, Query, status

from .. import serialization
from .. import sql as sql_analysis
from ..config import AppConfig, supports_schemas
from ..models import (
    ColumnModel,
    IndexModel,
    QueryResult,
    QueryRiskModel,
    RowPageModel,
    SchemaModel,
    SchemaModelList,
    TableModel,
    TableModelList,
    TableSchemaModel,
)
from ..database.db import DBSession
from ..storage import open_session
from .connections import load_connection

router = APIRouter(tags=["queries"])


def to_column_model(name: str, db_type: Optional[str], **overrides) -> ColumnModel:
    kind = sql_analysis.semantic_kind(db_type, name)
    return ColumnModel(
        name=name,
        type=db_type,
        kind=kind,
        sensitive=sql_analysis.is_sensitive(name),
        monospace=sql_analysis.is_monospace(kind, name),
        **overrides,
    )


def columns_from_info(columns) -> list[ColumnModel]:
    return [
        to_column_model(
            column.name,
            column.type,
            nullable=column.nullable,
            default=None if column.default is None else str(column.default),
            primary_key=column.primary_key,
            indexed=column.indexed,
            position=column.position,
        )
        for column in columns
    ]


def columns_from_description(description, known: dict[str, ColumnModel]):
    """Describe a result set, enriching with table metadata where names match."""
    columns = []
    for position, entry in enumerate(description or [], start=1):
        name = entry.get("name")
        existing = known.get(name)
        if existing:
            columns.append(existing.model_copy(update={"position": position}))
        else:
            columns.append(
                to_column_model(name, entry.get("type"), position=position)
            )
    return columns


def split_entity(entity_name: str, schema: Optional[str]):
    if "." in entity_name:
        entity_schema, _, table = entity_name.partition(".")
        return entity_schema, table
    return schema, entity_name


async def table_columns(session, entity_name: str, schema: Optional[str]):
    entity_schema, table = split_entity(entity_name, schema)
    try:
        return await session.get_columns(table, entity_schema)
    except Exception:
        return []


@router.get("/connection/{connection_id}/schema", response_model=SchemaModelList)
async def get_schemas(connection_id: str, db: DBSession):
    """List schemas for a connection. Backends without schemas return an empty list."""
    connection = await load_connection(db, connection_id)
    if not supports_schemas(connection.source):
        return SchemaModelList(schemas=[], total=0)

    async with open_session(connection) as session:
        names = await session.get_schemas()

    schemas = [SchemaModel(name=name) for name in names]
    return SchemaModelList(schemas=schemas, total=len(schemas))


@router.get("/connection/{connection_id}/table", response_model=TableModelList)
async def get_tables(
    connection_id: str,
    db: DBSession,
    schema: Annotated[Optional[str], Query()] = None,
):
    """List the tables of a connection, optionally within a schema."""
    connection = await load_connection(db, connection_id)

    async with open_session(connection) as session:
        names = await session.get_tables(schema)

    tables = [TableModel(name=name) for name in names]
    return TableModelList(tables=tables, total=len(tables))


@router.get(
    "/connection/{connection_id}/entities/{entity_name}/columns",
    response_model=TableSchemaModel,
)
async def get_entity_columns(
    connection_id: str,
    entity_name: str,
    db: DBSession,
    schema: Annotated[Optional[str], Query()] = None,
    include_row_count: Annotated[bool, Query()] = True,
):
    """Column types, nullability, defaults, primary key and indexes for a table."""
    connection = await load_connection(db, connection_id)
    entity_schema, table = split_entity(entity_name, schema)

    async with open_session(connection) as session:
        column_info = await session.get_columns(table, entity_schema)
        if not column_info:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Table '{entity_name}' was not found on this connection",
            )
        indexes = await session.get_indexes(table, entity_schema)
        row_count = None
        if include_row_count:
            try:
                row_count = await session.count(table, entity_schema)
            except Exception:
                row_count = None

    columns = columns_from_info(column_info)
    return TableSchemaModel(
        connection_id=connection_id,
        entity_name=entity_name,
        schema_name=entity_schema,
        columns=columns,
        indexes=[
            IndexModel(
                name=index.name,
                columns=index.columns,
                unique=index.unique,
                primary=index.primary,
            )
            for index in indexes
        ],
        primary_key=[column.name for column in columns if column.primary_key],
        row_count=row_count,
        total=len(columns),
    )


@router.get(
    "/connection/{connection_id}/entities/{entity_name}/rows",
    response_model=RowPageModel,
)
async def get_entity_rows(
    connection_id: str,
    entity_name: str,
    db: DBSession,
    schema: Annotated[Optional[str], Query()] = None,
    limit: Annotated[int, Query(ge=1, le=AppConfig.MAX_ROWS)] = AppConfig.DEFAULT_ROWS,
    offset: Annotated[Optional[int], Query(ge=0)] = None,
    after: Annotated[Optional[str], Query()] = None,
    order_by: Annotated[Optional[str], Query()] = None,
):
    """Read a page of rows with a stable ordering.

    When the table has a single-column primary key the page is fetched with a
    keyset scan (`WHERE pk > after`), which stays correct and fast as the offset
    grows. Otherwise it falls back to OFFSET and says so in `warnings`.
    """
    connection = await load_connection(db, connection_id)
    entity_schema, table = split_entity(entity_name, schema)
    warnings: list[str] = []

    async with open_session(connection) as session:
        column_info = await session.get_columns(table, entity_schema)
        if not column_info:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Table '{entity_name}' was not found on this connection",
            )

        columns = columns_from_info(column_info)
        by_name = {column.name: column for column in columns}
        primary_key = [column.name for column in columns if column.primary_key]

        cursor_column = order_by or (primary_key[0] if len(primary_key) == 1 else None)
        if order_by and order_by not in by_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown column '{order_by}' on '{entity_name}'",
            )

        qualified = session.quote_identifier(table, entity_schema)
        values: list[Any] = []
        where = ""
        keyset = False

        if cursor_column:
            ordering = f" ORDER BY {session.quote_identifier(cursor_column)} ASC"
        else:
            ordering = ""
            warnings.append(
                "Table has no single-column primary key, so row order is not "
                "guaranteed between pages"
            )

        if after is not None and cursor_column:
            placeholder = session.__class__.get_placeholder(1)
            where = f" WHERE {session.quote_identifier(cursor_column)} > {placeholder}"
            values.append(coerce_cursor(after, by_name.get(cursor_column)))
            keyset = True
        elif offset:
            if offset >= sql_analysis.LARGE_OFFSET:
                warnings.append(
                    f"OFFSET {offset:,} scans and discards every earlier row; "
                    "paging with `after` stays fast"
                )

        query = f"SELECT * FROM {qualified}{where}{ordering} LIMIT {limit}"
        if not keyset and offset:
            query += f" OFFSET {offset}"

        started = time.perf_counter()
        result = await session.execute(query, values) if values else await session.execute(query)
        elapsed = (time.perf_counter() - started) * 1000

        try:
            total_rows = await session.count(table, entity_schema)
        except Exception:
            total_rows = None

    rows = serialization.jsonable_rows(result.rows or [])
    next_cursor = None
    if cursor_column and len(rows) == limit:
        last = rows[-1].get(cursor_column)
        next_cursor = None if last is None else str(last)

    return RowPageModel(
        connection_id=connection_id,
        entity_name=entity_name,
        schema_name=entity_schema,
        rows=rows,
        columns=columns_from_description(result.description, by_name),
        row_count=len(rows),
        total_rows=total_rows,
        limit=limit,
        offset=offset,
        next_cursor=next_cursor,
        cursor_column=cursor_column,
        keyset=keyset,
        query=query,
        execution_time_ms=round(elapsed, 2),
        warnings=warnings,
    )


def coerce_cursor(value: str, column: Optional[ColumnModel]):
    if column is not None and column.kind == "number":
        try:
            return int(value)
        except ValueError:
            try:
                return float(value)
            except ValueError:
                return value
    return value


@router.get(
    "/connection/{connection_id}/entities/{entity_name}/queries",
    response_model=QueryResult,
)
async def execute_query(
    connection_id: str,
    entity_name: str,
    db: DBSession,
    query: Annotated[str, Query()],
    limit: Annotated[Optional[int], Query()] = None,
    offset: Annotated[Optional[int], Query()] = None,
    schema: Annotated[Optional[str], Query()] = None,
    allow_writes: Annotated[bool, Query()] = False,
):
    """Run an arbitrary query, reporting its risk, timing and column metadata.

    A connection marked read-only rejects anything that writes unless the caller
    explicitly passes `allow_writes`.
    """
    connection = await load_connection(db, connection_id)

    if not (query or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Query is empty"
        )

    risk = sql_analysis.analyze(query)
    if not risk.read_only and getattr(connection, "read_only", True) and not allow_writes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"This connection is read-only and the query is a {risk.statement}. "
                "Turn off read-only on the connection, or re-run with writes allowed."
            ),
        )

    statement = sql_analysis.apply_limit_offset(query, limit, offset)
    # report the risk of what actually runs: appending LIMIT/OFFSET can clear
    # the "no LIMIT" warning the raw query would have raised
    risk = sql_analysis.analyze(statement)

    async with open_session(connection) as session:
        known = {
            column.name: column
            for column in columns_from_info(
                await table_columns(session, entity_name, schema)
            )
        }

        started = time.perf_counter()
        result = await session.execute(statement, force_commit=not risk.read_only)
        elapsed = (time.perf_counter() - started) * 1000

    rows = serialization.jsonable_rows(result.rows or [])
    truncated = bool(limit) and len(rows) >= limit

    return QueryResult(
        rows=rows,
        columns=columns_from_description(result.description, known),
        entity_name=entity_name,
        connection_id=connection_id,
        query=statement,
        limit=limit,
        offset=offset,
        row_count=len(rows),
        rows_affected=result.rows_affected,
        returns_rows=result.returns_rows,
        truncated=truncated,
        execution_time_ms=round(elapsed, 2),
        risk=QueryRiskModel(**risk.to_dict()),
    )
