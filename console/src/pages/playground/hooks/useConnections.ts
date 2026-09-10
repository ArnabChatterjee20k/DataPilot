import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createConnection,
  deleteConnection,
  getConnection,
  getConnectionStatus,
  listConnections,
  updateConnection,
  type ConnectionsModel,
  type CreateConnectionData,
  type UpdateConnectionData,
} from "@/lib/sdk";
import type { DatabaseConnection } from "../store/store";
import type { SourceType } from "@/lib/sql";

export const connectionKeys = {
  all: ["connections"] as const,
  list: () => [...connectionKeys.all, "list"] as const,
  detail: (id: string) => [...connectionKeys.all, "detail", id] as const,
  status: (id: string) => [...connectionKeys.all, "status", id] as const,
};

export function toDatabaseConnection(model: ConnectionsModel): DatabaseConnection {
  return {
    id: model.uid,
    name: model.name,
    type: model.source as SourceType,
    baseUrl: model.source === "api" ? model.connection_uri : undefined,
    environment: model.environment ?? "local",
    role: model.role ?? "primary",
    readOnly: model.read_only ?? true,
    supportsSchemas: model.supports_schemas ?? false,
  };
}

export function useConnections() {
  return useQuery({
    queryKey: connectionKeys.list(),
    queryFn: async () => {
      const response = await listConnections({ throwOnError: true });
      return (response.data?.connections ?? []).map(toDatabaseConnection);
    },
  });
}

export function useConnection(connectionId: string | null | undefined) {
  return useQuery({
    queryKey: connectionKeys.detail(connectionId ?? ""),
    enabled: !!connectionId,
    queryFn: async () => {
      const response = await getConnection({
        path: { connection_uid: connectionId! },
        throwOnError: true,
      });
      return response.data ? toDatabaseConnection(response.data) : null;
    },
  });
}

/** Dials the connection so the sidebar can show whether it actually answers. */
export function useConnectionStatus(connectionId: string | null | undefined) {
  return useQuery({
    queryKey: connectionKeys.status(connectionId ?? ""),
    enabled: !!connectionId,
    staleTime: 30_000,
    queryFn: async () => {
      const response = await getConnectionStatus({
        path: { connection_uid: connectionId! },
        throwOnError: true,
      });
      return response.data ?? null;
    },
  });
}

export function useCreateConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateConnectionData["body"]) => {
      const response = await createConnection({ body, throwOnError: true });
      return response.data;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: connectionKeys.list() }),
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
      data: UpdateConnectionData["body"];
    }) => {
      const response = await updateConnection({
        path: { connection_uid: connectionId },
        body: data,
        throwOnError: true,
      });
      return response.data;
    },
    onSuccess: (_data, variables) => {
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
      await deleteConnection({
        path: { connection_uid: connectionId },
        throwOnError: true,
      });
      return connectionId;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: connectionKeys.list() }),
  });
}
