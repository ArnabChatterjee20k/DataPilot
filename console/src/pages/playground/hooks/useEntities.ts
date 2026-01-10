import { useQueries } from "@tanstack/react-query";
import { getTables, type TableModel } from "@/lib/sdk";
import type { Table } from "../store/store";

export const entityKeys = {
entities:()=>['entities']
  entity: (connectionId: string) => ["schema", connectionId],
};

export function useSchemas(connectionIds: string) {
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
      },
      staleTime: 5 * 60_000,
    })),
  });
}
