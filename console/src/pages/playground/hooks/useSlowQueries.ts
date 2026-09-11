import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  compareSnapshots,
  deleteSnapshot,
  getSlowQueries,
  listSnapshots,
  takeSnapshot,
  type SlowQueryReportModel,
  type SnapshotComparisonModel,
  type SnapshotListModel,
} from "@/lib/sdk";
import { errorMessage } from "@/lib/errors";

export type SlowQueryOrder = "total" | "mean" | "calls" | "rows";

export const slowQueryKeys = {
  all: (connectionId: string) => ["slow-queries", connectionId] as const,
  report: (connectionId: string, order: SlowQueryOrder) =>
    ["slow-queries", connectionId, "report", order] as const,
  snapshots: (connectionId: string) =>
    ["slow-queries", connectionId, "snapshots"] as const,
};

/**
 * What the database itself says has been slow.
 *
 * Not the queries DataPilot has run: those only describe DataPilot. An
 * unavailable source is an answer with a reason attached, not an error.
 */
export function useSlowQueries(
  connectionId: string | undefined,
  order: SlowQueryOrder
) {
  return useQuery({
    queryKey: slowQueryKeys.report(connectionId ?? "", order),
    enabled: !!connectionId,
    retry: false,
    queryFn: async (): Promise<SlowQueryReportModel> => {
      const response = await getSlowQueries({
        path: { connection_id: connectionId! },
        query: { order_by: order },
        throwOnError: true,
      });
      return response.data!;
    },
  });
}

export function useSnapshots(connectionId: string | undefined) {
  return useQuery({
    queryKey: slowQueryKeys.snapshots(connectionId ?? ""),
    enabled: !!connectionId,
    retry: false,
    queryFn: async (): Promise<SnapshotListModel> => {
      const response = await listSnapshots({
        path: { connection_id: connectionId! },
        throwOnError: true,
      });
      return response.data ?? { snapshots: [], total: 0 };
    },
  });
}

export function useTakeSnapshot(connectionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (note: string) => {
      const response = await takeSnapshot({
        path: { connection_id: connectionId! },
        query: { note },
        throwOnError: true,
      });
      return response.data;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: slowQueryKeys.snapshots(connectionId ?? ""),
      }),
  });
}

export function useDeleteSnapshot(connectionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (snapshotUid: string) => {
      await deleteSnapshot({
        path: { connection_id: connectionId!, snapshot_uid: snapshotUid },
        throwOnError: true,
      });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: slowQueryKeys.snapshots(connectionId ?? ""),
      }),
  });
}

/**
 * The difference between a stored reading and now.
 *
 * The server's counters only go up and cover everything since they were last
 * reset, which may be weeks of traffic that has nothing to do with the change
 * being looked at.
 */
export function useComparison(
  connectionId: string | undefined,
  before: string | null
) {
  return useQuery({
    queryKey: ["slow-queries", connectionId ?? "", "compare", before ?? ""],
    enabled: !!connectionId && !!before,
    retry: false,
    queryFn: async (): Promise<SnapshotComparisonModel> => {
      const response = await compareSnapshots({
        path: { connection_id: connectionId! },
        query: { before: before! },
      });
      if (response.error || !response.data) {
        throw new Error(
          errorMessage(response.error, "Could not compare against that reading")
        );
      }
      return response.data;
    },
  });
}
