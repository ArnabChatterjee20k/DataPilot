"""Reading, storing and comparing the server's own slow-statement records."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Annotated, Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, status

from .. import slow_queries
from ..config import SourceConfig
from ..models import (
    SlowQueryModel,
    SlowQueryReportModel,
    SnapshotComparisonModel,
    SnapshotDetailModel,
    SnapshotListModel,
    SnapshotModel,
)
from ..database.db import DBSession
from ..database.models import QueryLogs
from ..storage import open_session, to_http_error
from .connections import load_connection

router = APIRouter(tags=["slow-queries"])

#: Snapshots are one row each, holding the whole reading.
SNAPSHOT_KIND = "slow-query-snapshot"


async def read_report(
    connection,
    limit: Optional[int] = None,
    order: str = slow_queries.DEFAULT_ORDER,
) -> slow_queries.SlowQueryReport:
    """Ask the server for its own record of what has been slow.

    An older PostgreSQL names the timing columns differently, so the modern
    query is tried first and the legacy one is the fallback - which is cheaper
    than asking for the server version to decide.
    """
    source = connection.source
    if not slow_queries.is_supported(source):
        return slow_queries.unavailable(source)

    statements = slow_queries.statements_for(source, slow_queries.clamp(limit), order)
    last_error: Optional[Exception] = None

    async with open_session(connection) as session:
        for index, statement in enumerate(statements):
            try:
                result = await session.execute(statement)
            except Exception as error:  # noqa: BLE001 - classified just below
                last_error = error
                missing = slow_queries.missing_source(source, error)
                if missing:
                    return slow_queries.unavailable(source, missing)
                # an older server names the columns differently; try the next
                if index + 1 < len(statements) and slow_queries.is_legacy_postgres(error):
                    continue
                raise to_http_error(error, str(connection.connection_uri)) from error

            return slow_queries.SlowQueryReport(
                source=source,
                available=True,
                queries=slow_queries.parse(source, result.rows or []),
                origin=(
                    "pg_stat_statements"
                    if source == SourceConfig.POSTGRES.value
                    else "performance_schema.events_statements_summary_by_digest"
                ),
            )

    if last_error:
        raise to_http_error(last_error, str(connection.connection_uri))
    return slow_queries.unavailable(source)


def to_model(query: slow_queries.SlowQuery) -> SlowQueryModel:
    return SlowQueryModel(**vars(query))


def from_stored(payload: dict) -> slow_queries.SlowQuery:
    return slow_queries.SlowQuery(
        **{
            field: payload.get(field)
            for field in slow_queries.SlowQuery.__dataclass_fields__
            if payload.get(field) is not None
        }
    )


def snapshot_summary(record) -> SnapshotModel:
    values = record.get_values()
    meta = values.get("metadata") or {}
    return SnapshotModel(
        uid=values["uid"],
        connection_id=values["connection_id"],
        taken_at=str(meta.get("taken_at") or ""),
        source=str(meta.get("source") or ""),
        query_count=int(meta.get("query_count") or 0),
        total_ms=float(meta.get("total_ms") or 0.0),
        note=str(meta.get("note") or ""),
    )


def stored_queries(record) -> list[slow_queries.SlowQuery]:
    meta = record.get_values().get("metadata") or {}
    payload = meta.get("queries")
    if isinstance(payload, str):
        payload = json.loads(payload)
    return [from_stored(item) for item in (payload or [])]


async def load_snapshot(db: DBSession, connection_id: str, snapshot_uid: str):
    record = await db.get(QueryLogs, filters=QueryLogs.uid == snapshot_uid)
    if not record or record.get_values().get("connection_id") != connection_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Snapshot {snapshot_uid} not found on this connection",
        )
    return record


@router.get(
    "/connection/{connection_id}/slow-queries", response_model=SlowQueryReportModel
)
async def get_slow_queries(
    connection_id: str,
    db: DBSession,
    limit: Annotated[Optional[int], Query(ge=1, le=slow_queries.MAX_LIMIT)] = None,
    order_by: Annotated[str, Query()] = slow_queries.DEFAULT_ORDER,
):
    """The slowest statements the server itself has recorded.

    Not the queries DataPilot has run - those would only describe DataPilot.
    """
    connection = await load_connection(db, connection_id)
    report = await read_report(connection, limit=limit, order=order_by)
    return SlowQueryReportModel(
        connection_id=connection_id,
        source=report.source,
        available=report.available,
        detail=report.detail,
        origin=report.origin,
        queries=[to_model(query) for query in report.queries],
    )


@router.post(
    "/connection/{connection_id}/slow-queries/snapshots",
    response_model=SnapshotDetailModel,
)
async def take_snapshot(
    connection_id: str,
    db: DBSession,
    note: Annotated[str, Query()] = "",
):
    """Store the current reading.

    The server's counters only ever go up and are lost on a reset or a
    restart, so a reading kept here is what makes "what changed since
    yesterday" answerable at all.
    """
    connection = await load_connection(db, connection_id)
    # a snapshot is only worth comparing if it covers everything, so it reads
    # as much as the server will give rather than the screenful a list shows
    report = await read_report(connection, limit=slow_queries.MAX_LIMIT)

    if not report.available:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=report.detail or "There are no statement statistics to snapshot.",
        )

    taken_at = datetime.now(timezone.utc).isoformat()
    uid = str(uuid4())
    queries = [vars(query) for query in report.queries]

    await db.create(
        QueryLogs(
            uid=uid,
            connection_id=connection_id,
            query=SNAPSHOT_KIND,
            metadata={
                "kind": SNAPSHOT_KIND,
                "taken_at": taken_at,
                "source": report.source,
                "origin": report.origin,
                "note": note,
                "query_count": len(queries),
                "total_ms": round(sum(query["total_ms"] for query in queries), 3),
                "queries": queries,
            },
        )
    )
    await db.commit()

    return SnapshotDetailModel(
        snapshot=SnapshotModel(
            uid=uid,
            connection_id=connection_id,
            taken_at=taken_at,
            source=report.source,
            query_count=len(queries),
            total_ms=round(sum(query["total_ms"] for query in queries), 3),
            note=note,
        ),
        queries=[to_model(query) for query in report.queries],
    )


@router.get(
    "/connection/{connection_id}/slow-queries/snapshots",
    response_model=SnapshotListModel,
)
async def list_snapshots(connection_id: str, db: DBSession):
    await load_connection(db, connection_id)
    records = await db.list(QueryLogs, filters=QueryLogs.connection_id == connection_id, limit=-1)

    snapshots = [
        snapshot_summary(record)
        for record in records
        if (record.get_values().get("metadata") or {}).get("kind") == SNAPSHOT_KIND
    ]
    snapshots.sort(key=lambda snapshot: snapshot.taken_at, reverse=True)
    return SnapshotListModel(snapshots=snapshots, total=len(snapshots))


@router.get(
    "/connection/{connection_id}/slow-queries/snapshots/{snapshot_uid}",
    response_model=SnapshotDetailModel,
)
async def get_snapshot(connection_id: str, snapshot_uid: str, db: DBSession):
    record = await load_snapshot(db, connection_id, snapshot_uid)
    return SnapshotDetailModel(
        snapshot=snapshot_summary(record),
        queries=[to_model(query) for query in stored_queries(record)],
    )


@router.delete(
    "/connection/{connection_id}/slow-queries/snapshots/{snapshot_uid}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_snapshot(connection_id: str, snapshot_uid: str, db: DBSession):
    await load_snapshot(db, connection_id, snapshot_uid)
    await db.delete(QueryLogs, QueryLogs.uid == snapshot_uid)
    await db.commit()


@router.get(
    "/connection/{connection_id}/slow-queries/compare",
    response_model=SnapshotComparisonModel,
)
async def compare_snapshots(
    connection_id: str,
    db: DBSession,
    before: Annotated[str, Query()],
    after: Annotated[Optional[str], Query()] = None,
):
    """What happened between two readings.

    The absolute numbers include every statement since the counters were last
    reset, which may be weeks of traffic that has nothing to do with the change
    you are looking at. The difference is the answer.
    """
    connection = await load_connection(db, connection_id)
    earlier = await load_snapshot(db, connection_id, before)

    if after:
        later = await load_snapshot(db, connection_id, after)
        later_summary = snapshot_summary(later)
        later_queries = stored_queries(later)
    else:
        # comparing against now is the common case, and needs no second stored
        # reading to have been taken first
        report = await read_report(connection, limit=slow_queries.MAX_LIMIT)
        if not report.available:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=report.detail
            )
        later_queries = report.queries
        later_summary = SnapshotModel(
            uid="now",
            connection_id=connection_id,
            taken_at=datetime.now(timezone.utc).isoformat(),
            source=report.source,
            query_count=len(later_queries),
            total_ms=round(sum(query.total_ms for query in later_queries), 3),
            note="live",
        )

    difference = slow_queries.compare(stored_queries(earlier), later_queries)
    return SnapshotComparisonModel(
        connection_id=connection_id,
        before=snapshot_summary(earlier),
        after=later_summary,
        queries=[to_model(query) for query in difference],
    )
