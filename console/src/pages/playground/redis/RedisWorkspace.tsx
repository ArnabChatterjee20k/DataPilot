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
import { KeyTree } from "./KeyTree";
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

  // polled whichever panel is open, so the count answers "is anything talking
  // on this server" without having to go and look
  const live = useChannels(tab.connectionId);
  const channelCount = live.data?.channels?.length ?? 0;

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
              {item.value === "pubsub" && channelCount > 0 && (
                <span
                  title={`${channelCount} channel${channelCount === 1 ? "" : "s"} with a listener`}
                  className="rounded-full bg-emerald-500/15 px-1.5 text-[10px] tabular-nums text-emerald-400"
                >
                  {formatCount(channelCount)}
                </span>
              )}
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

/** The types a keyspace can hold, in the order they are worth scanning for. */
const TYPES = [
  { value: "string", label: "String" },
  { value: "hash", label: "Hash" },
  { value: "list", label: "List" },
  { value: "set", label: "Set" },
  { value: "zset", label: "Sorted set" },
  { value: "stream", label: "Stream" },
] as const;

function KeyBrowser({ connectionId }: { connectionId?: string }) {
  const [pattern, setPattern] = useState("*");
  const [draft, setDraft] = useState("*");
  const [selected, setSelected] = useState<string | null>(null);
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [grouped, setGrouped] = useState(true);

  const scan = useKeyScan(connectionId, pattern);
  const value = useKeyValue(connectionId, selected);
  const remove = useDeleteKey(connectionId);

  const all = scan.data?.keys ?? [];
  // filtering here rather than in the scan: SCAN's TYPE option would need a
  // round trip per change, and the page is already in hand
  const keys = types.size ? all.filter((key) => types.has(key.type)) : all;

  const counts = all.reduce<Record<string, number>>((totals, key) => {
    totals[key.type] = (totals[key.type] ?? 0) + 1;
    return totals;
  }, {});

  const toggleType = (type: string) =>
    setTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

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
            aria-label="Scan"
          >
            {scan.isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </form>

        <div
          className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5 empty:hidden"
          role="group"
          aria-label="Filter by type"
        >
          {TYPES.filter((type) => counts[type.value]).map((type) => (
            <button
              key={type.value}
              type="button"
              onClick={() => toggleType(type.value)}
              aria-pressed={types.has(type.value)}
              aria-label={`${type.label}, ${counts[type.value]} keys`}
              className={cn(
                "rounded-full border px-1.5 py-0.5 text-[10px] transition-colors",
                types.has(type.value)
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {type.label}
              <span className="ml-1 text-muted-foreground/70">
                {counts[type.value]}
              </span>
            </button>
          ))}
        </div>

        {scan.error && (
          <p className="p-3 text-xs text-destructive">
            {errorMessage(scan.error, "Could not read the keyspace")}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-auto py-1">
          <KeyTree
            keys={keys}
            selected={selected}
            grouped={grouped}
            onSelect={setSelected}
          />

          {!scan.isLoading && keys.length === 0 && !scan.error && (
            <p className="p-3 text-xs text-muted-foreground">
              {/* an empty page with a cursor still to follow is not "no keys" */}
              {types.size && all.length
                ? "No key of that type on this page."
                : scan.data?.complete
                  ? `Nothing matches ${pattern}.`
                  : "Still scanning…"}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t px-2 py-1.5 text-[10px] text-muted-foreground">
          <button
            type="button"
            onClick={() => setGrouped((current) => !current)}
            aria-pressed={grouped}
            title="Redis has no folders, but almost every keyspace is named as though it does"
            className="rounded border px-1.5 py-0.5 hover:text-foreground"
          >
            {grouped ? "Grouped" : "Flat"}
          </button>
          <span className="ml-auto">
            {formatCount(keys.length)} key{keys.length === 1 ? "" : "s"}
            {types.size > 0 && ` of ${formatCount(all.length)}`}
          </span>
          {scan.data && !scan.data.complete && (
            <span title="SCAN is cursored, so this is one page of the keyspace">
              more to scan
            </span>
          )}
        </div>
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

/** A channel list is comma or space separated, and either is worth accepting. */
function splitList(text: string): string[] {
  return text
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function PubSub({ connectionId }: { connectionId?: string }) {
  const [channels, setChannels] = useState("");
  const [patterns, setPatterns] = useState("");
  const [message, setMessage] = useState("");
  const [publishTo, setPublishTo] = useState("");
  const [query, setQuery] = useState("");

  const live = useChannels(connectionId);
  const subscription = useSubscription(connectionId);
  const send = usePublish(connectionId);

  const active = live.data?.channels ?? [];
  const patternCount = live.data?.pattern_subscriptions ?? 0;

  // what this tab asked for, against what the server confirmed: the second is
  // the one that decides whether a channel counts one of its listeners as us
  const wanted = new Set(splitList(channels));
  const confirmed = new Set(subscription.subscribed);

  const seen = subscription.messages.reduce<Record<string, number>>(
    (totals, item) => {
      totals[item.channel] = (totals[item.channel] ?? 0) + 1;
      return totals;
    },
    {}
  );

  const needle = query.trim().toLowerCase();
  const rows = active
    .map((item) => {
      const name = String(item.channel);
      const subscribers = Number(item.subscribers) || 0;
      const isMine = confirmed.has(name);
      return {
        name,
        subscribers,
        isMine,
        // PUBSUB NUMSUB counts this tab too, so the interesting number is what
        // is left after taking ourselves out: that is the other applications
        others: Math.max(subscribers - (isMine ? 1 : 0), 0),
        messages: seen[name] ?? 0,
      };
    })
    .filter((item) => !needle || item.name.toLowerCase().includes(needle))
    .sort((a, b) => b.others - a.others || a.name.localeCompare(b.name));

  /** Add or drop a channel, and resubscribe so the change takes effect now. */
  const toggleChannel = (name: string) => {
    const next = new Set(wanted);
    if (next.has(name)) next.delete(name);
    else next.add(name);

    const text = [...next].join(", ");
    setChannels(text);
    setPublishTo((current) => current || name);

    // a click on a channel means "listen to this", so it has to take effect
    // without a second trip to the Subscribe button
    if (subscription.state !== "closed") subscription.stop();
    if (next.size || patterns.trim()) subscription.start(text, patterns);
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-72 shrink-0 flex-col border-r">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <p className="text-xs font-medium">Channels on this server</p>
          <span
            className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground"
            title="Polled from PUBSUB CHANNELS every few seconds"
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                active.length ? "bg-emerald-400" : "bg-muted-foreground/40"
              )}
            />
            {formatCount(active.length)}
          </span>
        </div>

        {active.length > 8 && (
          <div className="border-b px-3 py-1.5">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Filter channels"
              placeholder="Filter channels"
              className="h-6 w-full bg-transparent font-mono text-[11px] outline-none"
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto" aria-label="Active channels">
          {rows.length === 0 ? (
            <p className="p-3 text-[11px] leading-relaxed text-muted-foreground">
              {/* a channel exists only while something is listening to it */}
              {active.length
                ? `No channel matches ${query}.`
                : "Nothing is subscribed to any channel right now. Redis keeps no list of channel names, so a channel shows up here only while an application is listening to it."}
            </p>
          ) : (
            rows.map((item) => (
              <button
                key={item.name}
                type="button"
                onClick={() => toggleChannel(item.name)}
                aria-pressed={item.isMine}
                aria-label={`Listen to ${item.name}`}
                title={
                  item.isMine
                    ? `You are listening to ${item.name}. Click to stop.`
                    : `Click to listen to ${item.name}`
                }
                className={cn(
                  "flex w-full items-center gap-2 border-l-2 px-3 py-1.5 text-left text-xs hover:bg-muted/60",
                  item.isMine
                    ? "border-l-emerald-400 bg-emerald-500/5"
                    : "border-l-transparent"
                )}
              >
                <span className="min-w-0 flex-1 truncate font-mono">
                  {item.name}
                </span>

                {item.messages > 0 && (
                  <span
                    className="shrink-0 text-[10px] tabular-nums text-sky-400"
                    title={`${item.messages} received in this tab`}
                  >
                    {formatCount(item.messages)}
                  </span>
                )}

                <span
                  className="shrink-0 text-[10px] text-muted-foreground"
                  title={
                    item.isMine
                      ? `This tab, and ${item.others} other subscriber${item.others === 1 ? "" : "s"}`
                      : `${item.others} subscriber${item.others === 1 ? "" : "s"}, none of them this tab`
                  }
                >
                  {item.isMine && <span className="text-emerald-400">you</span>}
                  {item.isMine && item.others > 0 && " + "}
                  {(!item.isMine || item.others > 0) &&
                    `${item.others} app${item.others === 1 ? "" : "s"}`}
                </span>
              </button>
            ))
          )}
        </div>

        <p className="border-t px-3 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
          Click a channel to listen to it.
          {patternCount > 0 && (
            <>
              {" "}
              {patternCount === 1
                ? "One pattern subscription is"
                : `${patternCount} pattern subscriptions are`}{" "}
              also open, which Redis counts but cannot name.
            </>
          )}
        </p>
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
                  : active.length
                    ? "Click one of the channels on the left, or name one here."
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
            {send.data.received_by === 0 && ". Nobody is listening to that channel."}
          </p>
        )}
      </div>
    </div>
  );
}
