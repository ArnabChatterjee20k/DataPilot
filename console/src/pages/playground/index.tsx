import { useCallback, useEffect, useMemo, useState } from "react";
import { Command as CommandIcon, Globe, Plus, X } from "lucide-react";

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
import { useDialogStore } from "./store/dialogs";
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
  const {
    tabs,
    activeTabId,
    setActiveTabId,
    addQueryTab,
    addRequestTab,
    closeTab,
    openTableTab,
  } = useTabsStore();
  const { data: connections = [] } = useConnections();
  const tablesByConnection = useAllTables(connections);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  const openConnectionDialog = useDialogStore((state) => state.openConnectionDialog);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  /**
   * The connection a new query tab should start on.
   *
   * Landing on "Select a connection" with one connection in the sidebar is a
   * click that has only one possible answer.
   */
  const defaultConnectionId = useMemo(() => {
    const queryable = connections.filter((item) => item.type !== "api");
    const current = queryable.find((item) => item.id === activeTab?.connectionId);
    if (current) return current.id;

    const lastUsed = [...tabs]
      .reverse()
      .map((tab) => queryable.find((item) => item.id === tab.connectionId))
      .find(Boolean);
    return lastUsed?.id ?? queryable[0]?.id;
  }, [connections, tabs, activeTab?.connectionId]);

  const commands = useMemo<Command[]>(
    () => [
      ...buildTableCommands(connections, tablesByConnection, openTableTab),
      {
        id: "action:new-query",
        label: "New query",
        group: "Actions",
        icon: Plus,
        run: () => addQueryTab(defaultConnectionId),
      },
      {
        id: "action:new-request",
        label: "New request",
        group: "Actions",
        icon: Globe,
        // no connection: a URL you want to try once should not require
        // inventing a connection for it first
        run: () => addRequestTab(undefined),
      },
    ],
    [
      connections,
      tablesByConnection,
      openTableTab,
      addQueryTab,
      addRequestTab,
      defaultConnectionId,
    ]
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
        addQueryTab(defaultConnectionId);
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
  }, [activeTab, addQueryTab, closeTab, defaultConnectionId]);

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
              onNew={() => addQueryTab(defaultConnectionId)}
              onClose={closeTab}
              onOpenPalette={() => setIsPaletteOpen(true)}
            />

            {activeTab && !activeTab.isNew ? (
              // only the active tab is mounted: every mounted tab used to run
              // its own queries in the background
              <TabWorkspace key={activeTab.id} tab={activeTab} />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                {/* with nothing connected, "New query" is a button that can
                    only fail, so the first step is the only one offered */}
                <p className="text-sm text-muted-foreground">
                  {connections.length === 0
                    ? "Nothing is connected yet. Add a database or an API to begin."
                    : "Open a table from the sidebar, start a query, or send a request to any URL."}
                </p>
                <div className="flex items-center gap-2">
                  {connections.length === 0 && (
                    <button
                      type="button"
                      onClick={() => openConnectionDialog()}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add a connection
                    </button>
                  )}
                  {connections.length > 0 && (
                    <button
                      type="button"
                      onClick={() => addQueryTab(defaultConnectionId)}
                      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      New query
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => addRequestTab(undefined)}
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    Request any URL
                  </button>
                </div>
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
  const { data: connections = [] } = useConnections();
  const { result, isSending, isSaving, send, save } = useRequestRunner(tab);

  return (
    <ResizablePanelGroup direction="vertical" className="min-h-0 flex-1">
      <ResizablePanel defaultSize={46} minSize={20} maxSize={80}>
        <RequestBuilder
          tab={tab}
          connection={connection}
          connections={connections}
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
