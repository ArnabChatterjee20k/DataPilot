import { AlertCircle, KeyRound, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import { useColumns } from "../hooks/useColumns";

/**
 * What a table is indexed on.
 *
 * The grid already warns that filtering an unindexed column scans the table,
 * but only one column at a time and only once you try. This is the same fact
 * asked directly, which is the question people have before writing the query
 * rather than after it.
 */
export function IndexesDialog({
  connectionId,
  entityName,
  schemaName,
  open,
  onOpenChange,
}: {
  connectionId: string;
  entityName: string;
  schemaName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const schema = useColumns(connectionId, entityName, schemaName);
  const indexes = schema.data?.indexes ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Indexes on {entityName}</DialogTitle>
          <DialogDescription>
            What the database can look up directly. Anything else is found by
            reading the table.
          </DialogDescription>
        </DialogHeader>

        {schema.isLoading && (
          <p className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Reading the table…
          </p>
        )}

        {!!schema.error && (
          <p className="flex items-start gap-2 py-4 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {errorMessage(schema.error, "Could not read the table")}
          </p>
        )}

        {!schema.isLoading && !schema.error && indexes.length === 0 && (
          <p className="py-4 text-xs text-muted-foreground">
            {/* no index is a finding, not an empty state */}
            This table has no indexes, so every filter and join on it reads
            every row.
          </p>
        )}

        {indexes.length > 0 && (
          <div className="max-h-[55vh] overflow-auto rounded-md border">
            <table className="w-full text-xs" aria-label={`Indexes on ${entityName}`}>
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Columns</th>
                  <th className="px-3 py-2 font-medium">Kind</th>
                </tr>
              </thead>
              <tbody>
                {indexes.map((index) => (
                  <tr key={index.name} className="border-b last:border-0">
                    <td className="px-3 py-1.5 font-mono">
                      <span className="flex items-center gap-1.5">
                        {index.primary && (
                          <KeyRound className="h-3 w-3 shrink-0 text-amber-400" />
                        )}
                        {index.name}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">
                      {/* order matters: an index on (a, b) does not help a
                          filter on b alone */}
                      {index.columns.join(", ")}
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={cn(
                          "rounded border px-1.5 py-0.5 text-[10px]",
                          index.primary
                            ? "border-amber-500/30 text-amber-400"
                            : index.unique
                              ? "border-sky-500/30 text-sky-400"
                              : "text-muted-foreground"
                        )}
                      >
                        {index.primary
                          ? "primary key"
                          : index.unique
                            ? "unique"
                            : "index"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
