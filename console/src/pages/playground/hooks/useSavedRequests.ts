import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createRequest,
  deleteRequest,
  listRequests,
  updateRequest,
  type RequestSpecModel,
} from "@/lib/sdk";

export const requestKeys = {
  list: (connectionId: string) => ["requests", connectionId] as const,
};

export function useSavedRequests(connectionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: requestKeys.list(connectionId ?? ""),
    enabled: enabled && !!connectionId,
    queryFn: async () => {
      const response = await listRequests({
        path: { connection_id: connectionId! },
        throwOnError: true,
      });
      return response.data?.requests ?? [];
    },
  });
}

export function useSaveRequest(connectionId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      requestId,
      spec,
    }: {
      requestId?: string;
      spec: RequestSpecModel;
    }) => {
      // the same body creates or updates, so the builder does not need two paths
      const response = requestId
        ? await updateRequest({
            path: { connection_id: connectionId!, request_uid: requestId },
            body: spec,
            throwOnError: true,
          })
        : await createRequest({
            path: { connection_id: connectionId! },
            body: spec,
            throwOnError: true,
          });
      return response.data;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: requestKeys.list(connectionId ?? ""),
      }),
  });
}

export function useDeleteRequest(connectionId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (requestId: string) => {
      await deleteRequest({
        path: { connection_id: connectionId!, request_uid: requestId },
        throwOnError: true,
      });
      return requestId;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: requestKeys.list(connectionId ?? ""),
      }),
  });
}
