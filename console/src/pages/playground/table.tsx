import { useMemo, useState } from "react";
import {
  Table as TableComponent,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDatabaseStore, useTabsStore} from "./store/store";
import { Checkbox } from "@/components/ui/checkbox"
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface TableViewProps {
  tableName: string;
  tableId?: string;
  databaseName: string;
  tabId: string
}

const COLUMN_PARAM = 'columns'
const SORT_COLUMN_PARAM = 'sortCol'
const SORT_DIR_PARAM = "sortDIR"

export function TableView({
  tableName,
  tableId,
  databaseName,
  tabId
}: TableViewProps) {
  const { getColumns, getRows } = useDatabaseStore();
  const { updateTableFilters, tabs } = useTabsStore();
  const tab = tabs.filter(tab => tab.id === tabId)[0]
  const columns = tableId ? getColumns(tableId) : [];
  const rows = tableId ? getRows(tableId) : [];

  const visibleColumnsParam = tab.filters[COLUMN_PARAM]
  const visibleColumns = visibleColumnsParam ? new Set(visibleColumnsParam.split(",")) : new Set(columns.map((col) => col.name))

  const [selectedRows,setSelectedRows] = useState<Set<string|number>>(new Set())
  
  const sortColumnParam = tab.filters[SORT_COLUMN_PARAM]
  const sortDirParam = tab.filters[SORT_DIR_PARAM] as "asc" | "desc" | null

  const sortedRows = useMemo(() => {
    if (!sortColumnParam) return rows

    const sorted = [...rows].sort((a, b) => {
      const aValue = a[sortColumnParam!]
      const bValue = b[sortColumnParam!]

      // Handle nulls
      if (aValue === null || aValue === undefined) return 1
      if (bValue === null || bValue === undefined) return -1

      // Compare values
      if (aValue < bValue) return sortDirParam === "asc" ? -1 : 1
      if (aValue > bValue) return sortDirParam === "asc" ? 1 : -1
      return 0
    })

    return sorted
  }, [rows, sortColumnParam, sortDirParam])

  const handleSelectRow = (rowId:string|number) => {
    setSelectedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(rowId)) {
        newSet.delete(rowId);
      } else {
        newSet.add(rowId);
      }
      return newSet;
    })
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedRows(new Set(sortedRows.map((row) => row.id as string | number)));
    } else {
      setSelectedRows(new Set());
    }
  }

  const handleSort = (columnName:string)=>{
    let direction : 'asc' | 'desc' = 'asc';
    if(sortDirParam === 'asc' && sortColumnParam === columnName){
      direction = 'desc';
    }
    updateTableFilters(tab.id,{[SORT_COLUMN_PARAM]:columnName, [SORT_DIR_PARAM]:direction})
  }

  const handleToggleViewColumn = (columnName:string)=>{
    if(visibleColumns.has(columnName)) visibleColumns.delete(columnName)
    else visibleColumns.add(columnName)
    
    const newVisibleColumns = Array.from(visibleColumns).join(',')
    updateTableFilters(tab.id,{[COLUMN_PARAM]: newVisibleColumns})
  }

  const getSortIcon = (columnName: string) => {
    if (sortColumnParam !== columnName) return <ChevronsUpDown className="w-4 h-4 opacity-50" />
    return sortDirParam === "asc" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
  }

  const displayedColumns = columns.filter((col) => visibleColumns.has(col.name))

  return (
    <div className="h-full flex flex-col p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-1">{tableName}</h2>
        <p className="text-sm text-muted-foreground">Database: {databaseName}</p>
      </div>

      <div className="mb-4 flex items-center justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2 bg-transparent">
              Columns
              <ChevronDown className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
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
      </div>

      <div className="flex-1 border rounded-lg min-h-0 overflow-hidden">
        {displayedColumns.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>No columns selected</p>
          </div>
        ) : (
          <div className="h-full overflow-auto">
            <TableComponent className="min-w-full">
              <TableHeader className="sticky top-0 bg-background z-20 border-b">
                <TableRow>
                  <TableHead className="w-12 px-4 py-2 bg-background sticky left-0 z-30">
                    <Checkbox
                      checked={sortedRows.length > 0 && sortedRows.every(row => selectedRows.has(row.id as string | number))}
                      onCheckedChange={handleSelectAll}
                      aria-label="Select all rows"
                    />
                  </TableHead>
                  {displayedColumns.map((column) => (
                    <TableHead
                      key={column.id}
                      className="px-4 py-2 whitespace-nowrap bg-background cursor-pointer hover:bg-muted"
                      onClick={() => handleSort(column.name)}
                    >
                      <button className="flex items-center gap-2 font-semibold">
                        <span>{column.name}</span>
                        {getSortIcon(column.name)}
                      </button>
                      <span className="text-xs text-muted-foreground font-normal">
                        {column.type}
                        {column.nullable === false && <span className="ml-1 text-red-500">*</span>}
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
                          <TableCell key={column.id} className="px-4 py-2 whitespace-nowrap">
                            {row[column.name] !== null && row[column.name] !== undefined ? (
                              String(row[column.name])
                            ) : (
                              <span className="text-muted-foreground italic">null</span>
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </TableComponent>
          </div>
        )}
      </div>

      {selectedRows.size > 0 && (
        <div className="mt-4 p-3 bg-muted rounded text-sm">
          {selectedRows.size} row{selectedRows.size !== 1 ? "s" : ""} selected
        </div>
      )}
    </div>
  )
}
