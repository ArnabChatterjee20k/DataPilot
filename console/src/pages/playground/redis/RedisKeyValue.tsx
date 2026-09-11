import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import { formatCount } from "@/lib/format";
import type { RedisKeyValueModel } from "@/lib/sdk";
import { CopyButton, EmptyState } from "../components/primitives";
import { Database } from "lucide-react";

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
  if (value.type === "string") {
    return (
      <div className="p-4">
        {!value.is_text && (
          <p className="mb-2 text-[11px] text-muted-foreground">
            This value is not text, so it is shown base64 encoded.
          </p>
        )}
        <div className="flex items-start gap-2">
          <pre
            aria-label="Key value"
            className="min-w-0 flex-1 whitespace-pre-wrap break-words rounded border bg-background p-2 font-mono text-xs"
          >
            {value.value}
          </pre>
          <CopyButton value={value.value ?? ""} label="Copy value" />
        </div>
      </div>
    );
  }

  if (value.type === "hash") {
    return (
      <Table headers={["Field", "Value"]} label="Hash fields">
        {(value.entries ?? []).map((entry, index) => (
          <tr key={index} className="border-b hover:bg-muted/40">
            <Cell mono>{String(entry.field)}</Cell>
            <Cell>{String(entry.value)}</Cell>
          </tr>
        ))}
      </Table>
    );
  }

  if (value.type === "zset") {
    return (
      <Table headers={["Member", "Score"]} label="Sorted set members">
        {(value.entries ?? []).map((entry, index) => (
          <tr key={index} className="border-b hover:bg-muted/40">
            <Cell mono>{String(entry.member)}</Cell>
            <Cell mono align="right">
              {String(entry.score)}
            </Cell>
          </tr>
        ))}
      </Table>
    );
  }

  if (value.type === "stream") {
    return (
      <Table headers={["Entry", "Fields"]} label="Stream entries">
        {(value.entries ?? []).map((entry, index) => (
          <tr key={index} className="border-b align-top hover:bg-muted/40">
            <Cell mono>{String(entry.id)}</Cell>
            <Cell>
              <div className="space-y-0.5">
                {Object.entries((entry.fields ?? {}) as Record<string, string>).map(
                  ([name, item]) => (
                    <p key={name} className="font-mono text-[11px]">
                      <span className="text-muted-foreground">{name}</span> {item}
                    </p>
                  )
                )}
              </div>
            </Cell>
          </tr>
        ))}
      </Table>
    );
  }

  // list and set: a list keeps its order, so its index is worth showing
  return (
    <Table
      headers={value.type === "list" ? ["#", "Value"] : ["Member"]}
      label={value.type === "list" ? "List members" : "Set members"}
    >
      {(value.members ?? []).map((member, index) => (
        <tr key={index} className="border-b hover:bg-muted/40">
          {value.type === "list" && (
            <Cell mono align="right">
              {index}
            </Cell>
          )}
          <Cell mono>{member}</Cell>
        </tr>
      ))}
    </Table>
  );
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
