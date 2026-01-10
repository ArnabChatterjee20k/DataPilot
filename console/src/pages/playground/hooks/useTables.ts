import { useQueries } from "@tanstack/react-query";
import { getTables } from "@/lib/sdk";
import type { Table } from "../store/store";

export const tableKeys = {
  table: (connectionId: string, schemaName?: string) => [
    "tables",
    connectionId,
    schemaName || "default",
  ],
};

type TableQueryParams = {
  connectionId: string;
  schemaName?: string;
};

export function useTables(queries: TableQueryParams[]) {
  return useQueries({
    queries: queries.map(({ connectionId, schemaName }) => ({
      queryKey: tableKeys.table(connectionId, schemaName),
      queryFn: async (): Promise<(Table & { connectionId: string })[]> => {
        const response = await getTables({
          path: { connection_id: connectionId },
          query: schemaName ? { schema: schemaName } : undefined,
          throwOnError: true,
        });
        if (!response.data) return [];
        return (
          response.data?.tables.map((table) => ({
            id: table.name,
            name: table.name,
            schemaId: schemaName,
            connectionId: connectionId,
          })) || []
        );
      },
    })),
  });
}

