"""Flows: storing a node graph, and running it once while it is watched."""

from __future__ import annotations

import json
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status

from .. import flow_runner, flows, http_client, serialization, sql as sql_analysis
from ..config import AppConfig, SourceConfig
from ..models import (
    FlowListModel,
    FlowModel,
    FlowSpecModel,
    NodeReferenceGroupModel,
    NodeReferenceModel,
    NodeRunModel,
    NodeTestModel,
)
from ..database.db import DBSession
from ..database.models import Connections, Flows
from ..storage import open_session, to_http_error
from .requests import CONTROL_KEY, connection_variables

router = APIRouter(tags=["flows"])


def to_model(record) -> FlowModel:
    values = record.get_values()
    return FlowModel(
        uid=values["uid"],
        name=values["name"],
        graph=values.get("graph") or {"nodes": [], "edges": []},
    )


async def load_flow(db: DBSession, flow_uid: str):
    record = await db.get(Flows, filters=Flows.uid == flow_uid)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Flow {flow_uid} not found"
        )
    return record


def validated(graph: dict) -> dict:
    try:
        return flows.to_payload(flows.read_graph(graph))
    except flows.FlowError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
        ) from error


@router.post("/flows", response_model=FlowModel)
async def create_flow(spec: FlowSpecModel, db: DBSession):
    uid = str(uuid4())
    await db.create(
        Flows(uid=uid, name=spec.name or "Untitled flow", graph=validated(spec.graph))
    )
    await db.commit()
    return FlowModel(uid=uid, name=spec.name or "Untitled flow", graph=spec.graph)


@router.get("/flows", response_model=FlowListModel)
async def list_flows(db: DBSession):
    records = await db.list(Flows, limit=-1)
    items = sorted((to_model(record) for record in records), key=lambda flow: flow.name.lower())
    return FlowListModel(flows=items, total=len(items))


@router.get("/flows/{flow_uid}", response_model=FlowModel)
async def get_flow(flow_uid: str, db: DBSession):
    return to_model(await load_flow(db, flow_uid))


@router.put("/flows/{flow_uid}", response_model=FlowModel)
async def update_flow(flow_uid: str, spec: FlowSpecModel, db: DBSession):
    await load_flow(db, flow_uid)
    updates = {"name": spec.name or "Untitled flow", "graph": validated(spec.graph)}
    await db.update(Flows, Flows.uid == flow_uid, updates)
    await db.commit()
    return FlowModel(uid=flow_uid, **updates)


@router.delete("/flows/{flow_uid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_flow(flow_uid: str, db: DBSession):
    await load_flow(db, flow_uid)
    await db.delete(Flows, Flows.uid == flow_uid)
    await db.commit()


# ------------------------------------------------------------------- running


async def load_connection_for(session, connection_id: Optional[str], node):
    if not connection_id:
        raise flows.FlowError(f"{node.label} has no connection chosen.")
    connection = await session.get(Connections, filters=Connections.uid == connection_id)
    if not connection:
        raise flows.FlowError(
            f"{node.label} points at a connection that no longer exists."
        )
    return connection


async def run_query_node(connection, node, sql: str) -> tuple[str, dict]:
    """Run a node's query, with the same guards the query tab has."""
    if connection.source == SourceConfig.API.value:
        raise flows.FlowError(
            f"{node.label} is a query node on an API connection. Use a request "
            "node, or point it at a database."
        )

    risk = sql_analysis.analyze(sql)
    if risk.level == "dangerous":
        # a flow runs unattended once started; a statement that would need a
        # confirmation in the query tab does not get one here
        raise flows.FlowError(
            f"{node.label} would run a {risk.statement} that cannot be undone: "
            f"{'; '.join(risk.warnings) or 'no WHERE clause'}. A flow will not "
            "run one."
        )

    try:
        async with open_session(connection) as session:
            result = await session.execute(sql)
    except HTTPException as error:
        raise flows.FlowError(str(error.detail)) from error
    except Exception as error:
        raise flows.FlowError(str(to_http_error(error, connection.connection_uri).detail)) from error

    # an adapter hands back UUID, datetime, Decimal and bytes as themselves,
    # and none of those survive json.dumps on the way to the browser
    rows = serialization.jsonable_rows(result.rows or [])[: AppConfig.MAX_ROWS]
    payload = {
        "rows": rows,
        "row_count": len(rows),
        "columns": [{"name": column} for column in (result.columns or [])],
    }
    return f"{len(rows)} row{'' if len(rows) == 1 else 's'}", payload


async def run_request_node(connection, node, spec: dict) -> tuple[str, dict]:
    from ..models import RequestSpecModel
    from .requests import run_request

    if connection.source != SourceConfig.API.value:
        raise flows.FlowError(
            f"{node.label} is a request node on a {connection.source} "
            "connection. Use a query node, or point it at an API."
        )

    try:
        model = RequestSpecModel(**{**spec, "name": spec.get("name") or node.label})
    except Exception as error:
        raise flows.FlowError(f"{node.label} is not a valid request: {error}") from error

    try:
        outcome = await run_request(
            model,
            base_url=connection.connection_uri,
            variables=connection_variables(connection),
            connection_id=connection.uid,
        )
    except HTTPException as error:
        raise flows.FlowError(str(error.detail)) from error

    response = outcome.response
    payload = {
        "status": response.status,
        "reason": response.reason,
        "body": response.body,
        "headers": [header for header in response.headers],
        "elapsed_ms": response.elapsed_ms,
        "url": outcome.request.url,
    }
    return f"{response.status} {response.reason}".strip(), payload


def node_executor(session, runner_ref: dict, captured: Optional[dict] = None):
    """How a node runs, shared by the live flow and by testing one node.

    `captured` collects what a node was actually sent, which is the thing
    worth looking at when a flow does something unexpected: the reference was
    probably fine and the value behind it was not.
    """

    async def execute(node: flows.Node, inputs: dict):
        runner = runner_ref["runner"]
        connection = await load_connection_for(session, node.connection_id, node)

        if node.kind == flows.QUERY:
            sql, missing = flows.interpolate(node.query, inputs, runner.names)
            if missing:
                runner.warn(node.id, flows.describe_missing(missing))
            if not str(sql).strip():
                raise flows.FlowError(f"{node.label} has no query to run.")
            if captured is not None and captured.get("id") == node.id:
                captured["query"] = sql
            return await run_query_node(connection, node, sql)

        spec, missing = flows.interpolate_deep(node.request or {}, inputs, runner.names)
        if missing:
            runner.warn(node.id, flows.describe_missing(missing))
        if captured is not None and captured.get("id") == node.id:
            captured["request"] = spec
        return await run_request_node(connection, node, spec)

    return execute


@router.post("/flows/{flow_uid}/nodes/{node_id}/test", response_model=NodeTestModel)
async def test_node(flow_uid: str, node_id: str, db: DBSession):
    """Run one node, along with whatever feeds it, and report what happened.

    Running the whole flow to find out what one node does is a slow way to
    ask, and the branches beside it fire on the way past. This runs the node
    and its ancestors only.
    """
    record = await load_flow(db, flow_uid)
    try:
        graph = flows.read_graph(record.get_values().get("graph") or {})
    except flows.FlowError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error))

    if node_id not in graph.by_id():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"This flow has no node '{node_id}'. Save the flow first.",
        )

    needed = graph.upto(node_id)
    captured: dict = {"id": node_id}
    runner_ref: dict = {}

    async def report(_run: flow_runner.NodeRun):
        return None

    runner = flow_runner.FlowRun(
        needed, node_executor(db, runner_ref, captured), report
    )
    runner_ref["runner"] = runner
    runs = await runner.run()

    target = runs[node_id]
    upstream = [runs[other] for other in needed.by_id() if other != node_id]

    # what the node could have referred to, with the values it would have got
    available = []
    for other_id, output in runner.outputs.items():
        if other_id == node_id:
            continue
        other = needed.by_id()[other_id]
        name = flows.reference_name(other.name, other.id)
        available.append(
            NodeReferenceGroupModel(
                node=other.label,
                kind=other.kind,
                references=[
                    NodeReferenceModel(**item)
                    for item in flows.suggest_references(name, other.kind, output)
                ],
            )
        )

    # what a node after this one would write to use what it just produced,
    # which is the question asked while looking at the result, not later
    node = needed.by_id()[node_id]
    offers = [
        NodeReferenceModel(**item)
        for item in flows.suggest_references(
            flows.reference_name(node.name, node.id),
            node.kind,
            runner.outputs.get(node_id, {}),
        )
    ]

    return NodeTestModel(
        node=NodeRunModel(**target.as_dict()),
        offers=offers,
        resolved_query=captured.get("query", ""),
        resolved_request=captured.get("request"),
        upstream=[NodeRunModel(**run.as_dict()) for run in upstream],
        available=available,
    )


@router.websocket("/flows/{flow_uid}/run")
async def run_flow(websocket: WebSocket, flow_uid: str):
    """Run the flow once, reporting every node as its state changes.

    A websocket rather than one response at the end: a node that flips
    straight from idle to done tells you nothing about where a slow flow is,
    and where it is is the question.
    """
    await websocket.accept()

    from ..database.db import storage

    async def control(state: str, detail: str = ""):
        await websocket.send_text(json.dumps({CONTROL_KEY: state, "detail": detail}))

    async def report(run: flow_runner.NodeRun):
        # a value that cannot be encoded is a bad cell, not a broken flow, so
        # it degrades to text here rather than killing the socket
        await websocket.send_text(
            json.dumps({"node": run.as_dict()}, default=serialization.to_jsonable)
        )

    try:
        async with storage.session() as session:
            record = await session.get(Flows, filters=Flows.uid == flow_uid)
            if not record:
                await control("error", f"Flow {flow_uid} not found")
                await websocket.close(code=1008)
                return

            values = record.get_values()
            try:
                graph = flows.read_graph(values.get("graph") or {})
            except flows.FlowError as error:
                await control("error", str(error))
                await websocket.close(code=1008)
                return

            if not graph.nodes:
                await control("error", "This flow has no nodes yet.")
                await websocket.close(code=1008)
                return

            runner_ref: dict = {}
            runner = flow_runner.FlowRun(
                graph, node_executor(session, runner_ref), report
            )
            runner_ref["runner"] = runner

            await control("ready", values.get("name") or flow_uid)
            runs = await runner.run()

            failed = [run.name for run in runs.values() if run.state == flows.FAILED]
            skipped = [run.name for run in runs.values() if run.state == flows.SKIPPED]
            await control(
                "finished",
                json.dumps(
                    {
                        "succeeded": sum(
                            1 for run in runs.values() if run.state == flows.SUCCEEDED
                        ),
                        "failed": failed,
                        "skipped": skipped,
                    }
                ),
            )
    except WebSocketDisconnect:
        return
    except Exception as error:  # noqa: BLE001 - reported to the browser
        try:
            await control("error", f"The flow could not run: {error}")
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
