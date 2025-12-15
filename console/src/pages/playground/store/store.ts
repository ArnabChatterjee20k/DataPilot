import { create } from "zustand";

export interface DatabaseConnection {
  id: string;
  name: string;
  type: string;
}

export interface Table {
  id: string;
  name: string;
}

export interface Column {
  id: string;
  name: string;
  type: string;
  nullable?: boolean;
  defaultValue?: string;
}

export type Row = Record<string,string>

export type TabType = "query" | "table";
export interface Tab {
  id: string;
  name: string;
  type: TabType;
  content?: string;
  tableName?: string;
  tableId?: string;
  databaseName?: string;
  connectionId?: string;
  entityName?: string;
  isNew?: boolean;
  filters:Record<string,string>,
  tableWindowSize?:string
  queryWindowSize?:string
}

export interface QueryResult {
  columns: string[];
  rows: Row[];
  query?: string;
  error?: string;
}

const NEW_TAB_ID = "new";

const getNewQueryTab = (): Tab => ({
  id: NEW_TAB_ID,
  name: "+ New Query",
  type: "query",
  content: "",
  isNew: true,
  filters:{}
});

const getDefaultNewQueryTab = (tabId: string): Tab => ({
  id: tabId,
  name: "Query",
  type: "query",
  content: "",
  isNew: false,
  filters:{}
});

export const getTableTabId = (tableId:string)=> `table-${tableId}`;

interface ActiveTableView {
  table: Table;
  database: DatabaseConnection;
}

interface TabStore {
  tabs: Tab[];
  activeTabId: string;
  queryResults: Record<string, QueryResult>; // { [tabId]: QueryResult }
  activeTableView: ActiveTableView | null; // Table view shown below query
  setActiveTabId: (id: string) => void;
  addNewQueryTab: () => void;
  openTableTab: (table: Table, database: DatabaseConnection) => void;
  setActiveTableView: (table: Table, database: DatabaseConnection) => void;
  clearActiveTableView: () => void;
  closeTab: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
  setQueryResult: (tabId: string, result: QueryResult) => void;
  updateTabConnection: (tabId: string, connectionId: string, entityName?: string) => void;
  updateTableFilters:(tabId: string, filters:Record<string,string>) => void;
}

export const useTabsStore = create<TabStore>((set, get) => ({
  tabs: [getNewQueryTab()],
  activeTabId: NEW_TAB_ID,
  queryResults: {},
  activeTableView: null,
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

    const newTabId = getTableTabId(table.id);
    const newTab: Tab = {
      id: newTabId,
      name: table.name,
      type: "table",
      tableName: table.name,
      tableId: table.id,
      databaseName: database.name,
      connectionId: database.id,
      filters:{}
    };
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTabId,
    }));
  },
  setActiveTableView: (table: Table, database: DatabaseConnection) => {
    set({ activeTableView: { table, database } });
  },
  clearActiveTableView: () => {
    set({ activeTableView: null });
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
  setQueryResult: (tabId: string, result: QueryResult) => {
    set((state) => ({
      queryResults: { ...state.queryResults, [tabId]: result },
    }));
  },
  updateTabConnection: (tabId: string, connectionId: string, entityName?: string) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, connectionId, entityName } : tab
      ),
    }));
  },
  updateTableFilters: (tabId: string,filters: Record<string, string>) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, filters: {...(tab.filters || {}), ...filters} }
          : tab
      ),
    }))
  },
}));

// Database Store
interface DatabaseStore {
  connections: DatabaseConnection[];
  tables: Record<string, Table[]>; // { [databaseId]: Table[] }
  columns: Record<string, Column[]>; // { [tableId]: Column[] }
  rows: Record<string, Row[]>; // { [tableId]: Row[] }
  setConnections: (connection: DatabaseConnection[]) => void;
  addConnection: (connection: DatabaseConnection) => void;
  removeConnection: (id: string) => void;
  updateConnection: (
    id: string,
    connection: Partial<DatabaseConnection>
  ) => void;
  setTables: (tables: Record<string, Table[]>) => void;
  setTablesForConnection: (connectionId: string, tables: Table[]) => void;
  addTable: (connectionId: string, table: Table) => void;
  removeTable: (connectionId: string, tableId: string) => void;
  updateTable: (connectionId: string, tableId: string, table: Partial<Table>) => void;
  getTablesForConnection: (connectionId: string) => Table[];
  setColumns: (tableId: string, columns: Column[]) => void;
  setRows: (tableId: string, rows: Row[]) => void;
  getColumns: (tableId: string) => Column[];
  getRows: (tableId: string) => Row[];
}

export const useDatabaseStore = create<DatabaseStore>((set, get) => ({
  connections: [],
  tables: {},
  columns: {},
  rows: {},
  setConnections: (connections: DatabaseConnection[]) =>
    set(() => ({
      connections: connections,
    })),
  addConnection: (connection) =>
    set((state) => ({
      connections: [...state.connections, connection],
    })),
  removeConnection: (id) =>
    set((state) => {
      const newTables = { ...state.tables };
      delete newTables[id];
      return {
        connections: state.connections.filter((conn) => conn.id !== id),
        tables: newTables,
      };
    }),
  updateConnection: (id, updates) =>
    set((state) => ({
      connections: state.connections.map((conn) =>
        conn.id === id ? { ...conn, ...updates } : conn
      ),
    })),
  setTables: (tables: Record<string, Table[]>) =>
    set(() => ({
      tables: tables,
    })),
  setTablesForConnection: (connectionId: string, tables: Table[]) =>
    set((state) => ({
      tables: { ...state.tables, [connectionId]: tables },
    })),
  addTable: (connectionId: string, table: Table) =>
    set((state) => {
      const connectionTables = state.tables[connectionId] || [];
      return {
        tables: {
          ...state.tables,
          [connectionId]: [...connectionTables, table],
        },
      };
    }),
  removeTable: (connectionId: string, tableId: string) =>
    set((state) => {
      const newColumns = { ...state.columns };
      const newRows = { ...state.rows };
      delete newColumns[tableId];
      delete newRows[tableId];
      
      const connectionTables = state.tables[connectionId] || [];
      return {
        tables: {
          ...state.tables,
          [connectionId]: connectionTables.filter((table) => table.id !== tableId),
        },
        columns: newColumns,
        rows: newRows,
      };
    }),
  updateTable: (connectionId: string, tableId: string, updates: Partial<Table>) =>
    set((state) => {
      const connectionTables = state.tables[connectionId] || [];
      return {
        tables: {
          ...state.tables,
          [connectionId]: connectionTables.map((table) =>
            table.id === tableId ? { ...table, ...updates } : table
          ),
        },
      };
    }),
  getTablesForConnection: (connectionId: string) => {
    const state = get();
    return state.tables[connectionId] || [];
  },
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
