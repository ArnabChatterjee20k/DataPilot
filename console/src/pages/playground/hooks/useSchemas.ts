import { useQueries } from "@tanstack/react-query";

import { getSchemas } from "@/lib/sdk";
import type { Schema } from "../store/store";

export const schemaKeys = {
  schema: (connectionId: string) => ["schema", connectionId] as const,
};

export function useSchemas(connectionIds: string[]) {
  return useQueries({
    queries: connectionIds.map((connectionId) => ({
      queryKey: schemaKeys.schema(connectionId),
      queryFn: async (): Promise<Schema[]> => {
        const response = await getSchemas({
          path: { connection_id: connectionId },
          throwOnError: true,
        });
        return (response.data?.schemas ?? []).map((schema) => ({
          id: schema.name,
          name: schema.name,
        }));
      },
    })),
    combine: (results) => ({
      byConnectionId: new Map(
        connectionIds.map((id, index) => [id, results[index]?.data ?? []])
      ),
      isLoading: results.some((result) => result.isLoading),
      error: results.find((result) => result.error)?.error ?? null,
    }),
  });
}
