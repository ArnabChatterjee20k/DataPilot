import { useCallback, useEffect, useRef, useState } from "react";

import { client } from "@/lib/sdk/client.gen";

/**
 * Talking to one of DataPilot's websocket proxies.
 *
 * Four consoles opened these by hand and each carried its own copy of the URL
 * building, the control-frame reading and the close-code prose. The copies had
 * already drifted, and a fifth was about to be written for the flow builder.
 *
 * The protocol they share: the browser's socket to DataPilot opens before the
 * upstream is dialled, so an open socket is not a connection. A frame carrying
 * the control key is the proxy talking about the upstream rather than the
 * upstream talking to you, and `ready` is the only thing that means connected.
 */

export const CONTROL_KEY = "__datapilot";

export type SocketState = "closed" | "connecting" | "open";

export interface ControlFrame {
  status: string;
  detail: string;
}

/** Build a ws:// URL for one of the server's proxy endpoints. */
export function socketUrl(path: string, params: Record<string, string> = {}): string {
  const base = client.getConfig().baseUrl ?? "";
  const origin = base || window.location.origin;
  const url = new URL(
    path,
    origin.startsWith("http") ? origin : window.location.origin
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

/** A frame about the upstream, rather than one from it. */
export function readControlFrame(data: string): ControlFrame | null {
  if (!data.includes(CONTROL_KEY)) return null;
  try {
    const parsed = JSON.parse(data);
    const status = parsed?.[CONTROL_KEY];
    if (typeof status !== "string") return null;
    return { status, detail: String(parsed.detail ?? "") };
  } catch {
    return null;
  }
}

/** The browser gives a bare code when it never reached the server. */
export function describeCloseCode(code: number): string {
  switch (code) {
    case 1000:
      return "closed normally";
    case 1001:
      return "the other end went away";
    case 1006:
      return "the connection could not be established";
    case 1008:
      return "rejected by the server";
    case 1011:
      return "the server hit an error";
    default:
      return "closed";
  }
}

export interface ControlSocket {
  state: SocketState;
  failure: string | null;
  /** Open it. Doing this twice is a no-op, so a double click cannot fork it. */
  open: (url: string) => void;
  close: () => void;
  send: (text: string) => boolean;
  clearFailure: () => void;
}

export function useControlSocket({
  onMessage,
  onControl,
  onOpen,
  onClose,
}: {
  /** A frame from the upstream. Control frames never arrive here. */
  onMessage?: (data: string) => void;
  onControl?: (frame: ControlFrame) => void;
  /** The browser socket reached DataPilot; the upstream is still being dialled. */
  onOpen?: () => void;
  onClose?: (reason: string, reachedUpstream: boolean) => void;
} = {}): ControlSocket {
  const [state, setState] = useState<SocketState>("closed");
  const [failure, setFailure] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  // a socket that never reached the upstream closed because it could not
  const reached = useRef(false);

  // the callbacks are rebuilt every render, and rebinding a live socket's
  // handlers on each one would drop frames arriving in between
  const handlers = useRef({ onMessage, onControl, onOpen, onClose });
  handlers.current = { onMessage, onControl, onOpen, onClose };

  // a component that goes away must not leave a socket open
  useEffect(
    () => () => {
      socketRef.current?.close();
      socketRef.current = null;
    },
    []
  );

  const close = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    setState("closed");
    setFailure(null);
  }, []);

  const open = useCallback((url: string) => {
    if (socketRef.current) return;

    setState("connecting");
    setFailure(null);
    reached.current = false;

    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.onopen = () => handlers.current.onOpen?.();

    socket.onmessage = (event) => {
      const data = String(event.data);
      const control = readControlFrame(data);

      if (control) {
        if (control.status === "ready") {
          reached.current = true;
          setState("open");
          setFailure(null);
        }
        if (control.status === "error") setFailure(control.detail);
        handlers.current.onControl?.(control);
        return;
      }

      handlers.current.onMessage?.(data);
    };

    socket.onclose = (event) => {
      setState("closed");
      socketRef.current = null;

      const reason = event.reason || describeCloseCode(event.code);
      // a close before the upstream was ever reached is a failure to report;
      // the detail usually arrived as a control frame just before it
      if (!reached.current) setFailure((current) => current ?? reason);
      handlers.current.onClose?.(reason, reached.current);
    };
  }, []);

  const send = useCallback((text: string) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return false;
    socketRef.current.send(text);
    return true;
  }, []);

  return {
    state,
    failure,
    open,
    close,
    send,
    clearFailure: useCallback(() => setFailure(null), []),
  };
}
