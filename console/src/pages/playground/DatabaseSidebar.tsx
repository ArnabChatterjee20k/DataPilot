import { File, Folder, Tree } from "@/components/ui/file-tree";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getEntities, getRows, listConnections } from "@/lib/sdk";
import { getTableTabId, useDatabaseStore, useTabsStore } from "./store/store";
import type { DatabaseConnection, Table } from "./store/store";
import { useEffect, useState } from "react";
import { ConnectionModal } from "./ConnectionModal";

export default function DatabaseSidebar() {
  const { connections, tables, setConnections, setTablesForConnection, setColumns, setRows } =
    useDatabaseStore();
  const { openTableTab, updateTabContent } = useTabsStore();
  const [isConnectionModalOpen, setIsConnectionModalOpen] = useState(false);

  const handleTableClick = async(
    e: React.MouseEvent,
    table: Table,
    database: DatabaseConnection
  ) => {
    e.stopPropagation();
    try {
      openTableTab(table, database);
      
      const rowsResponse = await getRows({
        path: {
          connection_id: database.id,
          entity_name: table.name,
        },
      });
      
      if (rowsResponse.data) {
        // Set columns and rows from getRows response
        if (rowsResponse.data.columns) {
          setColumns(table.id, (rowsResponse.data.columns as any[]).map((col: any, idx: number) => ({
            id: `${table.id}-col-${idx}`,
            name: col.name || String(col),
            type: col.type || 'unknown',
            nullable: col.nullable,
            defaultValue: col.default_value,
          })));
        }
        updateTabContent(getTableTabId(table.id), rowsResponse.data.query)
        if (rowsResponse.data.rows) {
          setRows(table.id, rowsResponse.data.rows as any[]);
        }
      }
    } catch (error) {
      console.error('Error fetching entity:', error);
    }
  };

  const handleNewConnection = () => {
    setIsConnectionModalOpen(true);
  };

  const handleConnectionSuccess = async () => {
    // Reload connections to refresh the view
    await loadConnections();
    // Optionally, you could also clear cached tables/entities here if needed
    // setTablesForConnection can be used to clear specific connection's tables
  };

  const loadConnections = async () => {
    const currentConnections = await listConnections();
    setConnections(
      currentConnections.data?.connections.map((conn) => ({
        id: conn.uid,
        name: conn.name,
        type: conn.source,
      })) || []
    );
  };

  const loadEntities = async (id: string) => {
    const entities = await getEntities({ path: { connection_id: id } });
    setTablesForConnection(
      id,
      entities.data?.entities.map((entity) => ({
        id: entity.name,
        name: entity.name,
      })) || []
    );
  };

  useEffect(()=>{
    loadConnections()
  },[])

  const elements = connections.map((db) => ({
    id: db.id,
    name: db.name,
    isSelectable: true,
    children: (tables[db.id] || []).map((table) => ({
      id: table.id,
      name: table.name,
      isSelectable: true,
    })),
  }));

  return (
    <>
      <div className="bg-background relative flex h-full flex-col border-r">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-sm font-semibold">Connections</h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleNewConnection}
            className="h-7 w-7 p-0"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-auto">
          <Tree
            onExpand={(id) =>
              loadEntities(id)
            }
            className="bg-background overflow-hidden rounded-md p-3"
            elements={elements}
          >
            {connections.map((database) => (
              <Folder
                key={database.id}
                element={database.name}
                value={database.id}
              >
                {(tables[database.id] || []).map((table) => (
                  <File
                    key={table.id}
                    value={table.id}
                    onClick={(e) => handleTableClick(e, table, database)}
                  >
                    <p>{table.name}</p>
                  </File>
                ))}
              </Folder>
            ))}
          </Tree>
        </div>
      </div>
      <ConnectionModal
        open={isConnectionModalOpen}
        onOpenChange={setIsConnectionModalOpen}
        onSuccess={handleConnectionSuccess}
      />
    </>
  );
}
