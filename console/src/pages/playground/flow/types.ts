import type { RequestSpecModel } from "@/lib/sdk";
import { emptyRow, type KeyValueRow } from "../store/store";

export type NodeKind =
  | "query"
  | "request"
  | "constants"
  | "socket"
  | "graph";

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
  chart?: ChartConfig;
  checks?: FlowCheck[];
  [key: string]: unknown;
}

/** What a socket node subscribes to. The connection carries the base URL. */
export interface SocketConfig {
  path?: string;
}

/** One line on a graph: a field, and the node it comes from. */
export interface ChartSeries {
  /** The id of the node feeding it. */
  from: string;
  field: string;
}

/** What a graph node draws, and out of which fields. */
export interface ChartConfig {
  type?: "line" | "step" | "area" | "bar" | "bars-across" | "scatter";
  /** The field along the bottom. Blank means the order things arrived in. */
  x?: string;
  /** One line each, named by field only: kept for flows drawn before sources. */
  y?: string[];
  /**
   * One line each, each naming the node it comes from.
   *
   * A graph can be fed by several nodes at once - a table that was queried
   * once and a socket that keeps arriving - so a series has to say which one
   * it belongs to, or the two would be indistinguishable once merged.
   */
  series?: ChartSeries[];
  /** How many points to keep on screen. */
  window?: number;
  /**
   * A sample of what the data looks like, pasted before any has arrived.
   *
   * A flow is drawn before it is run, so the fields have to be choosable
   * before anything has produced them. The keys in here become suggestions
   * alongside the ones real data brings.
   */
  sample?: string;
  /** How big the node was dragged, so the chart keeps the room it was given. */
  w?: number;
  h?: number;
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
  chart?: ChartConfig;
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
  /** What the node was sent, once its references were replaced. */
  sent?: unknown;
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

export const NEW_GRAPH_NODE = (id: string): FlowNode => ({
  id,
  name: "Chart",
  kind: "graph",
  chart: { type: "line", x: "", y: [], window: 100 },
  position: { x: 0, y: 0 },
});

export const newNodeId = () =>
  `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
