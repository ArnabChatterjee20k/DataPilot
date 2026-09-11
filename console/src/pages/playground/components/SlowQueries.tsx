import { useState } from "react";
import {
  AlertCircle,
  Camera,
  GitCompareArrows,
  Loader2,
  RefreshCw,
  Trash2,
  Gauge,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import { formatCount, formatDuration, relativeTime } from "@/lib/format";
import type { SlowQueryModel } from "@/lib/sdk";
import type { DatabaseConnection, Tab } from "../store/store";
import {
  useComparison,
  useDeleteSnapshot,
  useSlowQueries,
  useSnapshots,
  useTakeSnapshot,
  type SlowQueryOrder,
} from "../hooks/useSlowQueries";
import { CopyButton, EmptyState, EnvironmentBadge } from "./primitives";

const ORDERS: { value: SlowQueryOrder; label: string }[] = [
  { value: "total", label: "Total time" },
  { value: "mean", label: "Mean time" },
  { value: "calls", label: "Calls" },
  { value: "rows", label: "Rows" },
];

/**
 * The statements the database itself has recorded as slow.
 *
 * Timing the queries DataPilot happens to run would only describe DataPilot;
 * this reads the server's own counters, which cover the application's traffic.
 */
export function SlowQueries({
  tab,
  connection,
}: {
  tab: Tab;
  connection?: DatabaseConnection;
}) {
  const [order, setOrder] = useState<SlowQueryOrder>("total");
  const [comparing, setComparing] = useState<string | null>(null);

  const report = useSlowQueries(tab.connectionId, order);
  const snapshots = useSnapshots(tab.connectionId);
  const takeSnapshot = useTakeSnapshot(tab.connectionId);
  const removeSnapshot = useDeleteSnapshot(tab.connectionId);
  const comparison = useComparison(tab.connectionId, comparing);

  const stored = snapshots.data?.snapshots ?? [];
  const available = report.data?.available !== false;
  const queries = comparing
    ? comparison.data?.queries ?? []
    : report.data?.queries ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <span className="text-xs font-medium">{connection?.name}</span>
        {connection && (
          <EnvironmentBadge
            environment={connection.environment}
            role={connection.role}
          />
        )}
        {report.data?.origin && (
          <span className="font-mono text-[11px] text-muted-foreground">
            {report.data.origin}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <Select
            value={order}
            onValueChange={(value) => setOrder(value as SlowQueryOrder)}
            disabled={!available || !!comparing}
          >
            <SelectTrigger className="h-8 w-32 text-xs" aria-label="Order by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORDERS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 px-2 text-xs"
            onClick={() => void report.refetch()}
            disabled={!available || report.isFetching}
            aria-label="Reload"
            title="Read the counters again"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", report.isFetching && "animate-spin")}
            />
          </Button>

          <Button
            size="sm"
            className="h-8 gap-1.5 px-3 text-xs"
            onClick={() => takeSnapshot.mutate("")}
            disabled={!available || takeSnapshot.isPending}
            title="Store this reading, so it survives the counters being reset"
          >
            {takeSnapshot.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Camera className="h-3.5 w-3.5" />
            )}
            Snapshot
          </Button>
        </div>
      </div>

      {!available && (
        <div
          role="status"
          className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <div className="min-w-0">
            <p className="font-medium text-amber-400">
              No statement statistics on this connection
            </p>
            <p className="mt-0.5 break-words text-amber-300/80">
              {report.data?.detail}
            </p>
          </div>
        </div>
      )}

      {report.error && (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <p className="min-w-0 break-words text-destructive/80">
            {errorMessage(report.error, "Could not read the statement statistics")}
          </p>
        </div>
      )}

      {stored.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5 border-b px-4 py-1.5"
          role="group"
          aria-label="Stored readings"
        >
          <span className="text-[11px] text-muted-foreground">Compare with:</span>
          {stored.map((snapshot) => {
            const active = comparing === snapshot.uid;
            return (
              <span
                key={snapshot.uid}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                  active
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "text-muted-foreground"
                )}
              >
                <button
                  type="button"
                  onClick={() => setComparing(active ? null : snapshot.uid)}
                  aria-pressed={active}
                  aria-label={`Compare with the reading from ${relativeTime(
                    Date.parse(snapshot.taken_at)
                  )}`}
                  className="inline-flex items-center gap-1"
                >
                  <GitCompareArrows className="h-3 w-3" />
                  {snapshot.note || relativeTime(Date.parse(snapshot.taken_at))}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (active) setComparing(null);
                    removeSnapshot.mutate(snapshot.uid);
                  }}
                  aria-label={`Delete the reading from ${snapshot.taken_at}`}
                  className="rounded hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {comparing && (
        <p
          role="status"
          className="border-b bg-muted/20 px-4 py-1.5 text-[11px] text-muted-foreground"
        >
          Showing what ran since that reading. The absolute numbers cover
          everything since the counters were last reset.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {report.isLoading || (comparing && comparison.isLoading) ? (
          <p className="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Reading the counters…
          </p>
        ) : comparison.error && comparing ? (
          <p className="px-4 py-6 text-xs text-destructive">
            {errorMessage(comparison.error, "Could not compare against that reading")}
          </p>
        ) : !available ? (
          // the banner above already says what is wrong and what to do
          null
        ) : queries.length === 0 ? (
          <EmptyState
            icon={Gauge}
            title={comparing ? "Nothing ran since that reading" : "Nothing recorded yet"}
            description="The server records statements as they run; come back once there has been some traffic."
          />
        ) : (
          <QueryTable queries={queries} />
        )}
      </div>
    </div>
  );
}

function QueryTable({ queries }: { queries: SlowQueryModel[] }) {
  return (
    <table className="w-full border-collapse text-xs">
      <thead className="sticky top-0 z-10 bg-card">
        <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <th className="px-4 py-2 font-medium">Statement</th>
          <th className="w-20 px-2 py-2 text-right font-medium">Calls</th>
          <th className="w-24 px-2 py-2 text-right font-medium">Total</th>
          <th className="w-24 px-2 py-2 text-right font-medium">Mean</th>
          <th className="w-24 px-2 py-2 text-right font-medium">Rows/call</th>
          <th className="w-28 px-2 py-2 text-right font-medium">Examined</th>
          <th className="w-10 px-2 py-2" />
        </tr>
      </thead>
      <tbody>
        {queries.map((query) => (
          <tr key={query.digest} className="group border-b hover:bg-muted/40">
            <td className="max-w-0 px-4 py-2">
              <p className="truncate font-mono" title={query.statement}>
                {query.statement}
              </p>
            </td>
            <td className="px-2 py-2 text-right tabular-nums">
              {formatCount(query.calls ?? 0)}
            </td>
            <td className="px-2 py-2 text-right tabular-nums">
              {formatDuration(query.total_ms ?? 0)}
            </td>
            <td
              className={cn(
                "px-2 py-2 text-right tabular-nums",
                (query.mean_ms ?? 0) > 100 && "text-amber-400"
              )}
            >
              {formatDuration(query.mean_ms ?? 0)}
            </td>
            <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
              {query.rows_per_call ?? 0}
            </td>
            <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
              {/* the gap between examined and returned is what finds a missing index */}
              {query.rows_examined == null ? "—" : formatCount(query.rows_examined)}
            </td>
            <td className="px-2 py-2 text-right">
              <span className="opacity-0 group-hover:opacity-100">
                <CopyButton value={query.statement} label="Copy statement" />
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
