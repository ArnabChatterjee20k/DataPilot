import { useQuery } from "@tanstack/react-query";

import { explainQuery, getEntityStats } from "@/lib/sdk";

export const insightKeys = {
  stats: (connectionId: string, entity: string, schema?: string | null) =>
    ["stats", connectionId, schema ?? "default", entity] as const,
  explain: (connectionId: string, entity: string, query: string) =>
    ["explain", connectionId, entity, query] as const,
};

/** Null share, distinct count and top values per column. */
export function useEntityStats(
  connectionId: string | undefined,
  entityName: string | undefined,
  schemaName: string | null | undefined,
  enabled: boolean
) {
  return useQuery({
    queryKey: insightKeys.stats(connectionId ?? "", entityName ?? "", schemaName),
    enabled: enabled && !!connectionId && !!entityName,
    staleTime: 60_000,
    queryFn: async () => {
      const response = await getEntityStats({
        path: { connection_id: connectionId!, entity_name: entityName! },
        query: schemaName ? { schema: schemaName } : undefined,
        throwOnError: true,
      });
      return response.data ?? null;
    },
  });
}

/** The plan for a query, without running it. */
export function useQueryPlan(
  connectionId: string | undefined,
  entityName: string | undefined,
  query: string | undefined,
  enabled: boolean
) {
  return useQuery({
    queryKey: insightKeys.explain(connectionId ?? "", entityName ?? "", query ?? ""),
    enabled: enabled && !!connectionId && !!query?.trim(),
    staleTime: 30_000,
    queryFn: async () => {
      const response = await explainQuery({
        path: {
          connection_id: connectionId!,
          entity_name: entityName || "query",
        },
        query: { query: query! },
        throwOnError: true,
      });
      return response.data ?? null;
    },
  });
}
