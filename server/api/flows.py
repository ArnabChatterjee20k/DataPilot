"""Wiring a query into a request, running the chain once, and watching it move.

This is *composition*, not automation: there is no schedule, no retry and no
alert. A flow is a debugging tool - it answers "where did the data stop being
what I expected", which is a question you ask while looking at it.

The two hard parts are both about being honest under failure:

* A node that fails must not make the nodes after it look broken. They never
  ran, which is a different thing, and saying "failed" for both hides which
  one to go and fix.
* Every node has to be able to show what it actually produced. A node that
  hides its output is useless for the only job a flow has.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Optional

#: How deep a `{{node.a.b.c}}` path may go before it is more likely a mistake.
MAX_PATH_DEPTH = 12

#: A whole flow gives up after this long, however many nodes are left.
DEFAULT_FLOW_TIMEOUT = 120.0

REFERENCE = re.compile(r"\{\{\s*([\w.\-\[\]]+)\s*\}\}")

QUERY = "query"
REQUEST = "request"
KINDS = (QUERY, REQUEST)

#: Node states, in the order a node passes through them.
IDLE = "idle"
RUNNING = "running"
SUCCEEDED = "succeeded"
FAILED = "failed"
#: Never ran, because something it depends on did not finish.
SKIPPED = "skipped"


class FlowError(Exception):
    """A problem with the flow itself, phrased for the person who drew it."""


@dataclass
class Node:
    id: str
    name: str
    kind: str
    connection_id: Optional[str] = None
    query: str = ""
    request: dict = field(default_factory=dict)
    position: dict = field(default_factory=dict)

    @property
    def label(self) -> str:
        return self.name or self.id


@dataclass
class Edge:
    source: str
    target: str
    id: str = ""


@dataclass
class Graph:
    nodes: list[Node]
    edges: list[Edge]

    def by_id(self) -> dict[str, Node]:
        return {node.id: node for node in self.nodes}

    def parents(self) -> dict[str, list[str]]:
        parents: dict[str, list[str]] = {node.id: [] for node in self.nodes}
        for edge in self.edges:
            parents[edge.target].append(edge.source)
        return parents

    def children(self) -> dict[str, list[str]]:
        children: dict[str, list[str]] = {node.id: [] for node in self.nodes}
        for edge in self.edges:
            children[edge.source].append(edge.target)
        return children


def read_graph(payload: dict) -> Graph:
    """Read a stored or submitted graph, refusing one that cannot run."""
    payload = payload or {}
    nodes: list[Node] = []
    seen: set[str] = set()

    for raw in payload.get("nodes") or []:
        node_id = str(raw.get("id") or "").strip()
        if not node_id:
            raise FlowError("Every node needs an id.")
        if node_id in seen:
            raise FlowError(f"Two nodes share the id '{node_id}'.")
        seen.add(node_id)

        kind = str(raw.get("kind") or "").strip().lower()
        if kind not in KINDS:
            raise FlowError(
                f"'{node_id}' is a '{kind or 'nameless'}' node; a flow node is "
                f"a {' or a '.join(KINDS)}."
            )

        nodes.append(
            Node(
                id=node_id,
                name=str(raw.get("name") or "").strip(),
                kind=kind,
                connection_id=(str(raw.get("connection_id") or "").strip() or None),
                query=str(raw.get("query") or ""),
                request=raw.get("request") or {},
                position=raw.get("position") or {},
            )
        )

    edges: list[Edge] = []
    for raw in payload.get("edges") or []:
        source = str(raw.get("source") or "").strip()
        target = str(raw.get("target") or "").strip()
        if source not in seen:
            raise FlowError(f"An edge starts at '{source}', which is not a node.")
        if target not in seen:
            raise FlowError(f"An edge ends at '{target}', which is not a node.")
        if source == target:
            raise FlowError(f"'{source}' cannot feed itself.")
        edges.append(Edge(source=source, target=target, id=str(raw.get("id") or "")))

    graph = Graph(nodes=nodes, edges=edges)
    cycle = find_cycle(graph)
    if cycle:
        names = " → ".join(graph.by_id()[node].label for node in cycle)
        raise FlowError(
            f"These nodes feed each other in a loop, so none of them can go "
            f"first: {names}."
        )
    return graph


def find_cycle(graph: Graph) -> list[str]:
    """Return one cycle, or nothing. Naming it beats saying 'invalid graph'."""
    children = graph.children()
    state: dict[str, int] = {}
    path: list[str] = []

    def walk(node: str) -> list[str]:
        state[node] = 1
        path.append(node)
        for child in children.get(node, []):
            if state.get(child) == 1:
                return path[path.index(child):] + [child]
            if state.get(child, 0) == 0:
                found = walk(child)
                if found:
                    return found
        state[node] = 2
        path.pop()
        return []

    for node in graph.nodes:
        if state.get(node.id, 0) == 0:
            found = walk(node.id)
            if found:
                return found
    return []


def to_payload(graph: Graph) -> dict:
    return {
        "nodes": [
            {
                "id": node.id,
                "name": node.name,
                "kind": node.kind,
                "connection_id": node.connection_id,
                "query": node.query,
                "request": node.request,
                "position": node.position,
            }
            for node in graph.nodes
        ],
        "edges": [
            {"id": edge.id or f"{edge.source}->{edge.target}",
             "source": edge.source,
             "target": edge.target}
            for edge in graph.edges
        ],
    }


# --------------------------------------------------------------------- values


def node_output(kind: str, result: Any) -> dict:
    """What a finished node offers downstream.

    Shaped for how it is written rather than how it is stored: `first` exists
    because `{{users.first.id}}` is what someone types, and `rows.0.id` is
    what they work out afterwards.
    """
    if kind == QUERY:
        rows = result.get("rows") or []
        return {
            "rows": rows,
            "row_count": result.get("row_count", len(rows)),
            "first": rows[0] if rows else None,
            "columns": [column.get("name") for column in result.get("columns") or []],
        }

    body = result.get("body")
    parsed: Any = None
    if isinstance(body, str) and body.strip():
        try:
            parsed = json.loads(body)
        except ValueError:
            parsed = None

    return {
        "status": result.get("status"),
        "ok": bool(result.get("status") and 200 <= int(result["status"]) < 300),
        "body": body,
        "json": parsed,
        "headers": {
            str(header.get("key")): header.get("value")
            for header in result.get("headers") or []
        },
    }


def resolve_path(source: Any, path: list[str]) -> Any:
    """Walk `a.b.0.c` through dictionaries and lists."""
    current = source
    for step in path[:MAX_PATH_DEPTH]:
        if current is None:
            return None
        if isinstance(current, dict):
            current = current.get(step)
        elif isinstance(current, list):
            try:
                current = current[int(step)]
            except (ValueError, IndexError):
                return None
        else:
            return None
    return current


def as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    return str(value)


@dataclass
class Missing:
    """A reference that pointed at nothing, kept so it can be reported."""

    reference: str
    reason: str


def interpolate(text: str, outputs: dict, names: dict) -> tuple[str, list[Missing]]:
    """Replace `{{node.field}}` with what that node produced.

    An unknown reference is left as written rather than blanked, so the
    request that went out shows the mistake instead of silently sending
    nothing - and it is reported alongside, because a node whose input was
    wrong is more useful than one that merely failed.
    """
    if not isinstance(text, str) or "{{" not in text:
        return text, []

    missing: list[Missing] = []

    def replace(match: re.Match) -> str:
        reference = match.group(1)
        parts = [part for part in reference.replace("[", ".").replace("]", "").split(".") if part]
        if not parts:
            return match.group(0)

        head, rest = parts[0], parts[1:]
        node_id = names.get(head, head)
        if node_id not in outputs:
            missing.append(
                Missing(reference, f"there is no node called '{head}' before this one")
            )
            return match.group(0)

        value = resolve_path(outputs[node_id], rest)
        if value is None:
            missing.append(
                Missing(reference, f"'{head}' produced nothing at {'.'.join(rest) or 'its output'}")
            )
            return match.group(0)
        return as_text(value)

    return REFERENCE.sub(replace, text), missing


def interpolate_deep(value: Any, outputs: dict, names: dict) -> tuple[Any, list[Missing]]:
    """Interpolate through a request's nested structure."""
    missing: list[Missing] = []

    def walk(current: Any) -> Any:
        if isinstance(current, str):
            replaced, found = interpolate(current, outputs, names)
            missing.extend(found)
            return replaced
        if isinstance(current, dict):
            return {key: walk(item) for key, item in current.items()}
        if isinstance(current, list):
            return [walk(item) for item in current]
        return current

    return walk(value), missing


def name_index(graph: Graph) -> dict[str, str]:
    """Let a reference use a node's name as well as its id.

    A name is what is on the canvas; an id is what the editor generated. Both
    should work, and a name that is not unique falls back to the id.
    """
    counts: dict[str, int] = {}
    for node in graph.nodes:
        if node.name:
            counts[node.name] = counts.get(node.name, 0) + 1

    index = {node.id: node.id for node in graph.nodes}
    for node in graph.nodes:
        if node.name and counts[node.name] == 1:
            index[node.name] = node.id
            index[node.name.replace(" ", "_")] = node.id
    return index


def describe_missing(missing: list[Missing]) -> str:
    unique = {item.reference: item.reason for item in missing}
    parts = [f"{{{{{reference}}}}} - {reason}" for reference, reason in unique.items()]
    return "This node's input referred to something that was not there: " + "; ".join(parts)
