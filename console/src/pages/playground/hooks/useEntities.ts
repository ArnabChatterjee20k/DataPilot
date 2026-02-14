import { useQueries } from "@tanstack/react-query";
import { getTables } from "@/lib/sdk";
import type { Table } from "../store/store";

export const entityKeys = {
  entities: () => ['entities'],
  entity: (connectionId: string) => ["entity", connectionId],
};

type EntityQueryParams = {
  connectionId: string;
};

export function useEntities(queries: EntityQueryParams[]) {
  return useQueries({
    queries: queries.map(({ connectionId }) => ({
      queryKey: entityKeys.entity(connectionId),
      queryFn: async (): Promise<(Table & { connectionId: string })[]> => {
        const response = await getTables({
          path: { connection_id: connectionId },
          throwOnError: true,
        });
        if (!response.data) return [];
        return (
          response.data?.tables.map((table) => ({
            id: table.name,
            name: table.name,
            connectionId: connectionId,
          })) || []
        );
      },
      staleTime: 5 * 60_000,
    })),
  });
}
