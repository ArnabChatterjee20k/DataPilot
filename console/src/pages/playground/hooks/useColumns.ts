import { useQuery } from "@tanstack/react-query";

import { getEntityColumns } from "@/lib/sdk";
import { toColumns } from "@/lib/columns";

export const columnKeys = {
  columns: (connectionId: string, entity: string, schema?: string | null) =>
    ["columns", connectionId, schema ?? "default", entity] as const,
};

/**
 * Column types, nullability, primary key, indexes and sensitivity for a table.
 * This is what lets the grid label columns and mask credentials without
 * guessing from the values it happens to have loaded.
 */
export function useColumns(
  connectionId: string | undefined,
  entityName: string | undefined,
  schemaName?: string | null
) {
  return useQuery({
    queryKey: columnKeys.columns(connectionId ?? "", entityName ?? "", schemaName),
    enabled: !!connectionId && !!entityName,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const response = await getEntityColumns({
        path: { connection_id: connectionId!, entity_name: entityName! },
        query: schemaName ? { schema: schemaName } : undefined,
        throwOnError: true,
      });
      if (!response.data) return null;
      return { ...response.data, columns: toColumns(response.data.columns) };
    },
  });
}
