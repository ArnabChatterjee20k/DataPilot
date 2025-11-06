import { File, Folder, Tree } from "@/components/ui/file-tree";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export interface DatabaseConnection {
  id: string;
  name: string;
  type: string;
}

export interface Table {
  id: string;
  name: string;
  databaseId: string;
}

export interface Column {
  id: string;
  name: string;
  type: string;
  nullable?: boolean;
  defaultValue?: string;
}

export interface Row {
  [columnName: string]: unknown;
}

interface DatabaseSidebarProps {
  connections: DatabaseConnection[];
  tables: Table[];
  onTableDoubleClick: (table: Table, database: DatabaseConnection) => void;
  onNewConnection: () => void;
}

export default function DatabaseSidebar({
  connections,
  tables,
  onTableDoubleClick,
  onNewConnection,
}: DatabaseSidebarProps) {
  const [expandedItems] = useState<string[]>(
    connections.map((db) => db.id)
  );

  const handleTableDoubleClick = (
    e: React.MouseEvent,
    table: Table,
    database: DatabaseConnection
  ) => {
    e.stopPropagation();
    onTableDoubleClick(table, database);
  };

  // Group tables by databaseId
  const tablesByDatabase = tables?.reduce((acc, table) => {
    if (!acc[table.databaseId]) {
      acc[table.databaseId] = [];
    }
    acc[table.databaseId].push(table);
    return acc;
  }, {} as Record<string, Table[]>);

  const elements = connections.map((db) => ({
    id: db.id,
    name: db.name,
    isSelectable: true,
    children: (tablesByDatabase[db.id] || []).map((table) => ({
      id: table.id,
      name: table.name,
      isSelectable: true,
    })),
  }));

  return (
    <div className="bg-background relative flex h-full flex-col border-r">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h2 className="text-sm font-semibold">Connections</h2>
        <Button
          size="sm"
          variant="ghost"
          onClick={onNewConnection}
          className="h-7 w-7 p-0"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto">
        <Tree
          className="bg-background overflow-hidden rounded-md p-3"
          initialExpandedItems={expandedItems}
          elements={elements}
        >
          {connections.map((database) => (
            <Folder
              key={database.id}
              element={database.name}
              value={database.id}
            >
              {(tablesByDatabase[database.id] || []).map((table) => (
                <File
                  key={table.id}
                  value={table.id}
                  onDoubleClick={(e) =>
                    handleTableDoubleClick(e, table, database)
                  }
                >
                  <p>{table.name}</p>
                </File>
              ))}
            </Folder>
          ))}
        </Tree>
      </div>
    </div>
  );
}
