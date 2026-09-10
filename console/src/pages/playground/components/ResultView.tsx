import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Database,
  Columns2,
  Download,
  Gauge,
  Plus,
  RefreshCw,
  SearchIcon,
  Table2,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { applyColumnOrder, moveColumn, refineColumns } from "@/lib/columns";
import { diffRows, NO_CHANGES } from "@/lib/changes";
import { formatCount } from "@/lib/format";
import { buildDelete, primaryKeyOf, rowIdentity, type Filter } from "@/lib/sql";
import type {
  Column,
  DatabaseConnection,
  QueryResultState,
  Row,
  Tab,
} from "../store/store";
import { ROWS_LIMITS, tableKeyOf, useTabsStore } from "../store/store";
import { DataGrid } from "./DataGrid";
import { PlanPanel } from "./PlanPanel";
import { RowDiffPanel } from "./RowDiffPanel";
import { StatsPanel } from "./StatsPanel";
import { ViewsMenu } from "./ViewsMenu";
import { useEntityStats, useQueryPlan } from "../hooks/useInsights";
import { FilterBar } from "./FilterBar";
import { QueryStatusBar } from "./QueryStatusBar";
import { RowDetailPanel } from "./RowDetailPanel";
import { CopyButton, EmptyState, GridSkeleton } from "./primitives";
import { RowEditorDialog } from "./RowEditorDialog";

interface ResultViewProps {
  tab: Tab;
  connection?: DatabaseConnection;
  result?: QueryResultState;
  /** Column metadata from the table, when the tab is bound to one. */
  tableColumns?: Column[];
  totalRows?: number | null;
  isLoading: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onExport?: (format: "csv" | "json" | "ndjson", columns: string[]) => void;
  onWrite?: (sql: string, description: string) => Promise<void>;
}

export function ResultView({
  tab,
  connection,
  result,
  tableColumns,
  totalRows,
  isLoading,
  isRefreshing,
  onRefresh,
  onExport,
  onWrite,
}: ResultViewProps) {
  const {
    updateTab,
    addFilter,
    removeFilter,
    clearFilters,
    toggleColumn,
    showAllColumns,
    reorderColumns,
    toggleSort,
    saveView,
    applyView,
    deleteView,
  } = useTabsStore();
  const savedViews = useTabsStore((state) => state.views);

  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [detailRow, setDetailRow] = useState<Row | null>(null);
  const [editorRow, setEditorRow] = useState<Row | null>(null);
  const [isInserting, setIsInserting] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  const [searchDraft, setSearchDraft] = useState(tab.search);
  const [panel, setPanel] = useState<"data" | "stats" | "plan">("data");
  const [isComparing, setIsComparing] = useState(false);

  const isTableTab = tab.type === "table" && !!tab.tableName;
  const rows = result?.rows ?? [];

  const allColumns = useMemo(
    () =>
      applyColumnOrder(
        refineColumns(
          result?.columns?.length ? result.columns : (tableColumns ?? []),
          rows
        ),
        tab.columnOrder
      ),
    [result?.columns, tableColumns, rows, tab.columnOrder]
  );

  const columns = useMemo(() => {
    const hidden = new Set(tab.hiddenColumns);
    return allColumns.filter((column) => !hidden.has(column.name));
  }, [allColumns, tab.hiddenColumns]);
  const primaryKey = useMemo(() => primaryKeyOf(allColumns), [allColumns]);

  // a new result set invalidates selections made against the previous one
  useEffect(() => {
    setSelectedRows(new Set());
  }, [result?.ranAt]);

  // the page that was on screen before this one, so a reload can say what moved
  const previousRows = useRef<Row[] | undefined>(undefined);
  const [changes, setChanges] = useState(NO_CHANGES);

  useEffect(() => {
    if (!result || result.error) return;
    setChanges(diffRows(rows, previousRows.current, allColumns, primaryKey));
    previousRows.current = rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.ranAt]);

  // a different table is a different comparison; do not diff across them
  useEffect(() => {
    previousRows.current = undefined;
    setChanges(NO_CHANGES);
  }, [tab.id, tab.tableName]);

  useEffect(() => {
    setSearchDraft(tab.search);
  }, [tab.id, tab.search]);

  const searchTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    },
    []
  );

  const handleSearchChange = (value: string) => {
    setSearchDraft(value);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      updateTab(tab.id, { search: value, rowsOffset: 0 });
    }, 350);
  };

  const handleFilter = useCallback(
    (filter: Filter) => addFilter(tab.id, filter),
    [addFilter, tab.id]
  );

  const statsQuery = useEntityStats(
    tab.connectionId,
    tab.tableName,
    tab.schemaName,
    panel === "stats" && isTableTab
  );
  const planQuery = useQueryPlan(
    tab.connectionId,
    tab.tableName,
    result?.query ?? tab.content,
    panel === "plan"
  );

  const tableKey = tableKeyOf(tab.connectionId, tab.schemaName, tab.tableName);
  const views = useMemo(
    () =>
      savedViews
        .filter((view) => view.tableKey === tableKey)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [savedViews, tableKey]
  );
  const hasSomethingToSave =
    tab.filters.length > 0 ||
    !!tab.search.trim() ||
    !!tab.sort ||
    tab.hiddenColumns.length > 0 ||
    tab.columnOrder.length > 0;

  const page = Math.floor(tab.rowsOffset / Math.max(tab.rowsLimit, 1)) + 1;
  const lastPage =
    totalRows && totalRows > 0
      ? Math.max(1, Math.ceil(totalRows / Math.max(tab.rowsLimit, 1)))
      : null;
  const canGoBack = tab.rowsOffset > 0;
  const canGoForward = rows.length >= tab.rowsLimit;

  const selectedRowObjects = useMemo(
    () =>
      rows.filter((row, index) =>
        selectedRows.has(rowIdentity(row, primaryKey, index))
      ),
    [rows, selectedRows, primaryKey]
  );

  const runWrite = async (sql: string, description: string) => {
    if (!onWrite) return;
    setIsWriting(true);
    try {
      await onWrite(sql, description);
      setSelectedRows(new Set());
    } finally {
      setIsWriting(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (!primaryKey || !selectedRowObjects.length || !onWrite) return;
    const count = selectedRowObjects.length;
    if (
      !window.confirm(
        `Delete ${count} row${count === 1 ? "" : "s"} from ${tab.tableName}? ` +
          "This cannot be undone."
      )
    ) {
      return;
    }
    const sql = buildDelete(
      tab.tableName!,
      tab.schemaName,
      connection?.type ?? "sqlite",
      primaryKey,
      selectedRowObjects.map((row) => row[primaryKey.name])
    );
    await runWrite(sql, `Deleted ${count} row${count === 1 ? "" : "s"}`);
  };

  const busy = isLoading || isRefreshing || isWriting;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={searchDraft}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder={isTableTab ? "Search this table…" : "Search unavailable for queries"}
            disabled={!isTableTab || busy}
            className={cn(
              "h-8 w-full rounded-md border bg-background pl-8 pr-2 text-xs",
              "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          />
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <div className="mr-1 flex items-center rounded-md border p-0.5">
            {(
              [
                ["data", "Data", Table2],
                ["stats", "Stats", BarChart3],
                ["plan", "Plan", Gauge],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPanel(value)}
                aria-pressed={panel === value}
                title={label}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors",
                  panel === value
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">{label}</span>
              </button>
            ))}
          </div>

          <span className="mr-1 hidden text-xs text-muted-foreground sm:inline">
            {totalRows !== null && totalRows !== undefined
              ? `${formatCount(totalRows)} rows`
              : `${formatCount(rows.length)} shown`}
          </span>

          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 px-2 text-xs"
            onClick={onRefresh}
            disabled={busy}
            title="Re-run"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
            <span className="hidden md:inline">Reload</span>
          </Button>

          {isTableTab && onWrite && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 px-2 text-xs"
              onClick={() => {
                setIsInserting(true);
                setEditorRow({});
              }}
              disabled={busy}
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden md:inline">New row</span>
            </Button>
          )}

          {onExport && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 px-2 text-xs"
                  disabled={busy || !columns.length}
                >
                  <Download className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">Export</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Visible columns, current filters
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(["csv", "json", "ndjson"] as const).map((format) => (
                  <DropdownMenuItem
                    key={format}
                    onClick={() =>
                      onExport(
                        format,
                        columns.map((column) => column.name)
                      )
                    }
                  >
                    {format.toUpperCase()}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {isTableTab && (
            <ViewsMenu
              views={views}
              canSave={hasSomethingToSave}
              onSave={(name) => saveView(tab.id, name)}
              onApply={(viewId) => applyView(tab.id, viewId)}
              onDelete={deleteView}
              disabled={busy}
            />
          )}

          <ColumnsMenu
            columns={allColumns}
            hidden={new Set(tab.hiddenColumns)}
            onToggle={(name) => toggleColumn(tab.id, name)}
            onShowAll={() => showAllColumns(tab.id)}
            disabled={busy || !allColumns.length}
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1 px-2 text-xs"
                disabled={busy}
              >
                {tab.rowsLimit}
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Rows per page
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {ROWS_LIMITS.map((limit) => (
                <DropdownMenuCheckboxItem
                  key={limit}
                  checked={limit === tab.rowsLimit}
                  onCheckedChange={() =>
                    updateTab(tab.id, { rowsLimit: limit, rowsOffset: 0 })
                  }
                >
                  {limit}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={() =>
                updateTab(tab.id, {
                  rowsOffset: Math.max(0, tab.rowsOffset - tab.rowsLimit),
                })
              }
              disabled={busy || !canGoBack}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-14 text-center text-xs tabular-nums text-muted-foreground">
              {lastPage ? `${page} / ${lastPage}` : `Page ${page}`}
            </span>
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={() =>
                updateTab(tab.id, { rowsOffset: tab.rowsOffset + tab.rowsLimit })
              }
              disabled={busy || !canGoForward}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <FilterBar
        filters={tab.filters}
        search={tab.search}
        onRemove={(key) => removeFilter(tab.id, key)}
        onClearAll={() => {
          clearFilters(tab.id);
          setSearchDraft("");
        }}
      />

      <QueryStatusBar result={result} isRunning={isLoading && !result} />

      {selectedRows.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-4 py-1.5 text-xs">
          <span>
            {selectedRows.size} row{selectedRows.size === 1 ? "" : "s"} selected
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() => setSelectedRows(new Set())}
          >
            Clear
          </Button>
          {selectedRows.size === 2 && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 gap-1.5 px-2 text-xs"
              onClick={() => setIsComparing(true)}
            >
              <Columns2 className="h-3.5 w-3.5" />
              Compare
            </Button>
          )}
          <CopyButton
            value={JSON.stringify(selectedRowObjects, null, 2)}
            label="Copy selected rows as JSON"
            className="h-6 w-6"
          />
          {primaryKey && (
            <CopyButton
              value={selectedRowObjects
                .map((row) => String(row[primaryKey.name]))
                .join(String.fromCharCode(10))}
              label={`Copy ${primaryKey.name} values`}
              className="h-6 w-6"
            />
          )}
          {isTableTab && onWrite && primaryKey && (
            <Button
              size="sm"
              variant="destructive"
              className="ml-auto h-6 gap-1.5 px-2 text-xs"
              onClick={handleDeleteSelected}
              disabled={isWriting}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete selected
            </Button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {panel === "stats" ? (
          <StatsPanel
            stats={statsQuery.data}
            isLoading={statsQuery.isLoading}
            error={statsQuery.error}
          />
        ) : panel === "plan" ? (
          <PlanPanel
            plan={planQuery.data}
            isLoading={planQuery.isLoading}
            error={planQuery.error}
          />
        ) : isLoading && !result ? (
          <GridSkeleton columns={Math.max(allColumns.length || 6, 4)} />
        ) : !result ? (
          <EmptyState
            icon={Database}
            title="Nothing has run yet"
            description="Press Run, or pick a table from the sidebar."
          />
        ) : result.error ? (
          <EmptyState
            icon={Database}
            title="No results"
            description="Fix the error above and run again."
          />
        ) : !result.returnsRows ? (
          <EmptyState
            icon={Database}
            title={`${formatCount(result.rowsAffected)} row${
              result.rowsAffected === 1 ? "" : "s"
            } affected`}
            description="This statement does not return rows."
          />
        ) : (
          <DataGrid
            columns={columns}
            rows={rows}
            primaryKey={primaryKey}
            sort={tab.sort}
            onSort={isTableTab ? (column) => toggleSort(tab.id, column) : undefined}
            onFilter={isTableTab ? handleFilter : undefined}
            onHideColumn={(column) => toggleColumn(tab.id, column)}
            onReorder={(from, to) =>
              reorderColumns(
                tab.id,
                moveColumn(
                  allColumns.map((column) => column.name),
                  from,
                  to
                )
              )
            }
            selectedRows={selectedRows}
            onSelectionChange={setSelectedRows}
            onOpenRow={(row) => setDetailRow(row)}
            changes={changes}
            emptyTitle={
              tab.filters.length || tab.search ? "No rows match these filters" : "0 rows returned"
            }
            emptyDescription={
              tab.filters.length || tab.search
                ? "Remove a filter to widen the result."
                : "The query ran successfully but matched no rows."
            }
          />
        )}
      </div>

      <RowDiffPanel
        rows={
          selectedRowObjects.length === 2
            ? [selectedRowObjects[0], selectedRowObjects[1]]
            : null
        }
        columns={allColumns}
        open={isComparing && selectedRowObjects.length === 2}
        onOpenChange={(open) => !open && setIsComparing(false)}
      />

      <RowDetailPanel
        row={detailRow}
        columns={allColumns}
        open={!!detailRow}
        onOpenChange={(open) => !open && setDetailRow(null)}
      />

      {isTableTab && onWrite && (
        <RowEditorDialog
          open={!!editorRow}
          row={editorRow}
          isNew={isInserting}
          columns={allColumns}
          table={tab.tableName!}
          schema={tab.schemaName}
          source={connection?.type ?? "sqlite"}
          primaryKey={primaryKey}
          onOpenChange={(open) => {
            if (!open) {
              setEditorRow(null);
              setIsInserting(false);
            }
          }}
          onSubmit={runWrite}
        />
      )}
    </div>
  );
}

function ColumnsMenu({
  columns,
  hidden,
  onToggle,
  onShowAll,
  disabled,
}: {
  columns: Column[];
  hidden: Set<string>;
  onToggle: (name: string) => void;
  onShowAll: () => void;
  disabled?: boolean;
}) {
  const hiddenCount = hidden.size;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 px-2 text-xs"
          disabled={disabled}
        >
          <Columns3 className="h-3.5 w-3.5" />
          <span className="hidden md:inline">
            Columns{hiddenCount ? ` (${columns.length - hiddenCount}/${columns.length})` : ""}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-auto">
        <DropdownMenuLabel className="flex items-center justify-between text-xs font-normal text-muted-foreground">
          Visible columns
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={onShowAll}
              className="text-xs text-primary hover:underline"
            >
              Show all
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.name}
            checked={!hidden.has(column.name)}
            onCheckedChange={() => onToggle(column.name)}
          >
            <span className="truncate">{column.name}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
