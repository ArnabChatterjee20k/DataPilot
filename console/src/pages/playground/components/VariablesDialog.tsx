import { useEffect, useState } from "react";
import { KeyRound, Loader2, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useSaveVariables, useVariables } from "../hooks/useVariables";

interface Row {
  name: string;
  value: string;
  /** A masked value that has not been touched must be saved back as-is. */
  wasSecret: boolean;
}

/**
 * The editor for a connection's `{{variables}}`.
 *
 * The API has stored and masked these since the start, but the only way to set
 * one was to call the endpoint yourself.
 */
export function VariablesDialog({
  connectionId,
  connectionName,
  open,
  onOpenChange,
}: {
  connectionId: string;
  connectionName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading, error } = useVariables(open ? connectionId : null);
  const save = useSaveVariables(connectionId);
  const [rows, setRows] = useState<Row[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !data) return;
    const secret = new Set(data.secret ?? []);
    setRows([
      ...Object.entries(data.variables ?? {}).map(([name, value]) => ({
        name,
        value: String(value ?? ""),
        wasSecret: secret.has(name),
      })),
      blank(),
    ]);
    setSaveError(null);
  }, [open, data]);

  const update = (index: number, patch: Partial<Row>) => {
    setRows((current) => {
      const next = current.map((row, position) =>
        position === index ? { ...row, ...patch } : row
      );
      if (index === next.length - 1 && (next[index].name || next[index].value)) {
        next.push(blank());
      }
      return next;
    });
  };

  const submit = async () => {
    const variables: Record<string, string> = {};
    for (const row of rows) {
      const name = row.name.trim();
      if (name) variables[name] = row.value;
    }
    try {
      setSaveError(null);
      await save.mutateAsync(variables);
      onOpenChange(false);
    } catch (problem) {
      setSaveError(errorMessage(problem, "Could not save the variables"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Variables for {connectionName}</DialogTitle>
          <DialogDescription>
            Written as <code>{"{{name}}"}</code> in a URL, header, body or socket
            path. Values that look like secrets are stored whole and shown masked.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading variables…
          </p>
        ) : error ? (
          <p className="py-6 text-xs text-destructive">
            {errorMessage(error, "Could not load the variables")}
          </p>
        ) : (
          <div className="max-h-80 space-y-1 overflow-auto" role="group" aria-label="Variables">
            {rows.map((row, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <input
                  value={row.name}
                  onChange={(event) => update(index, { name: event.target.value })}
                  placeholder="name"
                  aria-label={`Variable name ${index + 1}`}
                  className="h-8 w-44 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                />
                <div className="relative min-w-0 flex-1">
                  <input
                    value={row.value}
                    onChange={(event) =>
                      update(index, { value: event.target.value, wasSecret: false })
                    }
                    placeholder="value"
                    aria-label={`Variable value ${index + 1}`}
                    className={cn(
                      "h-8 w-full rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring",
                      row.wasSecret && "pr-7 text-muted-foreground"
                    )}
                  />
                  {row.wasSecret && (
                    <KeyRound
                      className="absolute right-2 top-2 h-3.5 w-3.5 text-amber-400"
                      aria-label="Stored secret, shown masked"
                    />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setRows((current) =>
                      current.filter((_, position) => position !== index)
                    )
                  }
                  aria-label={`Remove ${row.name || `variable ${index + 1}`}`}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRows((current) => [...current, blank()])}
              className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3 w-3" />
              Add row
            </button>
          </div>
        )}

        {saveError && <p className="text-xs text-destructive">{saveError}</p>}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={save.isPending || isLoading}>
            {save.isPending ? "Saving…" : "Save variables"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const blank = (): Row => ({ name: "", value: "", wasSecret: false });
