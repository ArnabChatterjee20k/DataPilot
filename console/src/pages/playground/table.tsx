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
  type Row,
} from "./store/store";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  SearchIcon,
  Plus,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getRowsQuery, getTableRecordsSearchQuery } from "@/lib/queries";
import { executeQuery } from "@/lib/sdk";
import SearchInput from "@/components/app/SearchInput";

interface TableViewProps {
  tableName: string;
  tableId?: string;
  databaseName: string;
  tabId: string;
  externalRows?: Row[];
  externalColumns?: Column[];
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

export function TableView({ tableId, tabId, externalRows, externalColumns }: TableViewProps) {
  const { getColumns, getRows, setRows, connections } = useDatabaseStore();
  const { updateTabContent } = useTabsStore();
  const { updateTableFilters, updateTabPagination, tabs } = useTabsStore();
  const tab = tabs.filter((tab) => tab.id === tabId)[0];

  // sorting
  const columns = externalColumns ? externalColumns : (tableId ? getColumns(tableId) : []);
  const rows = externalRows ? externalRows : (tableId ? getRows(tableId) : []);

  // Search state
  const [isSearching, setIsSearching] = useState(false);
  // Loading state for pagination
  const [isLoading, setIsLoading] = useState(false);
  // Edit dialog state
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<Row | null>(null);
  const [isNewRow, setIsNewRow] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Combined loading state for disabling controls
  const isProcessing = isSearching || isLoading || isSaving;
  
  // Check if using external data (query results)
  const isUsingExternalData = !!externalRows || !!externalColumns;

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
  const handleToggleRowLimit = async (limit: number) => {
    updateTabPagination(tab.id, limit);
    await fetchPage(0, limit);
  };

  // TODO: handle connection for the table
  const fetchPage = async (offset: number, limit?: number) => {
    setIsLoading(true);

    try {
      const rowsLimit = limit ?? tab.rowsLimit;
      updateTabPagination(tabId, rowsLimit, offset);

      const query = getRowsQuery(tab.tableName!, rowsLimit, offset);

      const rowsResponse = await executeQuery({
        path: {
          connection_id: tab.connectionId!,
          entity_name: tab.tableName!,
        },
        query: {
          query,
          limit: rowsLimit,
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
    } finally {
      setIsLoading(false);
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

  const handleEditRow = (row: Row | null, isNew: boolean = false) => {
    if (isNew) {
      // Create empty row with default values
      const newRow: Row = { id: "new" };
      columns.forEach((col) => {
        newRow[col.name] = col.defaultValue || "";
      });
      setEditingRow(newRow);
      setIsNewRow(true);
    } else {
      setEditingRow(row ? { ...row } : null);
      setIsNewRow(false);
    }
    setIsEditDialogOpen(true);
  };

  const handleSaveRow = async () => {
    if (!editingRow || !tab.tableName || !tab.connectionId || !tableId) return;

    setIsSaving(true);
    try {
      let query = "";
      
      if (isNewRow) {
        // Generate INSERT query
        const columnNames: string[] = [];
        const values: string[] = [];
        
        columns.forEach((col) => {
          const value = editingRow[col.name];
          if (value !== undefined && value !== null && value !== "") {
            columnNames.push(col.name);
            // Escape single quotes in values
            const escapedValue = String(value).replace(/'/g, "''");
            values.push(`'${escapedValue}'`);
          } else if (col.nullable !== false && !col.defaultValue) {
            // Include nullable columns with null
            columnNames.push(col.name);
            values.push("NULL");
          }
        });

        if (columnNames.length === 0) {
          throw new Error("At least one column must have a value");
        }

        query = `INSERT INTO ${tab.tableName} (${columnNames.join(", ")}) VALUES (${values.join(", ")})`;
      } else {
        // Generate UPDATE query
        const setClauses: string[] = [];
        const whereClauses: string[] = [];
        
        // Use id column for WHERE clause
        const idValue = editingRow.id;
        if (idValue === undefined || idValue === null) {
          throw new Error("Cannot update row without an ID");
        }
        
        // Find the primary key or id column
        const idColumn = columns.find((col) => col.name.toLowerCase() === "id") || columns[0];
        whereClauses.push(`${idColumn.name} = '${String(idValue).replace(/'/g, "''")}'`);

        columns.forEach((col) => {
          if (col.name === idColumn.name) return; // Skip ID column in SET clause
          
          const value = editingRow[col.name];
          if (value !== undefined) {
            if (value === null || value === "") {
              if (col.nullable !== false) {
                setClauses.push(`${col.name} = NULL`);
              }
            } else {
              const escapedValue = String(value).replace(/'/g, "''");
              setClauses.push(`${col.name} = '${escapedValue}'`);
            }
          }
        });

        if (setClauses.length === 0) {
          throw new Error("No columns to update");
        }

        query = `UPDATE ${tab.tableName} SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")}`;
      }

      // Execute the query
      await executeQuery({
        path: {
          connection_id: tab.connectionId,
          entity_name: tab.tableName,
        },
        query: {
          query,
        },
      });

      // Refresh the table
      await fetchPage(tab.rowsOffset);
      
      setIsEditDialogOpen(false);
      setEditingRow(null);
    } catch (error: any) {
      console.error("Error saving row:", error);
      alert(`Error saving row: ${error.message || "Unknown error"}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRowDoubleClick = (row: Row) => {
    if (!isUsingExternalData) {
      handleEditRow(row, false);
    }
  };

  return (
    <div className="h-full flex flex-col p-6">
      <div className="mb-4 flex items-center">
        <div className="flex justify-between w-full">
          <SearchTable
            onSearch={handleSearch}
            isSearching={isSearching}
            disabled={isProcessing || isUsingExternalData}
          />
          <div className="flex justify-center items-center gap-2">
            {!isUsingExternalData && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleEditRow(null, true)}
                disabled={isProcessing}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                New Row
              </Button>
            )}
            <RowsPaginator
              currentPage={(tab.rowsOffset + 1) % tab.rowsLimit}
              handleNextPage={handlePaginateNext}
              handlePreviousPage={handlePaginatePrevious}
              disabled={isProcessing || isUsingExternalData}
            />
            <RowsPerPageDropdown
              currentRowLimit={tab.rowsLimit}
              handleToggleRowLimit={handleToggleRowLimit}
              disabled={isProcessing || isUsingExternalData}
            />
            <ColumnDropdown
              columns={columns}
              visibleColumns={visibleColumns}
              handleToggleViewColumn={handleToggleViewColumn}
              disabled={isProcessing}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 border rounded-lg min-h-0 overflow-hidden relative">
        {displayedColumns.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>No columns selected</p>
          </div>
        ) : (
          <>
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
                        onDoubleClick={() => handleRowDoubleClick(row)}
                        style={{ cursor: isUsingExternalData ? "default" : "pointer" }}
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
            {isLoading && (
              <div className="absolute bottom-0 left-0 right-0 p-2 bg-background/80 backdrop-blur-sm border-t text-sm text-center text-muted-foreground">
                Loading...
              </div>
            )}
          </>
        )}
      </div>

      {selectedRows.size > 0 && (
        <div className="mt-4 p-3 bg-muted rounded text-sm">
          {selectedRows.size} row{selectedRows.size !== 1 ? "s" : ""} selected
        </div>
      )}

      {/* Edit Row Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isNewRow ? "Insert New Row" : "Edit Row"}</DialogTitle>
            <DialogDescription>
              {isNewRow
                ? "Fill in the values for the new row. Leave fields empty for NULL values."
                : "Modify the row values below."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {columns.map((column) => (
              <div key={column.id} className="space-y-2">
                <Label htmlFor={`edit-${column.id}`}>
                  {column.name}
                  {column.nullable === false && (
                    <span className="ml-1 text-red-500">*</span>
                  )}
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({column.type})
                  </span>
                </Label>
                <Input
                  id={`edit-${column.id}`}
                  value={
                    editingRow?.[column.name] !== undefined &&
                    editingRow?.[column.name] !== null
                      ? String(editingRow[column.name])
                      : ""
                  }
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    if (!editingRow) return;
                    const newRow = { ...editingRow };
                    newRow[column.name] = e.target.value;
                    setEditingRow(newRow);
                  }}
                  placeholder={
                    column.defaultValue
                      ? `Default: ${column.defaultValue}`
                      : column.nullable !== false
                      ? "NULL"
                      : "Required"
                  }
                  disabled={isSaving}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsEditDialogOpen(false);
                setEditingRow(null);
              }}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveRow} disabled={isSaving}>
              {isSaving ? "Saving..." : isNewRow ? "Insert" : "Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RowsPaginator({
  currentPage,
  handleNextPage,
  handlePreviousPage,
  disabled,
}: {
  currentPage: number;
  handleNextPage: () => void;
  handlePreviousPage: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={handlePreviousPage}
        size="icon"
        variant="outline"
        disabled={disabled}
      >
        <ChevronLeft />
      </Button>
      <p className="text-sm">Page {currentPage}</p>
      <Button
        onClick={handleNextPage}
        size="icon"
        variant="outline"
        disabled={disabled}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}

function ColumnDropdown({
  columns,
  visibleColumns,
  handleToggleViewColumn,
  disabled,
}: {
  columns: Column[];
  visibleColumns: Set<string>;
  handleToggleViewColumn: (column: string) => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="gap-2 bg-transparent"
          disabled={disabled}
        >
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
  disabled,
}: {
  currentRowLimit: number;
  handleToggleRowLimit: (limit: number) => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="gap-2 bg-transparent"
          disabled={disabled}
        >
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
  disabled,
}: {
  onSearch: (term: string) => void;
  isSearching: boolean;
  disabled?: boolean;
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
        disabled={disabled || isSearching}
      />
      {isSearching && (
        <div className="absolute inset-y-0 end-0 flex items-center pe-3 pointer-events-none">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-500"></div>
        </div>
      )}
    </div>
  );
}
