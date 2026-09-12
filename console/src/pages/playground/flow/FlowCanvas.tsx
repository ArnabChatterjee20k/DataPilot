import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  SelectionMode,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlertCircle,
  Braces,
  Database,
  Globe,
  Keyboard,
  Loader2,
  Play,
  Radio,
  Save,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import type { DatabaseConnection } from "../store/store";
import { useSaveFlow, useTestNode } from "../hooks/useFlows";
import { FlowNodeCard, type FlowNodeCardData } from "./FlowNodeCard";
import { NodeInspector } from "./NodeInspector";
import { SelectionPanel } from "./SelectionPanel";
import { useLiveNodes } from "./useLiveNodes";
import { useFlowRun } from "./useFlowRun";
import {
  isMacPlatform,
  SHORTCUTS,
  shortcutLabel,
  useFlowShortcuts,
} from "./shortcuts";
import {
  NEW_CONSTANTS_NODE,
  NEW_QUERY_NODE,
  NEW_SOCKET_NODE,
  NEW_REQUEST_NODE,
  newNodeId,
  type FlowGraph,
  type FlowNode,
  type NodeKind,
} from "./types";

const NODE_TYPES = { datapilot: FlowNodeCard };

type CanvasNode = Node<FlowNodeCardData>;

/** Where a new node lands, so two in a row do not sit on top of each other. */
const nextPosition = (count: number) => ({
  x: 40 + (count % 3) * 300,
  y: 40 + Math.floor(count / 3) * 190,
});

function subtitleOf(data: FlowNodeCardData): string {
  if (data.kind === "socket") return (data.socket?.path ?? "").trim() || "/";
  if (data.kind === "constants") {
    const rows = (data.constants ?? []).filter((row) => row.key.trim());
    return rows.length
      ? rows.map((row) => row.key).join(", ")
      : "no values yet";
  }
  if (data.kind === "query") return String(data.query ?? "").trim();
  const request = data.request;
  return request ? `${request.method ?? "GET"} ${request.path ?? ""}`.trim() : "";
}

const toCanvas = (node: FlowNode): CanvasNode => ({
  id: node.id,
  type: "datapilot",
  position: node.position ?? { x: 0, y: 0 },
  data: {
    name: node.name,
    kind: node.kind,
    connection_id: node.connection_id ?? null,
    query: node.query ?? "",
    request: node.request,
    constants: node.constants ?? [],
    socket: node.socket,
    checks: node.checks ?? [],
    subtitle: "",
  },
});

const toDomain = (node: CanvasNode): FlowNode => ({
  id: node.id,
  name: String(node.data.name ?? ""),
  kind: node.data.kind as NodeKind,
  connection_id: (node.data.connection_id as string | null) ?? null,
  query: String(node.data.query ?? ""),
  request: node.data.request,
  constants: (node.data.constants as FlowNode["constants"]) ?? [],
  socket: node.data.socket as FlowNode["socket"],
  checks: (node.data.checks as FlowNode["checks"]) ?? [],
  position: node.position,
});

export function FlowCanvas({
  flowUid,
  name,
  graph,
  connections,
}: {
  flowUid: string;
  name: string;
  graph: FlowGraph;
  connections: DatabaseConnection[];
}) {
  const save = useSaveFlow(flowUid);
  const test = useTestNode(flowUid);
  const { runs, isRunning, summary, failure, run, reset } = useFlowRun(flowUid);

  // React Flow owns the array: it stores the measurements a node needs before
  // it can be drawn at all, and rebuilding the array on every render throws
  // them away, which leaves the canvas looking empty
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(
    graph.nodes.map(toCanvas)
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    graph.edges.map((edge) => ({ ...edge }))
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    test.reset();
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setNodes(graph.nodes.map(toCanvas));
    setEdges(graph.edges.map((edge) => ({ ...edge })));
    setDirty(false);
    reset();
  }, [flowUid]); // eslint-disable-line react-hooks/exhaustive-deps

  const connectionName = useCallback(
    (id?: unknown) => connections.find((item) => item.id === id)?.name,
    [connections]
  );

  // the run state and the derived labels are layered on by spreading, which
  // keeps every field React Flow put on the node
  const rendered = useMemo<CanvasNode[]>(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          subtitle: subtitleOf(node.data),
          connectionName: connectionName(node.data.connection_id),
          run: runs[node.id],
        },
      })),
    [nodes, runs, connectionName]
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      onNodesChange(changes);
      if (
        changes.some(
          (change) => change.type === "position" && change.dragging === false
        )
      ) {
        setDirty(true);
      }
    },
    [onNodesChange]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) =>
        addEdge(
          { ...connection, id: `${connection.source}->${connection.target}` },
          current
        )
      );
      setDirty(true);
    },
    [setEdges]
  );

  const addNode = (kind: NodeKind) => {
    const id = newNodeId();
    const base =
      kind === "query"
        ? NEW_QUERY_NODE(id)
        : kind === "constants"
          ? NEW_CONSTANTS_NODE(id)
          : kind === "socket"
            ? NEW_SOCKET_NODE(id)
            : NEW_REQUEST_NODE(id);
    setNodes((current) => {
      const sameKind = current.filter((node) => node.data.kind === kind).length;
      return [
        ...current.map((node) => ({ ...node, selected: false })),
        {
          ...toCanvas({
            ...base,
            name: `${base.name} ${sameKind + 1}`,
            position: nextPosition(current.length),
          }),
          // React Flow owns the selection: setting selectedId on its own is
          // overwritten the moment it reports the change back
          selected: true,
        },
      ];
    });
    setSelectedId(id);
    setDirty(true);
  };

  /**
   * What a shortcut acts on.
   *
   * React Flow marks what was clicked or rubber-banded, which can be several
   * nodes; the inspector only ever holds one. Both count as the selection.
   */
  const selectedNodes = useCallback(
    () => {
      const marked = nodes.filter((node) => node.selected);
      if (marked.length) return marked;
      const one = nodes.find((node) => node.id === selectedId);
      return one ? [one] : [];
    },
    [nodes, selectedId]
  );

  /**
   * React Flow owns the selection; the inspector follows it.
   *
   * These used to be set separately, so rubber-banding three nodes left the
   * inspector showing whichever one happened to be clicked last.
   */
  const onSelectionChange = useCallback(
    ({ nodes: picked }: OnSelectionChangeParams) =>
      setSelectedId(picked.length === 1 ? picked[0].id : null),
    []
  );

  const selectAll = useCallback(() => {
    setNodes((current) => current.map((node) => ({ ...node, selected: true })));
  }, [setNodes]);

  const clearSelection = useCallback(() => {
    setNodes((current) => current.map((node) => ({ ...node, selected: false })));
    setSelectedId(null);
  }, [setNodes]);

  /**
   * Lay the selection out in a column or a row.
   *
   * Aligning one edge and leaving the other alone is what a drawing tool does,
   * but here it hides nodes behind each other the moment two of them share a
   * row, and there is no undo to climb back out of that. Spacing them is what
   * was wanted anyway.
   */
  const arrange = useCallback(
    (axis: "column" | "row") => {
      const chosen = selectedNodes();
      if (chosen.length < 2) return;

      const down = axis === "column";
      const gap = down ? 190 : 300;
      const left = Math.min(...chosen.map((node) => node.position.x));
      const top = Math.min(...chosen.map((node) => node.position.y));

      // keep the order they are already in, so a layout stays recognisable
      const order = [...chosen].sort((a, b) =>
        down ? a.position.y - b.position.y : a.position.x - b.position.x
      );
      const placed = new Map(
        order.map((node, index) => [
          node.id,
          down
            ? { x: left, y: top + index * gap }
            : { x: left + index * gap, y: top },
        ])
      );

      setNodes((current) =>
        current.map((node) =>
          placed.has(node.id)
            ? { ...node, position: placed.get(node.id)! }
            : node
        )
      );
      setDirty(true);
    },
    [selectedNodes, setNodes]
  );

  const duplicateSelection = useCallback(() => {
    const chosen = selectedNodes();
    if (!chosen.length) return;

    const copies = chosen.map((node) => ({
      ...node,
      id: newNodeId(),
      selected: true,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      data: { ...node.data, name: `${node.data.name} copy` },
    }));

    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      ...copies,
    ]);
    setSelectedId(copies[copies.length - 1].id);
    setDirty(true);
  }, [selectedNodes, setNodes]);

  const removeSelection = useCallback(() => {
    const doomed = new Set(selectedNodes().map((node) => node.id));
    const cutEdges = edges.filter((edge) => edge.selected).map((edge) => edge.id);
    if (!doomed.size && !cutEdges.length) return;

    setNodes((current) => current.filter((node) => !doomed.has(node.id)));
    setEdges((current) =>
      current.filter(
        (edge) =>
          !cutEdges.includes(edge.id) &&
          !doomed.has(edge.source) &&
          !doomed.has(edge.target)
      )
    );
    if (selectedId && doomed.has(selectedId)) setSelectedId(null);
    setDirty(true);
  }, [selectedNodes, edges, selectedId, setNodes, setEdges]);

  const nudge = useCallback(
    (dx: number, dy: number) => {
      const moving = new Set(selectedNodes().map((node) => node.id));
      if (!moving.size) return;
      setNodes((current) =>
        current.map((node) =>
          moving.has(node.id)
            ? {
                ...node,
                position: { x: node.position.x + dx, y: node.position.y + dy },
              }
            : node
        )
      );
      setDirty(true);
    },
    [selectedNodes, setNodes]
  );

  const patchNode = (id: string, patch: Partial<FlowNode>) => {
    setNodes((current) =>
      current.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...patch } } : node
      )
    );
    setDirty(true);
  };

  const removeNode = (id: string) => {
    setNodes((current) => current.filter((node) => node.id !== id));
    setEdges((current) =>
      current.filter((edge) => edge.source !== id && edge.target !== id)
    );
    if (selectedId === id) setSelectedId(null);
    setDirty(true);
  };

  const persist = async () => {
    try {
      setSaveError(null);
      await save.mutateAsync({
        name,
        graph: {
          nodes: nodes.map(toDomain),
          edges: edges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
          })),
        },
      });
      setDirty(false);
      return true;
    } catch (problem) {
      // the server refuses a graph it cannot run; that is worth reading
      setSaveError(errorMessage(problem, "Could not save the flow"));
      return false;
    }
  };

  const testNode = async (id: string) => {
    // the server reads the stored graph, so an unsaved edit would be tested
    // as it was before the edit, which is worse than not testing at all
    if (dirty && !(await persist())) return;
    test.mutate(id);
  };

  const start = async () => {
    if (dirty && !(await persist())) return;
    run();
  };

  const selected = nodes.find((node) => node.id === selectedId);
  const marked = nodes.filter((node) => node.selected);
  const domain = nodes.map(toDomain);
  const live = useLiveNodes(domain);
  const isMac = isMacPlatform();
  const modKey = isMac ? "⌘" : "Ctrl";

  useFlowShortcuts({
    addQuery: () => addNode("query"),
    addRequest: () => addNode("request"),
    addConstants: () => addNode("constants"),
    addSocket: () => addNode("socket"),
    duplicate: duplicateSelection,
    remove: removeSelection,
    selectAll,
    save: () => {
      if (dirty && !save.isPending) void persist();
    },
    run: () => {
      if (!isRunning && nodes.length) void start();
    },
    deselect: () => (help ? setHelp(false) : clearSelection()),
    help: () => setHelp((current) => !current),
    nudge,
  });

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 px-2 text-xs"
          onClick={() => addNode("query")}
          title="Add a query node (Q)"
        >
          <Database className="h-3.5 w-3.5" />
          Query node
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 px-2 text-xs"
          onClick={() => addNode("request")}
          title="Add a request node (R)"
        >
          <Globe className="h-3.5 w-3.5" />
          Request node
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 px-2 text-xs"
          onClick={() => addNode("constants")}
          title="Add a constants node (C)"
        >
          <Braces className="h-3.5 w-3.5" />
          Constants
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 px-2 text-xs"
          onClick={() => addNode("socket")}
          title="Add a websocket source (W)"
        >
          <Radio className="h-3.5 w-3.5" />
          Websocket
        </Button>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={() => setHelp((current) => !current)}
            aria-expanded={help}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
          >
            <Keyboard className="h-3.5 w-3.5" />
          </Button>
          {dirty && <span className="text-[11px] text-muted-foreground">unsaved</span>}
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 px-2 text-xs"
            onClick={persist}
            disabled={save.isPending || !dirty}
            title={`Save (${modKey} + S)`}
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 px-3 text-xs"
            onClick={start}
            disabled={isRunning || nodes.length === 0}
            title={
              nodes.length === 0
                ? "Add a node first"
                : `Run this flow once (${modKey} + Enter)`
            }
          >
            {isRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {isRunning ? "Running…" : "Run"}
          </Button>
        </div>
      </div>

      {(saveError || failure) && (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <p className="min-w-0 break-words text-destructive/80">
            {saveError ?? failure}
          </p>
        </div>
      )}

      {summary && (
        <div
          role="status"
          className={cn(
            "border-b px-4 py-1.5 text-[11px]",
            summary.failed.length
              ? "border-destructive/30 bg-destructive/10 text-destructive/90"
              : "bg-muted/20 text-muted-foreground"
          )}
        >
          {summary.succeeded} succeeded
          {summary.failed.length > 0 && ` · ${summary.failed.join(", ")} failed`}
          {summary.skipped.length > 0 &&
            ` · ${summary.skipped.join(", ")} never ran, waiting on it`}
          {!!summary.checks?.failed.length && (
            <span className="text-amber-400">
              {` · ${summary.checks.failed.length} check${
                summary.checks.failed.length === 1 ? "" : "s"
              } failed: ${summary.checks.failed.join("; ")}`}
            </span>
          )}
          {!summary.checks?.failed.length && !!summary.checks?.passed && (
            ` · ${summary.checks.passed} check${
              summary.checks.passed === 1 ? "" : "s"
            } passed`
          )}
        </div>
      )}

      <ResizablePanelGroup
        direction="horizontal"
        // the width someone chose is a preference, not a per-flow setting
        autoSaveId="datapilot.flow-inspector"
        className="min-h-0 flex-1"
      >
        <ResizablePanel id="canvas" order={1} className="min-w-0">
          <div className="relative h-full min-w-0" data-testid="flow-canvas">
          <ReactFlow
            nodes={rendered}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            onPaneClick={() => setSelectedId(null)}
            // dragging the empty canvas draws a selection box, which is what a
            // builder is for; panning moves to the middle and right buttons
            selectionOnDrag
            panOnDrag={[1, 2]}
            selectionMode={SelectionMode.Partial}
            // deletion is handled here instead, so it marks the flow unsaved
            // and closes an inspector left open on a node that is gone
            deleteKeyCode={null}
            // fitting an empty graph leaves the viewport somewhere arbitrary,
            // and the first node added then lands outside it
            fitView={graph.nodes.length > 0}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />
            {nodes.length > 3 && (
              <MiniMap
                pannable
                zoomable
                // neutral rather than themed: the minimap has to read on the
                // light palette and the dark one, and grey is both
                bgColor="transparent"
                nodeColor="rgb(127 127 127 / 0.6)"
                maskColor="rgb(127 127 127 / 0.2)"
                className="!m-2 !h-20 !w-32 rounded border !bg-card/70"
              />
            )}
          </ReactFlow>

          {help && (
            <div className="absolute right-2 top-2 z-10 w-56 rounded-lg border bg-card shadow-lg">
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <p className="text-xs font-medium">Shortcuts</p>
                <button
                  type="button"
                  onClick={() => setHelp(false)}
                  aria-label="Close shortcuts"
                  className="ml-auto text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <ul className="p-2" aria-label="Keyboard shortcuts">
                {SHORTCUTS.map((shortcut) => (
                  <li
                    key={shortcut.action}
                    className="flex items-center gap-2 px-1 py-1 text-[11px]"
                  >
                    <span className="min-w-0 flex-1 text-muted-foreground">
                      {shortcut.label}
                    </span>
                    <kbd className="shrink-0 rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px]">
                      {shortcutLabel(shortcut, isMac)}
                    </kbd>
                  </li>
                ))}
                <li className="flex items-center gap-2 px-1 py-1 text-[11px]">
                  <span className="min-w-0 flex-1 text-muted-foreground">
                    Nudge the selection
                  </span>
                  <kbd className="shrink-0 rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px]">
                    Arrows
                  </kbd>
                </li>
              </ul>
              <p className="px-3 pb-2 text-[10px] leading-relaxed text-muted-foreground">
                A letter on its own does nothing while a field has focus, so
                typing a query stays typing a query.
              </p>
            </div>
          )}

          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-lg border bg-card/90 px-4 py-3 text-center">
                <p className="text-sm">Nothing on the canvas yet</p>
                <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                  Add a query node and a request node, then join them to pass
                  the rows along.
                </p>
              </div>
            </div>
          )}
          </div>
        </ResizablePanel>

        {(marked.length > 1 || selected) && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel
              id="inspector"
              order={2}
              defaultSize={26}
              minSize={16}
              maxSize={50}
              className="min-w-0"
            >
              {marked.length > 1 ? (
                <SelectionPanel
                  nodes={marked.map((node) => String(node.data.name))}
                  onArrange={arrange}
                  onDuplicate={duplicateSelection}
                  onDelete={removeSelection}
                  onClose={clearSelection}
                />
              ) : (
                selected && (
                  <NodeInspector
                    node={toDomain(selected)}
                    live={
                      selected.data.kind === "socket"
                        ? {
                            feed: live.feed(selected.id),
                            onStart: () => live.start(toDomain(selected)),
                            onStop: () => live.stop(selected.id),
                            onClear: () => live.clear(selected.id),
                          }
                        : undefined
                    }
                    run={runs[selected.id]}
                    connections={connections}
                    test={{
                      outcome: test.data,
                      isPending: test.isPending,
                      error: test.error,
                      dirty,
                      onRun: () => void testNode(selected.id),
                    }}
                    onChange={(patch) => patchNode(selected.id, patch)}
                    onDelete={() => removeNode(selected.id)}
                    onClose={clearSelection}
                  />
                )
              )}
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
