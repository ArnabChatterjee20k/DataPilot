import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Rendering a value that turns out to be JSON.
 *
 * Most of what applications put in Redis is serialised JSON, and a session
 * blob printed as one long escaped line is the difference between reading a
 * value and squinting at it.
 */

export function parseJson(text: string | null | undefined): unknown {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/** Below this many entries, everything opens at once. */
const OPEN_LIMIT = 50;

export function JsonView({ value, label }: { value: unknown; label?: string }) {
  return (
    <div
      className="font-mono text-[11px] leading-5"
      aria-label={label ?? "JSON value"}
    >
      <Node value={value} name={null} depth={0} isLast />
    </div>
  );
}

function Node({
  value,
  name,
  depth,
  isLast,
}: {
  value: unknown;
  name: string | null;
  depth: number;
  isLast: boolean;
}) {
  const entries = useMemo(() => childEntries(value), [value]);
  const [isOpen, setIsOpen] = useState(
    depth < 2 && entries !== null && entries.length <= OPEN_LIMIT
  );

  if (entries === null) {
    return (
      <div style={{ paddingLeft: depth * 12 }}>
        {name !== null && <Key name={name} />}
        <Scalar value={value} />
        {!isLast && <span className="text-muted-foreground/50">,</span>}
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const open = isArray ? "[" : "{";
  const close = isArray ? "]" : "}";

  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        className="inline-flex items-center gap-0.5 rounded hover:bg-muted/60"
      >
        {isOpen ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        {name !== null && <Key name={name} />}
        <span className="text-muted-foreground">{open}</span>
        {!isOpen && (
          <span className="text-muted-foreground/70">
            {entries.length} {isArray ? "items" : "keys"}
            {close}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          {entries.map(([childName, childValue], index) => (
            <Node
              key={childName}
              name={isArray ? null : childName}
              value={childValue}
              depth={depth + 1}
              isLast={index === entries.length - 1}
            />
          ))}
          <div style={{ paddingLeft: 0 }} className="text-muted-foreground">
            {close}
            {!isLast && <span className="text-muted-foreground/50">,</span>}
          </div>
        </>
      )}
    </div>
  );
}

function childEntries(value: unknown): [string, unknown][] | null {
  if (Array.isArray(value)) return value.map((item, index) => [String(index), item]);
  if (value && typeof value === "object") return Object.entries(value as object);
  return null;
}

function Key({ name }: { name: string }) {
  return (
    <span className="text-sky-400">
      {name}
      <span className="text-muted-foreground/60">: </span>
    </span>
  );
}

/** Colour by type, which is the fastest way to read a blob at a glance. */
function Scalar({ value }: { value: unknown }) {
  if (value === null) return <span className="text-muted-foreground/70">null</span>;
  if (typeof value === "boolean")
    return <span className="text-violet-400">{String(value)}</span>;
  if (typeof value === "number")
    return <span className="text-amber-400 tabular-nums">{value}</span>;
  return (
    <span className={cn("break-all text-emerald-400")}>
      "{String(value)}"
    </span>
  );
}
