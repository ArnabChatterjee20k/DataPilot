import { AlertCircle, FlaskConical, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import type { NodeReferenceModel, NodeTestModel } from "@/lib/sdk";
import { CopyButton } from "../components/primitives";

/**
 * Firing one node from the setup tab.
 *
 * Running the whole flow to find out what one node does is a slow way to ask,
 * and the answer arrives mixed in with every other node. What matters here is
 * what this node was actually sent: the reference is usually fine and the
 * value behind it is not.
 */
export function NodeTest({
  outcome,
  isPending,
  error,
  dirty,
  onRun,
}: {
  outcome?: NodeTestModel;
  isPending: boolean;
  error: unknown;
  dirty: boolean;
  onRun: () => void;
}) {
  const run = outcome?.node;

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={onRun}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FlaskConical className="h-3.5 w-3.5" />
          )}
          Test this node
        </Button>
        <span className="text-[10px] leading-tight text-muted-foreground">
          {dirty ? "Saves first, then runs" : "Runs this node and what feeds it"}
        </span>
      </div>

      {!!error && (
        <p className="break-words text-[11px] text-destructive">
          {String((error as Error)?.message ?? error)}
        </p>
      )}

      {run && (
        <>
          <Outcome outcome={outcome!} />
          <Offers rows={outcome!.offers ?? []} />
          <Available outcome={outcome!} />
        </>
      )}
    </div>
  );
}

function Outcome({ outcome }: { outcome: NodeTestModel }) {
  const run = outcome.node;
  const sent = outcome.resolved_query
    ? outcome.resolved_query
    : outcome.resolved_request
      ? describeRequest(outcome.resolved_request)
      : "";

  if (run.state === "skipped") {
    return (
      <p className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-400">
        {/* a node that never ran has not failed, and saying so hides which
            one to go and fix */}
        This node never ran. It is waiting on{" "}
        {run.blocked_by?.join(", ") || "something upstream"}, which did not
        finish. Test that node instead.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p
        className={cn(
          "flex items-center gap-1.5 text-[11px]",
          run.state === "failed" ? "text-destructive" : "text-emerald-400"
        )}
      >
        {run.state === "failed" && <AlertCircle className="h-3.5 w-3.5" />}
        {run.state === "failed" ? run.error : run.summary}
        {run.elapsed_ms != null && (
          <span className="ml-auto text-muted-foreground">
            {formatDuration(run.elapsed_ms)}
          </span>
        )}
      </p>

      {!!run.checks?.length && (
        <ul className="space-y-1" aria-label="Check results">
          {run.checks.map((item, index) => (
            <li
              key={index}
              className={cn(
                "rounded border px-2 py-1 text-[11px]",
                item.passed
                  ? "border-emerald-500/25 text-emerald-400"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-300"
              )}
            >
              <p className="font-mono">{item.description}</p>
              {!item.passed && (
                <p className="text-muted-foreground">
                  got {item.actual || "nothing"}
                  {item.detail && ` (${item.detail})`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {!!run.warnings?.length && (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-400">
          {run.warnings.map((warning) => (
            <p key={warning} className="break-words">
              {warning}
            </p>
          ))}
        </div>
      )}

      {!!sent && (
        <details className="rounded border bg-background" open>
          <summary className="cursor-pointer px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            What was sent
          </summary>
          <pre
            aria-label="What was sent"
            className="max-h-40 overflow-auto px-2 pb-2 font-mono text-[11px] leading-5"
          >
            {sent}
          </pre>
        </details>
      )}

      {run.state === "succeeded" && run.result != null && (
        <details className="rounded border bg-background" open>
          <summary className="cursor-pointer px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            What came back
          </summary>
          <pre
            aria-label="What came back"
            className="max-h-48 overflow-auto px-2 pb-2 font-mono text-[11px] leading-5"
          >
            {JSON.stringify(run.result, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

/**
 * How a node after this one uses what it just produced.
 *
 * This is the question people ask while looking at the result: they can see
 * the rows, and what they want is the line to paste into the next node. The
 * value beside each reference is what it holds right now, so the right one is
 * picked by reading rather than by guessing at the output shape.
 */
function Offers({ rows }: { rows: NodeReferenceModel[] }) {
  if (!rows.length) return null;
  return (
    <ReferenceTable title="How the next node uses this" rows={rows} />
  );
}

/** What this node can refer to, from everything that feeds it. */
function Available({ outcome }: { outcome: NodeTestModel }) {
  const groups = outcome.available ?? [];
  if (!groups.length) return null;

  return (
    <>
      {groups.map((group) => (
        <ReferenceTable
          key={group.node}
          title={`From ${group.node}`}
          rows={group.references ?? []}
        />
      ))}
    </>
  );
}

function ReferenceTable({
  title,
  rows,
}: {
  title: string;
  rows: NodeReferenceModel[];
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <table
        className="w-full table-fixed border-collapse rounded border bg-background"
        aria-label={title}
      >
        <thead>
          <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="w-[55%] px-2 py-1 font-medium">You write</th>
            <th className="px-2 py-1 font-medium" colSpan={2}>
              You get
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.reference} className="border-b last:border-0 hover:bg-muted/40">
              <td className="px-2 py-1 align-top font-mono text-[10px] leading-4 text-sky-400">
                <span className="break-all">{item.reference}</span>
              </td>
              <td
                title={item.value}
                className="px-2 py-1 align-top font-mono text-[10px] leading-4 text-muted-foreground"
              >
                {/* two lines, then cut: a whole row of JSON would push the
                    reference it belongs to off the panel */}
                <span className="line-clamp-2 break-all">{item.value}</span>
              </td>
              <td className="w-6 py-0.5 pr-1 align-top">
                <CopyButton
                  value={item.reference}
                  label={`Copy ${item.reference}`}
                  className="h-5 w-5"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The request as it went out, in the shape it was written in.
 *
 * Dumping the whole spec buries the two lines that were interpolated under
 * the ten that were not.
 */
export function describeRequest(request: Record<string, unknown>): string {
  const method = String(request.method ?? "GET");
  const line = `${method} ${String(request.path ?? "")}`.trim();
  const headers = (request.headers as { key?: string; value?: string }[]) ?? [];

  const parts = [line];
  for (const header of headers) {
    if (header?.key) parts.push(`${header.key}: ${header.value ?? ""}`);
  }
  const body = request.body;
  if (typeof body === "string" && body.trim()) parts.push("", body);
  return parts.join("\n");
}
