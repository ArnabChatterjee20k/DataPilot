import { useState } from "react";
import { Eye } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { absoluteTime, formatCell, prettyJson, relativeTime } from "@/lib/format";
import type { Column, Row } from "../store/store";
import { ColumnTypeBadge, CopyButton } from "./primitives";

function rowToObject(row: Row, columns: Column[]) {
  const output: Record<string, unknown> = {};
  for (const column of columns) output[column.name] = row[column.name];
  return output;
}

/** Field-by-field inspection of one row, plus its raw JSON. */
export function RowDetailPanel({
  row,
  columns,
  open,
  onOpenChange,
}: {
  row: Row | null;
  columns: Column[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  if (!row) return null;
  const json = prettyJson(rowToObject(row, columns));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Row detail</DialogTitle>
          <DialogDescription>
            Inspect each field, or copy the whole row as JSON.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="fields" className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="fields">Fields</TabsTrigger>
              <TabsTrigger value="json">JSON</TabsTrigger>
            </TabsList>
            <CopyButton value={json} label="Copy row as JSON" />
          </div>

          <TabsContent value="fields" className="mt-3 min-h-0 flex-1 overflow-auto">
            <dl className="divide-y divide-border/60">
              {columns.map((column) => {
                const isRevealed = revealed.has(column.name);
                const cell = formatCell(row[column.name], {
                  kind: column.kind,
                  masked: column.sensitive && !isRevealed,
                  relativeDates: false,
                });
                const value = row[column.name];

                return (
                  <div
                    key={column.name}
                    className="group grid grid-cols-[minmax(140px,220px)_1fr] gap-4 py-2"
                  >
                    <dt className="min-w-0">
                      <p className="truncate text-xs font-medium">{column.name}</p>
                      <ColumnTypeBadge column={column} />
                    </dt>
                    <dd className="flex min-w-0 items-start gap-2">
                      <div className="min-w-0 flex-1">
                        {cell.state === "masked" ? (
                          <button
                            type="button"
                            onClick={() =>
                              setRevealed((current) =>
                                new Set(current).add(column.name)
                              )
                            }
                            className="inline-flex items-center gap-1.5 rounded px-1 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Eye className="h-3 w-3" />
                            {cell.text}
                          </button>
                        ) : cell.state === "null" ? (
                          <span className="italic text-muted-foreground/60">null</span>
                        ) : cell.state === "empty" ? (
                          <span className="rounded bg-muted/60 px-1 text-[11px] italic text-muted-foreground/70">
                            empty string
                          </span>
                        ) : column.kind === "json" ? (
                          <pre className="max-h-56 overflow-auto rounded bg-muted/40 p-2 font-mono text-[11.5px] leading-relaxed">
                            {prettyJson(value)}
                          </pre>
                        ) : (
                          <p
                            className={cn(
                              "break-words text-xs",
                              column.monospace && "font-mono"
                            )}
                          >
                            {cell.text}
                            {column.kind === "timestamp" && (
                              <span className="ml-2 text-muted-foreground">
                                {relativeTime(value) ?? absoluteTime(value)}
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                      {cell.state !== "null" && (
                        <CopyButton
                          value={cell.full}
                          label={`Copy ${column.name}`}
                          className="opacity-0 transition-opacity group-hover:opacity-100"
                        />
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </TabsContent>

          <TabsContent value="json" className="mt-3 min-h-0 flex-1 overflow-auto">
            <pre className="rounded bg-muted/40 p-3 font-mono text-[11.5px] leading-relaxed">
              {json}
            </pre>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
