import { useQueries } from "@tanstack/react-query";

import { getTables } from "@/lib/sdk";
import type { Table } from "../store/store";

export const tableKeys = {
  table: (connectionId: string, schemaName?: string | null) =>
    ["tables", connectionId, schemaName ?? "default"] as const,
};

export interface TableQueryParams {
  connectionId: string;
  schemaName?: string | null;
}

/** Key a set of tables by connection, or by connection+schema on Postgres. */
export const tableGroupKey = (connectionId: string, schemaName?: string | null) =>
  schemaName ? `${connectionId}:${schemaName}` : connectionId;

export function useTables(queries: TableQueryParams[]) {
  return useQueries({
    queries: queries.map(({ connectionId, schemaName }) => ({
      queryKey: tableKeys.table(connectionId, schemaName),
      retry: false,
      queryFn: async (): Promise<Table[]> => {
        const response = await getTables({
          path: { connection_id: connectionId },
          query: schemaName ? { schema: schemaName } : undefined,
          throwOnError: true,
        });
        return (response.data?.tables ?? []).map((table) => ({
          id: tableGroupKey(connectionId, schemaName) + ":" + table.name,
          name: table.name,
          schemaId: schemaName ?? undefined,
        }));
      },
    })),
    combine: (results) => ({
      byGroup: new Map(
        queries.map((query, index) => [
          tableGroupKey(query.connectionId, query.schemaName),
          results[index]?.data ?? [],
        ])
      ),
      loadingGroups: new Set(
        queries
          .filter((_, index) => results[index]?.isLoading)
          .map((query) => tableGroupKey(query.connectionId, query.schemaName))
      ),
      errorsByGroup: new Map(
        queries
          .map((query, index) => [
            tableGroupKey(query.connectionId, query.schemaName),
            results[index]?.error ?? null,
          ])
          .filter(([, error]) => error) as [string, unknown][]
      ),
    }),
  });
}
