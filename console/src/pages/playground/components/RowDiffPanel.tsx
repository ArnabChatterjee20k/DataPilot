import { useMemo } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatCell, prettyJson } from "@/lib/format";
import type { Column, Row } from "../store/store";
import { ColumnTypeBadge, CopyButton } from "./primitives";

function display(value: unknown, column: Column): string {
  if (value === null || value === undefined) return "null";
  if (column.kind === "json") return prettyJson(value);
  return formatCell(value, { kind: column.kind, relativeDates: false }).full || '""';
}

/** Side-by-side comparison of two rows, changed fields first. */
export function RowDiffPanel({
  rows,
  columns,
  open,
  onOpenChange,
}: {
  rows: [Row, Row] | null;
  columns: Column[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const entries = useMemo(() => {
    if (!rows) return [];
    const [left, right] = rows;
    return columns
      .map((column) => {
        const leftText = display(left[column.name], column);
        const rightText = display(right[column.name], column);
        return { column, leftText, rightText, changed: leftText !== rightText };
      })
      .sort((a, b) => Number(b.changed) - Number(a.changed));
  }, [rows, columns]);

  const changedCount = entries.filter((entry) => entry.changed).length;

  if (!rows) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>Compare rows</DialogTitle>
          <DialogDescription>
            {changedCount === 0
              ? "These two rows are identical across every column."
              : `${changedCount} of ${entries.length} columns differ. Differences are listed first.`}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto">
          <div className="sticky top-0 z-10 grid grid-cols-[minmax(120px,180px)_1fr_1fr] gap-3 border-b bg-background pb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>Column</span>
            <span>Row A</span>
            <span>Row B</span>
          </div>

          {entries.map((entry) => (
            <div
              key={entry.column.name}
              className={cn(
                "grid grid-cols-[minmax(120px,180px)_1fr_1fr] gap-3 border-b border-border/50 py-2",
                entry.changed && "bg-amber-500/5"
              )}
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{entry.column.name}</p>
                <ColumnTypeBadge column={entry.column} />
              </div>

              <DiffCell
                text={entry.leftText}
                changed={entry.changed}
                tone="removed"
                monospace={entry.column.monospace || entry.column.kind === "json"}
              />
              <DiffCell
                text={entry.rightText}
                changed={entry.changed}
                tone="added"
                monospace={entry.column.monospace || entry.column.kind === "json"}
              />
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DiffCell({
  text,
  changed,
  tone,
  monospace,
}: {
  text: string;
  changed: boolean;
  tone: "removed" | "added";
  monospace: boolean;
}) {
  return (
    <div className="group flex min-w-0 items-start gap-1">
      <span
        className={cn(
          "min-w-0 flex-1 whitespace-pre-wrap break-words rounded px-1 py-0.5 text-xs",
          monospace && "font-mono text-[11.5px]",
          text === "null" && "italic text-muted-foreground/60",
          changed &&
            (tone === "removed"
              ? "bg-rose-500/10 text-rose-300"
              : "bg-emerald-500/10 text-emerald-300")
        )}
      >
        {text}
      </span>
      <CopyButton
        value={text}
        label="Copy value"
        className="opacity-0 transition-opacity group-hover:opacity-100"
      />
    </div>
  );
}
