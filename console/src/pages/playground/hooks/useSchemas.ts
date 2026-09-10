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
      // a database that is not there will not be there on the third attempt
      // either, and retrying only delays the message
      retry: false,
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
      errorByConnectionId: new Map(
        connectionIds
          .map((id, index) => [id, results[index]?.error ?? null] as const)
          .filter(([, error]) => error)
      ),
    }),
  });
}
