import { History, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatDuration, relativeTime } from "@/lib/format";
import type { RequestRun } from "../store/store";
import { useTabsStore } from "../store/store";

/**
 * Past runs, replayable.
 *
 * A saved request is the version you meant to keep; history is what you
 * actually sent, including the attempts that failed, which are usually the
 * ones worth finding again.
 */
export function RequestHistory({
  connectionId,
  onReplay,
}: {
  connectionId?: string;
  onReplay: (run: RequestRun) => void;
}) {
  const history = useTabsStore((state) => state.requestHistory);
  const clear = useTabsStore((state) => state.clearRequestHistory);

  // a run against another connection would resolve against the wrong base
  const runs = history.filter((run) => run.connectionId === connectionId);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 px-2 text-xs"
          title="Past runs"
        >
          <History className="h-3.5 w-3.5" />
          <span className="hidden md:inline">History</span>
          {runs.length > 0 && (
            <span className="text-[10px] text-muted-foreground">{runs.length}</span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-xs font-medium">Past runs</p>
          {runs.length > 0 && (
            <button
              type="button"
              onClick={clear}
              aria-label="Clear history"
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>

        {runs.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            Nothing sent yet on this connection.
          </p>
        ) : (
          <ul className="max-h-80 overflow-auto py-1">
            {runs.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  onClick={() => onReplay(run)}
                  className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-muted/60"
                >
                  <span className="w-12 shrink-0 pt-0.5 font-mono text-[10px] text-muted-foreground">
                    {run.method}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs">
                      {run.url || run.request.path || "/"}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
                      {run.error ? (
                        <span className="text-destructive">Failed</span>
                      ) : (
                        <span className={statusClass(run.status)}>{run.status}</span>
                      )}
                      {run.elapsedMs != null && <span>{formatDuration(run.elapsedMs)}</span>}
                      <span>{relativeTime(run.ranAt)}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function statusClass(status?: number): string {
  if (status == null) return "text-muted-foreground";
  if (status < 300) return "text-emerald-400";
  if (status < 400) return "text-sky-400";
  if (status < 500) return "text-amber-400";
  return cn("text-rose-400");
}
