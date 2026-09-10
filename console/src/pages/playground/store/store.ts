import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import type { QueryRiskModel } from "@/lib/sdk";
import type { Column } from "@/lib/columns";
import type { Filter, SourceType } from "@/lib/sql";

export interface DatabaseConnection {
  id: string;
  name: string;
  type: SourceType;
  environment: "local" | "staging" | "production";
  role: "primary" | "replica";
  readOnly: boolean;
  supportsSchemas: boolean;
}

export interface Schema {
  id: string;
  name: string;
}

export interface Table {
  id: string;
  name: string;
  schemaId?: string;
}

export type Row = Record<string, unknown>;
export type { Column };

export type SortState = { column: string; direction: "asc" | "desc" } | null;

export type TabType = "query" | "table";

export interface Tab {
  id: string;
  name: string;
  type: TabType;
  content: string;
  connectionId?: string;
  /** Table tabs only. */
  tableName?: string;
  schemaName?: string | null;
  isNew?: boolean;
  filters: Filter[];
  search: string;
  sort: SortState;
  hiddenColumns: string[];
  columnOrder: string[];
  rowsLimit: number;
  rowsOffset: number;
  /** When false the query runs exactly as typed. */
  applyLimitOffset: boolean;
  /** Explicitly opted into running writes on a read-only connection. */
  allowWrites: boolean;
}

export interface QueryResultState {
  columns: Column[];
  rows: Row[];
  query?: string;
  error?: string;
  rowCount: number;
  rowsAffected: number;
  returnsRows: boolean;
  truncated: boolean;
  executionMs: number;
  risk?: QueryRiskModel;
  ranAt: number;
}

const NEW_TAB_ID = "new";
const DEFAULT_LIMIT = 100;

export const ROWS_LIMITS = [50, 100, 250, 500];

export const getTableTabId = (connectionId: string, schema: string | null | undefined, table: string) =>
  `table:${connectionId}:${schema ?? ""}:${table}`;

function baseTab(id: string, name: string, type: TabType): Tab {
  return {
    id,
    name,
    type,
    content: "",
    filters: [],
    search: "",
    sort: null,
    hiddenColumns: [],
    columnOrder: [],
    rowsLimit: DEFAULT_LIMIT,
    rowsOffset: 0,
    applyLimitOffset: true,
    allowWrites: false,
  };
}

const newPlaceholderTab = (): Tab => ({
  ...baseTab(NEW_TAB_ID, "+ New Query", "query"),
  isNew: true,
});

interface TabStore {
  tabs: Tab[];
  activeTabId: string;
  results: Record<string, QueryResultState>;
  setActiveTabId: (id: string) => void;
  addQueryTab: (connectionId?: string) => string;
  openTableTab: (table: Table, connection: DatabaseConnection) => string;
  closeTab: (tabId: string) => void;
  updateTab: (tabId: string, patch: Partial<Tab>) => void;
  setResult: (tabId: string, result: QueryResultState | undefined) => void;
  addFilter: (tabId: string, filter: Filter) => void;
  removeFilter: (tabId: string, key: string) => void;
  clearFilters: (tabId: string) => void;
  toggleColumn: (tabId: string, column: string) => void;
  showAllColumns: (tabId: string) => void;
  toggleSort: (tabId: string, column: string) => void;
}

export const useTabsStore = create<TabStore>()(
  persist(
    (set, get) => ({
      tabs: [newPlaceholderTab()],
      activeTabId: NEW_TAB_ID,
      results: {},

      setActiveTabId: (id) => set({ activeTabId: id }),

      addQueryTab: (connectionId) => {
        const tabId = `query:${Date.now()}`;
        const existing = get().tabs.filter((tab) => tab.type === "query" && !tab.isNew);
        const tab: Tab = {
          ...baseTab(tabId, `Query ${existing.length + 1}`, "query"),
          connectionId,
        };
        set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tabId }));
        return tabId;
      },

      openTableTab: (table, connection) => {
        const tabId = getTableTabId(connection.id, table.schemaId, table.name);
        const existing = get().tabs.find((tab) => tab.id === tabId);
        if (existing) {
          set({ activeTabId: tabId });
          return tabId;
        }

        const tab: Tab = {
          ...baseTab(tabId, table.name, "table"),
          connectionId: connection.id,
          tableName: table.name,
          schemaName: table.schemaId ?? null,
        };
        set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tabId }));
        return tabId;
      },

      closeTab: (tabId) => {
        if (tabId === NEW_TAB_ID) return;
        set((state) => {
          const index = state.tabs.findIndex((tab) => tab.id === tabId);
          const tabs = state.tabs.filter((tab) => tab.id !== tabId);
          if (!tabs.some((tab) => tab.id === NEW_TAB_ID)) tabs.push(newPlaceholderTab());

          const results = { ...state.results };
          delete results[tabId];

          let activeTabId = state.activeTabId;
          if (activeTabId === tabId) {
            // step to the neighbour rather than jumping to the end
            const candidates = tabs.filter((tab) => tab.id !== NEW_TAB_ID);
            const neighbour =
              candidates[Math.min(Math.max(index - 1, 0), candidates.length - 1)];
            activeTabId = neighbour?.id ?? NEW_TAB_ID;
          }

          return { tabs, results, activeTabId };
        });
      },

      updateTab: (tabId, patch) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)),
        })),

      setResult: (tabId, result) =>
        set((state) => {
          const results = { ...state.results };
          if (result) results[tabId] = result;
          else delete results[tabId];
          return { results };
        }),

      addFilter: (tabId, filter) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => {
            if (tab.id !== tabId) return tab;
            const exists = tab.filters.some(
              (existing) =>
                existing.column === filter.column &&
                existing.operator === filter.operator &&
                existing.value === filter.value
            );
            if (exists) return tab;
            return { ...tab, filters: [...tab.filters, filter], rowsOffset: 0 };
          }),
        })),

      removeFilter: (tabId, key) =>
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId
              ? {
                  ...tab,
                  rowsOffset: 0,
                  filters: tab.filters.filter(
                    (filter) =>
                      `${filter.column}:${filter.operator}:${String(filter.value ?? "")}` !==
                      key
                  ),
                }
              : tab
          ),
        })),

      clearFilters: (tabId) =>
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, filters: [], search: "", rowsOffset: 0 } : tab
          ),
        })),

      toggleColumn: (tabId, column) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => {
            if (tab.id !== tabId) return tab;
            const hidden = new Set(tab.hiddenColumns);
            if (hidden.has(column)) hidden.delete(column);
            else hidden.add(column);
            return { ...tab, hiddenColumns: [...hidden] };
          }),
        })),

      showAllColumns: (tabId) =>
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, hiddenColumns: [] } : tab
          ),
        })),

      toggleSort: (tabId, column) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => {
            if (tab.id !== tabId) return tab;
            if (tab.sort?.column !== column) {
              return { ...tab, sort: { column, direction: "asc" }, rowsOffset: 0 };
            }
            if (tab.sort.direction === "asc") {
              return { ...tab, sort: { column, direction: "desc" }, rowsOffset: 0 };
            }
            return { ...tab, sort: null, rowsOffset: 0 };
          }),
        })),
    }),
    {
      name: "datapilot.tabs",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // results are re-fetched on open; persisting them would show stale data
      partialize: (state) => ({ tabs: state.tabs, activeTabId: state.activeTabId }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<TabStore> | undefined;
        const tabs = saved?.tabs?.length ? saved.tabs : current.tabs;
        if (!tabs.some((tab) => tab.id === NEW_TAB_ID)) tabs.push(newPlaceholderTab());
        return {
          ...current,
          tabs,
          activeTabId: tabs.some((tab) => tab.id === saved?.activeTabId)
            ? saved!.activeTabId!
            : NEW_TAB_ID,
        };
      },
    }
  )
);

export const useActiveTab = () =>
  useTabsStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId));
