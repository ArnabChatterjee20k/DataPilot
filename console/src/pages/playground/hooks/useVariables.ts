import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getVariables, setVariables, type VariablesModel } from "@/lib/sdk";

export const variableKeys = {
  all: (connectionId: string) => ["variables", connectionId] as const,
};

/**
 * A connection's `{{variables}}`.
 *
 * Secret-looking values come back masked, and saving a mask back unchanged
 * leaves the real value alone, so the editor never has to make the user retype
 * a token to change something next to it.
 */
export function useVariables(connectionId: string | null | undefined) {
  return useQuery({
    queryKey: variableKeys.all(connectionId ?? ""),
    enabled: !!connectionId,
    queryFn: async (): Promise<VariablesModel> => {
      const response = await getVariables({
        path: { connection_id: connectionId! },
        throwOnError: true,
      });
      return response.data ?? { variables: {}, secret: [] };
    },
  });
}

export function useSaveVariables(connectionId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (variables: Record<string, string>) => {
      const response = await setVariables({
        path: { connection_id: connectionId! },
        body: { variables },
        throwOnError: true,
      });
      return response.data;
    },
    onSuccess: (data) => {
      if (data) queryClient.setQueryData(variableKeys.all(connectionId ?? ""), data);
    },
  });
}
