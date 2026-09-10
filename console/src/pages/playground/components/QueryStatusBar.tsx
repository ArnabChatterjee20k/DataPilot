import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  PlugZap,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatCount, formatDuration } from "@/lib/format";
import type { QueryResultState } from "../store/store";

const RISK_STYLE: Record<string, string> = {
  safe: "text-emerald-400",
  caution: "text-amber-400",
  dangerous: "text-rose-400",
};

/**
 * One line telling the user what just happened: succeeded or not, how long it
 * took, how many rows, and anything the backend flagged as risky.
 */
export function QueryStatusBar({
  result,
  isRunning,
  className,
  onRetest,
  isRetesting,
  retestOutcome,
}: {
  result?: QueryResultState;
  isRunning?: boolean;
  className?: string;
  /** Re-dial the connection, for a failure that was not about the query. */
  onRetest?: () => void;
  isRetesting?: boolean;
  retestOutcome?: { reachable: boolean; detail?: string | null } | null;
}) {
  if (isRunning) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 border-b bg-muted/20 px-4 py-1.5 text-xs text-muted-foreground",
          className
        )}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Running…
      </div>
    );
  }

  if (!result) return null;

  if (result.error) {
    // a query that is wrong is fixed in the editor; a database that is not
    // there is fixed somewhere else, so they must not read the same
    const unreachable = result.errorKind === "connection";
    return (
      <div
        className={cn(
          "flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs",
          className
        )}
        role="alert"
      >
        {unreachable ? (
          <PlugZap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
        ) : (
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-destructive">
            {unreachable ? "Cannot reach the database" : "Query failed"}
          </p>
          <p className="mt-0.5 break-words text-destructive/80">{result.error}</p>
          {retestOutcome && (
            <p
              className={cn(
                "mt-1.5 break-words",
                retestOutcome.reachable ? "text-emerald-400" : "text-destructive/80"
              )}
            >
              {retestOutcome.reachable
                ? "The connection answers now - run the query again."
                : `Still unreachable: ${retestOutcome.detail || "no answer"}`}
            </p>
          )}
        </div>
        {unreachable && onRetest && (
          <button
            type="button"
            onClick={onRetest}
            disabled={isRetesting}
            className="shrink-0 rounded border border-destructive/40 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10 disabled:opacity-60"
          >
            {isRetesting ? "Testing…" : "Test connection"}
          </button>
        )}
      </div>
    );
  }

  const warnings = result.risk?.warnings ?? [];
  const level = result.risk?.level ?? "safe";

  return (
    <div
      className={cn("border-b bg-muted/20 px-4 py-1.5 text-xs", className)}
      role="status"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {result.returnsRows
            ? `${formatCount(result.rowCount)} row${result.rowCount === 1 ? "" : "s"}`
            : `${formatCount(result.rowsAffected)} row${
                result.rowsAffected === 1 ? "" : "s"
              } affected`}
        </span>

        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          {formatDuration(result.executionMs)}
        </span>

        {result.risk && (
          <span className={cn("inline-flex items-center gap-1.5", RISK_STYLE[level])}>
            <ShieldAlert className="h-3.5 w-3.5" />
            {result.risk.statement} · {level}
          </span>
        )}

        {result.truncated && (
          <span className="inline-flex items-center gap-1.5 text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            Truncated at the row limit
          </span>
        )}
      </div>

      {warnings.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {warnings.map((warning) => (
            <li
              key={warning}
              className="flex items-start gap-1.5 text-[11px] text-amber-400/90"
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {warning}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
