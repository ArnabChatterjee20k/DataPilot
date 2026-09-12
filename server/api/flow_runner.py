"""Running a flow once, reporting each node as it happens.

Nodes run as soon as everything they depend on has finished, so two branches
off the same node run at the same time rather than in whatever order they were
drawn. Each node reports itself the moment its state changes, because watching
where a flow stops is the entire point of having one.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

from . import flows

#: How long any one node may take before the flow gives up on it.
NODE_TIMEOUT = 60.0


@dataclass
class NodeRun:
    id: str
    name: str
    kind: str
    state: str = flows.IDLE
    started_at: Optional[float] = None
    elapsed_ms: Optional[float] = None
    #: A one-line summary for the canvas: "6 rows", "201 Created".
    summary: str = ""
    #: The whole result, so the node can show what it actually produced.
    result: Any = None
    error: str = ""
    #: References that pointed at nothing, kept separately from the failure.
    warnings: list[str] = field(default_factory=list)
    #: For a skipped node: what it was waiting on.
    blocked_by: list[str] = field(default_factory=list)
    #: Assertions this node carried, and what each one saw. A failed check is
    #: a finding rather than a verdict: it never changes `state`.
    checks: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "state": self.state,
            "elapsed_ms": self.elapsed_ms,
            "summary": self.summary,
            "result": self.result,
            "error": self.error,
            "warnings": self.warnings,
            "blocked_by": self.blocked_by,
            "checks": self.checks,
        }


#: Called with each node's state, every time it changes.
Report = Callable[[NodeRun], Awaitable[None]]

#: Runs one node and returns (summary, result). Raising means the node failed.
Execute = Callable[[flows.Node, dict], Awaitable[tuple[str, dict]]]


class FlowRun:
    def __init__(self, graph: flows.Graph, execute: Execute, report: Report):
        self.graph = graph
        self.execute = execute
        self.report = report
        self.nodes = graph.by_id()
        self.parents = graph.parents()
        self.children = graph.children()
        self.names = flows.name_index(graph)

        self.runs: dict[str, NodeRun] = {
            node.id: NodeRun(id=node.id, name=node.label, kind=node.kind)
            for node in graph.nodes
        }
        self.outputs: dict[str, dict] = {}
        self._finished: dict[str, asyncio.Event] = {
            node.id: asyncio.Event() for node in graph.nodes
        }

    async def _announce(self, run: NodeRun):
        await self.report(run)

    async def run(self, timeout: float = flows.DEFAULT_FLOW_TIMEOUT) -> dict[str, NodeRun]:
        if not self.graph.nodes:
            return self.runs

        for run in self.runs.values():
            await self._announce(run)

        tasks = [asyncio.create_task(self._run_node(node.id)) for node in self.graph.nodes]
        try:
            await asyncio.wait_for(asyncio.gather(*tasks), timeout=timeout)
        except asyncio.TimeoutError:
            for task in tasks:
                task.cancel()
            for run in self.runs.values():
                if run.state in (flows.IDLE, flows.RUNNING):
                    run.state = flows.FAILED
                    run.error = f"The flow ran out of time after {timeout:g}s."
                    await self._announce(run)
        return self.runs

    async def _run_node(self, node_id: str):
        run = self.runs[node_id]
        node = self.nodes[node_id]

        if flows.is_live(node.kind):
            # a live node is the browser's job. Reporting it and letting go
            # immediately keeps it from stalling anything drawn after it, and
            # leaves nothing in `outputs`, so no reference can reach a value
            # that only exists in a tab.
            run.state = flows.LIVE
            run.summary = "runs in your browser"
            await self._announce(run)
            self._finished[node_id].set()
            return

        # wait for everything upstream, whatever order it finishes in
        for parent in self.parents[node_id]:
            await self._finished[parent].wait()

        blocked = [
            self.runs[parent].name
            for parent in self.parents[node_id]
            if self.runs[parent].state != flows.SUCCEEDED
        ]
        if blocked:
            # a node that never ran is not a node that failed, and calling it
            # failed hides which one actually broke
            run.state = flows.SKIPPED
            run.blocked_by = blocked
            run.summary = f"waiting on {', '.join(blocked)}"
            await self._announce(run)
            self._finished[node_id].set()
            return

        run.state = flows.RUNNING
        run.started_at = time.perf_counter()
        await self._announce(run)

        inputs = self._inputs(node)
        # checked before the node runs, so they are still reported when it
        # then fails - which is exactly when what went in is worth seeing
        run.checks = flows.check(node.checks, inputs, self.names, flows.ON_INPUT)

        try:
            summary, result = await asyncio.wait_for(
                self.execute(node, inputs), timeout=NODE_TIMEOUT
            )
            run.state = flows.SUCCEEDED
            run.summary = summary
            run.result = result
            self.outputs[node_id] = flows.node_output(node.kind, result)
            run.checks += flows.check(
                node.checks, self.outputs[node_id], self.names, flows.ON_OUTPUT
            )
        except asyncio.TimeoutError:
            run.state = flows.FAILED
            run.error = f"{node.label} took longer than {NODE_TIMEOUT:g}s."
        except flows.FlowError as error:
            run.state = flows.FAILED
            run.error = str(error)
        except Exception as error:  # noqa: BLE001 - reported, not swallowed
            run.state = flows.FAILED
            run.error = str(error) or type(error).__name__
        finally:
            if run.started_at is not None:
                run.elapsed_ms = round((time.perf_counter() - run.started_at) * 1000, 2)
            await self._announce(run)
            self._finished[node_id].set()

    def _inputs(self, node: flows.Node) -> dict:
        """Only what this node can actually see: its ancestors' outputs."""
        visible: dict[str, dict] = {}
        seen: set[str] = set()
        stack = list(self.parents[node.id])
        while stack:
            current = stack.pop()
            if current in seen:
                continue
            seen.add(current)
            if current in self.outputs:
                visible[current] = self.outputs[current]
            stack.extend(self.parents.get(current, []))
        return visible

    def warn(self, node_id: str, message: str):
        run = self.runs.get(node_id)
        if run and message not in run.warnings:
            run.warnings.append(message)
