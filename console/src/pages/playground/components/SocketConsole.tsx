import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Loader2,
  Plug,
  PlugZap,
  SendHorizontal,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useControlSocket, socketUrl } from "../hooks/useControlSocket";
import type { DatabaseConnection, SocketMessage, Tab } from "../store/store";
import { useTabsStore } from "../store/store";
import { EnvironmentBadge, EmptyState } from "./primitives";

const NO_MESSAGES: SocketMessage[] = [];

const timestamp = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour12: false });

/** Connect to a websocket through the server, and watch the traffic. */
export function SocketConsole({
  tab,
  connection,
}: {
  tab: Tab;
  connection?: DatabaseConnection;
}) {
  const { updateTab, appendSocketMessage, clearSocketLog } = useTabsStore();
  // selecting `?? []` would hand back a new array every render, which
  // useSyncExternalStore treats as a changed snapshot and loops forever
  const stored = useTabsStore((state) => state.socketLogs[tab.id]);
  const messages = stored ?? NO_MESSAGES;

  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const log = (direction: SocketMessage["direction"], text: string) =>
    appendSocketMessage(tab.id, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      direction,
      text,
      at: Date.now(),
    });

  const socket = useControlSocket({
    onOpen: () => log("system", "Reached DataPilot, dialling upstream…"),
    onMessage: (data) => log("received", data),
    onControl: (frame) => {
      if (frame.status === "ready") {
        log("system", `Connected to ${frame.detail || "the upstream"}`);
      } else if (frame.status === "error") {
        log("system", frame.detail);
      }
    },
    onClose: (reason) => log("system", `Closed: ${reason}`),
  });
  const { state, failure } = socket;

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages.length]);

  const connect = () => {
    if (!tab.connectionId) return;
    log("system", `Connecting to ${tab.socketPath || "/"}…`);
    socket.open(
      socketUrl(`/connection/${tab.connectionId}/socket`, {
        path: tab.socketPath ?? "",
      })
    );
  };

  const disconnect = () => socket.close();

  const send = () => {
    if (state !== "open" || !draft.trim()) return;
    if (!socket.send(draft)) return;
    log("sent", draft);
    setDraft("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <span
          aria-label="Socket state"
          className={cn(
            "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
            state === "open"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : state === "connecting"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                : "border-border text-muted-foreground"
          )}
        >
          {state === "connecting" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : state === "open" ? (
            <PlugZap className="h-3 w-3" />
          ) : (
            <Plug className="h-3 w-3" />
          )}
          {state}
        </span>

        <input
          value={tab.socketPath ?? ""}
          onChange={(event) => updateTab(tab.id, { socketPath: event.target.value })}
          disabled={state !== "closed"}
          aria-label="Socket path"
          placeholder="/stream   (appended to the connection's base URL)"
          className="h-8 min-w-40 flex-1 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
        />

        {connection && (
          <EnvironmentBadge
            environment={connection.environment}
            role={connection.role}
          />
        )}

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 px-2 text-xs"
            onClick={() => clearSocketLog(tab.id)}
            disabled={!messages.length}
            title="Clear the log"
            aria-label="Clear log"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          {state === "closed" ? (
            <Button size="sm" className="h-8 px-3 text-xs" onClick={connect}>
              Connect
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-3 text-xs"
              onClick={disconnect}
            >
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {failure && (
        <div
          role="status"
          className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="font-medium text-destructive">Could not connect</p>
            <p className="mt-0.5 break-words text-destructive/80">{failure}</p>
          </div>
        </div>
      )}

      <div ref={logRef} className="min-h-0 flex-1 overflow-auto px-4 py-2">
        {messages.length === 0 ? (
          <EmptyState
            icon={Plug}
            title="Not connected"
            description="Connect to start watching frames in both directions."
          />
        ) : (
          <ul className="space-y-1" aria-label="Socket messages">
            {messages.map((message) => (
              <li
                key={message.id}
                data-direction={message.direction}
                className={cn(
                  "flex gap-2 rounded px-2 py-1 font-mono text-[11.5px]",
                  message.direction === "sent" && "bg-sky-500/10 text-sky-200",
                  message.direction === "received" && "bg-emerald-500/10 text-emerald-200",
                  message.direction === "system" && "text-muted-foreground"
                )}
              >
                <span className="shrink-0 opacity-60">{timestamp(message.at)}</span>
                <span className="shrink-0 opacity-60">
                  {message.direction === "sent"
                    ? "→"
                    : message.direction === "received"
                      ? "←"
                      : "•"}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                  {message.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-1.5 border-t px-4 py-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          disabled={state !== "open"}
          aria-label="Message to send"
          placeholder={
            state === "open" ? "Message, then Enter" : "Connect to send a message"
          }
          className="h-8 flex-1 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
        />
        <Button
          size="sm"
          className="h-8 gap-1.5 px-3 text-xs"
          onClick={send}
          disabled={state !== "open" || !draft.trim()}
        >
          <SendHorizontal className="h-3.5 w-3.5" />
          Send
        </Button>
      </div>
    </div>
  );
}
