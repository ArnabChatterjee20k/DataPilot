import { Plus, X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { emptyRow, type KeyValueRow } from "../store/store";

/**
 * Key/value rows for params, headers and form fields.
 *
 * A row can be switched off rather than deleted, so a header can be tried
 * without losing it, and there is always one blank row to type into.
 */
export function KeyValueEditor({
  rows,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  label,
  disabled,
}: {
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  label: string;
  disabled?: boolean;
}) {
  const withBlank = rows.length ? rows : [emptyRow()];

  const update = (index: number, patch: Partial<KeyValueRow>) => {
    const next = withBlank.map((row, position) =>
      position === index ? { ...row, ...patch } : row
    );
    // typing into the last row opens another one
    if (index === next.length - 1 && (next[index].key || next[index].value)) {
      next.push(emptyRow());
    }
    onChange(next);
  };

  const remove = (index: number) => {
    const next = withBlank.filter((_, position) => position !== index);
    onChange(next.length ? next : [emptyRow()]);
  };

  return (
    <div className="space-y-1" role="group" aria-label={label}>
      {withBlank.map((row, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Checkbox
            checked={row.enabled !== false}
            onCheckedChange={(checked) => update(index, { enabled: checked === true })}
            aria-label={`Enable ${row.key || `${label} row ${index + 1}`}`}
            disabled={disabled}
          />
          <input
            value={row.key}
            onChange={(event) => update(index, { key: event.target.value })}
            placeholder={keyPlaceholder}
            aria-label={`${label} key ${index + 1}`}
            disabled={disabled}
            className={cn(
              "h-7 w-2/5 min-w-0 rounded border bg-background px-2 font-mono text-xs",
              "outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            )}
          />
          <input
            value={row.value ?? ""}
            onChange={(event) => update(index, { value: event.target.value })}
            placeholder={valuePlaceholder}
            aria-label={`${label} value ${index + 1}`}
            disabled={disabled}
            className={cn(
              "h-7 min-w-0 flex-1 rounded border bg-background px-2 font-mono text-xs",
              "outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            )}
          />
          <button
            type="button"
            onClick={() => remove(index)}
            aria-label={`Remove ${label} row ${index + 1}`}
            disabled={disabled}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-40"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...withBlank, emptyRow()])}
        disabled={disabled}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        <Plus className="h-3 w-3" />
        Add row
      </button>
    </div>
  );
}
