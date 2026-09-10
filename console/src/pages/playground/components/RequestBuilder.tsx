import { useMemo } from "react";
import { Loader2, Save, SendHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { DatabaseConnection, RequestDraft, Tab } from "../store/store";
import { useTabsStore, type BodyType, type HttpMethod } from "../store/store";
import { KeyValueEditor } from "./KeyValueEditor";
import { EnvironmentBadge } from "./primitives";

const METHODS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

const METHOD_CLASS: Record<string, string> = {
  GET: "text-emerald-400",
  POST: "text-sky-400",
  PUT: "text-amber-400",
  PATCH: "text-amber-400",
  DELETE: "text-rose-400",
  HEAD: "text-muted-foreground",
  OPTIONS: "text-muted-foreground",
};

const BODY_TYPES: { value: BodyType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "json", label: "JSON" },
  { value: "form", label: "Form" },
  { value: "text", label: "Text" },
];

function countActive(rows: { key: string; enabled?: boolean }[]): number {
  return rows.filter((row) => row.key.trim() && row.enabled !== false).length;
}

export function RequestBuilder({
  tab,
  connection,
  isSending,
  isSaving,
  onSend,
  onSave,
}: {
  tab: Tab;
  connection?: DatabaseConnection;
  isSending: boolean;
  isSaving: boolean;
  onSend: () => void;
  onSave: () => void;
}) {
  const updateRequest = useTabsStore((state) => state.updateRequest);
  const request = tab.request;

  const jsonError = useMemo(() => {
    if (!request || request.body_type !== "json" || !request.body.trim()) return null;
    try {
      JSON.parse(request.body);
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  }, [request?.body, request?.body_type]);

  if (!request) return null;

  const patch = (values: Partial<RequestDraft>) => updateRequest(tab.id, values);
  const busy = isSending || isSaving;

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <input
          value={request.name}
          onChange={(event) => patch({ name: event.target.value })}
          aria-label="Request name"
          placeholder="Untitled request"
          className="h-8 min-w-32 max-w-56 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
        />

        {connection && (
          <EnvironmentBadge
            environment={connection.environment}
            role={connection.role}
          />
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 px-2 text-xs"
            onClick={onSave}
            disabled={busy}
            title={tab.requestId ? "Save changes" : "Save this request"}
          >
            <Save className="h-3.5 w-3.5" />
            <span className="hidden md:inline">{tab.requestId ? "Save" : "Save as"}</span>
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 px-3 text-xs"
            onClick={onSend}
            disabled={busy || !tab.connectionId}
            title="Send (Ctrl/Cmd + Enter)"
          >
            {isSending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <SendHorizontal className="h-3.5 w-3.5" />
            )}
            {isSending ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 border-b px-4 py-2">
        <Select
          value={request.method}
          onValueChange={(method) => patch({ method: method as HttpMethod })}
        >
          <SelectTrigger
            className={cn("h-8 w-28 font-mono text-xs", METHOD_CLASS[request.method])}
            aria-label="Method"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METHODS.map((method) => (
              <SelectItem key={method} value={method}>
                <span className={cn("font-mono", METHOD_CLASS[method])}>{method}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <input
          value={request.path}
          onChange={(event) => patch({ path: event.target.value })}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") onSend();
          }}
          aria-label="Request path"
          placeholder="/users?page=1   or an absolute URL,  {{variables}} allowed"
          className="h-8 flex-1 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <Tabs defaultValue="params" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-4 mt-2 w-fit" aria-label="Request sections">
          <TabsTrigger value="params" className="text-xs">
            Params
            {countActive(request.params) > 0 && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                {countActive(request.params)}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="headers" className="text-xs">
            Headers
            {countActive(request.headers) > 0 && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                {countActive(request.headers)}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="body" className="text-xs">
            Body
            {request.body_type !== "none" && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                {request.body_type}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="auth" className="text-xs">
            Auth
            {request.auth.type !== "none" && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                {request.auth.type}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-auto px-4 pb-3 pt-2">
          <TabsContent value="params" className="mt-0">
            <KeyValueEditor
              label="Query parameter"
              rows={request.params}
              onChange={(params) => patch({ params })}
              keyPlaceholder="name"
              valuePlaceholder="value"
              disabled={busy}
            />
          </TabsContent>

          <TabsContent value="headers" className="mt-0">
            <KeyValueEditor
              label="Header"
              rows={request.headers}
              onChange={(headers) => patch({ headers })}
              keyPlaceholder="Header"
              valuePlaceholder="value"
              disabled={busy}
            />
          </TabsContent>

          <TabsContent value="body" className="mt-0 space-y-2">
            <div className="flex items-center gap-1">
              {BODY_TYPES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => patch({ body_type: option.value })}
                  aria-pressed={request.body_type === option.value}
                  className={cn(
                    "rounded px-2 py-1 text-xs transition-colors",
                    request.body_type === option.value
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {request.body_type === "none" ? (
              <p className="text-xs text-muted-foreground">
                This request sends no body.
              </p>
            ) : request.body_type === "form" ? (
              <KeyValueEditor
                label="Form field"
                rows={parseFormRows(request.body)}
                onChange={(rows) => patch({ body: JSON.stringify(rows) })}
                keyPlaceholder="field"
                valuePlaceholder="value"
                disabled={busy}
              />
            ) : (
              <>
                <textarea
                  value={request.body}
                  onChange={(event) => patch({ body: event.target.value })}
                  aria-label="Request body"
                  spellCheck={false}
                  placeholder={
                    request.body_type === "json" ? '{\n  "name": "Ada"\n}' : "raw body"
                  }
                  className={cn(
                    "h-48 w-full resize-y rounded-md border bg-background p-2.5",
                    "font-mono text-xs leading-5 outline-none focus:ring-1 focus:ring-ring",
                    jsonError && "border-destructive/60"
                  )}
                />
                {jsonError && (
                  <p className="text-[11px] text-destructive">
                    Not valid JSON: {jsonError}
                  </p>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="auth" className="mt-0 space-y-2">
            <Select
              value={request.auth.type ?? "none"}
              onValueChange={(type) =>
                patch({ auth: { ...request.auth, type: type as never } })
              }
            >
              <SelectTrigger className="h-8 w-44 text-xs" aria-label="Auth type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No auth</SelectItem>
                <SelectItem value="bearer">Bearer token</SelectItem>
                <SelectItem value="basic">Basic</SelectItem>
                <SelectItem value="header">Custom header</SelectItem>
              </SelectContent>
            </Select>

            {request.auth.type === "bearer" && (
              <AuthField
                label="Token"
                value={request.auth.token ?? ""}
                onChange={(token) => patch({ auth: { ...request.auth, token } })}
              />
            )}

            {request.auth.type === "basic" && (
              <>
                <AuthField
                  label="Username"
                  value={request.auth.username ?? ""}
                  onChange={(username) => patch({ auth: { ...request.auth, username } })}
                />
                <AuthField
                  label="Password"
                  value={request.auth.password ?? ""}
                  onChange={(password) => patch({ auth: { ...request.auth, password } })}
                />
              </>
            )}

            {request.auth.type === "header" && (
              <>
                <AuthField
                  label="Header name"
                  value={request.auth.name ?? ""}
                  onChange={(name) => patch({ auth: { ...request.auth, name } })}
                />
                <AuthField
                  label="Header value"
                  value={request.auth.value ?? ""}
                  onChange={(value) => patch({ auth: { ...request.auth, value } })}
                />
              </>
            )}

            <p className="text-[11px] text-muted-foreground">
              Credentials are sent from the server and shown masked in the request
              preview. `&#123;&#123;variables&#125;&#125;` work here too.
            </p>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function AuthField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="h-8 w-full max-w-md rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
      />
    </label>
  );
}

/** Form bodies are stored as JSON rows so they survive a round trip. */
function parseFormRows(body: string) {
  try {
    const parsed = JSON.parse(body || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
