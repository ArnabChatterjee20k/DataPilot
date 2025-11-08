import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { CodeArea } from "./code-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import DatabaseSidebar from "@/components/app/DatabaseSidebar";
import type {
  Table,
  DatabaseConnection,
} from "@/components/app/DatabaseSidebar";
import { TableView } from "./table";
import { X } from "lucide-react";
import { useTabsStore, useDatabaseStore } from "./store";

export default () => {
  const {
    tabs,
    activeTabId,
    setActiveTabId,
    addNewQueryTab,
    openTableTab,
    closeTab,
    updateTabContent,
  } = useTabsStore();
  const { connections, tables } = useDatabaseStore();

  const handleTableDoubleClick = (
    table: Table,
    database: DatabaseConnection
  ) => {
    openTableTab(table, database);
  };

  const handleCloseTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    closeTab(tabId);
  };

  const queryTabs = tabs.filter((tab) => tab.type === "query");
  const tableTabs = tabs.filter((tab) => tab.type === "table");
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const isTableTabActive = activeTab?.type === "table";

  return (
    <div className="h-screen w-screen overflow-hidden">
      <ResizablePanelGroup
        direction="horizontal"
        className="w-full h-full"
      >
      <ResizablePanel defaultSize={18} minSize={15} maxSize={30}>
        <DatabaseSidebar
          connections={connections}
          tables={tables}
          onTableDoubleClick={handleTableDoubleClick}
          onNewConnection={() => {
            // TODO: Implement new connection dialog
            // For now, this can be handled by the store's addConnection method
            console.log("New connection");
          }}
        />
      </ResizablePanel>

      <ResizableHandle />

      <ResizablePanel defaultSize={80}>
        <ResizablePanelGroup direction="vertical">
          <ResizablePanel defaultSize={isTableTabActive ? 100 : 65} minSize={40}>
            <Tabs value={activeTabId} onValueChange={setActiveTabId} className="h-full flex flex-col">
              <div className="flex items-center border-b px-4 py-2">
                <TabsList className="bg-transparent h-auto p-0 gap-1">
                  {queryTabs.map((tab) => (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      className="relative group px-3 py-1.5"
                      onClick={(e) => {
                        if (tab.isNew) {
                          e.preventDefault();
                          addNewQueryTab();
                        } else {
                          setActiveTabId(tab.id);
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
                  {tableTabs.map((tab) => (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      className="relative group px-3 py-1.5"
                    >
                      <span>{tab.name}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-2 h-4 w-4 p-0 opacity-0 group-hover:opacity-100"
                        onClick={(e) => handleCloseTab(tab.id, e)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
              <div className="flex-1 overflow-hidden">
                {queryTabs.map((tab) => (
                  <TabsContent
                    key={tab.id}
                    value={tab.id}
                    className="h-full m-0"
                  >
                    <CodeArea
                      content={tab.content || ""}
                      onChange={(content) => updateTabContent(tab.id, content)}
                    />
                  </TabsContent>
                ))}
                {tableTabs.map((tab) => (
                  <TabsContent
                    key={tab.id}
                    value={tab.id}
                    className="h-full m-0"
                  >
                    <TableView
                      tableName={tab.tableName || ""}
                      tableId={tab.tableId}
                      databaseName={tab.databaseName || ""}
                    />
                  </TabsContent>
                ))}
              </div>
            </Tabs>
          </ResizablePanel>

          {!isTableTabActive && (
            <>
              <ResizableHandle />
              <ResizablePanel defaultSize={35} minSize={20}>
                <div className="flex h-full items-center justify-center p-6">
                  <span className="font-semibold">Results</span>
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
    </div>
  );
};