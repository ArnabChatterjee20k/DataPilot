import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listConnections,
  getConnection,
  createConnection,
  updateConnection,
  deleteConnection,
  type CreateConnectionData,
  type UpdateConnectionData,
} from '@/lib/sdk';
import type { DatabaseConnection } from '@/pages/playground/store/store';

export const connectionKeys = {
  all: ['connections'] as const,
  lists: () => [...connectionKeys.all, 'list'] as const,
  list: () => [...connectionKeys.lists()] as const,
  details: () => [...connectionKeys.all, 'detail'] as const,
  detail: (id: string) => [...connectionKeys.details(), id] as const,
};


export function useConnections() {
  return useQuery({
    queryKey: connectionKeys.list(),
    queryFn: async () => {
      const response = await listConnections({throwOnError:true});
      return (response.data?.connections || []).map((conn) => ({
        id: conn.uid,
        name: conn.name,
        type: conn.source,
      })) as DatabaseConnection[];
    },
  });
}

export function useConnection(connectionId: string | null | undefined) {
  return useQuery({
    queryKey: connectionKeys.detail(connectionId || ''),
    queryFn: async () => {
      if (!connectionId) return null;
      const response = await getConnection({
        path: { connection_uid: connectionId },
        throwOnError:true
      });
      if (!response.data) return null;
      return {
        id: response.data.uid,
        name: response.data.name,
        type: response.data.source,
      } as DatabaseConnection;
    },
    enabled: !!connectionId,
  });
}

export function useCreateConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateConnectionData['body']) => {
      const response = await createConnection({ body: data, throwOnError:true });
      return response.data;
    },
    onSuccess: () => {
      // Invalidate and refetch connections list
      queryClient.invalidateQueries({ queryKey: connectionKeys.list() });
    },
  });
}

export function useUpdateConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      connectionId,
      data,
    }: {
      connectionId: string;
      data: UpdateConnectionData['body'];
    }) => {
      const response = await updateConnection({
        path: { connection_uid: connectionId },
        body: data,
        throwOnError:true
      });
      return response.data;
    },
    onSuccess: (_, variables) => {
      // Invalidate connections list and specific connection
      queryClient.invalidateQueries({ queryKey: connectionKeys.list() });
      queryClient.invalidateQueries({
        queryKey: connectionKeys.detail(variables.connectionId),
      });
    },
  });
}

export function useDeleteConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (connectionId: string) => {
      const response = await deleteConnection({
        path: { connection_uid: connectionId },
        throwOnError:true
      });
      return response.data;
    },
    onSuccess: () => {
      // Invalidate connections list
      queryClient.invalidateQueries({ queryKey: connectionKeys.list() });
    },
  });
}

