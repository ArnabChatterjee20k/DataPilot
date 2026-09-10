import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Eye,
  Filter as FilterIcon,
  Maximize2,
  PanelRightOpen,
  TableIcon,
} from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  estimateColumnWidth,
  formatCell,
  looksEnumLike,
  pillClass,
  type FormattedCell,
} from "@/lib/format";
import { distinctCounts } from "@/lib/columns";
import { rowIdentity, type Filter } from "@/lib/sql";
import type { Column, Row } from "../store/store";
import { ColumnTypeBadge, CopyButton, EmptyState } from "./primitives";

const SELECT_COLUMN_WIDTH = 64;
const MIN_COLUMN_WIDTH = 72;

export interface DataGridProps {
  columns: Column[];
  rows: Row[];
  primaryKey: Column | null;
  sort: { column: string; direction: "asc" | "desc" } | null;
  onSort?: (column: string) => void;
  onFilter?: (filter: Filter) => void;
  onHideColumn?: (column: string) => void;
  selectedRows: Set<string>;
  onSelectionChange?: (next: Set<string>) => void;
  onOpenRow?: (row: Row, identity: string) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function DataGrid({
  columns,
  rows,
  primaryKey,
  sort,
  onSort,
  onFilter,
  onHideColumn,
  selectedRows,
  onSelectionChange,
  onOpenRow,
  emptyTitle = "0 rows returned",
  emptyDescription = "The query ran successfully but matched no rows.",
}: DataGridProps) {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [expandedCell, setExpandedCell] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const resizing = useRef<{ column: string; startX: number; startWidth: number } | null>(
    null
  );

  // widths are derived from content, but a column the user dragged keeps its size
  const measured = useMemo(() => {
    const next: Record<string, number> = {};
    for (const column of columns) {
      next[column.name] = estimateColumnWidth(column, rows);
    }
    return next;
  }, [columns, rows]);

  const widthFor = useCallback(
    (column: Column) => widths[column.name] ?? measured[column.name] ?? 160,
    [widths, measured]
  );

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const state = resizing.current;
      if (!state) return;
      const width = Math.max(MIN_COLUMN_WIDTH, state.startWidth + event.clientX - state.startX);
      setWidths((current) => ({ ...current, [state.column]: width }));
    };
    const handleUp = () => {
      resizing.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  const identities = useMemo(
    () => rows.map((row, index) => rowIdentity(row, primaryKey, index)),
    [rows, primaryKey]
  );

  const distinct = useMemo(() => distinctCounts(columns, rows), [columns, rows]);

  const allSelected = rows.length > 0 && identities.every((id) => selectedRows.has(id));
  const someSelected = !allSelected && identities.some((id) => selectedRows.has(id));

  const toggleAll = () => {
    if (!onSelectionChange) return;
    onSelectionChange(allSelected ? new Set() : new Set(identities));
  };

  const toggleRow = (identity: string) => {
    if (!onSelectionChange) return;
    const next = new Set(selectedRows);
    if (next.has(identity)) next.delete(identity);
    else next.add(identity);
    onSelectionChange(next);
  };

  const startResize = (column: Column, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    resizing.current = {
      column: column.name,
      startX: event.clientX,
      startWidth: widthFor(column),
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const sortIcon = (name: string) => {
    if (sort?.column !== name)
      return <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-0 group-hover/head:opacity-50" />;
    return sort.direction === "asc" ? (
      <ChevronUp className="h-3 w-3 shrink-0 text-foreground" />
    ) : (
      <ChevronDown className="h-3 w-3 shrink-0 text-foreground" />
    );
  };

  if (!columns.length) {
    return (
      <EmptyState
        icon={TableIcon}
        title="No columns to show"
        description="Every column is hidden, or the statement returned no result set."
      />
    );
  }

  return (
    <div className="relative h-full w-full overflow-auto">
      <table
        className="w-full min-w-max border-separate border-spacing-0 text-sm"
        style={{ tableLayout: "fixed" }}
      >
        <colgroup>
          <col style={{ width: SELECT_COLUMN_WIDTH }} />
          {columns.map((column) => (
            <col key={column.name} style={{ width: widthFor(column) }} />
          ))}
          {/* absorbs the leftover width so the header rule spans the panel */}
          <col />
        </colgroup>

        <thead>
          <tr>
            <th
              className={cn(
                "sticky left-0 top-0 z-30 border-b border-r bg-background px-3 py-2",
                "align-top"
              )}
            >
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={toggleAll}
                aria-label="Select all rows on this page"
              />
            </th>
            {columns.map((column, columnIndex) => (
              <th
                key={column.name}
                className={cn(
                  "group/head sticky top-0 z-20 border-b bg-background px-3 py-2 text-left align-top",
                  columnIndex === 0 && "sticky left-16 z-30 border-r"
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <button
                    type="button"
                    onClick={() => onSort?.(column.name)}
                    className="flex min-w-0 flex-1 items-center gap-1 text-left"
                    title={`Sort by ${column.name}`}
                  >
                    <span className="truncate text-xs font-semibold">{column.name}</span>
                    {sortIcon(column.name)}
                  </button>
                  {onHideColumn && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover/head:opacity-100"
                          aria-label={`Options for ${column.name}`}
                        >
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                          {column.name}
                          {column.type ? ` · ${column.type}` : ""}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onSort?.(column.name)}>
                          Sort
                        </DropdownMenuItem>
                        {onFilter && (
                          <>
                            <DropdownMenuItem
                              onClick={() =>
                                onFilter({ column: column.name, operator: "is null" })
                              }
                            >
                              Filter: is null
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                onFilter({ column: column.name, operator: "is not null" })
                              }
                            >
                              Filter: is not null
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onHideColumn(column.name)}>
                          Hide column
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                <div className="mt-0.5">
                  <ColumnTypeBadge column={column} />
                </div>
                <span
                  role="separator"
                  aria-orientation="vertical"
                  onMouseDown={(event) => startResize(column, event)}
                  onDoubleClick={() =>
                    setWidths((current) => {
                      const next = { ...current };
                      delete next[column.name];
                      return next;
                    })
                  }
                  className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40"
                  title="Drag to resize, double-click to reset"
                />
              </th>
            ))}
            <th
              className="sticky top-0 z-20 border-b bg-background px-3 py-2"
              aria-hidden
            />
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 2} className="p-0">
                <EmptyState
                  icon={TableIcon}
                  title={emptyTitle}
                  description={emptyDescription}
                />
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => {
              const identity = identities[rowIndex];
              const isSelected = selectedRows.has(identity);
              return (
                <tr
                  key={identity}
                  className={cn(
                    "group/row transition-colors",
                    isSelected ? "bg-primary/10" : "hover:bg-muted/40"
                  )}
                  onDoubleClick={() => onOpenRow?.(row, identity)}
                >
                  <td
                    className={cn(
                      "sticky left-0 z-10 border-b border-r px-3 py-1.5",
                      isSelected
                        ? "bg-[color-mix(in_oklch,var(--primary)_10%,var(--background))]"
                        : "bg-background group-hover/row:bg-[color-mix(in_oklch,var(--muted)_40%,var(--background))]"
                    )}
                  >
                    <div className="flex items-center gap-0.5">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleRow(identity)}
                        aria-label={`Select row ${rowIndex + 1}`}
                      />
                      {onOpenRow && (
                        <button
                          type="button"
                          onClick={() => onOpenRow(row, identity)}
                          aria-label={`Expand row ${rowIndex + 1}`}
                          title="Expand row"
                          className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover/row:opacity-100"
                        >
                          <PanelRightOpen className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>

                  {columns.map((column, columnIndex) => {
                    const cellKey = `${identity}:${column.name}`;
                    const isRevealed = revealed.has(cellKey);
                    const cell = formatCell(row[column.name], {
                      kind: column.kind,
                      masked: column.sensitive && !isRevealed,
                    });
                    const enumLike =
                      cell.state === "value" &&
                      looksEnumLike(column.kind, distinct[column.name], rows.length);

                    return (
                      <td
                        key={column.name}
                        className={cn(
                          "border-b px-3 py-1.5 align-top",
                          columnIndex === 0 &&
                            cn(
                              "sticky left-16 z-10 border-r",
                              isSelected
                                ? "bg-[color-mix(in_oklch,var(--primary)_10%,var(--background))]"
                                : "bg-background group-hover/row:bg-[color-mix(in_oklch,var(--muted)_40%,var(--background))]"
                            )
                        )}
                      >
                        <Cell
                          cell={cell}
                          column={column}
                          enumLike={enumLike}
                          expanded={expandedCell === cellKey}
                          onToggleExpand={() =>
                            setExpandedCell((current) =>
                              current === cellKey ? null : cellKey
                            )
                          }
                          onReveal={() =>
                            setRevealed((current) => new Set(current).add(cellKey))
                          }
                          onFilter={
                            onFilter
                              ? () =>
                                  onFilter(
                                    cell.state === "null"
                                      ? { column: column.name, operator: "is null" }
                                      : {
                                          column: column.name,
                                          operator: "=",
                                          value: row[column.name],
                                        }
                                  )
                              : undefined
                          }
                        />
                      </td>
                    );
                  })}
                  <td className="border-b" aria-hidden />
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  cell,
  column,
  enumLike,
  expanded,
  onToggleExpand,
  onReveal,
  onFilter,
}: {
  cell: FormattedCell;
  column: Column;
  enumLike: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onReveal: () => void;
  onFilter?: () => void;
}) {
  if (cell.state === "masked") {
    return (
      <button
        type="button"
        onClick={onReveal}
        className="inline-flex items-center gap-1.5 rounded px-1 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Hidden because this column looks sensitive — click to reveal"
      >
        <Eye className="h-3 w-3" />
        {cell.text}
      </button>
    );
  }

  const body =
    cell.state === "null" ? (
      <span className="italic text-muted-foreground/60">null</span>
    ) : cell.state === "empty" ? (
      <span className="rounded bg-muted/60 px-1 text-[11px] italic text-muted-foreground/70">
        empty
      </span>
    ) : enumLike ? (
      <span
        className={cn(
          "inline-block max-w-full truncate rounded-full border px-2 py-0.5 text-[11px]",
          pillClass(cell.text)
        )}
      >
        {cell.text}
      </span>
    ) : (
      <span
        className={cn(
          column.monospace && "font-mono text-[12.5px]",
          expanded ? "whitespace-pre-wrap break-words" : "block truncate"
        )}
      >
        {cell.text}
      </span>
    );

  const isTruncatable = cell.state === "value" && !enumLike && cell.text.length > 24;

  return (
    <div className="group/cell relative flex items-start gap-1" title={cell.title}>
      <div className="min-w-0 flex-1">{body}</div>
      <div className="absolute right-0 top-0 hidden items-center gap-0.5 rounded bg-background/95 pl-1 shadow-sm group-hover/cell:flex">
        {isTruncatable && (
          <button
            type="button"
            onClick={onToggleExpand}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            title={expanded ? "Collapse" : "Expand"}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        )}
        {onFilter && (
          <button
            type="button"
            onClick={onFilter}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Filter by this value"
          >
            <FilterIcon className="h-3.5 w-3.5" />
          </button>
        )}
        {cell.state === "value" && <CopyButton value={cell.full} label="Copy value" />}
      </div>
    </div>
  );
}
