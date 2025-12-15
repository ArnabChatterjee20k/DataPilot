import {
  Table as TableComponent,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle } from "lucide-react";
import type { QueryResult } from "./store/store";

interface QueryResultsProps {
  result?: QueryResult | null;
}

export function QueryResults({ result }: QueryResultsProps) {
  if (!result) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <span className="text-muted-foreground">No query executed yet</span>
      </div>
    );
  }

  if (result.error) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6">
        <div className="flex items-center gap-2 p-4 bg-red-500/10 text-red-400 rounded-md">
          <AlertCircle size={16} />
          <span className="text-sm font-medium">Error</span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{result.error}</p>
      </div>
    );
  }

  const columns = result.columns || [];
  const rows = result.rows || [];

  if (columns.length === 0 && rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <span className="text-muted-foreground">No results</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4">
        <h3 className="text-sm font-semibold mb-1">Query Results</h3>
        {result.query && (
          <p className="text-xs text-muted-foreground font-mono">{result.query}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          {rows.length} row{rows.length !== 1 ? "s" : ""} returned
        </p>
      </div>

      <ScrollArea className="flex-1 border rounded-lg">
        <div className="min-w-full">
          <TableComponent>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                {columns.map((col: any, idx: number) => (
                  <TableHead key={idx} className="px-4 py-2 whitespace-nowrap">
                    {typeof col === "string" ? col : col.name || String(col)}
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
                    No rows returned
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row: any, rowIdx: number) => (
                  <TableRow key={rowIdx}>
                    {columns.map((col: any, colIdx: number) => {
                      const colName = typeof col === "string" ? col : col.name || String(col);
                      const value = row[colName] ?? row[colIdx] ?? null;
                      return (
                        <TableCell key={colIdx} className="px-4 py-2 whitespace-nowrap">
                          {value !== null && value !== undefined ? (
                            String(value)
                          ) : (
                            <span className="text-muted-foreground italic">null</span>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              )}
            </TableBody>
          </TableComponent>
        </div>
      </ScrollArea>
    </div>
  );
}


