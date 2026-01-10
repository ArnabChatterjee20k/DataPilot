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
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { executeQuery, getTables, getSchemas } from "@/lib/sdk";
import { getTableTabId, useDatabaseStore, useTabsStore } from "./store/store";
import type { DatabaseConnection, Table } from "./store/store";
import { useState, useMemo, useCallback } from "react";
import { ConnectionModal } from "./ConnectionModal";
import { getRowsQuery } from "@/lib/queries";
import { useConnections, useDeleteConnection } from "./hooks";

// Helper function to extract error message
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  const apiError = error as any;
  return (
    apiError?.response?.data?.detail?.message ||
    apiError?.response?.data?.detail?.[0]?.msg ||
    apiError?.message ||
    "An error occurred"
  );
}

// Error Banner Component
function ErrorBanner({
  title,
  description,
  onCancel,
}: {
  title: string;
  description: string;
  onCancel: () => void;
}) {
  return (
    <div className="mb-3 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-destructive">{title}</p>
          <p className="text-xs text-destructive/80 mt-1">{description}</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          className="h-6 w-6 p-0 text-destructive hover:text-destructive"
        >
          ×
        </Button>
      </div>
    </div>
  );
}

// Loading Banner Component
function LoadingBanner({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-3 p-3 bg-muted/50 border border-muted rounded-md">
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description && (
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DatabaseSidebar() {
  // React Query for connections (server data)
  const {
    data: connections = [],
    isLoading: isLoadingConnections,
    error: connectionsError,
    refetch: refetchConnections,
  } = useConnections();
  const deleteConnectionMutation = useDeleteConnection();

  // Error state maps
  const connectionsErrorState = connectionsError
    ? {
        title: "Failed to load connections",
        description: getErrorMessage(connectionsError),
        onCancel: () => {
          // Error will be cleared when refetch succeeds
        },
      }
    : null;

  const deleteErrorState = deleteConnectionMutation.error
    ? {
        title: "Failed to delete connection",
        description: getErrorMessage(deleteConnectionMutation.error),
        onCancel: () => deleteConnectionMutation.reset(),
      }
    : null;

  // Loading state maps
  const deleteLoadingState = deleteConnectionMutation.isPending
    ? {
        title: "Deleting connection...",
        description: "Please wait while we delete the connection",
      }
    : null;

  // Zustand for local state (tables, schemas, columns, rows)
  const tables = useDatabaseStore((state) => state.tables);
  const schemas = useDatabaseStore((state) => state.schemas);
  const setTablesForConnection = useDatabaseStore(
    (state) => state.setTablesForConnection
  );
  const setSchemasForConnections = useDatabaseStore(
    (state) => state.setSchemasForConnections
  );
  const setColumns = useDatabaseStore((state) => state.setColumns);
  const setRows = useDatabaseStore((state) => state.setRows);
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
        await deleteConnectionMutation.mutateAsync(connectionId);
        // React Query will automatically refetch connections list
      } catch (error) {
        console.error("Error deleting connection:", error);
      }
    },
    [deleteConnectionMutation]
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
                disabled={deleteConnectionMutation.isPending}
                className="
                    flex items-center
                    rounded-sm px-2 py-1.5
                    text-sm
                    text-red-500
                    transition-colors
                    hover:bg-destructive/10
                    focus:bg-destructive/10
                    disabled:opacity-50
                    disabled:cursor-not-allowed
                  "
              >
                {deleteConnectionMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 text-red-500 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4 text-red-500" />
                )}
                {deleteConnectionMutation.isPending
                  ? "Deleting..."
                  : "Delete Connection"}
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
              disabled={deleteConnectionMutation.isPending}
              className="
                  flex items-center
                  rounded-sm px-2 py-1.5
                  text-sm
                  text-red-500
                  transition-colors
                  hover:bg-destructive/10
                  focus:bg-destructive/10
                  disabled:opacity-50
                  disabled:cursor-not-allowed
                "
            >
              {deleteConnectionMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 text-red-500 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4 text-red-500" />
              )}
              {deleteConnectionMutation.isPending
                ? "Deleting..."
                : "Delete Connection"}
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
            {isLoadingConnections ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">
                  Loading connections...
                </span>
              </div>
            ) : connectionsErrorState ? (
              <div className="flex flex-col items-center justify-center py-8 text-center px-4">
                <AlertCircle className="h-8 w-8 text-destructive mb-2" />
                <p className="text-sm font-medium text-destructive mb-1">
                  {connectionsErrorState.title}
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  {connectionsErrorState.description}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => refetchConnections()}
                  disabled={isLoadingConnections}
                  className="mt-2"
                >
                  {isLoadingConnections ? (
                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                  ) : null}
                  Retry
                </Button>
              </div>
            ) : connections.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <DatabaseIcon className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  No connections found
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Click the + button to create one
                </p>
              </div>
            ) : (
              <>
                {deleteLoadingState && (
                  <LoadingBanner
                    title={deleteLoadingState.title}
                    description={deleteLoadingState.description}
                  />
                )}
                {deleteErrorState && (
                  <ErrorBanner
                    title={deleteErrorState.title}
                    description={deleteErrorState.description}
                    onCancel={deleteErrorState.onCancel}
                  />
                )}
                <Tree
                  nodes={treeNodes}
                  indent={20}
                  onExpand={handleNodeExpand}
                />
              </>
            )}
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
        onSuccess={() => {}}
        connectionId={editingConnectionId}
      />
    </>
  );
}
