import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertCircle, Database, Globe, Loader2, Play, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import type { DatabaseConnection } from "../store/store";
import { useSaveFlow } from "../hooks/useFlows";
import { FlowNodeCard, type FlowNodeCardData } from "./FlowNodeCard";
import { NodeInspector } from "./NodeInspector";
import { useFlowRun } from "./useFlowRun";
import {
  NEW_QUERY_NODE,
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
    const base = kind === "query" ? NEW_QUERY_NODE(id) : NEW_REQUEST_NODE(id);
    setNodes((current) => {
      const sameKind = current.filter((node) => node.data.kind === kind).length;
      return [
        ...current,
        toCanvas({
          ...base,
          name: `${base.name} ${sameKind + 1}`,
          position: nextPosition(current.length),
        }),
      ];
    });
    setSelectedId(id);
    setDirty(true);
  };

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

  const start = async () => {
    if (dirty && !(await persist())) return;
    run();
  };

  const selected = nodes.find((node) => node.id === selectedId);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 px-2 text-xs"
          onClick={() => addNode("query")}
        >
          <Database className="h-3.5 w-3.5" />
          Query node
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 px-2 text-xs"
          onClick={() => addNode("request")}
        >
          <Globe className="h-3.5 w-3.5" />
          Request node
        </Button>

        <div className="ml-auto flex items-center gap-1.5">
          {dirty && <span className="text-[11px] text-muted-foreground">unsaved</span>}
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 px-2 text-xs"
            onClick={persist}
            disabled={save.isPending || !dirty}
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 px-3 text-xs"
            onClick={start}
            disabled={isRunning || nodes.length === 0}
            title={nodes.length === 0 ? "Add a node first" : "Run this flow once"}
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
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1" data-testid="flow-canvas">
          <ReactFlow
            nodes={rendered}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_event, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            // fitting an empty graph leaves the viewport somewhere arbitrary,
            // and the first node added then lands outside it
            fitView={graph.nodes.length > 0}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>

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

        {selected && (
          <NodeInspector
            node={toDomain(selected)}
            run={runs[selected.id]}
            connections={connections}
            onChange={(patch) => patchNode(selected.id, patch)}
            onDelete={() => removeNode(selected.id)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
}
