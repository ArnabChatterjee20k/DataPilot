import { Filter as FilterIcon, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { describeFilter, filterKey, type Filter } from "@/lib/sql";

/**
 * The filter stack. Filters read left to right and are always ANDed — stated
 * on the bar itself, so the result of stacking them is never a surprise.
 */
export function FilterBar({
  filters,
  search,
  onRemove,
  onClearAll,
  className,
}: {
  filters: Filter[];
  search?: string;
  onRemove: (key: string) => void;
  onClearAll: () => void;
  className?: string;
}) {
  const hasSearch = !!search?.trim();
  if (!filters.length && !hasSearch) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 border-b bg-muted/20 px-4 py-2",
        className
      )}
    >
      <FilterIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />

      {hasSearch && (
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs">
          <span className="text-muted-foreground">search</span>
          <span className="font-mono">{search}</span>
        </span>
      )}

      {filters.map((filter, index) => {
        const key = filterKey(filter);
        return (
          <span key={key} className="inline-flex items-center gap-1.5">
            {(index > 0 || hasSearch) && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                and
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background py-0.5 pl-2 pr-1 text-xs">
              <span className="font-mono">{describeFilter(filter)}</span>
              <button
                type="button"
                onClick={() => onRemove(key)}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`Remove filter ${describeFilter(filter)}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </span>
        );
      })}

      <Button
        size="sm"
        variant="ghost"
        onClick={onClearAll}
        className="ml-auto h-6 px-2 text-xs text-muted-foreground"
      >
        Clear all
      </Button>
    </div>
  );
}
