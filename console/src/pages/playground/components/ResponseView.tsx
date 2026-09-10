import { useMemo, useState } from "react";
import { AlertCircle, Clock, HardDrive, Loader2, SendHorizontal } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatDuration, prettyJson } from "@/lib/format";
import type { RequestResultState } from "../store/store";
import { CopyButton, EmptyState } from "./primitives";

function statusTone(status: number): string {
  if (status < 200) return "text-sky-400";
  if (status < 300) return "text-emerald-400";
  if (status < 400) return "text-amber-400";
  return "text-rose-400";
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

export function ResponseView({
  state,
  isSending,
}: {
  state?: RequestResultState;
  isSending: boolean;
}) {
  const [pretty, setPretty] = useState(true);

  const response = state?.result?.response;
  const request = state?.result?.request;

  const looksJson = useMemo(
    () => (response?.content_type ?? "").toLowerCase().includes("json"),
    [response?.content_type]
  );

  const body = useMemo(() => {
    if (!response) return "";
    if (!response.is_text) return response.body;
    return pretty && looksJson ? prettyJson(response.body) : response.body;
  }, [response, pretty, looksJson]);

  if (isSending && !state) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Sending…
      </div>
    );
  }

  if (!state) {
    return (
      <EmptyState
        icon={SendHorizontal}
        title="No response yet"
        description="Press Send to run this request."
      />
    );
  }

  if (state.error || !response) {
    return (
      <div className="flex h-full flex-col">
        <div
          className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs"
          role="status"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="font-medium text-destructive">Request failed</p>
            <p className="mt-0.5 break-words text-destructive/80">{state.error}</p>
          </div>
        </div>
        <EmptyState
          icon={SendHorizontal}
          title="Nothing came back"
          description="The request could not be delivered."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-muted/20 px-4 py-1.5 text-xs"
        role="status"
      >
        <span className={cn("font-medium", statusTone(response.status ?? 0))}>
          {response.status} {response.reason}
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          {formatDuration(response.elapsed_ms)}
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <HardDrive className="h-3.5 w-3.5" />
          {formatBytes(response.size ?? 0)}
        </span>
        {response.content_type && (
          <span className="truncate text-muted-foreground">{response.content_type}</span>
        )}
        {response.truncated && (
          <span className="text-amber-400">body truncated</span>
        )}
      </div>

      <Tabs defaultValue="body" className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 px-4 pt-2">
          <TabsList aria-label="Response sections">
            <TabsTrigger value="body" className="text-xs">
              Body
            </TabsTrigger>
            <TabsTrigger value="headers" className="text-xs">
              Headers
              <span className="ml-1 text-[10px] text-muted-foreground">
                {response.headers?.length ?? 0}
              </span>
            </TabsTrigger>
            <TabsTrigger value="request" className="text-xs">
              Request
            </TabsTrigger>
          </TabsList>

          <div className="ml-auto flex items-center gap-1">
            {looksJson && response.is_text && (
              <button
                type="button"
                onClick={() => setPretty((current) => !current)}
                aria-pressed={pretty}
                className={cn(
                  "rounded px-2 py-1 text-[11px] transition-colors",
                  pretty
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Pretty
              </button>
            )}
            <CopyButton value={body ?? ""} label="Copy response body" />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 pb-3 pt-2">
          <TabsContent value="body" className="mt-0">
            {!response.is_text && (
              <p className="mb-2 text-[11px] text-muted-foreground">
                Binary response, shown base64 encoded.
              </p>
            )}
            <pre
              aria-label="Response body"
              className="whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3 font-mono text-[11.5px] leading-relaxed"
            >
              {body || "(empty)"}
            </pre>
          </TabsContent>

          <TabsContent value="headers" className="mt-0">
            <HeaderTable headers={response.headers ?? []} />
          </TabsContent>

          <TabsContent value="request" className="mt-0 space-y-3">
            <div>
              <p className="mb-1 text-[11px] text-muted-foreground">Sent</p>
              <p className="break-all rounded-md bg-muted/30 p-2 font-mono text-[11.5px]">
                <span className="font-semibold">{request?.method}</span> {request?.url}
              </p>
            </div>
            <div>
              <p className="mb-1 text-[11px] text-muted-foreground">
                Headers — credential values are masked
              </p>
              <HeaderTable headers={request?.headers ?? []} />
            </div>
            {request?.body && (
              <div>
                <p className="mb-1 text-[11px] text-muted-foreground">Body</p>
                <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/30 p-2 font-mono text-[11.5px]">
                  {request.body}
                </pre>
              </div>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function HeaderTable({ headers }: { headers: Record<string, unknown>[] }) {
  if (!headers.length) {
    return <p className="text-xs text-muted-foreground">No headers.</p>;
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-xs">
        <tbody>
          {headers.map((header, index) => (
            <tr key={`${header.key}-${index}`} className="border-b last:border-0">
              <td className="w-1/3 px-2.5 py-1.5 align-top font-mono text-muted-foreground">
                {String(header.key)}
              </td>
              <td
                className={cn(
                  "px-2.5 py-1.5 font-mono break-all",
                  header.secret === true && "text-amber-400"
                )}
              >
                {String(header.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
