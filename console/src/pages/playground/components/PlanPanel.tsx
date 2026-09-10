import { AlertCircle, Gauge, Loader2, Zap } from "lucide-react";

import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import { formatCount } from "@/lib/format";
import type { QueryInsightModel } from "@/lib/sdk";
import { EmptyState } from "./primitives";

const SPEED_STYLE: Record<string, string> = {
  fast: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  medium: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  slow: "text-rose-400 border-rose-500/30 bg-rose-500/10",
};

/** What the planner intends to do — no rows are read to produce this. */
export function PlanPanel({
  plan,
  isLoading,
  error,
}: {
  plan?: QueryInsightModel | null;
  isLoading: boolean;
  error?: unknown;
}) {
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Reading the query plan…
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

  const warnings = plan?.warnings ?? [];
  const scans = plan?.scans ?? [];

  if (!plan || !plan.supported) {
    return (
      <EmptyState
        icon={Gauge}
        title="No plan available"
        description="Run a query to see how the database intends to execute it."
      />
    );
  }

  return (
    <div
      className="h-full space-y-3 overflow-auto p-4"
      role="region"
      aria-label="Query plan"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {plan.speed && (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-medium uppercase tracking-wide",
              SPEED_STYLE[plan.speed]
            )}
          >
            <Zap className="h-3 w-3" />
            {plan.speed}
          </span>
        )}
        <span
          className={cn(
            "rounded border px-2 py-0.5",
            plan.uses_index
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-border text-muted-foreground"
          )}
        >
          {plan.uses_index ? "uses an index" : "no index used"}
        </span>
        {plan.estimated_rows !== null && plan.estimated_rows !== undefined && (
          <span className="text-muted-foreground">
            ~{formatCount(plan.estimated_rows)} rows estimated
          </span>
        )}
        {plan.estimated_cost !== null && plan.estimated_cost !== undefined && (
          <span className="text-muted-foreground">
            cost {plan.estimated_cost.toFixed(2)}
          </span>
        )}
      </div>

      {warnings.length > 0 && (
        <ul className="space-y-1">
          {warnings.map((warning) => (
            <li
              key={warning}
              className="flex items-start gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/10 p-2 text-[11px] text-amber-300"
            >
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              {warning}
            </li>
          ))}
        </ul>
      )}

      {scans.length > 0 && (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/30 text-left">
                <th className="px-2.5 py-1.5 font-medium">Table</th>
                <th className="px-2.5 py-1.5 font-medium">Access</th>
                <th className="px-2.5 py-1.5 font-medium">Index</th>
                <th className="px-2.5 py-1.5 text-right font-medium">Rows</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((scan, index) => (
                <tr key={`${scan.table}-${index}`} className="border-b last:border-0">
                  <td className="px-2.5 py-1.5 font-mono">{scan.table ?? "—"}</td>
                  <td
                    className={cn(
                      "px-2.5 py-1.5",
                      scan.type === "sequential" ? "text-amber-400" : "text-emerald-400"
                    )}
                    title={scan.detail}
                  >
                    {scan.type}
                  </td>
                  <td className="px-2.5 py-1.5 font-mono text-muted-foreground">
                    {scan.index ?? "—"}
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-muted-foreground">
                    {scan.estimated_rows === null || scan.estimated_rows === undefined
                      ? "—"
                      : formatCount(scan.estimated_rows)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="rounded-md border">
        <summary className="cursor-pointer px-2.5 py-1.5 text-xs text-muted-foreground">
          Raw plan
        </summary>
        <pre className="max-h-64 overflow-auto border-t p-2.5 font-mono text-[11px] leading-relaxed">
          {JSON.stringify(plan.plan, null, 2)}
        </pre>
      </details>
    </div>
  );
}
