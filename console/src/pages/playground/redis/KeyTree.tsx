import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import type { RedisKeyModel } from "@/lib/sdk";
import {
  allPrefixes,
  buildTree,
  prefixesFor,
  TREE_THRESHOLD,
  type KeyNode,
} from "./keyPrefixes";

/**
 * A short label per type.
 *
 * Slicing the name to three letters turns both `string` and `stream` into
 * `str`, which is the one distinction the column exists to make.
 */
const TYPE_SHORT: Record<string, string> = {
  string: "str",
  hash: "hash",
  list: "list",
  set: "set",
  zset: "zset",
  stream: "strm",
};

/** A colour per type, so the shape of a keyspace reads without looking twice. */
const TYPE_CLASS: Record<string, string> = {
  string: "text-sky-400",
  hash: "text-violet-400",
  list: "text-amber-400",
  set: "text-emerald-400",
  zset: "text-rose-400",
  stream: "text-cyan-400",
};

export function KeyTree({
  keys,
  selected,
  grouped,
  onSelect,
}: {
  keys: RedisKeyModel[];
  selected: string | null;
  grouped: boolean;
  onSelect: (key: string) => void;
}) {
  const tree = useMemo(() => buildTree(keys), [keys]);
  const [open, setOpen] = useState<Set<string>>(new Set());

  // a small keyspace reads better flat, and a large one is unusable that way,
  // so the first view opens everything only while it is still small
  useEffect(() => {
    setOpen(new Set(keys.length <= TREE_THRESHOLD ? allPrefixes(tree) : []));
  }, [tree, keys.length]);

  // the selected key has to be reachable, whatever the scan returned
  useEffect(() => {
    if (!selected) return;
    setOpen((current) => {
      const next = new Set(current);
      for (const prefix of prefixesFor(selected)) next.add(prefix);
      return next;
    });
  }, [selected]);

  const toggle = (path: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  if (!grouped) {
    return (
      <div role="list" aria-label="Keys">
        {keys.map((key) => (
          <Row
            key={key.key}
            label={key.key}
            entry={key}
            depth={0}
            selected={selected === key.key}
            onSelect={onSelect}
          />
        ))}
      </div>
    );
  }

  return (
    <div role="list" aria-label="Keys">
      {tree.map((node) => (
        <Branch
          key={node.path}
          node={node}
          depth={0}
          open={open}
          selected={selected}
          onToggle={toggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function Branch({
  node,
  depth,
  open,
  selected,
  onToggle,
  onSelect,
}: {
  node: KeyNode;
  depth: number;
  open: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onSelect: (key: string) => void;
}) {
  // a node can be both: `user:7` may hold a value and have `user:7:sessions`
  const hasChildren = node.children.length > 0;
  const isOpen = open.has(node.path);

  return (
    <>
      {hasChildren ? (
        <button
          type="button"
          onClick={() => onToggle(node.path)}
          aria-expanded={isOpen}
          aria-label={`${node.name}, ${node.count} keys`}
          className="flex w-full items-center gap-1 py-1 pr-2 text-left text-xs hover:bg-muted/60"
          style={{ paddingLeft: depth * 12 + 8 }}
        >
          {isOpen ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          <Folder className="h-3 w-3 shrink-0 text-muted-foreground/70" />
          <span className="min-w-0 flex-1 truncate font-mono">{node.name}</span>
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
            {formatCount(node.count)}
          </span>
        </button>
      ) : (
        node.key && (
          <Row
            label={node.name}
            entry={node.key}
            depth={depth}
            selected={selected === node.key.key}
            onSelect={onSelect}
          />
        )
      )}

      {hasChildren && isOpen && (
        <>
          {node.key && (
            <Row
              label={`${node.name} (value)`}
              entry={node.key}
              depth={depth + 1}
              selected={selected === node.key.key}
              onSelect={onSelect}
            />
          )}
          {node.children.map((child) => (
            <Branch
              key={child.path}
              node={child}
              depth={depth + 1}
              open={open}
              selected={selected}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </>
      )}
    </>
  );
}

function Row({
  label,
  entry,
  depth,
  selected,
  onSelect,
}: {
  label: string;
  entry: RedisKeyModel;
  depth: number;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const expiring = entry.ttl != null && entry.ttl >= 0;

  return (
    <button
      type="button"
      role="listitem"
      onClick={() => onSelect(entry.key)}
      aria-pressed={selected}
      title={entry.key}
      className={cn(
        "flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs hover:bg-muted/60",
        selected && "bg-muted"
      )}
      style={{ paddingLeft: depth * 12 + 8 }}
    >
      <span
        aria-hidden
        title={entry.type}
        className={cn(
          "w-7 shrink-0 font-mono text-[9px] uppercase",
          TYPE_CLASS[entry.type] ?? "text-muted-foreground"
        )}
      >
        {TYPE_SHORT[entry.type] ?? entry.type.slice(0, 4)}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono">{label}</span>
      {expiring && (
        <span
          title={`expires in ${entry.ttl}s`}
          className="shrink-0 text-[10px] text-amber-500"
        >
          ttl
        </span>
      )}
      {entry.size != null && (
        <span
          title={sizeLabel(entry)}
          className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70"
        >
          {formatCount(entry.size)}
        </span>
      )}
    </button>
  );
}

/** The number beside a key means a different thing for each type. */
function sizeLabel(entry: RedisKeyModel): string {
  const size = formatCount(entry.size ?? 0);
  if (entry.type === "string") return `${size} bytes`;
  if (entry.type === "hash") return `${size} fields`;
  if (entry.type === "list") return `${size} items`;
  return `${size} members`;
}
