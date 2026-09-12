import { useCallback, useEffect, useRef, useState } from "react";

import { client } from "@/lib/sdk/client.gen";
import { useTabsStore, type FlowRunState } from "../store/store";
import type { NodeRun, RunSummary } from "./types";

const CONTROL_KEY = "__datapilot";

function runUrl(flowUid: string): string {
  const base = client.getConfig().baseUrl ?? "";
  const origin = base.startsWith("http") ? base : window.location.origin;
  const url = new URL(`/flows/${flowUid}/run`, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/**
 * Run a flow, watching every node as it goes.
 *
 * The server reports each node the moment its state changes rather than
 * answering once at the end, because where a flow stopped is the question a
 * flow exists to answer - and a node that flips straight from idle to done
 * answers nothing.
 */
export function useFlowRun(flowUid: string | undefined) {
  // the canvas is remounted on every tab change, so what a run reported lives
  // in the store rather than here; reading it back is the whole point
  const stored = useTabsStore((state) => state.flowRuns[flowUid ?? ""]);
  const setFlowRun = useTabsStore((state) => state.setFlowRun);

  const runs = (stored?.runs ?? {}) as Record<string, NodeRun>;
  const summary = (stored?.summary ?? null) as RunSummary | null;

  const keep = useCallback(
    (next: Partial<FlowRunState>) => {
      if (!flowUid) return;
      setFlowRun(flowUid, {
        runs: next.runs ?? runsRef.current,
        summary: next.summary !== undefined ? next.summary : summaryRef.current,
      });
    },
    [flowUid, setFlowRun]
  );

  // the socket callbacks are built once, so they read the latest through refs
  const runsRef = useRef<Record<string, NodeRun>>({});
  const summaryRef = useRef<RunSummary | null>(null);
  runsRef.current = runs;
  summaryRef.current = summary;

  const [isRunning, setIsRunning] = useState(false);
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
    setIsRunning(false);
  }, []);

  const run = useCallback(() => {
    if (!flowUid || socketRef.current) return;

    keep({ runs: {}, summary: null });
    setFailure(null);
    setIsRunning(true);

    const socket = new WebSocket(runUrl(flowUid));
    socketRef.current = socket;

    socket.onmessage = (event) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (CONTROL_KEY in frame) {
        const state = frame[CONTROL_KEY];
        if (state === "error") setFailure(String(frame.detail ?? "The flow could not run"));
        if (state === "finished") {
          try {
            keep({ summary: JSON.parse(String(frame.detail)) });
          } catch {
            /* the run still finished, only the tally is missing */
          }
        }
        return;
      }

      const node = frame.node as NodeRun | undefined;
      if (node?.id) keep({ runs: { ...runsRef.current, [node.id]: node } });
    };

    socket.onclose = () => {
      socketRef.current = null;
      setIsRunning(false);
    };
  }, [flowUid, keep]);

  /** A saved flow that has never run shows nothing, which is correct. */
  const reset = useCallback(() => {
    keep({ runs: {}, summary: null });
    setFailure(null);
  }, [keep]);

  return { runs, isRunning, summary, failure, run, stop, reset };
}
