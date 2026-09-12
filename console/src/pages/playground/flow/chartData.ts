import type { ChartPoint } from "./Chart";
import type { LiveFeed } from "./useLiveNodes";
import type { FlowNode, NodeRun } from "./types";

/**
 * Turning whatever fed a graph node into points it can draw.
 *
 * Two shapes arrive here. A query node hands over rows that are already a
 * table, and a socket node hands over a feed of frames that becomes one. They
 * are the same problem once flattened, so they are flattened here rather than
 * inside the chart, which should only know about points.
 */

/** Reach into a nested value with a dotted path, the way a reference does. */
function at(value: unknown, path: string): unknown {
  return path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((current, step) => {
      if (current && typeof current === "object") {
        return (current as Record<string, unknown>)[step];
      }
      return undefined;
    }, value);
}

function asNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** The rows an upstream node produced, whichever kind produced them. */
export function rowsFrom(
  upstream: FlowNode | undefined,
  run: NodeRun | undefined,
  feed: LiveFeed | undefined
): Record<string, unknown>[] {
  if (!upstream) return [];

  if (upstream.kind === "socket") {
    return (feed?.messages ?? []).map((message, index) =>
      message.value && typeof message.value === "object"
        ? { ...(message.value as Record<string, unknown>), at: message.at }
        : // a frame that is not JSON still has a position and a clock, which
          // is enough to draw how often it arrives
          { at: message.at, index, text: message.text }
    );
  }

  const result = run?.result as Record<string, unknown> | undefined;
  const rows = result?.rows;
  if (Array.isArray(rows)) return rows as Record<string, unknown>[];

  // a request node: its parsed body if that happens to be a list of things
  const body = result?.body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
    } catch {
      return [];
    }
  }
  return [];
}

/** Every field in the rows worth offering as an axis. */
export function fieldsOf(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows.slice(0, 20)) {
    for (const key of Object.keys(row ?? {})) seen.add(key);
  }
  return [...seen];
}

/** The fields that hold numbers, which are the only ones a line can use. */
export function numericFields(rows: Record<string, unknown>[]): string[] {
  return fieldsOf(rows).filter((field) =>
    rows.slice(0, 20).some((row) => asNumber(row?.[field]) !== null)
  );
}

export function toPoints(
  rows: Record<string, unknown>[],
  x: string,
  series: string[],
  window = 100
): ChartPoint[] {
  // the tail, because a live feed is read at its newest end
  const recent = rows.slice(-Math.max(window, 1));

  return recent.map((row, index) => {
    const point: ChartPoint = {
      // no x field chosen yet: the order they arrived in is still a story
      x: x ? (asNumber(at(row, x)) ?? String(at(row, x) ?? index)) : index,
    };
    for (const name of series) point[name] = asNumber(at(row, name));
    return point;
  });
}
