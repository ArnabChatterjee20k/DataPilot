import { useEffect, useRef } from "react";
import { Loader2, PlayIcon, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { DatabaseConnection, Tab } from "./store/store";
import { useTabsStore } from "./store/store";
import { EnvironmentBadge } from "./components/primitives";

interface CodeAreaProps {
  tab: Tab;
  connection?: DatabaseConnection;
  connections: DatabaseConnection[];
  onRun: (query: string) => void;
  isRunning: boolean;
}

export function CodeArea({
  tab,
  connection,
  connections,
  onRun,
  isRunning,
}: CodeAreaProps) {
  const updateTab = useTabsStore((state) => state.updateTab);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isTableTab = tab.type === "table";
  const content = tab.content ?? "";

  useEffect(() => {
    if (!isTableTab) textareaRef.current?.focus();
  }, [tab.id, isTableTab]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      onRun(content);
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      const { selectionStart, selectionEnd } = textarea;
      const next =
        content.slice(0, selectionStart) + "  " + content.slice(selectionEnd);
      updateTab(tab.id, { content: next });
      // restore the caret after React re-renders with the new value
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = selectionStart + 2;
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <ConnectionPicker
          tab={tab}
          connection={connection}
          connections={connections}
          disabled={isTableTab}
        />

        {tab.tableName && (
          <span className="text-xs text-muted-foreground">
            {tab.schemaName ? `${tab.schemaName}.` : ""}
            <span className="font-medium text-foreground">{tab.tableName}</span>
          </span>
        )}

        {connection && (
          <EnvironmentBadge
            environment={connection.environment}
            role={connection.role}
            readOnly={connection.readOnly}
          />
        )}

        <div className="ml-auto flex items-center gap-3">
          {!isTableTab && (
            <>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox
                  checked={tab.applyLimitOffset}
                  onCheckedChange={(checked) =>
                    updateTab(tab.id, { applyLimitOffset: checked === true })
                  }
                />
                Add limit/offset
              </label>

              {connection?.readOnly && (
                <label
                  className={cn(
                    "flex items-center gap-1.5 text-xs",
                    tab.allowWrites ? "text-amber-400" : "text-muted-foreground"
                  )}
                  title="This connection is read-only. Tick to allow this tab to run writes."
                >
                  <Checkbox
                    checked={tab.allowWrites}
                    onCheckedChange={(checked) =>
                      updateTab(tab.id, { allowWrites: checked === true })
                    }
                  />
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Allow writes
                </label>
              )}
            </>
          )}

          <Button
            size="sm"
            className="h-8 gap-1.5 px-3 text-xs"
            onClick={() => onRun(content)}
            disabled={isRunning || !content.trim() || !tab.connectionId}
            title="Run (⌘/Ctrl + Enter)"
          >
            {isRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlayIcon className="h-3.5 w-3.5" />
            )}
            {isRunning ? "Running…" : "Run"}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 p-2">
        <textarea
          ref={textareaRef}
          value={content}
          readOnly={isTableTab}
          onChange={(event) => updateTab(tab.id, { content: event.target.value })}
          onKeyDown={handleKeyDown}
          placeholder="SELECT * FROM …    (⌘/Ctrl + Enter to run)"
          spellCheck={false}
          aria-label="SQL editor"
          className={cn(
            "h-full w-full resize-none rounded-md border bg-background p-3",
            "font-mono text-[13px] leading-6 text-foreground caret-primary",
            "placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring",
            isTableTab && "text-muted-foreground"
          )}
        />
      </div>
    </div>
  );
}

function ConnectionPicker({
  tab,
  connection,
  connections,
  disabled,
}: {
  tab: Tab;
  connection?: DatabaseConnection;
  connections: DatabaseConnection[];
  disabled?: boolean;
}) {
  const updateTab = useTabsStore((state) => state.updateTab);

  if (disabled) {
    return (
      <span className="text-xs font-medium">
        {connection?.name ?? "Unknown connection"}
      </span>
    );
  }

  return (
    <Select
      value={tab.connectionId ?? ""}
      onValueChange={(connectionId) => updateTab(tab.id, { connectionId })}
    >
      <SelectTrigger className="h-8 w-[200px] text-xs" aria-label="Connection">
        <SelectValue placeholder="Select a connection" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Connections</SelectLabel>
          {connections.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
