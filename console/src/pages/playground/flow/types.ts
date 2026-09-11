import type { RequestSpecModel } from "@/lib/sdk";

export type NodeKind = "query" | "request";

/**
 * A node's state during a run.
 *
 * `skipped` is the important one: a node that never ran because something
 * upstream failed has not itself failed, and calling both "failed" hides which
 * one to go and fix.
 */
export type NodeState =
  | "idle"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export interface FlowNodeData {
  name: string;
  kind: NodeKind;
  connection_id?: string | null;
  query?: string;
  request?: RequestSpecModel;
  [key: string]: unknown;
}

export interface FlowNode {
  id: string;
  name: string;
  kind: NodeKind;
  connection_id?: string | null;
  query?: string;
  request?: RequestSpecModel;
  position?: { x: number; y: number };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** What the server reports for one node, every time its state changes. */
export interface NodeRun {
  id: string;
  name: string;
  kind: NodeKind;
  state: NodeState;
  elapsed_ms?: number | null;
  summary: string;
  result?: unknown;
  error: string;
  warnings: string[];
  blocked_by: string[];
}

export interface RunSummary {
  succeeded: number;
  failed: string[];
  skipped: string[];
}

export const NEW_QUERY_NODE = (id: string): FlowNode => ({
  id,
  name: "Query",
  kind: "query",
  query: "",
  position: { x: 0, y: 0 },
});

export const NEW_REQUEST_NODE = (id: string): FlowNode => ({
  id,
  name: "Request",
  kind: "request",
  request: {
    name: "Request",
    method: "GET",
    path: "",
    params: [],
    headers: [],
    body_type: "none",
    body: "",
    auth: null,
  },
  position: { x: 0, y: 0 },
});

export const newNodeId = () =>
  `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
