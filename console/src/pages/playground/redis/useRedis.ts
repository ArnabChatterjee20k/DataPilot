import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createKey,
  deleteKey,
  editKey,
  listChannels,
  publish,
  readKey,
  renameKey,
  runCommand,
  scanKeys,
  serverInfo,
  setTtl,
  type RedisCommandModel,
  type RedisKeyCreateModel,
  type RedisKeyEditModel,
  type RedisRenameModel,
  type RedisTtlModel,
  type RedisChannelListModel,
  type RedisInfoModel,
  type RedisKeyListModel,
  type RedisKeyValueModel,
} from "@/lib/sdk";
import { client } from "@/lib/sdk/client.gen";

export const redisKeys = {
  scan: (connectionId: string, pattern: string) =>
    ["redis", connectionId, "keys", pattern] as const,
  value: (connectionId: string, key: string) =>
    ["redis", connectionId, "value", key] as const,
  info: (connectionId: string) => ["redis", connectionId, "info"] as const,
  channels: (connectionId: string) => ["redis", connectionId, "channels"] as const,
};

/**
 * One page of keys.
 *
 * `SCAN` is cursored and can hand back an empty page with a cursor still to
 * follow, so "no keys yet" is only true once the cursor comes back zero.
 */
export function useKeyScan(connectionId: string | undefined, pattern: string) {
  return useQuery({
    queryKey: redisKeys.scan(connectionId ?? "", pattern),
    enabled: !!connectionId,
    retry: false,
    queryFn: async (): Promise<RedisKeyListModel> => {
      const response = await scanKeys({
        path: { connection_id: connectionId! },
        query: { pattern: pattern || "*", count: 200 },
        throwOnError: true,
      });
      return response.data!;
    },
  });
}

export function useKeyValue(connectionId: string | undefined, key: string | null) {
  return useQuery({
    queryKey: redisKeys.value(connectionId ?? "", key ?? ""),
    enabled: !!connectionId && !!key,
    retry: false,
    queryFn: async (): Promise<RedisKeyValueModel> => {
      const response = await readKey({
        path: { connection_id: connectionId! },
        query: { key: key! },
        throwOnError: true,
      });
      return response.data!;
    },
  });
}

export function useDeleteKey(connectionId: string | undefined, allowWrites = false) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      await deleteKey({
        path: { connection_id: connectionId! },
        query: { key, ...(allowWrites ? { allow_writes: true } : {}) },
        throwOnError: true,
      });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["redis", connectionId ?? ""] }),
  });
}

/**
 * Everything that changes a key.
 *
 * Each write answers with the key as Redis now holds it, and the keyspace is
 * refreshed afterwards, so the browser shows what was stored rather than what
 * it assumed it sent.
 */
export function useRedisWrites(connectionId: string | undefined, allowWrites: boolean) {
  const queryClient = useQueryClient();
  const path = { connection_id: connectionId! };
  const query = allowWrites ? { allow_writes: true } : {};
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["redis", connectionId ?? ""] });

  const create = useMutation({
    mutationFn: async (body: RedisKeyCreateModel) =>
      (await createKey({ path, query, body, throwOnError: true })).data!,
    onSuccess: refresh,
  });

  const edit = useMutation({
    mutationFn: async (body: RedisKeyEditModel) =>
      (await editKey({ path, query, body, throwOnError: true })).data!,
    onSuccess: refresh,
  });

  const expire = useMutation({
    mutationFn: async (body: RedisTtlModel) =>
      (await setTtl({ path, query, body, throwOnError: true })).data!,
    onSuccess: refresh,
  });

  const rename = useMutation({
    mutationFn: async (body: RedisRenameModel) =>
      (await renameKey({ path, query, body, throwOnError: true })).data!,
    onSuccess: refresh,
  });

  return { create, edit, expire, rename };
}

/**
 * One command, run the way redis-cli would.
 *
 * The server says whether the command wrote, from the same table it used to
 * decide it could run, so the keyspace is refreshed only when something may
 * have changed rather than guessed at here.
 */
export function useRunCommand(connectionId: string | undefined, allowWrites: boolean) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: RedisCommandModel) =>
      (
        await runCommand({
          path: { connection_id: connectionId! },
          query: allowWrites ? { allow_writes: true } : {},
          body,
          throwOnError: true,
        })
      ).data!,
    onSuccess: (result) => {
      if (result.writes) {
        void queryClient.invalidateQueries({ queryKey: ["redis", connectionId ?? ""] });
      }
    },
  });
}

export function useRedisInfo(connectionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: redisKeys.info(connectionId ?? ""),
    enabled: !!connectionId && enabled,
    retry: false,
    refetchInterval: 5000,
    queryFn: async (): Promise<RedisInfoModel> => {
      const response = await serverInfo({
        path: { connection_id: connectionId! },
        throwOnError: true,
      });
      return response.data!;
    },
  });
}

/**
 * The channels with a subscriber right now.
 *
 * Redis keeps no registry of channel names - a channel exists only while
 * something is listening - so this is a live picture and is polled.
 */
export function useChannels(connectionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: redisKeys.channels(connectionId ?? ""),
    enabled: !!connectionId && enabled,
    retry: false,
    refetchInterval: 3000,
    queryFn: async (): Promise<RedisChannelListModel> => {
      const response = await listChannels({
        path: { connection_id: connectionId! },
        throwOnError: true,
      });
      return response.data!;
    },
  });
}

export function usePublish(connectionId: string | undefined) {
  return useMutation({
    mutationFn: async ({ channel, message }: { channel: string; message: string }) => {
      const response = await publish({
        path: { connection_id: connectionId! },
        query: { channel, message },
        throwOnError: true,
      });
      return response.data!;
    },
  });
}

const CONTROL_KEY = "__datapilot";

export interface RedisMessage {
  id: string;
  channel: string;
  pattern?: string | null;
  payload: string;
  is_text: boolean;
  at: number;
}

function subscribeUrl(connectionId: string, channels: string, patterns: string) {
  const base = client.getConfig().baseUrl ?? "";
  const origin = base.startsWith("http") ? base : window.location.origin;
  const url = new URL(`/connection/${connectionId}/redis/subscribe`, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (channels) url.searchParams.set("channels", channels);
  if (patterns) url.searchParams.set("patterns", patterns);
  return url.toString();
}

/**
 * Watch messages arrive.
 *
 * Nothing is reported as subscribed until Redis confirms it: pub/sub has no
 * replay, so a message published before the subscription registers is gone
 * with nothing anywhere to say so.
 */
export function useSubscription(connectionId: string | undefined) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<RedisMessage[]>([]);
  const [subscribed, setSubscribed] = useState<string[]>([]);
  const [state, setState] = useState<"closed" | "connecting" | "open">("closed");
  const [failure, setFailure] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(
    () => () => {
      socketRef.current?.close();
      socketRef.current = null;
    },
    []
  );

  const stop = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    setState("closed");
    setSubscribed([]);
  }, []);

  const start = useCallback(
    (channels: string, patterns: string) => {
      if (!connectionId || socketRef.current) return;

      setState("connecting");
      setFailure(null);

      const socket = new WebSocket(subscribeUrl(connectionId, channels, patterns));
      socketRef.current = socket;

      socket.onmessage = (event) => {
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(String(event.data));
        } catch {
          return;
        }

        if (CONTROL_KEY in frame) {
          if (frame[CONTROL_KEY] === "ready") {
            try {
              const detail = JSON.parse(String(frame.detail));
              setSubscribed(detail.subscribed ?? []);
            } catch {
              setSubscribed([]);
            }
            setState("open");
            // this subscription is itself one of the listeners the channel
            // list shows, so it should appear there without a wait
            void queryClient.invalidateQueries({
              queryKey: redisKeys.channels(connectionId),
            });
            return;
          }
          if (frame[CONTROL_KEY] === "error") {
            setFailure(String(frame.detail ?? "Could not subscribe"));
          }
          return;
        }

        setMessages((current) =>
          [
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              channel: String(frame.channel ?? ""),
              pattern: (frame.pattern as string | null) ?? null,
              payload: String(frame.payload ?? ""),
              is_text: frame.is_text !== false,
              at: Date.now(),
            },
            ...current,
          ].slice(0, 500)
        );
      };

      socket.onclose = () => {
        socketRef.current = null;
        setState("closed");
        setSubscribed([]);
        void queryClient.invalidateQueries({
          queryKey: redisKeys.channels(connectionId),
        });
      };
    },
    [connectionId, queryClient]
  );

  return {
    messages,
    subscribed,
    state,
    failure,
    start,
    stop,
    clear: () => setMessages([]),
  };
}
