import { useCallback, useEffect, useMemo, useState } from "react";
import { Command as CommandIcon, Plus, X } from "lucide-react";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { client } from "@/lib/sdk/client.gen";
import { CodeArea } from "./code-area";
import DatabaseSidebar from "./DatabaseSidebar";
import { ResultView } from "./components/ResultView";
import { RequestBuilder } from "./components/RequestBuilder";
import { ResponseView } from "./components/ResponseView";
import { SocketConsole } from "./components/SocketConsole";
import {
  CommandPalette,
  buildTableCommands,
  type Command,
} from "./components/CommandPalette";
import { useConnections } from "./hooks";
import { useTabData } from "./hooks/useTabData";
import { useRequestRunner } from "./hooks/useRequestRunner";
import { useTabsStore, type DatabaseConnection, type Tab } from "./store/store";
import { useAllTables } from "./hooks/useAllTables";

function isTypingInto(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)
  );
}

export default function Playground() {
  const { tabs, activeTabId, setActiveTabId, addQueryTab, closeTab, openTableTab } =
    useTabsStore();
  const { data: connections = [] } = useConnections();
  const tablesByConnection = useAllTables(connections);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  const commands = useMemo<Command[]>(
    () => [
      ...buildTableCommands(connections, tablesByConnection, openTableTab),
      {
        id: "action:new-query",
        label: "New query",
        group: "Actions",
        icon: Plus,
        run: () => addQueryTab(activeTab?.connectionId),
      },
    ],
    [connections, tablesByConnection, openTableTab, addQueryTab, activeTab?.connectionId]
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const modified = event.metaKey || event.ctrlKey;

      if (modified && key === "k") {
        event.preventDefault();
        setIsPaletteOpen((open) => !open);
        return;
      }
      if (modified && key === "t") {
        event.preventDefault();
        addQueryTab(activeTab?.connectionId);
        return;
      }
      if (modified && key === "w" && activeTab && !activeTab.isNew) {
        event.preventDefault();
        closeTab(activeTab.id);
        return;
      }
      // "/" focuses search, but only when it is not already being typed into
      if (event.key === "/" && !modified && !isTypingInto(event.target)) {
        const search = document.querySelector<HTMLInputElement>('input[type="search"]:not([disabled])');
        if (search) {
          event.preventDefault();
          search.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab, addQueryTab, closeTab]);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <ResizablePanelGroup direction="horizontal" className="h-full w-full">
        <ResizablePanel defaultSize={20} minSize={14} maxSize={34}>
          <DatabaseSidebar />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={80} className="min-w-0">
          <div className="flex h-full min-h-0 flex-col">
            <TabStrip
              tabs={tabs}
              activeTabId={activeTabId}
              onSelect={setActiveTabId}
              onNew={() => addQueryTab(activeTab?.connectionId)}
              onClose={closeTab}
              onOpenPalette={() => setIsPaletteOpen(true)}
            />

            {activeTab && !activeTab.isNew ? (
              // only the active tab is mounted: every mounted tab used to run
              // its own queries in the background
              <TabWorkspace key={activeTab.id} tab={activeTab} />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <p className="text-sm text-muted-foreground">
                  Open a table from the sidebar, or start a new query.
                </p>
                <button
                  type="button"
                  onClick={() => addQueryTab(connections[0]?.id)}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New query
                </button>
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      <CommandPalette
        open={isPaletteOpen}
        onOpenChange={setIsPaletteOpen}
        commands={commands}
      />
    </div>
  );
}

function TabStrip({
  tabs,
  activeTabId,
  onSelect,
  onNew,
  onClose,
  onOpenPalette,
}: {
  tabs: Tab[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: (id: string) => void;
  onOpenPalette: () => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Open tabs"
      className="flex items-center gap-1 overflow-x-auto border-b px-2 py-1.5"
    >
      {tabs
        .filter((tab) => !tab.isNew)
        .map((tab) => (
          <div
            key={tab.id}
            role="tab"
            tabIndex={0}
            aria-label={tab.name}
            aria-selected={tab.id === activeTabId}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onSelect(tab.id);
            }}
            className={cn(
              "group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs",
              tab.id === activeTabId
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/50"
            )}
          >
            <span className="max-w-40 truncate">{tab.name}</span>
            <button
              type="button"
              aria-label={`Close ${tab.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
              className="rounded p-0.5 opacity-0 transition-opacity hover:bg-background group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

      <button
        type="button"
        onClick={onNew}
        title="New query (⌘/Ctrl + T)"
        aria-label="New query"
        className="ml-1 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={onOpenPalette}
        title="Command palette (Ctrl/Cmd + K)"
        aria-label="Command palette"
        className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <CommandIcon className="h-3 w-3" />
        <span className="hidden sm:inline">K</span>
      </button>
    </div>
  );
}

function TabWorkspace({ tab }: { tab: Tab }) {
  const { data: connections = [] } = useConnections();
  const connection = useMemo(
    () => connections.find((item) => item.id === tab.connectionId),
    [connections, tab.connectionId]
  );

  if (tab.type === "socket") {
    return <SocketConsole tab={tab} connection={connection} />;
  }
  if (tab.type === "request") {
    return <RequestWorkspace tab={tab} connection={connection} />;
  }
  return <QueryWorkspace tab={tab} connection={connection} />;
}

function RequestWorkspace({
  tab,
  connection,
}: {
  tab: Tab;
  connection?: DatabaseConnection;
}) {
  const { result, isSending, isSaving, send, save } = useRequestRunner(tab);

  return (
    <ResizablePanelGroup direction="vertical" className="min-h-0 flex-1">
      <ResizablePanel defaultSize={46} minSize={20} maxSize={80}>
        <RequestBuilder
          tab={tab}
          connection={connection}
          isSending={isSending}
          isSaving={isSaving}
          onSend={send}
          onSave={save}
        />
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel defaultSize={54} minSize={20} className="min-h-0">
        <ResponseView state={result} isSending={isSending} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function QueryWorkspace({
  tab,
  connection,
}: {
  tab: Tab;
  connection?: DatabaseConnection;
}) {
  const { data: connections = [] } = useConnections();

  const { result, tableColumns, totalRows, isRunning, run, refresh, tableSql } =
    useTabData(tab, connection);

  const handleRun = useCallback(
    (query: string) => {
      void run(query, {
        allowWrites: tab.allowWrites,
        applyLimits: tab.applyLimitOffset,
      });
    },
    [run, tab.allowWrites, tab.applyLimitOffset]
  );

  const handleWrite = useCallback(
    async (sql: string) => {
      await run(sql, { allowWrites: true });
      refresh();
    },
    [run, refresh]
  );

  const handleExport = useCallback(
    (format: "csv" | "json" | "ndjson", columns: string[]) => {
      if (!tab.connectionId) return;
      const entity = tab.tableName || "query";
      const params = new URLSearchParams({ format, columns: columns.join(",") });
      if (tab.schemaName) params.set("schema", tab.schemaName);

      const query = tab.type === "table" ? tableSql : result?.query ?? tab.content;
      if (query) params.set("query", query);

      const baseUrl = client.getConfig().baseUrl ?? "";
      window.open(
        `${baseUrl}/connection/${tab.connectionId}/entities/${encodeURIComponent(
          entity
        )}/export?${params.toString()}`,
        "_blank",
        "noopener"
      );
    },
    [tab, tableSql, result?.query]
  );

  return (
    <ResizablePanelGroup direction="vertical" className="min-h-0 flex-1">
      <ResizablePanel
        defaultSize={tab.type === "table" ? 18 : 30}
        minSize={8}
        maxSize={70}
      >
        <CodeArea
          tab={tab}
          connection={connection}
          connections={connections}
          onRun={handleRun}
          isRunning={isRunning}
        />
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel
        defaultSize={tab.type === "table" ? 82 : 70}
        minSize={20}
        className="min-h-0"
      >
        <ResultView
          tab={tab}
          connection={connection}
          result={result}
          tableColumns={tableColumns}
          totalRows={totalRows}
          isLoading={isRunning && !result}
          isRefreshing={isRunning}
          onRefresh={refresh}
          onExport={handleExport}
          onWrite={tab.type === "table" ? handleWrite : undefined}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
