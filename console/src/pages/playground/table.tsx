import { useMemo, useState, useCallback } from "react";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getTableTabId,
  useDatabaseStore,
  useTabsStore,
  type Column,
} from "./store/store";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  SearchIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { getRowsQuery, getTableRecordsSearchQuery } from "@/lib/queries";
import { executeQuery } from "@/lib/sdk";
import SearchInput from "@/components/app/SearchInput";

interface TableViewProps {
  tableName: string;
  tableId?: string;
  databaseName: string;
  tabId: string;
}

const COLUMN_PARAM = "columns";
const SORT_COLUMN_PARAM = "sortCol";
const SORT_DIR_PARAM = "sortDIR";
// -1 means no limits
const ROWS_LIMITS = [100, 200, 300, -1];

// Hack: Shadcn doesn implement scrolling on the outer div(https://github.com/shadcn-ui/ui/issues/1151)
// so it is solves that
function StickyHeaderTableContainer(props: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full h-full overflow-auto"
    >
      <table
        data-slot="table"
        className="w-full caption-bottom text-sm"
        {...props}
      />
    </div>
  );
}

export function TableView({ tableId, tabId }: TableViewProps) {
  const { getColumns, getRows, setRows, connections } = useDatabaseStore();
  const { updateTabContent } = useTabsStore();
  const { updateTableFilters, updateTabPagination, tabs } = useTabsStore();
  const tab = tabs.filter((tab) => tab.id === tabId)[0];

  // sorting
  const columns = tableId ? getColumns(tableId) : [];
  const rows = tableId ? getRows(tableId) : [];

  // Search state
  const [isSearching, setIsSearching] = useState(false);

  // Get connection type for search query
  const connection = connections.find((conn) => conn.id === tab.connectionId);
  const connectionType = connection?.type || "sqlite";

  const visibleColumnsParam = tab.filters[COLUMN_PARAM];
  const visibleColumns = visibleColumnsParam
    ? new Set(visibleColumnsParam.split(","))
    : new Set(columns.map((col) => col.name));

  const [selectedRows, setSelectedRows] = useState<Set<string | number>>(
    new Set()
  );

  const sortColumnParam = tab.filters[SORT_COLUMN_PARAM];
  const sortDirParam = tab.filters[SORT_DIR_PARAM] as "asc" | "desc" | null;

  const sortedRows = useMemo(() => {
    if (!sortColumnParam) return rows;

    const sorted = [...rows].sort((a, b) => {
      const aValue = a[sortColumnParam!];
      const bValue = b[sortColumnParam!];

      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;

      // Compare values
      if (aValue < bValue) return sortDirParam === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDirParam === "asc" ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [rows, sortColumnParam, sortDirParam]);

  const handleSelectRow = (rowId: string | number) => {
    setSelectedRows((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(rowId)) {
        newSet.delete(rowId);
      } else {
        newSet.add(rowId);
      }
      return newSet;
    });
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedRows(
        new Set(sortedRows.map((row) => row.id as string | number))
      );
    } else {
      setSelectedRows(new Set());
    }
  };

  const handleSort = (columnName: string) => {
    let direction: "asc" | "desc" = "asc";
    if (sortDirParam === "asc" && sortColumnParam === columnName) {
      direction = "desc";
    }
    updateTableFilters(tab.id, {
      [SORT_COLUMN_PARAM]: columnName,
      [SORT_DIR_PARAM]: direction,
    });
  };

  const handleToggleViewColumn = (columnName: string) => {
    if (visibleColumns.has(columnName)) visibleColumns.delete(columnName);
    else visibleColumns.add(columnName);

    const newVisibleColumns = Array.from(visibleColumns).join(",");
    updateTableFilters(tab.id, { [COLUMN_PARAM]: newVisibleColumns });
  };

  const getSortIcon = (columnName: string) => {
    if (sortColumnParam !== columnName)
      return <ChevronsUpDown className="w-4 h-4 opacity-50" />;
    return sortDirParam === "asc" ? (
      <ChevronUp className="w-4 h-4" />
    ) : (
      <ChevronDown className="w-4 h-4" />
    );
  };

  const displayedColumns = columns.filter((col) =>
    visibleColumns.has(col.name)
  );

  // pagination
  const handleToggleRowLimit = (limit: number) => {
    updateTabPagination(tab.id, limit);
  };

  // TODO: handle connection for the table
  const fetchPage = async (offset: number) => {
    updateTabPagination(tabId, tab.rowsLimit, offset);

    const query = getRowsQuery(tab.tableName!, tab.rowsLimit, offset);

    const rowsResponse = await executeQuery({
      path: {
        connection_id: tab.connectionId!,
        entity_name: tab.tableName!,
      },
      query: {
        query,
        limit: tab.rowsLimit,
        offset,
      },
    });

    if (!rowsResponse.data) return;

    updateTabContent(
      getTableTabId(tab.tableId!),
      rowsResponse.data.query || query
    );

    if (rowsResponse.data.rows) {
      setRows(tab.tableId!, rowsResponse.data.rows as any[]);
    }
  };

  const handlePaginateNext = async () => {
    const nextOffset = tab.rowsOffset + tab.rowsLimit;
    await fetchPage(nextOffset);
  };

  const handlePaginatePrevious = async () => {
    if (tab.rowsOffset === 0) return;

    const prevOffset = Math.max(0, tab.rowsOffset - tab.rowsLimit);
    await fetchPage(prevOffset);
  };

  // Search functionality
  const handleSearch = useCallback(
    async (search: string) => {
      if (!tableId || !tab.tableName || !tab.connectionId) return;

      setIsSearching(true);

      // Reset filters before searching
      updateTableFilters(tab.id, {});
      updateTabPagination(tab.id, 100, 0);

      try {
        if (!search.trim()) {
          // If search is empty, fetch normal rows
          await fetchPage(0);
          return;
        }

        // Get all column names for search
        const columnNames = columns.map((col) => col.name);

        if (columnNames.length === 0) {
          setIsSearching(false);
          return;
        }

        const searchQuery = getTableRecordsSearchQuery(
          connectionType,
          tab.tableName,
          search.trim(),
          columnNames,
          100
        );

        if (!searchQuery) {
          setIsSearching(false);
          return;
        }

        const rowsResponse = await executeQuery({
          path: {
            connection_id: tab.connectionId,
            entity_name: tab.tableName,
          },
          query: {
            query: searchQuery,
            limit: 100,
            offset: 0,
          },
        });

        if (!rowsResponse.data) {
          setIsSearching(false);
          return;
        }

        updateTabContent(
          getTableTabId(tab.tableId!),
          rowsResponse.data.query || searchQuery
        );

        if (rowsResponse.data.rows) {
          setRows(tab.tableId!, rowsResponse.data.rows as any[]);
        }
      } catch (error) {
        console.error("Error executing search:", error);
      } finally {
        setIsSearching(false);
      }
    },
    [
      tableId,
      tab,
      columns,
      connectionType,
      setRows,
      updateTableFilters,
      updateTabContent,
      updateTabPagination,
      fetchPage,
    ]
  );

  return (
    <div className="h-full flex flex-col p-6">
      <div className="mb-4 flex items-center">
        {/* table search */}
        <div className="flex justify-between w-full">
          <SearchTable onSearch={handleSearch} isSearching={isSearching} />
          <div className="flex justify-center gap-2">
            <RowsPaginator
              currentPage={(tab.rowsOffset + 1) % tab.rowsLimit}
              handleNextPage={handlePaginateNext}
              handlePreviousPage={handlePaginatePrevious}
            />
            <RowsPerPageDropdown
              currentRowLimit={tab.rowsLimit}
              handleToggleRowLimit={handleToggleRowLimit}
            />
            <ColumnDropdown
              columns={columns}
              visibleColumns={visibleColumns}
              handleToggleViewColumn={handleToggleViewColumn}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 border rounded-lg min-h-0 overflow-hidden">
        {displayedColumns.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>No columns selected</p>
          </div>
        ) : (
          <StickyHeaderTableContainer className="w-full caption-bottom text-sm min-w-full">
            <TableHeader className="sticky top-0 z-30 bg-background">
              <TableRow>
                <TableHead className="sticky top-0 w-12 px-4 py-2 bg-background z-30">
                  <Checkbox
                    checked={
                      sortedRows.length > 0 &&
                      sortedRows.every((row) =>
                        selectedRows.has(row.id as string | number)
                      )
                    }
                    onCheckedChange={handleSelectAll}
                    aria-label="Select all rows"
                  />
                </TableHead>
                {displayedColumns.map((column) => (
                  <TableHead
                    key={column.id}
                    className="sticky top-0 px-4 py-2 whitespace-nowrap bg-background z-30 cursor-pointer hover:bg-muted"
                    onClick={() => handleSort(column.name)}
                  >
                    <button className="flex items-center gap-2 font-semibold">
                      <span>{column.name}</span>
                      {getSortIcon(column.name)}
                    </button>
                    <span className="text-xs text-muted-foreground font-normal">
                      {column.type}
                      {column.nullable === false && (
                        <span className="ml-1 text-red-500">*</span>
                      )}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={displayedColumns.length + 1}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    No data available
                  </TableCell>
                </TableRow>
              ) : (
                sortedRows.map((row, index) => {
                  const rowId = row.id as string | number;
                  return (
                    <TableRow
                      key={rowId ?? index}
                      className={selectedRows.has(rowId) ? "bg-muted" : ""}
                    >
                      <TableCell className="px-4 py-2 w-12">
                        <Checkbox
                          checked={selectedRows.has(rowId)}
                          onCheckedChange={() => handleSelectRow(rowId)}
                          aria-label={`Select row ${index + 1}`}
                        />
                      </TableCell>
                      {displayedColumns.map((column) => (
                        <TableCell
                          key={column.id}
                          className="px-4 py-2 whitespace-nowrap"
                        >
                          {row[column.name] !== null &&
                          row[column.name] !== undefined ? (
                            String(row[column.name])
                          ) : (
                            <span className="text-muted-foreground italic">
                              null
                            </span>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </StickyHeaderTableContainer>
        )}
      </div>

      {selectedRows.size > 0 && (
        <div className="mt-4 p-3 bg-muted rounded text-sm">
          {selectedRows.size} row{selectedRows.size !== 1 ? "s" : ""} selected
        </div>
      )}
    </div>
  );
}

function RowsPaginator({
  currentPage,
  handleNextPage,
  handlePreviousPage,
}: {
  currentPage: number;
  handleNextPage: () => void;
  handlePreviousPage: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button onClick={handlePreviousPage} size="icon" variant="outline">
        <ChevronLeft />
      </Button>
      <p className="text-sm">Page {currentPage}</p>
      <Button onClick={handleNextPage} size="icon" variant="outline">
        <ChevronRight />
      </Button>
    </div>
  );
}

function ColumnDropdown({
  columns,
  visibleColumns,
  handleToggleViewColumn,
}: {
  columns: Column[];
  visibleColumns: Set<string>;
  handleToggleViewColumn: (column: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2 bg-transparent">
          Columns
          <ChevronDown className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Columns visible</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={visibleColumns.has(column.name)}
            onCheckedChange={() => handleToggleViewColumn(column.name)}
          >
            {column.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RowsPerPageDropdown({
  currentRowLimit,
  handleToggleRowLimit,
}: {
  currentRowLimit: number;
  handleToggleRowLimit: (limit: number) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2 bg-transparent">
          {currentRowLimit === -1 ? "No limits" : currentRowLimit}
          <ChevronDown className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Rows per page </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ROWS_LIMITS.map((row) => (
          <DropdownMenuCheckboxItem
            key={row}
            checked={row === currentRowLimit}
            onCheckedChange={() => handleToggleRowLimit(row)}
          >
            {row === -1 ? "No limits" : row}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SearchTable({
  onSearch,
  isSearching,
}: {
  onSearch: (term: string) => void;
  isSearching: boolean;
}) {
  return (
    <div className="relative w-full max-w-xs">
      <div className="absolute inset-y-0 start-0 flex items-center ps-3 pointer-events-none">
        <SearchIcon size={16} className="text-gray-500" />
      </div>
      <SearchInput
        id="simple-search"
        className="px-3 py-2.5 bg-neutral-secondary-medium border border-default-medium rounded-lg ps-9 text-heading text-sm focus:ring-brand focus:border-brand block w-full placeholder:text-body"
        placeholder="Search in table..."
        onSearch={onSearch}
        disabled={isSearching}
      />
      {isSearching && (
        <div className="absolute inset-y-0 end-0 flex items-center pe-3 pointer-events-none">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-500"></div>
        </div>
      )}
    </div>
  );
}
