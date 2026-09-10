import { useEffect, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { buildInsert, buildUpdate, type SourceType } from "@/lib/sql";
import { errorMessage } from "@/lib/errors";
import type { Column, Row } from "../store/store";
import { ColumnTypeBadge } from "./primitives";

type Draft = Record<string, { value: string; isNull: boolean }>;

function toDraft(row: Row | null, columns: Column[], isNew: boolean): Draft {
  const draft: Draft = {};
  for (const column of columns) {
    const value = row?.[column.name];
    const missing = value === null || value === undefined;
    draft[column.name] = {
      value: missing ? "" : typeof value === "object" ? JSON.stringify(value) : String(value),
      isNull: isNew ? column.nullable && missing : missing,
    };
  }
  return draft;
}

/**
 * Insert or update a single row.
 *
 * NULL is an explicit checkbox rather than "leave the box empty", because an
 * empty string and NULL are different values and conflating them silently
 * writes the wrong thing.
 */
export function RowEditorDialog({
  open,
  row,
  isNew,
  columns,
  table,
  schema,
  source,
  primaryKey,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  row: Row | null;
  isNew: boolean;
  columns: Column[];
  table: string;
  schema?: string | null;
  source: SourceType;
  primaryKey: Column | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (sql: string, description: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(toDraft(row, columns, isNew));
      setError(null);
    }
  }, [open, row, columns, isNew]);

  const editable = useMemo(
    () => columns.filter((column) => !(isNew && column.primary_key && column.indexed)),
    [columns, isNew]
  );

  const buildStatement = () => {
    const values: Record<string, unknown> = {};
    for (const column of editable) {
      const entry = draft[column.name];
      if (!entry) continue;
      if (entry.isNull) {
        values[column.name] = null;
        continue;
      }
      if (isNew && entry.value === "" && column.default) continue;
      values[column.name] = entry.value;
    }

    if (isNew) {
      return {
        sql: buildInsert(table, schema, source, editable, values),
        description: "Row inserted",
      };
    }

    if (!primaryKey) throw new Error("This table has no primary key, so a row cannot be updated safely");
    const keyValue = row?.[primaryKey.name];
    if (keyValue === null || keyValue === undefined) {
      throw new Error("This row has no primary key value");
    }

    const changed: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(values)) {
      const original = row?.[name];
      const originalText =
        original === null || original === undefined
          ? null
          : typeof original === "object"
            ? JSON.stringify(original)
            : String(original);
      const nextText = value === null ? null : String(value);
      if (originalText !== nextText) changed[name] = value;
    }

    return {
      sql: buildUpdate(table, schema, source, columns, primaryKey, keyValue, changed),
      description: "Row updated",
    };
  };

  const handleSave = async () => {
    setError(null);
    let statement: { sql: string; description: string };
    try {
      statement = buildStatement();
    } catch (buildError) {
      setError(errorMessage(buildError, "Could not build the statement"));
      return;
    }

    setIsSaving(true);
    try {
      await onSubmit(statement.sql, statement.description);
      onOpenChange(false);
    } catch (saveError) {
      setError(errorMessage(saveError, "Could not save the row"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>{isNew ? "Insert row" : "Edit row"}</DialogTitle>
          <DialogDescription>
            {isNew
              ? `A new row in ${table}. Columns with a default can be left blank.`
              : `Only changed columns are written back to ${table}.`}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
          {editable.map((column) => {
            const entry = draft[column.name] ?? { value: "", isNull: false };
            return (
              <div key={column.name} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`field-${column.name}`} className="text-xs">
                    {column.name}
                    <span className="ml-2">
                      <ColumnTypeBadge column={column} />
                    </span>
                  </Label>
                  {column.nullable && (
                    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Checkbox
                        checked={entry.isNull}
                        onCheckedChange={(checked) =>
                          setDraft((current) => ({
                            ...current,
                            [column.name]: { ...entry, isNull: checked === true },
                          }))
                        }
                      />
                      NULL
                    </label>
                  )}
                </div>
                <Input
                  id={`field-${column.name}`}
                  value={entry.isNull ? "" : entry.value}
                  disabled={entry.isNull || isSaving}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      [column.name]: { value: event.target.value, isNull: false },
                    }))
                  }
                  placeholder={
                    column.default
                      ? `default: ${column.default}`
                      : column.nullable
                        ? "leave blank for empty string"
                        : "required"
                  }
                  className={cn("h-8 text-xs", column.monospace && "font-mono")}
                />
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving…" : isNew ? "Insert" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
