import { useMemo, useState } from "react";
import { Database, Loader2, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import { formatCount } from "@/lib/format";
import type { RedisKeyValueModel } from "@/lib/sdk";
import { CopyButton, EmptyState } from "../components/primitives";
import { JsonView, parseJson } from "./JsonValue";

/** `-1` means no expiry, which is a different thing from expired. */
function ttlLabel(ttl?: number | null): string {
  if (ttl == null || ttl < 0) return "no expiry";
  if (ttl < 60) return `${ttl}s left`;
  if (ttl < 3600) return `${Math.round(ttl / 60)}m left`;
  if (ttl < 86400) return `${Math.round(ttl / 3600)}h left`;
  return `${Math.round(ttl / 86400)}d left`;
}

/**
 * One key, shown as whatever it is.
 *
 * A hash rendered as a string is unreadable, and a sorted set without its
 * scores is not a sorted set, so each type gets its own table.
 */
export function RedisKeyValue({
  value,
  isLoading,
  error,
}: {
  value?: RedisKeyValueModel;
  isLoading: boolean;
  error: unknown;
}) {
  if (isLoading) {
    return (
      <p className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Reading the key…
      </p>
    );
  }
  if (error) {
    return (
      <p className="p-4 text-xs text-destructive">
        {errorMessage(error, "Could not read that key")}
      </p>
    );
  }
  if (!value) {
    return (
      <EmptyState
        icon={Database}
        title="No key chosen"
        description="Pick a key on the left to see what it holds."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
        <span className="font-mono font-medium" data-testid="redis-key-name">
          {value.key}
        </span>
        <span className="rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {value.label}
        </span>
        <span className="text-muted-foreground">
          {value.type === "string"
            ? `${formatCount(value.size ?? 0)} bytes`
            : `${formatCount(value.size ?? 0)} ${
                value.type === "hash" ? "fields" : "entries"
              }`}
        </span>
        <span
          className={cn(
            "text-muted-foreground",
            value.ttl != null && value.ttl >= 0 && "text-amber-400"
          )}
        >
          {ttlLabel(value.ttl)}
        </span>
        {value.encoding && (
          <span className="text-muted-foreground/70">{value.encoding}</span>
        )}
      </div>

      {value.truncated && (
        <p
          role="status"
          className="border-b bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-400"
        >
          Showing the first {(value.entries?.length ?? 0) || (value.members?.length ?? 0)} of{" "}
          {formatCount(value.size ?? 0)}. A key this size is not worth loading
          whole into a browser tab.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <Body value={value} />
      </div>
    </div>
  );
}

function Body({ value }: { value: RedisKeyValueModel }) {
  if (value.type === "string") return <StringValue value={value} />;

  if (value.type === "hash") return <HashValue value={value} />;
  if (value.type === "zset") return <SortedSetValue value={value} />;
  if (value.type === "stream") return <StreamValue value={value} />;
  return <MembersValue value={value} />;
}

/**
 * A string, rendered as whatever it turns out to be.
 *
 * Most of what applications put in Redis is serialised JSON, and a session
 * blob printed as one escaped line is the difference between reading a value
 * and squinting at it.
 */
function StringValue({ value }: { value: RedisKeyValueModel }) {
  const parsed = useMemo(() => parseJson(value.value), [value.value]);
  const [raw, setRaw] = useState(false);

  return (
    <div className="space-y-2 p-4">
      <div className="flex items-center gap-2">
        {parsed !== undefined && (
          <div className="flex items-center rounded-md border p-0.5">
            {([["json", "JSON"], ["raw", "Raw"]] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setRaw(mode === "raw")}
                aria-pressed={raw === (mode === "raw")}
                className={cn(
                  "rounded px-2 py-0.5 text-[11px] transition-colors",
                  raw === (mode === "raw")
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {!value.is_text && (
          <p className="text-[11px] text-muted-foreground">
            Not text, so it is shown base64 encoded.
          </p>
        )}
        <span className="ml-auto">
          <CopyButton value={value.value ?? ""} label="Copy value" />
        </span>
      </div>

      {parsed !== undefined && !raw ? (
        <div className="overflow-auto rounded border bg-background p-2">
          <JsonView value={parsed} label="Key value" />
        </div>
      ) : (
        <pre
          aria-label="Key value"
          className="whitespace-pre-wrap break-words rounded border bg-background p-2 font-mono text-xs"
        >
          {value.value}
        </pre>
      )}
    </div>
  );
}

function HashValue({ value }: { value: RedisKeyValueModel }) {
  const entries = value.entries ?? [];
  const { rows, filter } = useFilter(entries, (entry) =>
    `${entry.field} ${entry.value}`
  );

  return (
    <>
      {filter}
      <Table headers={["Field", "Value"]} label="Hash fields">
        {rows.map((entry, index) => (
          <tr key={index} className="border-b align-top hover:bg-muted/40">
            <Cell mono>{String(entry.field)}</Cell>
            <Cell>
              <MaybeJson text={String(entry.value)} />
            </Cell>
          </tr>
        ))}
      </Table>
    </>
  );
}

function SortedSetValue({ value }: { value: RedisKeyValueModel }) {
  const entries = value.entries ?? [];
  const { rows, filter } = useFilter(entries, (entry) => String(entry.member));

  // the scores mean more against each other than alone
  const top = Math.max(...entries.map((entry) => Number(entry.score) || 0), 0);

  return (
    <>
      {filter}
      <Table headers={["Member", "Score"]} label="Sorted set members">
        {rows.map((entry, index) => (
          <tr key={index} className="border-b hover:bg-muted/40">
            <Cell mono>{String(entry.member)}</Cell>
            <td className="w-48 px-4 py-1.5">
              <div className="flex items-center gap-2">
                <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/60"
                    style={{
                      width: top > 0 ? `${(Number(entry.score) / top) * 100}%` : "0%",
                    }}
                  />
                </div>
                <span className="shrink-0 font-mono tabular-nums">
                  {String(entry.score)}
                </span>
              </div>
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}

function StreamValue({ value }: { value: RedisKeyValueModel }) {
  const entries = value.entries ?? [];
  const { rows, filter } = useFilter(entries, (entry) =>
    `${entry.id} ${JSON.stringify(entry.fields ?? {})}`
  );

  return (
    <>
      {filter}
      <Table headers={["Entry", "Fields"]} label="Stream entries">
        {rows.map((entry, index) => (
          <tr key={index} className="border-b align-top hover:bg-muted/40">
            <Cell mono>
              <span title={streamTime(String(entry.id))}>{String(entry.id)}</span>
            </Cell>
            <Cell>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {Object.entries((entry.fields ?? {}) as Record<string, string>).map(
                  ([name, item]) => (
                    <p key={name} className="font-mono text-[11px]">
                      <span className="text-sky-400">{name}</span>{" "}
                      <span className="text-muted-foreground/60">=</span> {item}
                    </p>
                  )
                )}
              </div>
            </Cell>
          </tr>
        ))}
      </Table>
    </>
  );
}

function MembersValue({ value }: { value: RedisKeyValueModel }) {
  const isList = value.type === "list";
  // the index is numbered before filtering, because a list position means
  // nothing once a search has removed the members in front of it
  const members = (value.members ?? []).map((member, index) => ({ member, index }));
  const { rows, filter } = useFilter(members, (item) => String(item.member));

  return (
    <>
      {filter}
      <Table
        headers={isList ? ["#", "Value"] : ["Member"]}
        label={isList ? "List members" : "Set members"}
      >
        {rows.map((item) => (
          <tr key={item.index} className="border-b align-top hover:bg-muted/40">
            {isList && (
              <Cell mono align="right">
                {item.index}
              </Cell>
            )}
            <Cell>
              <MaybeJson text={String(item.member)} />
            </Cell>
          </tr>
        ))}
      </Table>
    </>
  );
}

/** A cell that folds out when its text is JSON, and stays plain when it is not. */
function MaybeJson({ text }: { text: string }) {
  const parsed = useMemo(() => parseJson(text), [text]);
  if (parsed === undefined) return <span className="font-mono">{text}</span>;
  return <JsonView value={parsed} />;
}

/**
 * A filter over a collection's own entries.
 *
 * A hash with two hundred fields is a search problem, not a reading problem,
 * and scrolling it is the wrong tool.
 */
function useFilter<T>(items: T[], text: (item: T) => string) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const rows = needle
    ? items.filter((item) => text(item).toLowerCase().includes(needle))
    : items;

  const filter =
    items.length > 10 ? (
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b bg-card px-4 py-1.5">
        <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Filter entries"
          placeholder={`Filter ${items.length} entries`}
          className="h-6 min-w-0 flex-1 bg-transparent text-xs outline-none"
        />
        {needle && (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {rows.length} of {items.length}
          </span>
        )}
      </div>
    ) : null;

  return { rows, filter };
}

/** A stream id begins with the millisecond it was added. */
function streamTime(id: string): string {
  const millis = Number(id.split("-")[0]);
  return Number.isFinite(millis) ? new Date(millis).toLocaleString() : id;
}

function Table({
  headers,
  label,
  children,
}: {
  headers: string[];
  label: string;
  children: React.ReactNode;
}) {
  return (
    <table className="w-full border-collapse text-xs" aria-label={label}>
      <thead className="sticky top-0 bg-card">
        <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          {headers.map((header) => (
            <th
              key={header}
              className={cn("px-4 py-2 font-medium", header === "#" && "w-12")}
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Cell({
  children,
  mono,
  align,
}: {
  children: React.ReactNode;
  mono?: boolean;
  align?: "right";
}) {
  return (
    <td
      className={cn(
        "px-4 py-1.5 align-top",
        mono && "font-mono",
        align === "right" && "text-right tabular-nums"
      )}
    >
      <span className="break-words">{children}</span>
    </td>
  );
}
