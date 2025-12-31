import { File, Folder, Tree } from "@/components/ui/file-tree";
import { Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { executeQuery, listConnections, getConnection, deleteConnection } from "@/lib/sdk";
import { getTableTabId, useDatabaseStore, useTabsStore } from "./store/store";
import type { DatabaseConnection, Table } from "./store/store";
import { useEffect, useState } from "react";
import { ConnectionModal } from "./ConnectionModal";
import { getRowsQuery, getTablesQuery } from "@/lib/queries";


export default function DatabaseSidebar() {
  const {
    connections,
    tables,
    setConnections,
    setTablesForConnection,
    setColumns,
    setRows,
    removeConnection,
  } = useDatabaseStore();
  const { openTableTab, updateTabContent } = useTabsStore();
  const [isConnectionModalOpen, setIsConnectionModalOpen] = useState(false);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);

  const handleTableClick = async (
    e: React.MouseEvent,
    table: Table,
    database: DatabaseConnection
  ) => {
    e.stopPropagation();
    try {
      openTableTab(table, database);

      const limit = 100;
      const offset = 0;
      const query = getRowsQuery(table.name, limit, offset);
      const rowsResponse = await executeQuery({
        path: {
          connection_id: database.id,
          entity_name: table.name,
        },
        query: {
          query: query,
          limit: limit,
          offset: offset,
        },
      });

      if (rowsResponse.data) {
        // Set columns and rows from executeQuery response
        if (rowsResponse.data.columns) {
          setColumns(
            table.id,
            (rowsResponse.data.columns as any[]).map(
              (col: any, idx: number) => ({
                id: `${table.id}-col-${idx}`,
                name: col.name || String(col),
                type: col.type || "unknown",
                nullable: col.nullable,
                defaultValue: col.default_value,
              })
            )
          );
        }
        updateTabContent(
          getTableTabId(table.id),
          rowsResponse.data.query || query
        );
        if (rowsResponse.data.rows) {
          setRows(table.id, rowsResponse.data.rows as any[]);
        }
      }
    } catch (error) {
      console.error("Error fetching entity:", error);
    }
  };

  const handleNewConnection = () => {
    setEditingConnectionId(null);
    setIsConnectionModalOpen(true);
  };

  const handleEditConnection = (connectionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingConnectionId(connectionId);
    setIsConnectionModalOpen(true);
  };

  const handleDeleteConnection = async (connectionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm(`Are you sure you want to delete this connection? This action cannot be undone.`)) {
      return;
    }

    try {
      await deleteConnection({
        path: { connection_uid: connectionId },
      });
      
      // Remove from store
      removeConnection(connectionId);
      
      // Reload connections to ensure consistency
      await loadConnections();
    } catch (error) {
      console.error("Error deleting connection:", error);
      alert("Failed to delete connection. Please try again.");
    }
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
    // Try to get connection from store first, if not available fetch from API
    let connection = connections.find((conn) => conn.id === id);

    if (!connection) {
      // Fetch connection details from API if not in store
      try {
        const connectionResponse = await getConnection({
          path: { connection_uid: id },
        });
        if (connectionResponse.data) {
          connection = {
            id: connectionResponse.data.uid,
            name: connectionResponse.data.name,
            type: connectionResponse.data.source,
          };
        } else {
          return;
        }
      } catch (error) {
        console.error("Error fetching connection:", error);
        return;
      }
    }

    const query = getTablesQuery(connection.type);
    // Use a placeholder entity_name for table listing queries
    const response = await executeQuery({
      path: {
        connection_id: id,
        entity_name: "_tables", // Placeholder since we're querying for tables, not a specific table
      },
      query: {
        query: query,
      },
    });

    // Transform rows to entities structure
    const entities = {
      data: {
        entities:
          response.data?.rows.map((row: any) => ({
            name: row.name,
          })) || [],
      },
    };

    setTablesForConnection(
      id,
      entities.data?.entities.map((entity) => ({
        id: entity.name,
        name: entity.name,
      })) || []
    );
  };

  useEffect(() => {
    loadConnections();
  }, []);

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
            onExpand={(id) => loadEntities(id)}
                className="bg-background overflow-hidden rounded-md p-3"
            elements={elements}
          >
            {connections.map((database) => (
              <div key={database.id} className="group relative">
                <Folder
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
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    onClick={(e) => handleEditConnection(database.id, e)}
                    title="Edit connection"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    onClick={(e) => handleDeleteConnection(database.id, e)}
                    title="Delete connection"
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </Tree>
        </div>
      </div>
      <ConnectionModal
        open={isConnectionModalOpen}
        onOpenChange={(open) => {
          setIsConnectionModalOpen(open);
          if (!open) {
            setEditingConnectionId(null);
          }
        }}
        onSuccess={loadConnections}
        connectionId={editingConnectionId}
      />
    </>
  );
}
