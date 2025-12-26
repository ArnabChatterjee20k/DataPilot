import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useState } from "react";
import { CodeArea } from "./code-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import DatabaseSidebar from "./DatabaseSidebar";
import { TableView } from "./table";
import { QueryResults } from "./result";
import { X } from "lucide-react";
import { useDatabaseStore, useTabsStore } from "./store/store";
import { executeQuery } from "@/lib/sdk";
import { getQueryWithRowOffsetAndLimits } from "@/lib/queries";

export default () => {
  const {
    tabs,
    activeTabId,
    setActiveTabId,
    addNewQueryTab,
    closeTab,
    updateTabContent,
    setQueryResult,
    updateTabConnection,
    queryResults,
    updateTableFilters
  } = useTabsStore();
  const { setRows, setColumns } = useDatabaseStore();
  const [runningTabId, setRunningTabId] = useState<string | null>(null);

  const handleCloseTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    closeTab(tabId);
  };

  const handleRunQuery = async (tabId: string, query: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const connectionId = tab.connectionId;
    if (!connectionId) {
      setQueryResult(tabId, {
        columns: [],
        rows: [],
        error: "No connection available. Please create a connection first.",
      });
      return;
    }

    const entityName = tab.tableName as string;

    setRunningTabId(tabId);
    try {
      const response = await executeQuery({
        path: {
          connection_id: connectionId,
          entity_name: entityName,
        },
        query: {
          query: getQueryWithRowOffsetAndLimits(query, tab.rowsLimit, tab.rowsOffset),
        },
      });

      if (response.data) {
        updateTableFilters(tabId,{})
        setQueryResult(tabId, {
          columns: (response.data.columns as any[]) || [],
          rows: (response.data.rows as any[]) || [],
          query: response.data.query,
        });
        updateTabConnection(tabId, connectionId, entityName);
        // TODO: need to check for the tableId as we have query tabs as well
        // here type error is justified and we need to correct the structure and relation between tabs, query and table
        setColumns(
          tab.tableId,
          (response.data.columns as any[]).map((col: any, idx: number) => ({
            id: `${tab.tableId}-col-${idx}`,
            name: col.name || String(col),
            type: col.type || "unknown",
            nullable: col.nullable,
            defaultValue: col.default_value,
          }))
        );
        setRows(tab.tableId, response.data.rows);
      }
    } catch (error: any) {
      setQueryResult(tabId, {
        columns: [],
        rows: [],
        error:
          error?.response?.data?.detail?.message ||
          error?.response?.data?.detail?.[0]?.msg ||
          error?.message ||
          "Failed to execute query",
      });
    } finally {
      setRunningTabId(null);
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden">
      <ResizablePanelGroup direction="horizontal" className="w-full h-full">
        <ResizablePanel defaultSize={18} minSize={15} maxSize={30}>
          <DatabaseSidebar />
        </ResizablePanel>

        <ResizableHandle />

        <ResizablePanel defaultSize={80}>
          <Tabs
            value={activeTabId}
            onValueChange={(value) => {
              if (value !== activeTabId) {
                setActiveTabId(value);
              }
            }}
            className="h-full flex flex-col"
          >
            <div className="flex items-center border-b px-4 py-2">
              <TabsList className="bg-transparent h-auto p-0 gap-1">
                {tabs.map((tab) => (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    className="relative group px-3 py-1.5"
                    onClick={(e) => {
                      if (tab.isNew) {
                        e.preventDefault();
                        addNewQueryTab();
                      }
                    }}
                  >
                    {tab.isNew ? (
                      "+ New Query"
                    ) : (
                      <>
                        <span>{tab.name}</span>
                        {!tab.isNew && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="ml-2 h-4 w-4 p-0 opacity-0 group-hover:opacity-100"
                            onClick={(e) => handleCloseTab(tab.id, e)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <div className="flex-1 overflow-hidden">
              {tabs.map((tab) => (
                <TabsContent key={tab.id} value={tab.id} className="h-full m-0">
                  <ResizablePanelGroup direction="vertical" className="h-full">
                    <ResizablePanel defaultSize={25} minSize={0} maxSize={100}>
                      <CodeArea
                        tab={tab}
                        key={`codearea-${tab.id}`}
                        content={tab.content || ""}
                        onChange={(content) =>
                          updateTabContent(tab.id, content)
                        }
                        onRun={(query: string) => handleRunQuery(tab.id, query)}
                        isRunning={runningTabId === tab.id}
                      />
                    </ResizablePanel>

                    <ResizableHandle />
                    {/* TODO: remove the dependency from tab type so that results from aribitary can be visible as well */}
                    <ResizablePanel defaultSize={65} minSize={40}>
                      {tab.type === "query" ? (
                        <QueryResults result={queryResults[tab.id]} />
                      ) : tab.type === "table" &&
                        tab.tableName &&
                        tab.databaseName ? (
                        <TableView
                          tableName={tab.tableName}
                          tableId={tab.tableId}
                          databaseName={tab.databaseName}
                          tabId={tab.id}
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center p-6">
                          <span className="text-muted-foreground">
                            No content to display
                          </span>
                        </div>
                      )}
                    </ResizablePanel>
                  </ResizablePanelGroup>
                </TabsContent>
              ))}
            </div>
          </Tabs>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};
