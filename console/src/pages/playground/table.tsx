import {
  Table as TableComponent,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { useDatabaseStore } from "./store";

interface TableViewProps {
  tableName: string;
  tableId?: string;
  databaseName: string;
}

export function TableView({
  tableName,
  tableId,
  databaseName,
}: TableViewProps) {
  const { getColumns, getRows } = useDatabaseStore();

  const columns = tableId ? getColumns(tableId) : [];
  const rows = tableId ? getRows(tableId) : [];

  return (
    <div className="h-full flex flex-col p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-1">{tableName}</h2>
        <p className="text-sm text-muted-foreground">
          Database: {databaseName}
        </p>
      </div>
      <div className="flex-1 border rounded-lg min-h-0 overflow-hidden">
        {columns.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>No columns found</p>
          </div>
        ) : (
          <div className="h-full overflow-auto">
            <TableComponent className="min-w-full">
              <TableHeader className="sticky top-0 bg-background z-10 border-b">
                <TableRow>
                  {columns.map((column) => (
                    <TableHead key={column.id} className="px-4 py-2 whitespace-nowrap bg-background">
                      <div className="flex flex-col">
                        <span className="font-semibold">{column.name}</span>
                        <span className="text-xs text-muted-foreground font-normal">
                          {column.type}
                          {column.nullable === false && (
                            <span className="ml-1 text-red-500">*</span>
                          )}
                        </span>
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      No data available
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row, rowIndex) => (
                    <TableRow key={rowIndex}>
                      {columns.map((column) => (
                        <TableCell key={column.id} className="px-4 py-2 whitespace-nowrap">
                          {row[column.name] !== null &&
                          row[column.name] !== undefined
                            ? String(row[column.name])
                            : (
                                <span className="text-muted-foreground italic">
                                  null
                                </span>
                              )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </TableComponent>
          </div>
        )}
      </div>
    </div>
  );
}
