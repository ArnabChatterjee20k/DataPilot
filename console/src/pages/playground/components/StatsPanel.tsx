import { AlertCircle, BarChart3, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import { formatCount, pillClass } from "@/lib/format";
import type { TableStatsModel } from "@/lib/sdk";
import { EmptyState } from "./primitives";

/** Per-column null share, cardinality and most common values. */
export function StatsPanel({
  stats,
  isLoading,
  error,
}: {
  stats?: TableStatsModel | null;
  isLoading: boolean;
  error?: unknown;
}) {
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Reading column statistics…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <AlertCircle className="h-6 w-6 text-destructive" />
        <p className="text-xs text-destructive">{errorMessage(error)}</p>
      </div>
    );
  }

  const columns = stats?.columns ?? [];

  if (!stats) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No statistics"
        description="Open a table to see its column statistics."
      />
    );
  }

  return (
    <div className="h-full overflow-auto p-4" role="region" aria-label="Column statistics">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">
            {formatCount(stats.row_count)}
          </span>{" "}
          rows
        </span>
        <span>
          <span className="font-medium text-foreground">{columns.length}</span>{" "}
          columns
        </span>
        {stats.sampled && (
          <span className="text-amber-400">
            sampled from the first {formatCount(stats.scanned_rows)} rows
          </span>
        )}
      </div>

      <div className="space-y-2">
        {columns.map((column) => (
          <div key={column.name} className="rounded-md border p-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs font-medium">{column.name}</span>
              <span className="text-[11px] text-muted-foreground">
                {formatCount(column.distinct_count ?? null)} distinct
              </span>
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full",
                    (column.null_percent ?? 0) > 50
                      ? "bg-rose-500/70"
                      : "bg-sky-500/60"
                  )}
                  style={{ width: `${Math.min(100, column.null_percent ?? 0)}%` }}
                />
              </div>
              <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {column.null_percent ?? 0}% null
              </span>
            </div>

            {(column.top_values ?? []).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {(column.top_values ?? []).map((entry, index) => {
                  const raw =
                    entry.value === null || entry.value === undefined
                      ? "null"
                      : String(entry.value);
                  // an empty string would otherwise render as a bare count
                  const label = raw === "" ? "(empty)" : raw;
                  return (
                    <span
                      key={`${label}-${index}`}
                      className={cn(
                        "inline-flex max-w-52 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                        pillClass(label)
                      )}
                      title={`${label} — ${entry.count} rows`}
                    >
                      <span className="truncate">{label}</span>
                      <span className="opacity-70">{entry.count}</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
