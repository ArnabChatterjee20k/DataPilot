import { Columns3, Copy, Rows3, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The inspector when more than one node is selected.
 *
 * The single-node inspector cannot answer "which of these three am I editing",
 * so it does not try. What is left is the handful of things that only make
 * sense on several nodes at once.
 */
export function SelectionPanel({
  nodes,
  onArrange,
  onDuplicate,
  onDelete,
  onClose,
}: {
  nodes: string[];
  onArrange: (axis: "column" | "row") => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <aside
      className="flex h-full min-h-0 flex-col border-l bg-card"
      aria-label="Selection"
    >
      <div className="flex items-center gap-1.5 border-b px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-xs font-medium">
          {nodes.length} nodes selected
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Clear the selection"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-3 p-3">
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">Lay them out</p>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 flex-1 gap-1.5 px-2 text-xs"
              onClick={() => onArrange("column")}
            >
              <Rows3 className="h-3.5 w-3.5" />
              Column
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 flex-1 gap-1.5 px-2 text-xs"
              onClick={() => onArrange("row")}
            >
              <Columns3 className="h-3.5 w-3.5" />
              Row
            </Button>
          </div>
        </div>

        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 gap-1.5 px-2 text-xs"
            onClick={onDuplicate}
          >
            <Copy className="h-3.5 w-3.5" />
            Duplicate
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 gap-1.5 px-2 text-xs"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        </div>

        <ul className="space-y-0.5 border-t pt-2" aria-label="Selected nodes">
          {nodes.map((name, index) => (
            <li
              key={`${name}-${index}`}
              className="truncate font-mono text-[11px] text-muted-foreground"
            >
              {name}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
