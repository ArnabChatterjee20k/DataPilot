import { useCallback, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  createConnection,
  deleteConnection,
  getConnection,
  getConnectionStatus,
  listConnections,
  updateConnection,
  type ConnectionStatusModel,
  type ConnectionsModel,
  type CreateConnectionData,
  type UpdateConnectionData,
} from "@/lib/sdk";
import { errorMessage } from "@/lib/errors";
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

/**
 * Dial a connection and always come back with a verdict.
 *
 * An unreachable connection is an answer, not a failed request, so it must not
 * surface as a query error with nothing to show for it.
 */
async function probeConnection(connectionId: string): Promise<ConnectionStatusModel> {
  const response = await getConnectionStatus({
    path: { connection_uid: connectionId },
  });
  return (
    response.data ?? {
      uid: connectionId,
      reachable: false,
      detail: errorMessage(response.error, "DataPilot could not test this connection"),
    }
  );
}

/** Dials the connection so the sidebar can show whether it actually answers. */
export function useConnectionStatus(connectionId: string | null | undefined) {
  return useQuery({
    queryKey: connectionKeys.status(connectionId ?? ""),
    enabled: !!connectionId,
    staleTime: 30_000,
    // an unreachable connection is an answer, not a failure to retry
    retry: false,
    queryFn: () => probeConnection(connectionId!),
  });
}

/**
 * Dial a connection on demand.
 *
 * A query that failed because the database is not there needs an answer to
 * "is it back yet?" without having to run the query again to find out.
 */
export function useConnectionProbe(connectionId: string | null | undefined) {
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<ConnectionStatusModel | null>(null);
  const [isProbing, setIsProbing] = useState(false);

  const probe = useCallback(async () => {
    if (!connectionId) return;
    setIsProbing(true);
    try {
      const response = await getConnectionStatus({
        path: { connection_uid: connectionId },
      });
      setOutcome(
        response.data ?? {
          uid: connectionId,
          reachable: false,
          detail: errorMessage(response.error, "Could not test the connection"),
        }
      );
      queryClient.setQueryData(connectionKeys.status(connectionId), response.data);
    } catch (error) {
      setOutcome({
        uid: connectionId,
        reachable: false,
        detail: errorMessage(error, "Could not reach DataPilot to test the connection"),
      });
    } finally {
      setIsProbing(false);
    }
  }, [connectionId, queryClient]);

  return { probe, isProbing, outcome };
}

/** Every connection's health at once, so the tree can be built around it. */
export function useConnectionStatuses(connectionIds: string[]) {
  return useQueries({
    queries: connectionIds.map((connectionId) => ({
      queryKey: connectionKeys.status(connectionId),
      staleTime: 30_000,
      retry: false,
      queryFn: () => probeConnection(connectionId),
    })),
    combine: (results) => ({
      byConnectionId: new Map(
        connectionIds.map(
          (id, index) => [id, results[index]?.data ?? null] as const
        )
      ),
      isChecking: new Set(
        connectionIds.filter((_, index) => results[index]?.isFetching)
      ),
    }),
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
