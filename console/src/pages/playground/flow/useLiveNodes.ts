import { useCallback, useEffect, useRef, useState } from "react";

import { socketUrl, readControlFrame } from "../hooks/useControlSocket";
import type { FlowNode } from "./types";

/**
 * The subscriptions a flow's socket nodes hold open.
 *
 * These run in the browser rather than on the server: the flow runner walks a
 * graph once and finishes, which is the opposite of a feed. So the console
 * opens them, keeps what arrives, and hands it to whatever is drawn next.
 *
 * One socket per node, opened and closed together, because a subscription that
 * outlived the node it belongs to would be invisible and unstoppable.
 */

/** How much of a feed is kept. A chatty socket must not grow until the tab dies. */
export const BUFFER = 500;

export interface LiveMessage {
  at: number;
  text: string;
  /** Parsed when the frame was JSON, so a chart can read a field out of it. */
  value?: unknown;
}

export interface LiveFeed {
  state: "closed" | "connecting" | "open";
  failure: string | null;
  messages: LiveMessage[];
  /** How many have arrived in total, which the buffer length stops telling you. */
  received: number;
}

const CLOSED: LiveFeed = {
  state: "closed",
  failure: null,
  messages: [],
  received: 0,
};

export function useLiveNodes(nodes: FlowNode[]) {
  const [feeds, setFeeds] = useState<Record<string, LiveFeed>>({});
  const sockets = useRef<Map<string, WebSocket>>(new Map());

  const patch = useCallback((id: string, change: Partial<LiveFeed>) => {
    setFeeds((current) => ({
      ...current,
      [id]: { ...(current[id] ?? CLOSED), ...change },
    }));
  }, []);

  const stop = useCallback((id: string) => {
    sockets.current.get(id)?.close();
    sockets.current.delete(id);
  }, []);

  const start = useCallback(
    (node: FlowNode) => {
      if (!node.connection_id || sockets.current.has(node.id)) return;

      patch(node.id, { state: "connecting", failure: null });

      const socket = new WebSocket(
        socketUrl(`/connection/${node.connection_id}/socket`, {
          path: node.socket?.path ?? "",
        })
      );
      sockets.current.set(node.id, socket);

      socket.onmessage = (event) => {
        const data = String(event.data);
        const control = readControlFrame(data);

        if (control) {
          if (control.status === "ready") patch(node.id, { state: "open" });
          if (control.status === "error") patch(node.id, { failure: control.detail });
          return;
        }

        let value: unknown;
        try {
          value = JSON.parse(data);
        } catch {
          value = undefined;
        }

        setFeeds((current) => {
          const feed = current[node.id] ?? CLOSED;
          return {
            ...current,
            [node.id]: {
              ...feed,
              received: feed.received + 1,
              // oldest first, so what is drawn reads left to right in time
              messages: [...feed.messages, { at: Date.now(), text: data, value }].slice(
                -BUFFER
              ),
            },
          };
        });
      };

      socket.onclose = () => {
        sockets.current.delete(node.id);
        patch(node.id, { state: "closed" });
      };
    },
    [patch]
  );

  const clear = useCallback((id: string) => {
    setFeeds((current) => ({
      ...current,
      [id]: { ...(current[id] ?? CLOSED), messages: [], received: 0 },
    }));
  }, []);

  // a node that was deleted must not leave its socket running, and neither
  // must a flow that was closed
  const liveIds = nodes.filter((node) => node.kind === "socket").map((node) => node.id);
  const key = liveIds.join(",");
  useEffect(() => {
    const wanted = new Set(key ? key.split(",") : []);
    for (const id of [...sockets.current.keys()]) {
      if (!wanted.has(id)) stop(id);
    }
  }, [key, stop]);

  useEffect(() => {
    const open = sockets.current;
    return () => {
      for (const socket of open.values()) socket.close();
      open.clear();
    };
  }, []);

  return {
    feeds,
    feed: (id: string): LiveFeed => feeds[id] ?? CLOSED,
    start,
    stop,
    clear,
  };
}
