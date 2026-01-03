import Tree, {
  type NestedTreeNode,
  type ExpandedNodeInfo,
} from "@/components/ui/Tree";
import { Plus, Trash2, Pencil, DatabaseIcon, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  executeQuery,
  listConnections,
  getConnection,
  deleteConnection,
} from "@/lib/sdk";
import { getTableTabId, useDatabaseStore, useTabsStore } from "./store/store";
import type { DatabaseConnection, Table } from "./store/store";
import { useEffect, useState, useMemo, useCallback } from "react";
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
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(
    null
  );

  const handleTableClick = useCallback(
    async (table: Table, database: DatabaseConnection) => {
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
    },
    [openTableTab, setColumns, updateTabContent, setRows]
  );

  const handleNewConnection = () => {
    setEditingConnectionId(null);
    setIsConnectionModalOpen(true);
  };

  const handleEditConnection = useCallback((connectionId: string) => {
    setEditingConnectionId(connectionId);
    setIsConnectionModalOpen(true);
  }, []);

  const loadConnections = useCallback(async () => {
    const currentConnections = await listConnections();
    setConnections(
      currentConnections.data?.connections.map((conn) => ({
        id: conn.uid,
        name: conn.name,
        type: conn.source,
      })) || []
    );
  }, [setConnections]);

  const handleDeleteConnection = useCallback(
    async (connectionId: string) => {
      if (
        !confirm(
          `Are you sure you want to delete this connection? This action cannot be undone.`
        )
      ) {
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
    },
    [removeConnection, loadConnections]
  );

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

  // Convert connections and tables to the Tree nodes structure
  const treeNodes = useMemo<NestedTreeNode[]>(() => {
    return connections.map((database) => {
      const databaseTables = tables[database.id] || [];

      return {
        name: database.name,
        icon: DatabaseIcon,
        className:
          "group relative rounded-md px-2 py-1 transition-colors duration-150 hover:bg-muted/60 data-[active=true]:bg-muted",
        addChildrenIcon: MoreVertical,
        children:
          databaseTables.length > 0
            ? databaseTables.map((table) => ({
                name: table.name,
                className:
                  "group relative rounded-md px-2 py-1 cursor-pointer transition-colors duration-150 hover:bg-muted/70 hover:text-foreground",
                onClick: () => handleTableClick(table, database),
              }))
            : [],
        menuActions: () => (
          <>
            <DropdownMenuItem
              onClick={() => handleEditConnection(database.id)}
              className="
                flex items-center
                rounded-sm px-2 py-1.5
                text-sm
                transition-colors
                hover:bg-muted
                focus:bg-muted
              "
            >
              <Pencil className="mr-2 h-4 w-4 text-foreground/70" />
              Edit Connection
            </DropdownMenuItem>

            <DropdownMenuItem
              onClick={() => handleNewConnection()}
              className="
                flex items-center
                rounded-sm px-2 py-1.5
                text-sm
                transition-colors
                hover:bg-muted
                focus:bg-muted
                w-6xl
              "
            >
              <Plus className="mr-2 h-4 w-4 text-foreground/70" />
              Create New Connection
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleDeleteConnection(database.id)}
              className="
                  flex items-center
                  rounded-sm px-2 py-1.5
                  text-sm
                  text-red-500
                  transition-colors
                  hover:bg-destructive/10
                  focus:bg-destructive/10
                "
            >
              <Trash2 className="mr-2 h-4 w-4 text-red-500" />
              Delete Connection
            </DropdownMenuItem>
          </>
        ),
      };
    });
  }, [
    connections,
    tables,
    handleTableClick,
    handleEditConnection,
    handleDeleteConnection,
  ]);

  // Handle node expansion - now receives the full node object with depth
  const handleNodeExpand = (info: ExpandedNodeInfo) => {
    // If it's a connection node (depth 0), load its tables
    if (info.depth === 0) {
      // Find the connection by name
      const connection = connections.find(
        (conn) => conn.name === info.node.name
      );
      if (connection) {
        loadEntities(connection.id);
      }
    }
  };

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
          <div className="bg-background overflow-hidden rounded-md p-3">
            <Tree nodes={treeNodes} indent={20} onExpand={handleNodeExpand} />
          </div>
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
