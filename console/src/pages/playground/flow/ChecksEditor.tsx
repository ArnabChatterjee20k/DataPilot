import { Plus, X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { FlowCheck } from "./types";

/**
 * What a node expects, written down.
 *
 * The flow already shows what happened; a check says what should have. That
 * turns a flow anyone can watch into a flow that tells you when it is wrong,
 * without becoming a test framework: nothing here can stop the run.
 */

const OPERATORS: { value: FlowCheck["op"]; label: string; lone?: boolean }[] = [
  { value: "eq", label: "is" },
  { value: "ne", label: "is not" },
  { value: "gt", label: "more than" },
  { value: "gte", label: "at least" },
  { value: "lt", label: "less than" },
  { value: "lte", label: "at most" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "matches", label: "matches" },
  { value: "count_eq", label: "has exactly" },
  { value: "count_gt", label: "has more than" },
  { value: "count_lt", label: "has fewer than" },
  { value: "exists", label: "is there", lone: true },
  { value: "missing", label: "is not there", lone: true },
  { value: "empty", label: "is empty", lone: true },
  { value: "not_empty", label: "is not empty", lone: true },
];

const LONE = new Set(OPERATORS.filter((item) => item.lone).map((item) => item.value));

export const emptyCheck = (): FlowCheck => ({
  on: "output",
  path: "",
  op: "eq",
  value: "",
  enabled: true,
});

export function ChecksEditor({
  checks,
  onChange,
  outputHint,
}: {
  checks: FlowCheck[];
  onChange: (checks: FlowCheck[]) => void;
  outputHint: string;
}) {
  const rows = checks.length ? checks : [emptyCheck()];

  const update = (index: number, patch: Partial<FlowCheck>) => {
    const next = rows.map((row, position) =>
      position === index ? { ...row, ...patch } : row
    );
    // typing into the last row opens another one, like the other editors here
    if (index === next.length - 1 && next[index].path) next.push(emptyCheck());
    onChange(next);
  };

  return (
    <div className="space-y-1.5" role="group" aria-label="Checks">
      {rows.map((row, index) => (
        <div key={index} className="space-y-1 rounded border p-1.5">
          <div className="flex items-center gap-1.5">
            <Checkbox
              checked={row.enabled}
              onCheckedChange={(checked) =>
                update(index, { enabled: checked !== false })
              }
              aria-label="Run this check"
            />
            <Select
              value={row.on}
              onValueChange={(on) => update(index, { on: on as FlowCheck["on"] })}
            >
              <SelectTrigger className="h-7 w-24 text-[11px]" aria-label="What to check">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="output">it returns</SelectItem>
                <SelectItem value="input">it receives</SelectItem>
              </SelectContent>
            </Select>
            <input
              value={row.path}
              onChange={(event) => update(index, { path: event.target.value })}
              aria-label="Path to check"
              placeholder={row.on === "input" ? "Rows.first.id" : outputHint}
              className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, position) => position !== index))}
              aria-label="Remove this check"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 pl-6">
            <Select
              value={row.op}
              onValueChange={(op) => update(index, { op: op as FlowCheck["op"] })}
            >
              <SelectTrigger className="h-7 w-32 text-[11px]" aria-label="Comparison">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPERATORS.map((operator) => (
                  <SelectItem key={operator.value} value={operator.value}>
                    {operator.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              value={row.value}
              onChange={(event) => update(index, { value: event.target.value })}
              aria-label="Expected value"
              // an operator that reads the value on its own has nothing to
              // compare against, so the box would only invite a wrong answer
              disabled={LONE.has(row.op)}
              placeholder={LONE.has(row.op) ? "nothing to compare" : "200"}
              className={cn(
                "h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring",
                LONE.has(row.op) && "opacity-50"
              )}
            />
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...rows, emptyCheck()])}
        className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <Plus className="h-3 w-3" />
        Add check
      </button>
    </div>
  );
}
