import { useState } from "react";
import {
  AlertCircle,
  Database,
  Gauge,
  Loader2,
  Radio,
  RefreshCw,
  SendHorizontal,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import { formatCount } from "@/lib/format";
import type { DatabaseConnection, Tab } from "../store/store";
import { EmptyState, EnvironmentBadge } from "../components/primitives";
import { RedisKeyValue } from "./RedisKeyValue";
import {
  useChannels,
  useDeleteKey,
  useKeyScan,
  useKeyValue,
  usePublish,
  useRedisInfo,
  useSubscription,
} from "./useRedis";

type Panel = "keys" | "dashboard" | "pubsub";

const PANELS: { value: Panel; label: string; icon: typeof Database }[] = [
  { value: "keys", label: "Keys", icon: Database },
  { value: "dashboard", label: "Dashboard", icon: Gauge },
  { value: "pubsub", label: "Pub/Sub", icon: Radio },
];

export function RedisWorkspace({
  tab,
  connection,
}: {
  tab: Tab;
  connection?: DatabaseConnection;
}) {
  const [panel, setPanel] = useState<Panel>("keys");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <span className="text-xs font-medium">{connection?.name}</span>
        {connection && (
          <EnvironmentBadge
            environment={connection.environment}
            role={connection.role}
          />
        )}

        <div className="ml-auto flex items-center rounded-md border p-0.5">
          {PANELS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setPanel(item.value)}
              aria-pressed={panel === item.value}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors",
                panel === item.value
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {panel === "keys" && <KeyBrowser connectionId={tab.connectionId} />}
      {panel === "dashboard" && <Dashboard connectionId={tab.connectionId} />}
      {panel === "pubsub" && <PubSub connectionId={tab.connectionId} />}
    </div>
  );
}

function KeyBrowser({ connectionId }: { connectionId?: string }) {
  const [pattern, setPattern] = useState("*");
  const [draft, setDraft] = useState("*");
  const [selected, setSelected] = useState<string | null>(null);

  const scan = useKeyScan(connectionId, pattern);
  const value = useKeyValue(connectionId, selected);
  const remove = useDeleteKey(connectionId);

  const keys = scan.data?.keys ?? [];

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-72 shrink-0 flex-col border-r">
        <form
          className="flex items-center gap-1.5 border-b p-2"
          onSubmit={(event) => {
            event.preventDefault();
            setPattern(draft.trim() || "*");
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Key pattern"
            placeholder="user:*"
            className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2 text-xs"
            type="submit"
            disabled={scan.isFetching}
          >
            {scan.isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </form>

        {scan.error && (
          <p className="p-3 text-xs text-destructive">
            {errorMessage(scan.error, "Could not read the keyspace")}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-auto" role="list" aria-label="Keys">
          {keys.map((item) => (
            <button
              key={item.key}
              type="button"
              role="listitem"
              onClick={() => setSelected(item.key)}
              aria-pressed={selected === item.key}
              className={cn(
                "flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs hover:bg-muted/60",
                selected === item.key && "bg-muted"
              )}
            >
              <span className="min-w-0 flex-1 truncate font-mono">{item.key}</span>
              <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                {item.label}
              </span>
              {item.size != null && (
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                  {formatCount(item.size)}
                </span>
              )}
            </button>
          ))}

          {!scan.isLoading && keys.length === 0 && !scan.error && (
            <p className="p-3 text-xs text-muted-foreground">
              {/* an empty page with a cursor still to follow is not "no keys" */}
              {scan.data?.complete
                ? `Nothing matches ${pattern}.`
                : "Still scanning…"}
            </p>
          )}
        </div>

        {scan.data && !scan.data.complete && (
          <p className="border-t px-2 py-1.5 text-[10px] text-muted-foreground">
            More to scan. Narrow the pattern to find a key faster.
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {selected && (
          <div className="flex items-center justify-end border-b px-4 py-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => {
                remove.mutate(selected);
                setSelected(null);
              }}
              disabled={remove.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete key
            </Button>
          </div>
        )}
        <div className="min-h-0 flex-1">
          <RedisKeyValue
            value={value.data}
            isLoading={value.isLoading}
            error={value.error}
          />
        </div>
      </div>
    </div>
  );
}

function Dashboard({ connectionId }: { connectionId?: string }) {
  const info = useRedisInfo(connectionId);

  if (info.isLoading) {
    return (
      <p className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Asking the server about itself…
      </p>
    );
  }
  if (info.error) {
    return (
      <p className="p-4 text-xs text-destructive">
        {errorMessage(info.error, "Could not read the server's numbers")}
      </p>
    );
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
      {info.data?.hit_rate != null && (
        <div className="rounded-lg border p-3">
          <p className="text-[11px] text-muted-foreground">Keyspace hit rate</p>
          <p
            className={cn(
              "mt-1 text-2xl tabular-nums",
              info.data.hit_rate >= 80
                ? "text-emerald-400"
                : info.data.hit_rate >= 50
                  ? "text-amber-400"
                  : "text-destructive"
            )}
          >
            {info.data.hit_rate}%
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            How often a lookup found what it wanted. A cache that misses more
            than it hits is costing more than it saves.
          </p>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-medium">Server</p>
        <dl
          className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3"
          aria-label="Server statistics"
        >
          {(info.data?.fields ?? []).map((field) => (
            <div key={String(field.name)} className="border-b py-1.5">
              <dt className="text-[11px] text-muted-foreground">
                {String(field.label)}
              </dt>
              <dd className="truncate font-mono" title={String(field.value)}>
                {String(field.value) || "—"}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium">Keyspace</p>
        {(info.data?.keyspace ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Every database is empty.
          </p>
        ) : (
          <table className="w-full border-collapse text-xs" aria-label="Keyspace">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5 font-medium">Database</th>
                <th className="py-1.5 text-right font-medium">Keys</th>
                <th className="py-1.5 text-right font-medium">With an expiry</th>
              </tr>
            </thead>
            <tbody>
              {(info.data?.keyspace ?? []).map((row) => (
                <tr key={String(row.db)} className="border-b">
                  <td className="py-1.5 font-mono">db{String(row.db)}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatCount(Number(row.keys))}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                    {formatCount(Number(row.expires))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function PubSub({ connectionId }: { connectionId?: string }) {
  const [channels, setChannels] = useState("");
  const [patterns, setPatterns] = useState("");
  const [message, setMessage] = useState("");
  const [publishTo, setPublishTo] = useState("");

  const live = useChannels(connectionId);
  const subscription = useSubscription(connectionId);
  const send = usePublish(connectionId);

  const active = live.data?.channels ?? [];

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-64 shrink-0 flex-col border-r">
        <p className="border-b px-3 py-2 text-xs font-medium">Listening now</p>
        <div className="min-h-0 flex-1 overflow-auto" aria-label="Active channels">
          {active.length === 0 ? (
            <p className="p-3 text-[11px] text-muted-foreground">
              {/* a channel exists only while something is listening to it */}
              Nothing is subscribed to any channel. Redis keeps no list of
              channel names, so a channel appears here only while someone is
              listening.
            </p>
          ) : (
            active.map((item) => (
              <button
                key={String(item.channel)}
                type="button"
                onClick={() => {
                  setChannels(String(item.channel));
                  setPublishTo(String(item.channel));
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/60"
              >
                <span className="min-w-0 flex-1 truncate font-mono">
                  {String(item.channel)}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {String(item.subscribers)}
                </span>
              </button>
            ))
          )}
        </div>
        {(live.data?.pattern_subscriptions ?? 0) > 0 && (
          <p className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
            {live.data?.pattern_subscriptions} pattern subscription
            {live.data?.pattern_subscriptions === 1 ? "" : "s"}, which the list
            above cannot show by name.
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
          <input
            value={channels}
            onChange={(event) => setChannels(event.target.value)}
            disabled={subscription.state !== "closed"}
            aria-label="Channels to subscribe to"
            placeholder="updates, alerts"
            className="h-8 min-w-32 flex-1 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />
          <input
            value={patterns}
            onChange={(event) => setPatterns(event.target.value)}
            disabled={subscription.state !== "closed"}
            aria-label="Patterns to subscribe to"
            placeholder="events:*"
            className="h-8 min-w-28 flex-1 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />

          {subscription.state === "closed" ? (
            <Button
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => subscription.start(channels, patterns)}
              disabled={!channels.trim() && !patterns.trim()}
            >
              Subscribe
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-3 text-xs"
              onClick={subscription.stop}
            >
              {subscription.state === "connecting" ? "Subscribing…" : "Unsubscribe"}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 px-2 text-xs"
            onClick={subscription.clear}
            disabled={!subscription.messages.length}
            aria-label="Clear messages"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        {subscription.failure && (
          <div
            role="alert"
            className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <p className="min-w-0 break-words text-destructive/80">
              {subscription.failure}
            </p>
          </div>
        )}

        {subscription.subscribed.length > 0 && (
          <p
            role="status"
            className="border-b bg-emerald-500/10 px-4 py-1.5 text-[11px] text-emerald-400"
          >
            {/* the server confirmed it; pub/sub has no replay, so this matters */}
            Subscribed to {subscription.subscribed.join(", ")}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          {subscription.messages.length === 0 ? (
            <EmptyState
              icon={Radio}
              title={
                subscription.state === "open"
                  ? "Nothing has arrived yet"
                  : "Not subscribed"
              }
              description={
                subscription.state === "open"
                  ? "Messages appear here as they are published."
                  : "Name a channel or a pattern, then press Subscribe."
              }
            />
          ) : (
            <ul className="divide-y font-mono text-xs" aria-label="Messages">
              {subscription.messages.map((item) => (
                <li key={item.id} className="flex gap-2 px-4 py-1.5">
                  <span className="shrink-0 text-muted-foreground/70">
                    {new Date(item.at).toLocaleTimeString(undefined, {
                      hour12: false,
                    })}
                  </span>
                  <span className="shrink-0 text-sky-400">{item.channel}</span>
                  {item.pattern && (
                    <span className="shrink-0 text-muted-foreground/70">
                      {item.pattern}
                    </span>
                  )}
                  <span className="min-w-0 whitespace-pre-wrap break-words">
                    {item.payload}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-1.5 border-t px-4 py-2">
          <input
            value={publishTo}
            onChange={(event) => setPublishTo(event.target.value)}
            aria-label="Channel to publish to"
            placeholder="channel"
            className="h-8 w-40 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && publishTo.trim()) {
                send.mutate({ channel: publishTo, message });
                setMessage("");
              }
            }}
            aria-label="Message to publish"
            placeholder="Message, then Enter"
            className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          <Button
            size="sm"
            className="h-8 gap-1.5 px-3 text-xs"
            disabled={!publishTo.trim() || send.isPending}
            onClick={() => {
              send.mutate({ channel: publishTo, message });
              setMessage("");
            }}
          >
            <SendHorizontal className="h-3.5 w-3.5" />
            Publish
          </Button>
        </div>

        {send.data && (
          <p
            role="status"
            className="border-t px-4 py-1 text-[11px] text-muted-foreground"
          >
            {/* zero is the useful answer: it means nobody was listening */}
            Delivered to {send.data.received_by} subscriber
            {send.data.received_by === 1 ? "" : "s"}
            {send.data.received_by === 0 && " — nobody is listening to that channel"}
          </p>
        )}
      </div>
    </div>
  );
}
