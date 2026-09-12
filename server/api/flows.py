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
CONSTANTS = "constants"
SOCKET = "socket"

#: Kinds the server runs, once, when the flow runs.
SERVER_KINDS = (QUERY, REQUEST, CONSTANTS)

#: Kinds that run in the browser instead, for as long as the tab is open.
LIVE_KINDS: tuple[str, ...] = (SOCKET,)

KINDS = SERVER_KINDS + LIVE_KINDS

#: Which config field belongs to which kind. Adding a kind means adding a row
#: here: `to_payload` and the error message a bad kind gets both read it, so
#: they cannot drift apart.
KIND_FIELDS: dict[str, tuple[str, ...]] = {
    QUERY: ("query",),
    REQUEST: ("request",),
    CONSTANTS: ("constants",),
    SOCKET: ("socket",),
}


def is_live(kind: str) -> bool:
    """A live node runs in the browser, so the server never executes it."""
    return kind in LIVE_KINDS


def kind_list() -> str:
    """`query, request or constants`, for an error somebody has to read.

    Plain names rather than `a query, a request`: once `constants` is in the
    list the article version reads as "a constants", which is not English.
    """
    names = list(KINDS)
    if len(names) == 1:
        return names[0]
    return f"{', '.join(names[:-1])} or {names[-1]}"

#: Node states, in the order a node passes through them.
IDLE = "idle"
RUNNING = "running"
SUCCEEDED = "succeeded"
FAILED = "failed"
#: Never ran, because something it depends on did not finish.
SKIPPED = "skipped"
#: Runs in the browser, so the server never starts or finishes it.
LIVE = "live"


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
    constants: list[dict] = field(default_factory=list)
    socket: dict = field(default_factory=dict)
    checks: list[dict] = field(default_factory=list)
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

    def ancestors(self, node_id: str) -> set[str]:
        """Everything `node_id` depends on, however far back."""
        parents = self.parents()
        found: set[str] = set()
        stack = list(parents.get(node_id, []))
        while stack:
            current = stack.pop()
            if current in found:
                continue
            found.add(current)
            stack.extend(parents.get(current, []))
        return found

    def upto(self, node_id: str) -> "Graph":
        """The part of the flow needed to reach one node, and no more.

        Testing a node means running what feeds it, not the branches beside
        it: a request that fires on the way past is a surprise nobody asked
        for.
        """
        keep = self.ancestors(node_id) | {node_id}
        return Graph(
            nodes=[node for node in self.nodes if node.id in keep],
            edges=[
                edge
                for edge in self.edges
                if edge.source in keep and edge.target in keep
            ],
        )


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
                f"one of {kind_list()}."
            )

        nodes.append(
            Node(
                id=node_id,
                name=str(raw.get("name") or "").strip(),
                kind=kind,
                connection_id=(str(raw.get("connection_id") or "").strip() or None),
                query=str(raw.get("query") or ""),
                request=raw.get("request") or {},
                constants=read_constants(node_id, raw.get("constants")),
                socket=raw.get("socket") or {},
                checks=read_checks(node_id, raw.get("checks")),
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

    by_id = graph.by_id()
    for edge in edges:
        source, target = by_id[edge.source], by_id[edge.target]
        if is_live(source.kind) and not is_live(target.kind):
            # the server can never resolve {{Stream.last.value}}: not "not
            # yet", but architecturally never, because the subscription lives
            # in a browser tab. Refusing the edge beats a node that succeeds
            # having sent the braces along with the request.
            raise FlowError(
                f"'{source.label}' is a {source.kind} node, which runs in your "
                f"browser, so '{target.label}' cannot read it. A {target.kind} "
                f"node only sees nodes the server ran."
            )

    cycle = find_cycle(graph)
    if cycle:
        names = " → ".join(graph.by_id()[node].label for node in cycle)
        raise FlowError(
            f"These nodes feed each other in a loop, so none of them can go "
            f"first: {names}."
        )
    return graph


def read_constants(node_id: str, rows: Any) -> list[dict]:
    """Clean the key/value rows a constants node was drawn with.

    The editor always leaves a blank row to type into, so blank keys are
    dropped rather than stored as `{{Config.}}`. Two rows with one key is
    refused instead of resolved last-wins, which is an hour of debugging for
    no gain.
    """
    cleaned: list[dict] = []
    seen: set[str] = set()

    for raw in rows or []:
        if not isinstance(raw, dict):
            continue
        key = str(raw.get("key") or "").strip()
        if not key:
            continue
        if key in seen:
            raise FlowError(
                f"'{node_id}' has two values called '{key}'; a reference could "
                f"only reach one of them."
            )
        seen.add(key)
        cleaned.append(
            {
                "key": key,
                "value": str(raw.get("value") or ""),
                "enabled": raw.get("enabled", True) is not False,
            }
        )
    return cleaned


#: What a check can ask, and how each one reads when it is written out.
OPERATORS: dict[str, str] = {
    "exists": "to be there",
    "missing": "not to be there",
    "eq": "to be",
    "ne": "not to be",
    "gt": "to be more than",
    "gte": "to be at least",
    "lt": "to be less than",
    "lte": "to be at most",
    "contains": "to contain",
    "not_contains": "not to contain",
    "matches": "to match",
    "count_eq": "to have exactly",
    "count_gt": "to have more than",
    "count_lt": "to have fewer than",
    "empty": "to be empty",
    "not_empty": "not to be empty",
}

#: Operators that read the value on their own, with nothing to compare against.
LONE_OPERATORS = {"exists", "missing", "empty", "not_empty"}

#: Where a check looks: at what came in, or at what this node produced.
ON_INPUT = "input"
ON_OUTPUT = "output"


def read_checks(node_id: str, rows: Any) -> list[dict]:
    """Clean the assertions a node was drawn with."""
    cleaned: list[dict] = []

    for raw in rows or []:
        if not isinstance(raw, dict):
            continue
        path = str(raw.get("path") or "").strip()
        if not path:
            continue
        operator = str(raw.get("op") or "eq").strip()
        if operator not in OPERATORS:
            raise FlowError(
                f"'{node_id}' checks something with '{operator}', which is not "
                f"one of {', '.join(sorted(OPERATORS))}."
            )
        on = str(raw.get("on") or ON_OUTPUT).strip()
        if on not in (ON_INPUT, ON_OUTPUT):
            raise FlowError(
                f"'{node_id}' has a check on '{on}'; a check looks at the "
                f"{ON_INPUT} or the {ON_OUTPUT}."
            )
        cleaned.append(
            {
                "on": on,
                "path": path,
                "op": operator,
                "value": str(raw.get("value") or ""),
                "enabled": raw.get("enabled", True) is not False,
            }
        )
    return cleaned


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


#: Stored on every node, whatever it is.
COMMON_FIELDS = ("id", "name", "kind", "connection_id", "position", "checks")


def node_payload(node: Node) -> dict:
    """One node, as it is stored.

    A whitelist rather than the whole object, because the console sends back
    everything React Flow hangs on a node - measurements, drag state - and none
    of that belongs in the database.
    """
    stored = {name: getattr(node, name) for name in COMMON_FIELDS}
    for name in KIND_FIELDS.get(node.kind, ()):
        stored[name] = getattr(node, name)
    return stored


def to_payload(graph: Graph) -> dict:
    return {
        "nodes": [node_payload(node) for node in graph.nodes],
        "edges": [
            {"id": edge.id or f"{edge.source}->{edge.target}",
             "source": edge.source,
             "target": edge.target}
            for edge in graph.edges
        ],
    }


# --------------------------------------------------------------------- values


def _query_output(result: Any) -> dict:
    rows = result.get("rows") or []
    return {
        "rows": rows,
        "row_count": result.get("row_count", len(rows)),
        "first": rows[0] if rows else None,
        "columns": [column.get("name") for column in result.get("columns") or []],
    }


def _request_output(result: Any) -> dict:
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


def _constants_output(result: Any) -> dict:
    # flat, so it reads as `{{Config.api_key}}` rather than
    # `{{Config.values.api_key}}`, which is a tax on every reader
    return dict(result.get("values") or {})


#: What each kind offers downstream, by kind.
OUTPUTS: dict[str, Any] = {
    QUERY: _query_output,
    REQUEST: _request_output,
    CONSTANTS: _constants_output,
}


def node_output(kind: str, result: Any) -> dict:
    """What a finished node offers downstream.

    Shaped for how it is written rather than how it is stored: `first` exists
    because `{{users.first.id}}` is what someone types, and `rows.0.id` is
    what they work out afterwards.

    A kind with no entry offers nothing. That matters more than it looks: this
    used to be an if/else where anything that was not a query fell through to
    the request branch and was handed HTTP response semantics.
    """
    reader = OUTPUTS.get(kind)
    return reader(result) if reader else {}


#: How many columns or JSON keys are worth listing before the list is noise.
MAX_SUGGESTIONS = 12

#: How much of a value is shown beside a reference.
PREVIEW_CHARS = 80


def reference_name(name: str, node_id: str) -> str:
    """What to write in `{{...}}` for this node.

    A name with a space in it cannot be written literally, so the underscore
    form is the one to hand people rather than one they have to work out
    after a reference silently fails.
    """
    return name.replace(" ", "_") if name else node_id


def _query_paths(output: dict) -> list[str]:
    paths = ["rows", "row_count", "columns", "columns.0"]
    first = output.get("first")
    if isinstance(first, dict):
        paths += [f"first.{column}" for column in list(first)[:MAX_SUGGESTIONS]]
        # indexing is a pattern rather than one value, so it is shown on a row
        # that exists: a suggestion resolving to nothing teaches nothing
        for index in range(min(len(output.get("rows") or []), 2)):
            paths += [f"rows.{index}.{column}" for column in list(first)[:1]]
    return paths


def _request_paths(output: dict) -> list[str]:
    paths = ["status", "ok", "body", "json"]
    parsed = output.get("json")
    if isinstance(parsed, dict):
        paths += [f"json.{key}" for key in list(parsed)[:MAX_SUGGESTIONS]]
    return paths


def _no_paths(_output: dict) -> list[str]:
    return []


def _constants_paths(output: dict) -> list[str]:
    return list(output)[:MAX_SUGGESTIONS]


#: What each kind is worth offering as a reference, by kind.
PATHS: dict[str, Any] = {
    QUERY: _query_paths,
    REQUEST: _request_paths,
    CONSTANTS: _constants_paths,
}


def suggest_references(node_name: str, kind: str, output: dict) -> list[dict]:
    """Every reference this node offers, with what it resolves to right now.

    Someone wiring a request to a query should not have to learn the output
    shape from the docs and the node name from the canvas and then guess how
    the two combine. The answer is copyable instead.
    """
    paths = PATHS.get(kind, _no_paths)(output)

    suggestions = []
    for path in paths:
        value = resolve_path(output, path.replace("[", ".").replace("]", "").split("."))
        if value is None:
            continue
        preview = as_text(value)
        suggestions.append(
            {
                "reference": f"{{{{{node_name}.{path}}}}}",
                "value": preview[:PREVIEW_CHARS]
                + ("…" if len(preview) > PREVIEW_CHARS else ""),
            }
        )
    return suggestions


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
    """Render a value for a request body, a query, or a preview.

    Rows are serialised before they get here, so a UUID or a datetime should
    never reach this. Should is not a guarantee, and the cost of being wrong
    used to be a 500 on the endpoint rather than one odd looking cell, so
    anything json cannot encode falls back to its text form.
    """
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return json.dumps(value, default=str)
    return str(value)


@dataclass
class Missing:
    """A reference that pointed at nothing, kept so it can be reported."""

    reference: str
    reason: str


def resolve_reference(
    reference: str, outputs: dict, names: dict
) -> tuple[Any, Optional[Missing]]:
    """Look up one `node.field` path, without deciding how to render it.

    Kept apart from `interpolate` so that anything else asking the same
    question - an assertion, a suggestion - walks the same names and the same
    path rather than growing its own version that drifts.
    """
    parts = [
        part
        for part in reference.replace("[", ".").replace("]", "").split(".")
        if part
    ]
    if not parts:
        return None, Missing(reference, "that is not a reference to anything")

    head, rest = parts[0], parts[1:]
    node_id = names.get(head, head)
    if node_id not in outputs:
        return None, Missing(
            reference, f"there is no node called '{head}' before this one"
        )

    value = resolve_path(outputs[node_id], rest)
    if value is None:
        return None, Missing(
            reference,
            f"'{head}' produced nothing at {'.'.join(rest) or 'its output'}",
        )
    return value, None


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
        value, absent = resolve_reference(match.group(1), outputs, names)
        if absent:
            missing.append(absent)
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


def _as_number(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _length(value: Any) -> Optional[int]:
    if isinstance(value, (list, dict, str, tuple, set)):
        return len(value)
    return None


def _compare(operator: str, actual: Any, expected: str) -> tuple[bool, str]:
    """Run one comparison, and say why when it could not be run at all."""
    if operator == "exists":
        return actual is not None, ""
    if operator == "missing":
        return actual is None, ""
    if operator == "empty":
        return not actual, ""
    if operator == "not_empty":
        return bool(actual), ""

    if operator in ("eq", "ne"):
        # compare as numbers when both sides are numbers, so 200 and "200"
        # are the same answer rather than a puzzle
        left, right = _as_number(actual), _as_number(expected)
        same = (
            left == right
            if left is not None and right is not None
            else as_text(actual) == expected
        )
        return (same if operator == "eq" else not same), ""

    if operator in ("gt", "gte", "lt", "lte"):
        left, right = _as_number(actual), _as_number(expected)
        if left is None:
            return False, f"{as_text(actual)!r} is not a number"
        if right is None:
            return False, f"{expected!r} is not a number"
        return (
            {
                "gt": left > right,
                "gte": left >= right,
                "lt": left < right,
                "lte": left <= right,
            }[operator],
            "",
        )

    if operator in ("contains", "not_contains"):
        inside = expected in as_text(actual)
        return (inside if operator == "contains" else not inside), ""

    if operator == "matches":
        try:
            pattern = re.compile(expected)
        except re.error as problem:
            return False, f"that is not a valid pattern: {problem}"
        return bool(pattern.search(as_text(actual))), ""

    if operator in ("count_eq", "count_gt", "count_lt"):
        size = _length(actual)
        if size is None:
            return False, f"{as_text(actual)!r} has no length to count"
        wanted = _as_number(expected)
        if wanted is None:
            return False, f"{expected!r} is not a number"
        return (
            {
                "count_eq": size == wanted,
                "count_gt": size > wanted,
                "count_lt": size < wanted,
            }[operator],
            "",
        )

    return False, f"'{operator}' is not something a check can ask"


def describe_check(check: dict) -> str:
    """`status to be 200`, so a result reads without the operator table."""
    reading = OPERATORS.get(check["op"], check["op"])
    if check["op"] in LONE_OPERATORS:
        return f"{check['path']} {reading}"
    return f"{check['path']} {reading} {check['value']}"


def check(
    checks: list[dict], scope: dict, names: dict, on: str
) -> list[dict]:
    """Run the checks that look at `on`, and report what each one saw.

    Never raises and never decides anything about the node: a failed check is
    a finding, and the node it is attached to still succeeded or failed on its
    own merits.
    """
    results: list[dict] = []

    for item in checks:
        if item["on"] != on or not item.get("enabled", True):
            continue

        if on == ON_INPUT:
            actual, absent = resolve_reference(item["path"], scope, names)
            detail = absent.reason if absent else ""
        else:
            actual = resolve_path(
                scope, item["path"].replace("[", ".").replace("]", "").split(".")
            )
            detail = ""

        passed, problem = _compare(item["op"], actual, item["value"])
        preview = as_text(actual)
        results.append(
            {
                "on": on,
                "path": item["path"],
                "op": item["op"],
                "value": item["value"],
                "passed": passed,
                "actual": preview[:PREVIEW_CHARS]
                + ("…" if len(preview) > PREVIEW_CHARS else ""),
                "detail": problem or (detail if not passed else ""),
                "description": describe_check(item),
            }
        )

    return results


def describe_missing(missing: list[Missing]) -> str:
    unique = {item.reference: item.reason for item in missing}
    parts = [f"{{{{{reference}}}}} - {reason}" for reference, reason in unique.items()]
    return "This node's input referred to something that was not there: " + "; ".join(parts)
