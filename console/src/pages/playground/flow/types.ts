import type { RequestSpecModel } from "@/lib/sdk";
import { emptyRow, type KeyValueRow } from "../store/store";

export type NodeKind = "query" | "request" | "constants" | "socket";

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
  | "skipped"
  // runs in the browser, so the server never starts or finishes it
  | "live";

export interface FlowNodeData {
  name: string;
  kind: NodeKind;
  connection_id?: string | null;
  query?: string;
  request?: RequestSpecModel;
  constants?: KeyValueRow[];
  socket?: SocketConfig;
  checks?: FlowCheck[];
  [key: string]: unknown;
}

/** What a socket node subscribes to. The connection carries the base URL. */
export interface SocketConfig {
  path?: string;
}

export interface FlowNode {
  id: string;
  name: string;
  kind: NodeKind;
  connection_id?: string | null;
  query?: string;
  request?: RequestSpecModel;
  constants?: KeyValueRow[];
  socket?: SocketConfig;
  checks?: FlowCheck[];
  position?: { x: number; y: number };
}

/** One assertion on a node's input or output. */
export interface FlowCheck {
  on: "input" | "output";
  path: string;
  op:
    | "eq"
    | "ne"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "contains"
    | "not_contains"
    | "matches"
    | "count_eq"
    | "count_gt"
    | "count_lt"
    | "exists"
    | "missing"
    | "empty"
    | "not_empty";
  value: string;
  enabled: boolean;
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
  checks?: NodeCheck[];
}

/** What one assertion saw. A failure here never changes the node's state. */
export interface NodeCheck {
  on: "input" | "output";
  path: string;
  op: string;
  value: string;
  passed: boolean;
  actual: string;
  detail: string;
  description: string;
}

export interface RunSummary {
  succeeded: number;
  failed: string[];
  skipped: string[];
  live?: string[];
  checks?: { passed: number; failed: string[] };
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

export const NEW_CONSTANTS_NODE = (id: string): FlowNode => ({
  id,
  name: "Config",
  kind: "constants",
  constants: [emptyRow()],
  position: { x: 0, y: 0 },
});

export const NEW_SOCKET_NODE = (id: string): FlowNode => ({
  id,
  name: "Stream",
  kind: "socket",
  socket: { path: "" },
  position: { x: 0, y: 0 },
});

export const newNodeId = () =>
  `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
