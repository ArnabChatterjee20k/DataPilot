import { File, Folder, Tree } from "@/components/ui/file-tree";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { executeQuery, listConnections, getConnection } from "@/lib/sdk";
import { getTableTabId, useDatabaseStore, useTabsStore } from "./store/store";
import type { DatabaseConnection, Table } from "./store/store";
import { useEffect, useState } from "react";
import { ConnectionModal } from "./ConnectionModal";

// Helper function to get table list query based on connection type
const getTablesQuery = (connectionType: string): string => {
  switch (connectionType) {
    case "sqlite":
      return "SELECT name FROM sqlite_master WHERE type='table'";
    case "postgres":
      return "SELECT table_name as name FROM information_schema.tables WHERE table_schema = 'public'";
    case "mysql":
      return "SELECT table_name as name FROM information_schema.tables WHERE table_schema = DATABASE()";
    default:
      return "SELECT name FROM sqlite_master WHERE type='table'";
  }
};

// Helper function to get initial rows query with pagination
const getInitialRowsQuery = (
  entityName: string,
  limit: number = 100,
  offset: number = 0
): string => {
  return `SELECT * FROM ${entityName} LIMIT ${limit} OFFSET ${offset}`;
};

export default function DatabaseSidebar() {
  const {
    connections,
    tables,
    setConnections,
    setTablesForConnection,
    setColumns,
    setRows,
  } = useDatabaseStore();
  const { openTableTab, updateTabContent } = useTabsStore();
  const [isConnectionModalOpen, setIsConnectionModalOpen] = useState(false);

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
      const query = getInitialRowsQuery(table.name, limit, offset);
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
    setIsConnectionModalOpen(true);
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
        onSuccess={loadConnections}
      />
    </>
  );
}
