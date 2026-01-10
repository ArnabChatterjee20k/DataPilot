import { useQueries } from "@tanstack/react-query";
import { getSchemas } from "@/lib/sdk";
import type { Schema } from "../store/store";

export const schemaKeys = {
  schema: (connectionId: string) => ["schema", connectionId],
};

export function useSchemas(connectionIds: string[]) {
  return useQueries({
    queries: connectionIds.map((connectionId) => ({
      queryKey: schemaKeys.schema(connectionId),
      queryFn: async (): Promise<(Schema & {connectionId:string})[]> => {
        const response = await getSchemas({
          path: { connection_id: connectionId },
          throwOnError: true,
        });
        if (!response.data) return [];
        return (
          response.data?.schemas.map((schema) => ({
            id: schema.name,
            name: schema.name,
            connectionId: connectionId
          })) || []
        );
      }
    })),
  });
}
