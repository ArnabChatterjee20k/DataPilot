import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Loader2,
  Plug,
  PlugZap,
  Radio,
  SendHorizontal,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { client } from "@/lib/sdk/client.gen";
import type {
  DatabaseConnection,
  SocketMessage,
  Subscription,
  Tab,
} from "../store/store";
import { useTabsStore } from "../store/store";
import { EnvironmentBadge, EmptyState } from "./primitives";

type State = "closed" | "connecting" | "open";

const NO_MESSAGES: SocketMessage[] = [];
const NO_SUBSCRIPTIONS: Subscription[] = [];

const CONTROL_KEY = "__datapilot";

/** The proxy's own frames, about the broker rather than from it. */
type ControlStatus =
  | "ready"
  | "error"
  | "subscribed"
  | "unsubscribed"
  | "published";

interface ControlFrame {
  status: ControlStatus;
  detail: string;
}

interface BrokerMessage {
  topic: string;
  payload: string;
  is_text: boolean;
  qos: number;
  retain: boolean;
}

function readControlFrame(data: string): ControlFrame | null {
  if (!data.includes(CONTROL_KEY)) return null;
  try {
    const parsed = JSON.parse(data);
    const status = parsed?.[CONTROL_KEY];
    if (typeof status !== "string") return null;
    return { status: status as ControlStatus, detail: String(parsed.detail ?? "") };
  } catch {
    return null;
  }
}

function brokerUrl(connectionId: string): string {
  const base = client.getConfig().baseUrl ?? "";
  const origin = base.startsWith("http") ? base : window.location.origin;
  const url = new URL(`/connection/${connectionId}/mqtt`, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

const timestamp = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour12: false });

/**
 * Subscribe, publish and watch, against a broker the server holds.
 *
 * The browser cannot speak MQTT, so the session lives on the server and this
 * drives it. Nothing is reported as done until the broker has acknowledged it:
 * a publish issued straight after an unacknowledged subscribe is dropped by
 * the broker with no error anywhere, which is a miserable thing to debug.
 */
export function MqttConsole({
  tab,
  connection,
}: {
  tab: Tab;
  connection?: DatabaseConnection;
}) {
  const { updateTab, appendSocketMessage, clearSocketLog } = useTabsStore();
  const stored = useTabsStore((state) => state.socketLogs[tab.id]);
  const messages = stored ?? NO_MESSAGES;
  const subscriptions = tab.subscriptions ?? NO_SUBSCRIPTIONS;

  const [state, setState] = useState<State>("closed");
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [payload, setPayload] = useState("");
  const opened = useRef(false);
  const socketRef = useRef<WebSocket | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const topic = tab.mqttTopic ?? "";
  const qos = tab.mqttQos ?? 0;
  const retain = tab.mqttRetain ?? false;

  const log = (direction: SocketMessage["direction"], text: string) =>
    appendSocketMessage(tab.id, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      direction,
      text,
      at: Date.now(),
    });

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages.length]);

  useEffect(
    () => () => {
      socketRef.current?.close();
      socketRef.current = null;
    },
    []
  );

  const handleControl = (control: ControlFrame) => {
    if (control.status === "ready") {
      opened.current = true;
      setState("open");
      setFailure(null);
      log("system", `Connected to ${control.detail || "the broker"}`);
      return;
    }
    if (control.status === "error") {
      // a refused command does not cost the session, so this is a notice
      // rather than the banner a failed connection gets
      if (opened.current) setNotice(control.detail);
      else setFailure(control.detail);
      log("system", control.detail);
      return;
    }

    const body = safeParse(control.detail);
    if (control.status === "subscribed" && body?.topic) {
      updateTab(tab.id, {
        subscriptions: [
          ...(tab.subscriptions ?? []).filter((item) => item.topic !== body.topic),
          { topic: String(body.topic), qos: Number(body.qos ?? 0) },
        ],
      });
      log("system", `Subscribed to ${body.topic} (QoS ${body.qos ?? 0})`);
      return;
    }
    if (control.status === "unsubscribed" && body?.topic) {
      updateTab(tab.id, {
        subscriptions: (tab.subscriptions ?? []).filter(
          (item) => item.topic !== body.topic
        ),
      });
      log("system", `Unsubscribed from ${body.topic}`);
      return;
    }
    if (control.status === "published" && body?.topic) {
      log(
        "sent",
        `${body.topic}${body.retain ? " (retained)" : ""} · QoS ${body.qos ?? 0}`
      );
    }
  };

  const connect = () => {
    if (!tab.connectionId || socketRef.current) return;

    setState("connecting");
    setFailure(null);
    setNotice(null);
    opened.current = false;
    log("system", "Connecting to the broker…");

    const socket = new WebSocket(brokerUrl(tab.connectionId));
    socketRef.current = socket;

    socket.onopen = () => log("system", "Reached DataPilot, dialling the broker…");

    socket.onmessage = (event) => {
      const data = String(event.data);
      const control = readControlFrame(data);
      if (control) {
        handleControl(control);
        return;
      }

      const message = safeParse(data) as BrokerMessage | null;
      if (!message?.topic) {
        log("received", data);
        return;
      }
      log(
        "received",
        `${message.topic}${message.retain ? " (retained)" : ""} · QoS ${
          message.qos
        }\n${message.is_text ? message.payload : "(binary, base64) " + message.payload}`
      );
    };

    socket.onclose = (event) => {
      setState("closed");
      socketRef.current = null;
      updateTab(tab.id, { subscriptions: [] });

      const reason = event.reason || "the session ended";
      log("system", `Disconnected: ${reason}`);
      if (!opened.current) setFailure((current) => current ?? reason);
    };
  };

  const disconnect = () => {
    socketRef.current?.close();
    socketRef.current = null;
    setState("closed");
    setFailure(null);
    setNotice(null);
    updateTab(tab.id, { subscriptions: [] });
  };

  const command = (body: Record<string, unknown>) => {
    if (state !== "open" || socketRef.current?.readyState !== WebSocket.OPEN) return;
    setNotice(null);
    socketRef.current.send(JSON.stringify(body));
  };

  const canAct = state === "open" && !!topic.trim();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <span
          aria-label="Broker state"
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

        {connection && (
          <span className="font-mono text-[11px] text-muted-foreground">
            {connection.baseUrl}
          </span>
        )}

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

      <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
        <input
          value={topic}
          onChange={(event) => updateTab(tab.id, { mqttTopic: event.target.value })}
          disabled={state !== "open"}
          aria-label="Topic"
          placeholder="sensors/+/temperature"
          className="h-8 min-w-48 flex-1 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
        />

        <Select
          value={String(qos)}
          onValueChange={(value) => updateTab(tab.id, { mqttQos: Number(value) })}
          disabled={state !== "open"}
        >
          <SelectTrigger className="h-8 w-24 text-xs" aria-label="QoS">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">QoS 0</SelectItem>
            <SelectItem value="1">QoS 1</SelectItem>
            <SelectItem value="2">QoS 2</SelectItem>
          </SelectContent>
        </Select>

        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 px-2 text-xs"
          disabled={!canAct}
          onClick={() => command({ action: "subscribe", topic, qos })}
          title="Subscribe, and wait for the broker to acknowledge it"
        >
          <Radio className="h-3.5 w-3.5" />
          Subscribe
        </Button>
      </div>

      {failure && (
        <Banner tone="error" title="Could not connect" detail={failure} />
      )}
      {notice && (
        <Banner
          tone="warning"
          title="The broker refused that"
          detail={notice}
          onDismiss={() => setNotice(null)}
        />
      )}

      {subscriptions.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5 border-b px-4 py-1.5"
          role="group"
          aria-label="Subscriptions"
        >
          <span className="text-[11px] text-muted-foreground">Subscribed:</span>
          {subscriptions.map((item) => (
            <span
              key={item.topic}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-400"
            >
              {item.topic}
              <span className="text-emerald-400/60">Q{item.qos}</span>
              <button
                type="button"
                onClick={() => command({ action: "unsubscribe", topic: item.topic })}
                aria-label={`Unsubscribe from ${item.topic}`}
                className="rounded hover:text-emerald-200"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div ref={logRef} className="min-h-0 flex-1 overflow-auto px-4 py-2">
        {messages.length === 0 ? (
          <EmptyState
            icon={Radio}
            title={state === "open" ? "Nothing has arrived yet" : "Not connected"}
            description={
              state === "open"
                ? "Subscribe to a topic filter - wildcards are + for one level and # for the rest."
                : "Press Connect to open a session with the broker."
            }
          />
        ) : (
          <ul className="space-y-0.5 font-mono text-xs">
            {messages.map((message) => (
              <li
                key={message.id}
                className={cn(
                  "flex gap-2 rounded px-2 py-1",
                  message.direction === "sent" && "bg-sky-500/10 text-sky-300",
                  message.direction === "received" && "bg-emerald-500/10 text-emerald-300",
                  message.direction === "system" && "text-muted-foreground"
                )}
              >
                <span className="shrink-0 text-muted-foreground/70">
                  {timestamp(message.at)}
                </span>
                <span className="shrink-0">
                  {message.direction === "sent"
                    ? "↑"
                    : message.direction === "received"
                      ? "↓"
                      : "•"}
                </span>
                <span className="min-w-0 whitespace-pre-wrap break-words">
                  {message.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-1.5 border-t px-4 py-2">
        <input
          value={payload}
          onChange={(event) => setPayload(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && canAct) {
              command({ action: "publish", topic, payload, qos, retain });
              setPayload("");
            }
          }}
          disabled={state !== "open"}
          aria-label="Payload to publish"
          placeholder="Payload, then Enter to publish to the topic above"
          className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
        />

        <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <Checkbox
            checked={retain}
            onCheckedChange={(checked) =>
              updateTab(tab.id, { mqttRetain: checked === true })
            }
            disabled={state !== "open"}
            aria-label="Retain"
          />
          Retain
        </label>

        <Button
          size="sm"
          className="h-8 gap-1.5 px-3 text-xs"
          disabled={!canAct}
          onClick={() => {
            command({ action: "publish", topic, payload, qos, retain });
            setPayload("");
          }}
          title={
            state !== "open"
              ? "Connect first"
              : !topic.trim()
                ? "Enter a topic above"
                : "Publish"
          }
        >
          <SendHorizontal className="h-3.5 w-3.5" />
          Publish
        </Button>
      </div>
    </div>
  );
}

function Banner({
  tone,
  title,
  detail,
  onDismiss,
}: {
  tone: "error" | "warning";
  title: string;
  detail: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 border-b px-4 py-2 text-xs",
        tone === "error"
          ? "border-destructive/30 bg-destructive/10"
          : "border-amber-500/30 bg-amber-500/10"
      )}
    >
      <AlertCircle
        className={cn(
          "mt-0.5 h-3.5 w-3.5 shrink-0",
          tone === "error" ? "text-destructive" : "text-amber-400"
        )}
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "font-medium",
            tone === "error" ? "text-destructive" : "text-amber-400"
          )}
        >
          {title}
        </p>
        <p
          className={cn(
            "mt-0.5 break-words",
            tone === "error" ? "text-destructive/80" : "text-amber-300/80"
          )}
        >
          {detail}
        </p>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function safeParse(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
