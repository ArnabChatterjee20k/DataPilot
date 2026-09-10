import { useQueries } from "@tanstack/react-query";

import { getTables } from "@/lib/sdk";
import type { DatabaseConnection, Table } from "../store/store";
import { tableKeys, tableGroupKey } from "./useTables";

/**
 * Tables for every connection, for the command palette.
 *
 * Only the default schema is listed on Postgres: the palette is a fast way to
 * reach a table, not a catalogue browser, and eagerly walking every schema of
 * every connection would be a lot of queries for one keystroke.
 */
export function useAllTables(connections: DatabaseConnection[]) {
  return useQueries({
    queries: connections.map((connection) => {
      const schema = connection.supportsSchemas ? "public" : null;
      return {
        queryKey: tableKeys.table(connection.id, schema),
        queryFn: async (): Promise<Table[]> => {
          const response = await getTables({
            path: { connection_id: connection.id },
            query: schema ? { schema } : undefined,
            throwOnError: true,
          });
          return (response.data?.tables ?? []).map((table) => ({
            id: `${tableGroupKey(connection.id, schema)}:${table.name}`,
            name: table.name,
            schemaId: schema ?? undefined,
          }));
        },
        staleTime: 5 * 60_000,
      };
    }),
    combine: (results) =>
      new Map(
        connections.map((connection, index) => [
          connection.id,
          results[index]?.data ?? [],
        ])
      ),
  });
}
