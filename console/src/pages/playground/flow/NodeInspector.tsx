import { useState } from "react";
import { AlertCircle, Trash2, X } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import type { RequestSpecModel } from "@/lib/sdk";
import type { DatabaseConnection } from "../store/store";
import { CopyButton } from "../components/primitives";
import type { NodeTestModel } from "@/lib/sdk";
import { NodeTest } from "./NodeTest";
import type { FlowNode, NodeRun } from "./types";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const NO_CONNECTION = "__none__";

/**
 * One node, up close: what it will do, and what it did.
 *
 * The result panel is the point. A flow answers "where did the data stop being
 * what I expected", and that is unanswerable without seeing what each node
 * actually produced.
 */
export function NodeInspector({
  node,
  run,
  connections,
  test,
  onChange,
  onDelete,
  onClose,
}: {
  node: FlowNode;
  run?: NodeRun;
  connections: DatabaseConnection[];
  test: {
    outcome?: NodeTestModel;
    isPending: boolean;
    error: unknown;
    dirty: boolean;
    onRun: () => void;
  };
  onChange: (patch: Partial<FlowNode>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [panel, setPanel] = useState<"setup" | "result">("setup");

  const usable = connections.filter((item) =>
    node.kind === "query" ? item.type !== "api" : item.type === "api"
  );

  const patchRequest = (patch: Partial<RequestSpecModel>) =>
    onChange({ request: { ...(node.request ?? {}), ...patch } as RequestSpecModel });

  return (
    <aside
      className="flex w-80 shrink-0 flex-col border-l bg-card"
      aria-label={`${node.name} settings`}
    >
      <div className="flex items-center gap-1.5 border-b px-3 py-2">
        <input
          value={node.name}
          onChange={(event) => onChange({ name: event.target.value })}
          aria-label="Node name"
          className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${node.name}`}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the inspector"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-1 border-b px-3 py-1.5" role="tablist">
        {(["setup", "result"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={panel === value}
            onClick={() => setPanel(value)}
            className={cn(
              "rounded px-2 py-1 text-xs capitalize transition-colors",
              panel === value
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {panel === "setup" ? (
          <>
            <label className="block space-y-1">
              <span className="text-[11px] text-muted-foreground">Connection</span>
              <Select
                value={node.connection_id ?? NO_CONNECTION}
                onValueChange={(value) =>
                  onChange({
                    connection_id: value === NO_CONNECTION ? null : value,
                  })
                }
              >
                <SelectTrigger className="h-8 text-xs" aria-label="Node connection">
                  <SelectValue placeholder="Pick a connection" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CONNECTION}>No connection</SelectItem>
                  {usable.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {usable.length === 0 && (
                <span className="text-[11px] text-amber-500">
                  {node.kind === "query"
                    ? "No database connections yet."
                    : "No API connections yet."}
                </span>
              )}
            </label>

            {node.kind === "query" ? (
              <label className="block space-y-1">
                <span className="text-[11px] text-muted-foreground">Query</span>
                <textarea
                  value={node.query ?? ""}
                  onChange={(event) => onChange({ query: event.target.value })}
                  aria-label="Node query"
                  spellCheck={false}
                  placeholder="SELECT id, email FROM users WHERE id = {{Lookup.first.id}}"
                  className="h-40 w-full resize-y rounded-md border bg-background p-2 font-mono text-xs leading-5 outline-none focus:ring-1 focus:ring-ring"
                />
              </label>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <Select
                    value={node.request?.method ?? "GET"}
                    onValueChange={(method) =>
                      patchRequest({ method: method as RequestSpecModel["method"] })
                    }
                  >
                    <SelectTrigger className="h-8 w-24 font-mono text-xs" aria-label="Node method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METHODS.map((method) => (
                        <SelectItem key={method} value={method}>
                          {method}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <input
                    value={node.request?.path ?? ""}
                    onChange={(event) => patchRequest({ path: event.target.value })}
                    aria-label="Node path"
                    placeholder="/users/{{Users.first.id}}"
                    className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                <label className="block space-y-1">
                  <span className="text-[11px] text-muted-foreground">
                    JSON body
                  </span>
                  <textarea
                    value={node.request?.body_type === "json" ? String(node.request?.body ?? "") : ""}
                    onChange={(event) =>
                      patchRequest({
                        body_type: event.target.value.trim() ? "json" : "none",
                        body: event.target.value,
                      })
                    }
                    aria-label="Node body"
                    spellCheck={false}
                    placeholder='{"userId": {{Users.first.id}}}'
                    className="h-32 w-full resize-y rounded-md border bg-background p-2 font-mono text-xs leading-5 outline-none focus:ring-1 focus:ring-ring"
                  />
                </label>
              </>
            )}

            <p className="text-[11px] text-muted-foreground">
              Write <code>{"{{NodeName.first.id}}"}</code> to use what an
              upstream node produced. A query node offers{" "}
              <code>rows</code>, <code>first</code> and <code>row_count</code>;
              a request node offers <code>status</code>, <code>json</code> and{" "}
              <code>body</code>. Test the node to see the exact references,
              with what each one holds.
            </p>

            <NodeTest {...test} />
          </>
        ) : (
          <ResultPanel run={run} />
        )}
      </div>
    </aside>
  );
}

function ResultPanel({ run }: { run?: NodeRun }) {
  if (!run || run.state === "idle") {
    return (
      <p className="text-xs text-muted-foreground">
        This node has not run yet. Press Run to see what it produces.
      </p>
    );
  }

  if (run.state === "skipped") {
    return (
      <div className="space-y-2 text-xs">
        <p className="font-medium text-muted-foreground">This node never ran</p>
        <p className="text-muted-foreground">
          It was waiting on {run.blocked_by.join(", ") || "something upstream"},
          which did not finish. Fix that node and run again.
        </p>
      </div>
    );
  }

  if (run.state === "failed") {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />
          {run.name} failed
        </p>
        <p className="break-words text-xs text-destructive/80">{run.error}</p>
      </div>
    );
  }

  const body = JSON.stringify(run.result, null, 2);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-emerald-400">{run.summary}</span>
        {run.elapsed_ms != null && (
          <span className="text-muted-foreground">
            {formatDuration(run.elapsed_ms)}
          </span>
        )}
        <span className="ml-auto">
          <CopyButton value={body} label="Copy result" className="h-6 w-6" />
        </span>
      </div>

      {!!run.warnings?.length && (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-400">
          {run.warnings.map((warning) => (
            <p key={warning} className="break-words">
              {warning}
            </p>
          ))}
        </div>
      )}

      <pre
        aria-label="Node result"
        className="max-h-96 overflow-auto rounded border bg-background p-2 font-mono text-[11px] leading-5"
      >
        {body}
      </pre>
    </div>
  );
}
