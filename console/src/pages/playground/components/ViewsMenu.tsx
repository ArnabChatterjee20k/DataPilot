import { useState } from "react";
import { BookmarkPlus, Bookmark, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SavedView } from "../store/store";

/**
 * Named filter/sort/column presets for a table.
 *
 * Saving is only offered when there is something to save — an unfiltered,
 * unsorted default view is not worth a name.
 */
export function ViewsMenu({
  views,
  canSave,
  onSave,
  onApply,
  onDelete,
  disabled,
}: {
  views: SavedView[];
  canSave: boolean;
  onSave: (name: string) => void;
  onApply: (viewId: string) => void;
  onDelete: (viewId: string) => void;
  disabled?: boolean;
}) {
  const [name, setName] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const save = () => {
    if (!name.trim()) return;
    onSave(name);
    setName("");
    setIsOpen(false);
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 px-2 text-xs"
          disabled={disabled}
          aria-label="Saved views"
        >
          <Bookmark className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">
            Views{views.length ? ` (${views.length})` : ""}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Saved views
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {views.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            None yet. Filter or sort the table, then save it here.
          </p>
        ) : (
          views.map((view) => (
            <DropdownMenuItem
              key={view.id}
              onSelect={() => onApply(view.id)}
              className="flex items-center gap-2"
            >
              <span className="min-w-0 flex-1 truncate">{view.name}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {view.filters.length
                  ? `${view.filters.length} filter${view.filters.length === 1 ? "" : "s"}`
                  : "no filters"}
              </span>
              <button
                type="button"
                aria-label={`Delete view ${view.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  onDelete(view.id);
                }}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </DropdownMenuItem>
          ))
        )}

        {canSave && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5" onKeyDown={(event) => event.stopPropagation()}>
              <div className="flex items-center gap-1.5">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      save();
                    }
                  }}
                  placeholder="Name this view"
                  aria-label="View name"
                  className="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={save}
                  disabled={!name.trim()}
                  aria-label="Save view"
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                >
                  <BookmarkPlus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
