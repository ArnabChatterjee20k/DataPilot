import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createFlow,
  deleteFlow,
  getFlow,
  listFlows,
  updateFlow,
  type FlowModel,
} from "@/lib/sdk";
import type { FlowGraph } from "../flow/types";

export const flowKeys = {
  list: () => ["flows"] as const,
  detail: (uid: string) => ["flows", uid] as const,
};

export function useFlows() {
  return useQuery({
    queryKey: flowKeys.list(),
    queryFn: async (): Promise<FlowModel[]> => {
      const response = await listFlows({ throwOnError: true });
      return response.data?.flows ?? [];
    },
  });
}

export function useFlow(uid: string | undefined) {
  return useQuery({
    queryKey: flowKeys.detail(uid ?? ""),
    enabled: !!uid,
    queryFn: async (): Promise<FlowModel> => {
      const response = await getFlow({
        path: { flow_uid: uid! },
        throwOnError: true,
      });
      return response.data!;
    },
  });
}

export function useCreateFlow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const response = await createFlow({
        body: { name, graph: { nodes: [], edges: [] } },
        throwOnError: true,
      });
      return response.data!;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: flowKeys.list() }),
  });
}

/**
 * Saving is explicit.
 *
 * The server refuses a graph it cannot run - a loop, an edge to a node that is
 * not there - so the failure is worth showing rather than swallowing behind an
 * autosave nobody asked for.
 */
export function useSaveFlow(uid: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, graph }: { name: string; graph: FlowGraph }) => {
      const response = await updateFlow({
        path: { flow_uid: uid! },
        body: { name, graph: graph as unknown as Record<string, never> },
        throwOnError: true,
      });
      return response.data!;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(flowKeys.detail(uid ?? ""), data);
      void queryClient.invalidateQueries({ queryKey: flowKeys.list() });
    },
  });
}

export function useDeleteFlow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (uid: string) => {
      await deleteFlow({ path: { flow_uid: uid }, throwOnError: true });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: flowKeys.list() }),
  });
}
