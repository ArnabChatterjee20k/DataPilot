import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { executeQuery } from "@/lib/sdk";
import { errorMessage } from "@/lib/errors";
import { toColumns } from "@/lib/columns";
import { buildSelect, defaultSortColumn, primaryKeyOf } from "@/lib/sql";
import type { DatabaseConnection, QueryResultState, Tab } from "../store/store";
import { useTabsStore } from "../store/store";
import { useColumns } from "./useColumns";

/**
 * A table tab's rows are derived from its filters, sort and page, so the SQL is
 * regenerated rather than remembered. A query tab runs exactly what was typed.
 */
export function useTabData(tab: Tab | undefined, connection?: DatabaseConnection) {
  const setResult = useTabsStore((state) => state.setResult);
  const updateTab = useTabsStore((state) => state.updateTab);
  const result = useTabsStore((state) => (tab ? state.results[tab.id] : undefined));

  const [isRunning, setIsRunning] = useState(false);
  const runToken = useRef(0);

  const isTableTab = tab?.type === "table" && !!tab.tableName;

  const columnsQuery = useColumns(
    isTableTab ? tab?.connectionId : undefined,
    isTableTab ? tab?.tableName : undefined,
    isTableTab ? tab?.schemaName : undefined
  );

  const tableColumns = columnsQuery.data?.columns ?? [];
  const totalRows = columnsQuery.data?.row_count ?? null;

  /** Ordering the grid falls back to, so pages stay stable between fetches. */
  const effectiveSort = useMemo(() => {
    if (!tab) return null;
    if (tab.sort) return tab.sort;
    if (!tableColumns.length) return null;

    const recency = defaultSortColumn(tableColumns);
    if (recency) return { column: recency, direction: "desc" as const };

    const primaryKey = primaryKeyOf(tableColumns);
    return primaryKey ? { column: primaryKey.name, direction: "asc" as const } : null;
  }, [tab, tableColumns]);

  const tableSql = useMemo(() => {
    if (!tab || !isTableTab || !tableColumns.length) return null;
    return buildSelect({
      table: tab.tableName!,
      schema: tab.schemaName,
      source: connection?.type ?? "sqlite",
      columns: tableColumns,
      filters: tab.filters,
      search: tab.search,
      sort: effectiveSort,
      limit: tab.rowsLimit,
      offset: tab.rowsOffset,
    });
  }, [tab, isTableTab, tableColumns, connection?.type, effectiveSort]);

  const run = useCallback(
    async (sql: string, options: { allowWrites?: boolean; applyLimits?: boolean } = {}) => {
      if (!tab?.connectionId) {
        setResult(tab?.id ?? "", {
          columns: [],
          rows: [],
          error: "Pick a connection first.",
          rowCount: 0,
          rowsAffected: 0,
          returnsRows: false,
          truncated: false,
          executionMs: 0,
          ranAt: Date.now(),
        });
        return;
      }

      const token = ++runToken.current;
      setIsRunning(true);
      try {
        const response = await executeQuery({
          path: {
            connection_id: tab.connectionId,
            entity_name: tab.tableName || "query",
          },
          query: {
            query: sql,
            ...(options.applyLimits
              ? { limit: tab.rowsLimit, offset: tab.rowsOffset }
              : {}),
            ...(tab.schemaName ? { schema: tab.schemaName } : {}),
            ...(options.allowWrites ? { allow_writes: true } : {}),
          },
          throwOnError: true,
        });

        // a slower earlier run must not overwrite a newer one
        if (token !== runToken.current) return;

        const data = response.data;
        const next: QueryResultState = {
          columns: toColumns(data?.columns),
          rows: (data?.rows ?? []) as Record<string, unknown>[],
          query: data?.query,
          rowCount: data?.row_count ?? 0,
          rowsAffected: data?.rows_affected ?? 0,
          returnsRows: data?.returns_rows ?? false,
          truncated: data?.truncated ?? false,
          executionMs: data?.execution_time_ms ?? 0,
          risk: data?.risk,
          ranAt: Date.now(),
        };
        setResult(tab.id, next);
        if (data?.query) updateTab(tab.id, { content: data.query });
      } catch (error) {
        if (token !== runToken.current) return;
        setResult(tab.id, {
          columns: [],
          rows: [],
          error: errorMessage(error, "Could not run the query"),
          rowCount: 0,
          rowsAffected: 0,
          returnsRows: false,
          truncated: false,
          executionMs: 0,
          ranAt: Date.now(),
        });
      } finally {
        if (token === runToken.current) setIsRunning(false);
      }
    },
    [tab, setResult, updateTab]
  );

  // table tabs reload themselves whenever the derived SQL changes
  const lastSql = useRef<string | null>(null);
  useEffect(() => {
    if (!tableSql || !tab) return;
    if (lastSql.current === tableSql) return;
    lastSql.current = tableSql;
    void run(tableSql);
  }, [tableSql, tab, run]);

  useEffect(() => {
    lastSql.current = null;
  }, [tab?.id]);

  const refresh = useCallback(() => {
    if (isTableTab && tableSql) {
      void columnsQuery.refetch();
      void run(tableSql);
      return;
    }
    if (tab?.content?.trim()) void run(tab.content, { allowWrites: tab.allowWrites, applyLimits: tab.applyLimitOffset });
  }, [isTableTab, tableSql, run, tab?.content, tab?.allowWrites, tab?.applyLimitOffset, columnsQuery]);

  return {
    result,
    tableColumns,
    totalRows: tab?.filters.length || tab?.search ? null : totalRows,
    isLoadingColumns: columnsQuery.isLoading,
    columnsError: columnsQuery.error,
    isRunning,
    run,
    refresh,
    tableSql,
  };
}
