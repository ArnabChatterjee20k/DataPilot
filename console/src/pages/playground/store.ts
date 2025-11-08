import { create } from "zustand";
import type {
  DatabaseConnection,
  Table,
  Column,
  Row,
} from "@/components/app/DatabaseSidebar";

export type TabType = "query" | "table";
export interface Tab {
  id: string;
  name: string;
  type: TabType;
  content?: string;
  tableName?: string;
  tableId?: string;
  databaseName?: string;
  isNew?: boolean;
}

const NEW_TAB_ID = "new";

const getNewQueryTab = (): Tab => ({
  id: NEW_TAB_ID,
  name: "+ New Query",
  type: "query",
  content: "# ⌘ B to get AI assistant",
  isNew: true,
});

const getDefaultNewQueryTab = (tabId: string): Tab => ({
  id: tabId,
  name: "Query",
  type: "query",
  content: "# ⌘ B to get AI assistant",
  isNew: false,
});

interface TabStore {
  tabs: Tab[];
  activeTabId: string;
  setActiveTabId: (id: string) => void;
  addNewQueryTab: () => void;
  openTableTab: (table: Table, database: DatabaseConnection) => void;
  closeTab: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
}

export const useTabsStore = create<TabStore>((set, get) => ({
  tabs: [getNewQueryTab()],
  activeTabId: NEW_TAB_ID,
  setActiveTabId: (id) => set({ activeTabId: id }),
  addNewQueryTab: () => {
    const tabId = `query-${Date.now()}`;
    const newTab = getDefaultNewQueryTab(tabId);
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: tabId,
    }));
  },
  openTableTab: (table: Table, database: DatabaseConnection) => {
    const state = get();
    const existingTab = state.tabs.find(
      (tab) => tab.type === "table" && tab.tableName === table.name
    );

    if (existingTab) {
      set({ activeTabId: existingTab.id });
      return;
    }

    const newTabId = `table-${table.id}`;
    const newTab: Tab = {
      id: newTabId,
      name: table.name,
      type: "table",
      tableName: table.name,
      tableId: table.id,
      databaseName: database.name,
    };
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTabId,
    }));
  },
  closeTab: (tabId: string) => {
    if (tabId === NEW_TAB_ID) return; // Don't close the +New tab

    set((state) => {
      const newTabs = state.tabs.filter((tab) => tab.id !== tabId);
      // Ensure +New tab always exists
      const hasNewTab = newTabs.some((tab) => tab.id === NEW_TAB_ID);
      if (!hasNewTab) {
        newTabs.push(getNewQueryTab());
      }

      let newActiveTabId = state.activeTabId;
      if (state.activeTabId === tabId) {
        // If closing active tab, switch to the +New tab or the last tab
        const remainingTabs = newTabs.filter((t) => t.id !== NEW_TAB_ID);
        newActiveTabId =
          remainingTabs.length > 0
            ? remainingTabs[remainingTabs.length - 1].id
            : NEW_TAB_ID;
      }

      return {
        tabs: newTabs,
        activeTabId: newActiveTabId,
      };
    });
  },
  updateTabContent: (tabId: string, content: string) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, content } : tab
      ),
    }));
  },
}));

// Database Store
interface DatabaseStore {
  connections: DatabaseConnection[];
  tables: Table[];
  columns: Record<string, Column[]>; // { [tableId]: Column[] }
  rows: Record<string, Row[]>; // { [tableId]: Row[] }
  addConnection: (connection: DatabaseConnection) => void;
  removeConnection: (id: string) => void;
  updateConnection: (id: string, connection: Partial<DatabaseConnection>) => void;
  addTable: (table: Table) => void;
  removeTable: (id: string) => void;
  updateTable: (id: string, table: Partial<Table>) => void;
  setColumns: (tableId: string, columns: Column[]) => void;
  setRows: (tableId: string, rows: Row[]) => void;
  getColumns: (tableId: string) => Column[];
  getRows: (tableId: string) => Row[];
}

// Mock data
const mockConnections: DatabaseConnection[] = [
  {
    id: "db1",
    name: "Local SQLite DB",
    type: "SQLite",
  },
  {
    id: "db2",
    name: "Postgres Cluster",
    type: "PostgreSQL",
  },
];

const mockTables: Table[] = [
  { id: "t1", name: "users", databaseId: "db1" },
  { id: "t2", name: "posts", databaseId: "db1" },
  { id: "t3", name: "comments", databaseId: "db1" },
  { id: "t4", name: "orders", databaseId: "db2" },
  { id: "t5", name: "products", databaseId: "db2" },
];

const mockColumns: Record<string, Column[]> = {
  t1: [
    { id: "c1", name: "id", type: "INTEGER", nullable: false },
    { id: "c2", name: "name", type: "TEXT", nullable: false },
    { id: "c3", name: "email", type: "TEXT", nullable: true },
  ],
  t2: [
    { id: "c4", name: "id", type: "INTEGER", nullable: false },
    { id: "c5", name: "title", type: "TEXT", nullable: false },
    { id: "c6", name: "content", type: "TEXT", nullable: true },
  ],
};

const mockRows: Record<string, Row[]> = {
  t1: [
    { id: 1, name: "John Doe", email: "john@example.com" },
    { id: 2, name: "Jane Smith", email: "jane@example.com" },
    { id: 1, name: "John Doe", email: "john@example.com" },
    { id: 2, name: "Jane Smith", email: "jane@example.com" },

    { id: 1, name: "John Doe", email: "john@example.com" },
    { id: 2, name: "Jane Smith", email: "jane@example.com" },{ id: 1, name: "John Doe", email: "john@example.com" },
    { id: 2, name: "Jane Smith", email: "jane@example.com" },
    { id: 1, name: "John Doe", email: "john@example.com" },
    { id: 2, name: "Jane Smith", email: "jane@example.com" },
    { id: 1, name: "John Doe", email: "john@example.com" },
    { id: 2, name: "Jane Smith", email: "jane@example.com" },
    { id: 1, name: "John Doe", email: "john@example.com" },
    { id: 2, name: "Jane Smith", email: "jane@example.com" },
    { id: 1, name: "John Doe", email: "john@example.com" },
    { id: 2, name: "Jane Smith", email: "jane@example.com" },
    { id: 1, name: "John Doe", email: "john@example.com" },
    { id: 2, name: "Jane Smith", email: "jane@example.com" },
    { id: 1, name: "John Doe", email: "john@example.com" },
    { id: 2, name: "Jane Smith", email: "jane@example.com" },
    { id: 1, name: "John Doe", email: "john@example.com" },
    { id: 2, name: "Jane Smith", email: "jane@example.com" },
    { id: 1, name: "John Doe", email: "john@example.com" },
    { id: 2, name: "Jane Smith", email: "jane@example.com" },
    { id: 1, name: "John Doe", email: "john@example.com" },
    { id: 2, name: "Jane Smith", email: "jane@example.com" },
    { id: 1, name: "John Doe", email: "john@example.com" },
    { id: 2, name: "Jane Smith", email: "jane@example.com" },
    { id: 1, name: "John Doe", email: "john@example.com" },
    { id: 2, name: "Jane Smith", email: "jane@example.com" },

    { id: 1, name: "John Doe", email: "john@example.com" },
    { id: 2, name: "Jane Smith", email: "jane@example.com" },{ id: 1, name: "John Doe", email: "john@example.com" },
    { id: 2, name: "Jane Smith", email: "jane@example.com" },
    { id: 1, name: "John Doe", email: "john@example.com" },
    { id: 2, name: "Jane Smith", email: "jane@example.com" },
    { id: 1, name: "John Doe", email: "john@example.com" },
    { id: 2, name: "Jane Smith", email: "jane@example.com" },
  ],
  t2: [
    { id: 1, title: "First Post", content: "Content here" },
    { id: 2, title: "Second Post", content: "More content" },
  ],
};

export const useDatabaseStore = create<DatabaseStore>((set, get) => ({
  connections: mockConnections,
  tables: mockTables,
  columns: mockColumns,
  rows: mockRows,
  addConnection: (connection) =>
    set((state) => ({
      connections: [...state.connections, connection],
    })),
  removeConnection: (id) =>
    set((state) => ({
      connections: state.connections.filter((conn) => conn.id !== id),
      // Also remove tables associated with this database
      tables: state.tables.filter((table) => table.databaseId !== id),
    })),
  updateConnection: (id, updates) =>
    set((state) => ({
      connections: state.connections.map((conn) =>
        conn.id === id ? { ...conn, ...updates } : conn
      ),
    })),
  addTable: (table) =>
    set((state) => ({
      tables: [...state.tables, table],
    })),
  removeTable: (id) =>
    set((state) => {
      const newColumns = { ...state.columns };
      const newRows = { ...state.rows };
      delete newColumns[id];
      delete newRows[id];
      return {
        tables: state.tables.filter((table) => table.id !== id),
        columns: newColumns,
        rows: newRows,
      };
    }),
  updateTable: (id, updates) =>
    set((state) => ({
      tables: state.tables.map((table) =>
        table.id === id ? { ...table, ...updates } : table
      ),
    })),
  setColumns: (tableId, columns) =>
    set((state) => ({
      columns: { ...state.columns, [tableId]: columns },
    })),
  setRows: (tableId, rows) =>
    set((state) => ({
      rows: { ...state.rows, [tableId]: rows },
    })),
  getColumns: (tableId) => {
    const state = get();
    return state.columns[tableId] || [];
  },
  getRows: (tableId) => {
    const state = get();
    return state.rows[tableId] || [];
  },
}));
