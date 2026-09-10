import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import type {
  AuthModel,
  KeyValueModel,
  QueryRiskModel,
  RequestResultModel,
  RequestSpecModel,
} from "@/lib/sdk";
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

export type TabType = "query" | "table" | "request" | "socket";

export type KeyValueRow = KeyValueModel;
export type HttpMethod = NonNullable<RequestSpecModel["method"]>;
export type BodyType = NonNullable<RequestSpecModel["body_type"]>;

/** The request a request tab is editing. Saved requests store the same shape. */
export interface RequestDraft {
  name: string;
  method: HttpMethod;
  path: string;
  params: KeyValueRow[];
  headers: KeyValueRow[];
  body_type: BodyType;
  body: string;
  auth: AuthModel;
}

export const emptyRow = (): KeyValueRow => ({ key: "", value: "", enabled: true });

export const newRequestDraft = (): RequestDraft => ({
  name: "Untitled request",
  method: "GET",
  path: "",
  params: [emptyRow()],
  headers: [emptyRow()],
  body_type: "none",
  body: "",
  auth: { type: "none" },
});

export interface SocketMessage {
  id: string;
  direction: "sent" | "received" | "system";
  text: string;
  at: number;
}

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
  /** Request tabs only. */
  request?: RequestDraft;
  /** Set when the tab is editing a request that has been saved. */
  requestId?: string;
  /** Socket tabs only. */
  socketPath?: string;
}

/**
 * A named snapshot of how a table is being looked at.
 *
 * Keyed by table rather than by tab, so a view saved in one tab is offered the
 * next time the same table is opened anywhere.
 */
export interface SavedView {
  id: string;
  name: string;
  tableKey: string;
  filters: Filter[];
  search: string;
  sort: SortState;
  hiddenColumns: string[];
  columnOrder: string[];
  rowsLimit: number;
  createdAt: number;
}

export const tableKeyOf = (
  connectionId: string | undefined,
  schema: string | null | undefined,
  table: string | undefined
) => `${connectionId ?? ""}:${schema ?? ""}:${table ?? ""}`;

export interface RequestResultState {
  result?: RequestResultModel;
  error?: string;
  ranAt: number;
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
  requestResults: Record<string, RequestResultState>;
  socketLogs: Record<string, SocketMessage[]>;
  views: SavedView[];
  setActiveTabId: (id: string) => void;
  addQueryTab: (connectionId?: string) => string;
  addRequestTab: (
    connectionId: string,
    request?: Partial<RequestDraft>,
    requestId?: string
  ) => string;
  addSocketTab: (connectionId: string) => string;
  updateRequest: (tabId: string, patch: Partial<RequestDraft>) => void;
  setRequestResult: (tabId: string, result: RequestResultState | undefined) => void;
  appendSocketMessage: (tabId: string, message: SocketMessage) => void;
  clearSocketLog: (tabId: string) => void;
  openTableTab: (table: Table, connection: DatabaseConnection) => string;
  closeTab: (tabId: string) => void;
  updateTab: (tabId: string, patch: Partial<Tab>) => void;
  setResult: (tabId: string, result: QueryResultState | undefined) => void;
  addFilter: (tabId: string, filter: Filter) => void;
  removeFilter: (tabId: string, key: string) => void;
  clearFilters: (tabId: string) => void;
  toggleColumn: (tabId: string, column: string) => void;
  showAllColumns: (tabId: string) => void;
  reorderColumns: (tabId: string, order: string[]) => void;
  toggleSort: (tabId: string, column: string) => void;
  saveView: (tabId: string, name: string) => void;
  applyView: (tabId: string, viewId: string) => void;
  deleteView: (viewId: string) => void;
  viewsFor: (tableKey: string) => SavedView[];
}

export const useTabsStore = create<TabStore>()(
  persist(
    (set, get) => ({
      tabs: [newPlaceholderTab()],
      activeTabId: NEW_TAB_ID,
      results: {},
      requestResults: {},
      socketLogs: {},
      views: [],

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

      addRequestTab: (connectionId, request, requestId) => {
        const tabId = requestId ? `request:${requestId}` : `request:${Date.now()}`;
        const existing = get().tabs.find((tab) => tab.id === tabId);
        if (existing) {
          set({ activeTabId: tabId });
          return tabId;
        }

        const draft: RequestDraft = { ...newRequestDraft(), ...request };
        const tab: Tab = {
          ...baseTab(tabId, draft.name, "request"),
          connectionId,
          request: draft,
          requestId,
        };
        set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tabId }));
        return tabId;
      },

      addSocketTab: (connectionId) => {
        const tabId = `socket:${connectionId}`;
        const existing = get().tabs.find((tab) => tab.id === tabId);
        if (existing) {
          set({ activeTabId: tabId });
          return tabId;
        }

        const tab: Tab = {
          ...baseTab(tabId, "WebSocket", "socket"),
          connectionId,
          socketPath: "",
        };
        set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tabId }));
        return tabId;
      },

      updateRequest: (tabId, patch) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => {
            if (tab.id !== tabId || !tab.request) return tab;
            const request = { ...tab.request, ...patch };
            return { ...tab, request, name: request.name || tab.name };
          }),
        })),

      setRequestResult: (tabId, result) =>
        set((state) => {
          const requestResults = { ...state.requestResults };
          if (result) requestResults[tabId] = result;
          else delete requestResults[tabId];
          return { requestResults };
        }),

      appendSocketMessage: (tabId, message) =>
        set((state) => ({
          socketLogs: {
            ...state.socketLogs,
            // keep the log bounded; a chatty socket should not grow forever
            [tabId]: [...(state.socketLogs[tabId] ?? []), message].slice(-500),
          },
        })),

      clearSocketLog: (tabId) =>
        set((state) => ({ socketLogs: { ...state.socketLogs, [tabId]: [] } })),

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
          const requestResults = { ...state.requestResults };
          delete requestResults[tabId];
          const socketLogs = { ...state.socketLogs };
          delete socketLogs[tabId];

          let activeTabId = state.activeTabId;
          if (activeTabId === tabId) {
            // step to the neighbour rather than jumping to the end
            const candidates = tabs.filter((tab) => tab.id !== NEW_TAB_ID);
            const neighbour =
              candidates[Math.min(Math.max(index - 1, 0), candidates.length - 1)];
            activeTabId = neighbour?.id ?? NEW_TAB_ID;
          }

          return { tabs, results, requestResults, socketLogs, activeTabId };
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

      saveView: (tabId, name) =>
        set((state) => {
          const tab = state.tabs.find((item) => item.id === tabId);
          if (!tab || !name.trim()) return {};

          const tableKey = tableKeyOf(tab.connectionId, tab.schemaName, tab.tableName);
          const view: SavedView = {
            id: `view:${Date.now()}`,
            name: name.trim(),
            tableKey,
            filters: tab.filters,
            search: tab.search,
            sort: tab.sort,
            hiddenColumns: tab.hiddenColumns,
            columnOrder: tab.columnOrder,
            rowsLimit: tab.rowsLimit,
            createdAt: Date.now(),
          };

          // saving under an existing name replaces it rather than duplicating
          const views = state.views.filter(
            (existing) =>
              !(existing.tableKey === tableKey && existing.name === view.name)
          );
          return { views: [...views, view] };
        }),

      applyView: (tabId, viewId) =>
        set((state) => {
          const view = state.views.find((item) => item.id === viewId);
          if (!view) return {};
          return {
            tabs: state.tabs.map((tab) =>
              tab.id === tabId
                ? {
                    ...tab,
                    filters: view.filters,
                    search: view.search,
                    sort: view.sort,
                    hiddenColumns: view.hiddenColumns,
                    columnOrder: view.columnOrder,
                    rowsLimit: view.rowsLimit,
                    rowsOffset: 0,
                  }
                : tab
            ),
          };
        }),

      deleteView: (viewId) =>
        set((state) => ({ views: state.views.filter((view) => view.id !== viewId) })),

      viewsFor: (tableKey) =>
        get()
          .views.filter((view) => view.tableKey === tableKey)
          .sort((a, b) => a.name.localeCompare(b.name)),

      reorderColumns: (tabId, order) =>
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, columnOrder: order } : tab
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
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        views: state.views,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<TabStore> | undefined;
        const tabs = saved?.tabs?.length ? saved.tabs : current.tabs;
        if (!tabs.some((tab) => tab.id === NEW_TAB_ID)) tabs.push(newPlaceholderTab());
        return {
          ...current,
          views: saved?.views ?? current.views,
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
