import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Database, Search, Table2 } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { DatabaseConnection, Table } from "../store/store";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon?: React.ComponentType<{ className?: string }>;
  run: () => void;
}

export function buildTableCommands(
  connections: DatabaseConnection[],
  tablesByConnection: Map<string, Table[]>,
  open: (table: Table, connection: DatabaseConnection) => void
): Command[] {
  const commands: Command[] = [];
  for (const connection of connections) {
    for (const table of tablesByConnection.get(connection.id) ?? []) {
      commands.push({
        id: `table:${connection.id}:${table.schemaId ?? ""}:${table.name}`,
        label: table.schemaId ? `${table.schemaId}.${table.name}` : table.name,
        hint: connection.name,
        group: "Tables",
        icon: Table2,
        run: () => open(table, connection),
      });
    }
  }
  return commands;
}

function score(command: Command, term: string): number {
  if (!term) return 1;
  const haystack = `${command.label} ${command.hint ?? ""}`.toLowerCase();
  const needle = term.toLowerCase();
  const index = haystack.indexOf(needle);
  if (index === -1) return 0;
  // an exact prefix on the label beats a match buried in the hint
  return command.label.toLowerCase().startsWith(needle) ? 3 : index === 0 ? 2 : 1;
}

/** ⌘K launcher for tables and actions. */
export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Command[];
}) {
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setTerm("");
      setActive(0);
    }
  }, [open]);

  const matches = useMemo(() => {
    return commands
      .map((command) => ({ command, rank: score(command, term) }))
      .filter((entry) => entry.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 40)
      .map((entry) => entry.command);
  }, [commands, term]);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(matches.length - 1, 0)));
  }, [matches.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const groups = useMemo(() => {
    const byGroup = new Map<string, { command: Command; index: number }[]>();
    matches.forEach((command, index) => {
      const list = byGroup.get(command.group) ?? [];
      list.push({ command, index });
      byGroup.set(command.group, list);
    });
    return [...byGroup.entries()];
  }, [matches]);

  const choose = (command: Command) => {
    onOpenChange(false);
    command.run();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>

        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((current) => Math.min(current + 1, matches.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((current) => Math.max(current - 1, 0));
              } else if (event.key === "Enter" && matches[active]) {
                event.preventDefault();
                choose(matches[active]);
              }
            }}
            placeholder="Jump to a table, or run an action…"
            aria-label="Command palette search"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div ref={listRef} className="max-h-80 overflow-auto p-1.5">
          {matches.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              Nothing matches “{term}”
            </p>
          ) : (
            groups.map(([group, entries]) => (
              <div key={group} className="mb-1">
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </p>
                {entries.map(({ command, index }) => {
                  const Icon = command.icon ?? Database;
                  return (
                    <button
                      key={command.id}
                      type="button"
                      data-index={index}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(command)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
                        index === active ? "bg-muted" : "hover:bg-muted/60"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{command.label}</span>
                      {command.hint && (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {command.hint}
                        </span>
                      )}
                      {index === active && (
                        <CornerDownLeft className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
