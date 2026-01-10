import Tree, {
  type NestedTreeNode,
  type ExpandedNodeInfo,
} from "@/components/ui/Tree";
import {
  Plus,
  Trash2,
  Pencil,
  DatabaseIcon,
  MoreVertical,
  FolderIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { executeQuery, listConnections, deleteConnection, getTables, getSchemas } from "@/lib/sdk";
import { getTableTabId, useDatabaseStore, useTabsStore } from "./store/store";
import type { DatabaseConnection, Table } from "./store/store";
import { useEffect, useState, useMemo, useCallback } from "react";
import { ConnectionModal } from "./ConnectionModal";
import {
  getRowsQuery,
} from "@/lib/queries";

export default function DatabaseSidebar() {
  const connections = useDatabaseStore((state) => state.connections);
  const tables = useDatabaseStore((state) => state.tables);
  const schemas = useDatabaseStore((state) => state.schemas);
  const setConnections = useDatabaseStore((state) => state.setConnections);
  const setTablesForConnection = useDatabaseStore(
    (state) => state.setTablesForConnection
  );
  const setSchemasForConnections = useDatabaseStore(
    (state) => state.setSchemasForConnections
  );
  const setColumns = useDatabaseStore((state) => state.setColumns);
  const setRows = useDatabaseStore((state) => state.setRows);
  const removeConnection = useDatabaseStore((state) => state.removeConnection);
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
        // Use schema-qualified name for postgres if schemaId is present
        const query = getRowsQuery(table.name, limit, offset, table.schemaId);
        const rowsResponse = await executeQuery({
          path: {
            connection_id: database.id,
            entity_name: table.schemaId
              ? `${table.schemaId}.${table.name}`
              : table.name,
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
  const loadSchemas = async (id: string) => {
    let connection = connections.find((conn) => conn.id === id);

    if (!connection) {
      alert("Error fetching connection");
      return;
    }

    const response = await getSchemas({
      path: {
        connection_id: id,
      },
    });

    setSchemasForConnections(
      id,
      response.data?.schemas.map((schema) => ({
        id: schema.name,
        name: schema.name,
      })) || []
    );
  };

  const loadEntities = async (connectionId: string, schemaName?: string) => {
    let connection = connections.find((conn) => conn.id === connectionId);

    if (!connection) {
      alert("Error fetching connection");
      return;
    }

    const response = await getTables({
      path: {
        connection_id: connectionId,
      },
      query: schemaName ? { schema: schemaName } : undefined,
    });

    // Get existing tables for this connection
    const existingTables = tables[connectionId] || [];

    // Create new tables with schemaId if schemaName is provided
    const newTables =
      response.data?.tables.map((table) => ({
        id: table.name,
        name: table.name,
        schemaId: schemaName,
      })) || [];

    // Merge with existing tables, avoiding duplicates
    const allTables = [...existingTables];
    newTables.forEach((newTable) => {
      if (!allTables.find((t) => t.id === newTable.id)) {
        allTables.push(newTable);
      }
    });

    setTablesForConnection(connectionId, allTables);
  };

  useEffect(() => {
    loadConnections();
  }, []);

  // Convert connections and tables to the Tree nodes structure
  const treeNodes = useMemo<NestedTreeNode[]>(() => {
    return connections.map((database) => {
      const connectionSchemas = schemas[database.id] || [];
      const connectionTables = tables[database.id] || [];
      const isPostgres = database.type === "postgres";

      // For postgres: show schemas as children, then tables under schemas
      if (isPostgres && connectionSchemas.length > 0) {
        return {
          name: database.name,
          icon: DatabaseIcon,
          className:
            "group relative rounded-md px-2 py-1 transition-colors duration-150 hover:bg-muted/60 data-[active=true]:bg-muted",
          addChildrenIcon: MoreVertical,
          children: connectionSchemas.map((schema) => {
            // Filter tables for this schema
            const schemaTables = connectionTables.filter(
              (table) => table.schemaId === schema.name
            );
            return {
              name: schema.name,
              icon: FolderIcon,
              className:
                "group relative rounded-md px-2 py-1 transition-colors duration-150 hover:bg-muted/60",
              children:
                schemaTables.length > 0
                  ? schemaTables.map((table) => ({
                      name: table.name,
                      className:
                        "group relative rounded-md px-2 py-1 cursor-pointer transition-colors duration-150 hover:bg-muted/70 hover:text-foreground",
                      onClick: () => handleTableClick(table, database),
                    }))
                  : [],
            };
          }),
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
      }

      // For non-postgres: show tables directly under connection
      const directTables = connectionTables.filter((table) => !table.schemaId);
      return {
        name: database.name,
        icon: DatabaseIcon,
        className:
          "group relative rounded-md px-2 py-1 transition-colors duration-150 hover:bg-muted/60 data-[active=true]:bg-muted",
        addChildrenIcon: MoreVertical,
        children:
          directTables.length > 0
            ? directTables.map((table) => ({
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
    schemas,
    handleTableClick,
    handleEditConnection,
    handleDeleteConnection,
  ]);

  // Handle node expansion - now receives the full node object with depth
  const handleNodeExpand = (info: ExpandedNodeInfo) => {
    // Find the connection by traversing up the tree if needed
    let connection: DatabaseConnection | undefined;
    let schemaName: string | undefined;

    if (info.depth === 0) {
      // Connection node - load schemas for postgres, or tables for others
      connection = connections.find((conn) => conn.name === info.node.name);
      if (!connection) return;

      if (connection.type === "postgres") {
        loadSchemas(connection.id);
      } else {
        loadEntities(connection.id);
      }
    } else if (info.depth === 1) {
      // Schema node (for postgres) - load tables for this schema
      // Find the parent connection
      connection = connections.find((conn) => {
        const connectionSchemas = schemas[conn.id] || [];
        return connectionSchemas.some(
          (schema) => schema.name === info.node.name
        );
      });
      if (!connection) return;

      schemaName = info.node.name;
      loadEntities(connection.id, schemaName);
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
