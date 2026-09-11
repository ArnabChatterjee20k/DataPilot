import { useState } from "react";
import { ChevronRight, Loader2, Plus, Share2, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import { useCreateFlow, useDeleteFlow, useFlows } from "../hooks/useFlows";
import { useTabsStore } from "../store/store";

/**
 * Flows in the sidebar, below the connections.
 *
 * A flow crosses connections rather than belonging to one, so it cannot live
 * under any of them.
 */
export function FlowList() {
  const { data: flows = [], isLoading, error } = useFlows();
  const createFlow = useCreateFlow();
  const deleteFlow = useDeleteFlow();
  const addFlowTab = useTabsStore((state) => state.addFlowTab);
  const closeTab = useTabsStore((state) => state.closeTab);

  const [isOpen, setIsOpen] = useState(true);

  const create = async () => {
    const created = await createFlow.mutateAsync(`Flow ${flows.length + 1}`);
    if (created) addFlowTab(created.uid, created.name);
  };

  return (
    <div className="border-t pt-1">
      <div className="flex items-center gap-1 px-1 py-1">
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          aria-label="Flows"
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1 text-xs font-medium hover:bg-muted/60"
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              isOpen && "rotate-90"
            )}
          />
          <Share2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">Flows</span>
          {flows.length > 0 && (
            <span className="text-[10px] text-muted-foreground">{flows.length}</span>
          )}
        </button>
        <button
          type="button"
          onClick={create}
          disabled={createFlow.isPending}
          aria-label="New flow"
          title="New flow"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {createFlow.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {isOpen && (
        <>
          {isLoading && (
            <p className="px-2 py-1 pl-7 text-xs text-muted-foreground">Loading…</p>
          )}
          {error && (
            <p className="px-2 py-1 pl-7 text-xs text-destructive">
              {errorMessage(error, "Could not load flows")}
            </p>
          )}
          {!isLoading && !error && flows.length === 0 && (
            <p className="px-2 py-1 pl-7 text-xs text-muted-foreground">
              A flow wires a query into a request.
            </p>
          )}

          {flows.map((flow) => (
            <div
              key={flow.uid}
              className="group flex cursor-pointer items-center gap-1.5 rounded-md py-1 pl-7 pr-1 text-xs hover:bg-muted/60"
              role="button"
              tabIndex={0}
              aria-label={flow.name}
              onClick={() => addFlowTab(flow.uid, flow.name)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addFlowTab(flow.uid, flow.name);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{flow.name}</span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(`flow:${flow.uid}`);
                  deleteFlow.mutate(flow.uid);
                }}
                aria-label={`Delete ${flow.name}`}
                className="rounded p-0.5 opacity-0 hover:bg-background hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
