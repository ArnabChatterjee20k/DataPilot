import { memo } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  BarChart3,
  Braces,
  Database,
  Radio,
  Globe,
  Loader2,
  MinusCircle,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import type { RequestSpecModel } from "@/lib/sdk";
import type { KeyValueRow } from "../store/store";
import { FlowChart } from "./Chart";
import { toPoints } from "./chartData";
import type {
  ChartConfig,
  NodeKind,
  NodeRun,
  NodeState,
  SocketConfig,
} from "./types";

const STATE_STYLE: Record<NodeState, string> = {
  idle: "border-border",
  running: "border-amber-500/60 shadow-[0_0_0_3px] shadow-amber-500/10",
  succeeded: "border-emerald-500/50",
  failed: "border-destructive/60 shadow-[0_0_0_3px] shadow-destructive/10",
  skipped: "border-border border-dashed opacity-70",
  live: "border-sky-500/50",
};

const STATE_TEXT: Record<NodeState, string> = {
  idle: "text-muted-foreground",
  running: "text-amber-400",
  succeeded: "text-emerald-400",
  failed: "text-destructive",
  skipped: "text-muted-foreground",
  live: "text-sky-400",
};

function StateIcon({ state }: { state: NodeState }) {
  const className = cn("h-3.5 w-3.5 shrink-0", STATE_TEXT[state]);
  if (state === "running") return <Loader2 className={cn(className, "animate-spin")} />;
  if (state === "succeeded") return <CheckCircle2 className={className} />;
  if (state === "failed") return <XCircle className={className} />;
  if (state === "skipped") return <MinusCircle className={className} />;
  if (state === "live") return <Radio className={className} />;
  return <Circle className={className} />;
}

export interface FlowNodeCardData extends Record<string, unknown> {
  name: string;
  kind: NodeKind;
  /** The node's own configuration, so the canvas is the single source. */
  connection_id?: string | null;
  query?: string;
  request?: RequestSpecModel;
  constants?: KeyValueRow[];
  socket?: SocketConfig;
  chart?: ChartConfig;
  checks?: unknown[];
  /** Derived for the card: the line under the title. */
  subtitle: string;
  connectionName?: string;
  run?: NodeRun;
  /** For a graph node: what its upstream has produced so far. */
  rows?: Record<string, unknown>[];
}

/**
 * One node on the canvas, showing what it is and what it did.
 *
 * Debugging a flow means finding where the data stopped being what you
 * expected, so the state, the timing, the count and the reason all belong on
 * the card - a node you have to click to learn anything about is no help.
 */
export const FlowNodeCard = memo(function FlowNodeCard({
  data,
  selected,
}: NodeProps) {
  const card = data as FlowNodeCardData;
  const run = card.run;
  const state: NodeState = run?.state ?? "idle";
  const Icon =
    card.kind === "query"
      ? Database
      : card.kind === "constants"
        ? Braces
        : card.kind === "socket"
          ? Radio
          : card.kind === "graph"
            ? BarChart3
            : Globe;
  // a constants node has nothing to connect to, so the amber warning below
  // would make a correctly configured one look permanently broken
  const needsConnection = card.kind !== "constants" && card.kind !== "graph";

  // a chart in a 256px box is a thumbnail of a chart; a graph node is given
  // room by default and can be dragged bigger from there
  const isGraph = card.kind === "graph";
  const series = (card.chart?.y ?? []).filter(Boolean);
  const width = isGraph ? (card.chart?.w ?? 340) : undefined;
  const height = isGraph ? (card.chart?.h ?? 210) : undefined;

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border bg-card text-left shadow-sm transition-shadow",
        !isGraph && "w-64",
        STATE_STYLE[state],
        selected && "ring-2 ring-ring"
      )}
      style={isGraph ? { width, height } : undefined}
      data-testid={`flow-node-${card.name}`}
      data-state={state}
    >
      {isGraph && (
        <NodeResizer
          isVisible={selected}
          minWidth={260}
          minHeight={160}
          lineClassName="!border-ring"
          handleClassName="!h-2 !w-2 !rounded-sm !border-ring !bg-background"
        />
      )}

      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-background !bg-muted-foreground"
      />

      <div className="flex items-center gap-1.5 border-b px-2.5 py-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{card.name}</span>
        <StateIcon state={state} />
      </div>

      {isGraph ? (
        <div className="min-h-0 flex-1 px-2.5 py-1.5">
          {series.length ? (
            <FlowChart
              points={toPoints(
                card.rows ?? [],
                card.chart?.x ?? "",
                series,
                card.chart?.window ?? 100
              )}
              series={series}
              type={card.chart?.type ?? "line"}
              height={Math.max((height ?? 210) - 74, 90)}
              label={`${series.join(", ")} by ${card.chart?.x || "arrival"}`}
            />
          ) : (
            <p className="py-6 text-center text-[11px] text-muted-foreground">
              {/* the node is the picture, so it says what it is missing here
                  rather than only in a panel somebody has to open */}
              Nothing to draw yet. Name a field in the panel.
            </p>
          )}
        </div>
      ) : (
      <div className="space-y-1 px-2.5 py-1.5">
        <p
          className="truncate font-mono text-[11px] text-muted-foreground"
          title={card.subtitle}
        >
          {card.subtitle ||
            (card.kind === "query"
              ? "no query yet"
              : card.kind === "constants"
                ? "no values yet"
                : "no path yet")}
        </p>

        {card.connectionName ? (
          <p className="truncate text-[10px] text-muted-foreground/70">
            {card.connectionName}
          </p>
        ) : (
          needsConnection && (
            <p className="text-[10px] text-amber-500">no connection chosen</p>
          )
        )}

        {!!run?.checks?.length && (
          <p
            className={cn(
              "text-[10px]",
              run.checks.every((item) => item.passed)
                ? "text-emerald-400"
                : "text-amber-400"
            )}
          >
            {/* amber, not red: a failed check is a finding about the data,
                and this node still did what it was asked */}
            {run.checks.filter((item) => item.passed).length}/{run.checks.length}{" "}
            checks passed
          </p>
        )}

        {(run?.summary || run?.elapsed_ms != null) && (
          <p className={cn("flex items-center gap-2 text-[11px]", STATE_TEXT[state])}>
            {run?.summary && <span className="truncate">{run.summary}</span>}
            {run?.elapsed_ms != null && state !== "skipped" && (
              <span className="shrink-0 text-muted-foreground/70">
                {formatDuration(run.elapsed_ms)}
              </span>
            )}
          </p>
        )}

        {run?.error && (
          <p className="line-clamp-3 break-words text-[11px] text-destructive/90">
            {run.error}
          </p>
        )}

        {!!run?.warnings?.length && (
          <p className="flex items-start gap-1 text-[11px] text-amber-500">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="line-clamp-2 break-words">{run.warnings[0]}</span>
          </p>
        )}
      </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-background !bg-muted-foreground"
      />
    </div>
  );
});
