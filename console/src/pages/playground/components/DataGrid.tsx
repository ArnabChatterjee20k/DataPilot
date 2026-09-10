import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Eye,
  Filter as FilterIcon,
  GripVertical,
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
import { NO_CHANGES, type RowChanges } from "@/lib/changes";
import { rowIdentity, type Filter } from "@/lib/sql";
import type { Column, Row } from "../store/store";
import { ColumnTypeBadge, CopyButton, EmptyState, useCopy } from "./primitives";

const SELECT_COLUMN_WIDTH = 64;
const MIN_COLUMN_WIDTH = 72;
/** Starting guess for a row's height; measured per row once rendered. */
const ESTIMATED_ROW_HEIGHT = 33;
/** Rows above this are windowed rather than all mounted. */
const VIRTUALISE_ABOVE = 60;

export interface DataGridProps {
  columns: Column[];
  rows: Row[];
  primaryKey: Column | null;
  sort: { column: string; direction: "asc" | "desc" } | null;
  onSort?: (column: string) => void;
  onFilter?: (filter: Filter) => void;
  onHideColumn?: (column: string) => void;
  onReorder?: (from: string, to: string) => void;
  selectedRows: Set<string>;
  onSelectionChange?: (next: Set<string>) => void;
  onOpenRow?: (row: Row, identity: string) => void;
  changes?: RowChanges;
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
  onReorder,
  selectedRows,
  onSelectionChange,
  onOpenRow,
  changes = NO_CHANGES,
  emptyTitle = "0 rows returned",
  emptyDescription = "The query ran successfully but matched no rows.",
}: DataGridProps) {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [expandedCell, setExpandedCell] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<{ row: number; column: number } | null>(null);
  const [dragColumn, setDragColumn] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<string | null>(null);

  const resizing = useRef<{ column: string; startX: number; startWidth: number } | null>(
    null
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const { copy } = useCopy();

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
      const width = Math.max(
        MIN_COLUMN_WIDTH,
        state.startWidth + event.clientX - state.startX
      );
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

  const isVirtual = rows.length > VIRTUALISE_ABOVE;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 16,
    enabled: isVirtual,
  });

  const virtualRows = virtualizer.getVirtualItems();
  // spacer rows stand in for what is not mounted, so the scrollbar and the
  // sticky header behave as if every row were present
  const paddingTop = isVirtual && virtualRows.length ? virtualRows[0].start : 0;
  const paddingBottom =
    isVirtual && virtualRows.length
      ? virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0;

  const visible = isVirtual
    ? virtualRows.map((item) => ({ row: rows[item.index], index: item.index, item }))
    : rows.map((row, index) => ({ row, index, item: null }));

  const allSelected = rows.length > 0 && identities.every((id) => selectedRows.has(id));
  const someSelected = !allSelected && identities.some((id) => selectedRows.has(id));

  const toggleAll = () => {
    if (!onSelectionChange) return;
    onSelectionChange(allSelected ? new Set() : new Set(identities));
  };

  const toggleRow = useCallback(
    (identity: string) => {
      if (!onSelectionChange) return;
      const next = new Set(selectedRows);
      if (next.has(identity)) next.delete(identity);
      else next.add(identity);
      onSelectionChange(next);
    },
    [onSelectionChange, selectedRows]
  );

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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!rows.length || !columns.length) return;
    const current = focus ?? { row: 0, column: 0 };

    const move = (rowDelta: number, columnDelta: number) => {
      event.preventDefault();
      setFocus({
        row: Math.min(Math.max(current.row + rowDelta, 0), rows.length - 1),
        column: Math.min(Math.max(current.column + columnDelta, 0), columns.length - 1),
      });
    };

    switch (event.key) {
      case "ArrowDown":
        return move(1, 0);
      case "ArrowUp":
        return move(-1, 0);
      case "ArrowRight":
        return move(0, 1);
      case "ArrowLeft":
        return move(0, -1);
      case "Home":
        event.preventDefault();
        return setFocus({ row: current.row, column: 0 });
      case "End":
        event.preventDefault();
        return setFocus({ row: current.row, column: columns.length - 1 });
      case "Enter":
        event.preventDefault();
        return onOpenRow?.(rows[current.row], identities[current.row]);
      case " ":
        event.preventDefault();
        return toggleRow(identities[current.row]);
      default:
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
          event.preventDefault();
          const column = columns[current.column];
          const value = formatCell(rows[current.row]?.[column.name], {
            kind: column.kind,
            relativeDates: false,
          }).full;
          void copy(value);
        }
    }
  };

  useEffect(() => {
    if (!focus) return;
    if (isVirtual) virtualizer.scrollToIndex(focus.row, { align: "auto" });
    scrollRef.current
      ?.querySelector(`[data-cell="${focus.row}:${focus.column}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focus, isVirtual, virtualizer]);

  useEffect(() => {
    setFocus(null);
  }, [rows]);

  const sortIcon = (name: string) => {
    if (sort?.column !== name)
      return (
        <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-0 group-hover/head:opacity-50" />
      );
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
    <div
      ref={scrollRef}
      tabIndex={0}
      role="grid"
      aria-label="Query results"
      onKeyDown={handleKeyDown}
      className="relative h-full w-full overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
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
            <th className="sticky left-0 top-0 z-30 border-b border-r bg-background px-3 py-2 align-top">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={toggleAll}
                aria-label="Select all rows on this page"
              />
            </th>

            {columns.map((column, columnIndex) => (
              <th
                key={column.name}
                draggable={!!onReorder}
                onDragStart={() => setDragColumn(column.name)}
                onDragEnd={() => {
                  setDragColumn(null);
                  setDropColumn(null);
                }}
                onDragOver={(event) => {
                  if (!onReorder || !dragColumn || dragColumn === column.name) return;
                  event.preventDefault();
                  setDropColumn(column.name);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (onReorder && dragColumn && dragColumn !== column.name) {
                    onReorder(dragColumn, column.name);
                  }
                  setDragColumn(null);
                  setDropColumn(null);
                }}
                className={cn(
                  "group/head sticky top-0 z-20 border-b bg-background px-3 py-2 text-left align-top",
                  columnIndex === 0 && "sticky left-16 z-30 border-r",
                  dragColumn === column.name && "opacity-50",
                  dropColumn === column.name && "border-l-2 border-l-primary"
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  {onReorder && (
                    <GripVertical
                      className="mt-0.5 h-3 w-3 shrink-0 cursor-grab text-muted-foreground opacity-0 group-hover/head:opacity-60"
                      aria-hidden
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => onSort?.(column.name)}
                    className="flex min-w-0 flex-1 items-center gap-1 text-left"
                    title={`Sort by ${column.name}`}
                  >
                    <span className="truncate text-xs font-semibold">{column.name}</span>
                    {sortIcon(column.name)}
                  </button>

                  <ColumnMenu
                    column={column}
                    onSort={onSort}
                    onFilter={onFilter}
                    onHideColumn={onHideColumn}
                  />
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
            <>
              {paddingTop > 0 && (
                <tr aria-hidden>
                  <td colSpan={columns.length + 2} style={{ height: paddingTop }} />
                </tr>
              )}
              {visible.map(({ row, index: rowIndex, item }) => {
              const identity = identities[rowIndex];
              const isSelected = selectedRows.has(identity);
              const isChanged = changes.changed.has(identity);
              const isAdded = changes.added.has(identity);
              const isRecent = changes.recent.has(identity);
              const pinnedBackground = isSelected
                ? "bg-[color-mix(in_oklch,var(--primary)_10%,var(--background))]"
                : "bg-background group-hover/row:bg-[color-mix(in_oklch,var(--muted)_40%,var(--background))]";

              return (
                <tr
                  key={identity}
                  data-index={item?.index}
                  ref={item ? virtualizer.measureElement : undefined}
                  data-changed={isChanged || isAdded ? "true" : undefined}
                  data-recent={isRecent ? "true" : undefined}
                  className={cn(
                    "group/row transition-colors",
                    isSelected ? "bg-primary/10" : "hover:bg-muted/40",
                    focus?.row === rowIndex && "bg-muted/50",
                    isAdded && "bg-emerald-500/5",
                    isChanged && !isAdded && "bg-amber-500/5"
                  )}
                  onDoubleClick={() => onOpenRow?.(row, identity)}
                >
                  <td
                    className={cn(
                      "sticky left-0 z-10 border-b border-r px-3 py-1.5",
                      pinnedBackground
                    )}
                    style={{ position: "sticky" }}
                  >
                    <div className="flex items-center gap-0.5">
                      <span
                        aria-hidden
                        title={
                          isAdded
                            ? "New since the last load"
                            : isChanged
                              ? "Changed since the last load"
                              : isRecent
                                ? "Updated in the last 24 hours"
                                : undefined
                        }
                        className={cn(
                          "absolute left-0 top-0 h-full w-0.5",
                          isAdded
                            ? "bg-emerald-500"
                            : isChanged
                              ? "bg-amber-500"
                              : isRecent
                                ? "bg-sky-500/60"
                                : "bg-transparent"
                        )}
                      />
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
                    const isFocused =
                      focus?.row === rowIndex && focus?.column === columnIndex;

                    return (
                      <td
                        key={column.name}
                        data-cell={`${rowIndex}:${columnIndex}`}
                        onMouseDown={() =>
                          setFocus({ row: rowIndex, column: columnIndex })
                        }
                        className={cn(
                          "border-b px-3 py-1.5 align-top",
                          isFocused && "outline outline-1 -outline-offset-1 outline-ring",
                          columnIndex === 0 &&
                            cn("sticky left-16 z-10 border-r", pinnedBackground)
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
              })}
              {paddingBottom > 0 && (
                <tr aria-hidden>
                  <td colSpan={columns.length + 2} style={{ height: paddingBottom }} />
                </tr>
              )}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ColumnMenu({
  column,
  onSort,
  onFilter,
  onHideColumn,
}: {
  column: Column;
  onSort?: (column: string) => void;
  onFilter?: (filter: Filter) => void;
  onHideColumn?: (column: string) => void;
}) {
  const [term, setTerm] = useState("");
  if (!onHideColumn && !onFilter && !onSort) return null;

  return (
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

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {column.name}
          {column.type ? ` · ${column.type}` : ""}
          {onFilter && !column.indexed && !column.primary_key && (
            <span className="mt-0.5 block text-amber-400">
              Not indexed — filtering here scans the table
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {onSort && (
          <DropdownMenuItem onClick={() => onSort(column.name)}>Sort</DropdownMenuItem>
        )}

        {onFilter && (
          <>
            <DropdownMenuItem
              onClick={() => onFilter({ column: column.name, operator: "is null" })}
            >
              Filter: is null
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onFilter({ column: column.name, operator: "is not null" })}
            >
              Filter: is not null
            </DropdownMenuItem>
            <div
              className="px-2 py-1.5"
              onKeyDown={(event) => event.stopPropagation()}
            >
              <input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || !term.trim()) return;
                  event.preventDefault();
                  onFilter({
                    column: column.name,
                    operator: column.kind === "number" ? "=" : "contains",
                    value: term.trim(),
                  });
                  setTerm("");
                }}
                placeholder={
                  column.kind === "number" ? "equals…  (Enter)" : "contains…  (Enter)"
                }
                aria-label={`Filter ${column.name}`}
                className="h-7 w-full rounded border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </>
        )}

        {onHideColumn && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onHideColumn(column.name)}>
              Hide column
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
