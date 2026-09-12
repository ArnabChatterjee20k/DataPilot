import type { ChartPoint } from "./Chart";
import type { LiveFeed } from "./useLiveNodes";
import type { ChartSeries, FlowNode, NodeRun } from "./types";

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


/**
 * The keys in a pasted example.
 *
 * Accepts one object or a list of them, because people paste whichever they
 * happen to have in front of them.
 */
export function fieldsFromSample(sample: string): string[] {
  const text = (sample ?? "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return fieldsOf(rows.filter((row) => row && typeof row === "object"));
  } catch {
    return [];
  }
}

/** Is a pasted example there but unreadable? Worth saying, rather than ignoring. */
export function sampleIsBroken(sample: string): boolean {
  const text = (sample ?? "").trim();
  if (!text) return false;
  try {
    JSON.parse(text);
    return false;
  } catch {
    return true;
  }
}

/**
 * Every field worth offering, from the data and from the example together.
 *
 * Real data wins the ordering, because once something has arrived it is the
 * better answer; the example keeps offering what has not arrived yet.
 */
export function suggestedFields(
  rows: Record<string, unknown>[],
  sample: string
): string[] {
  const real = numericFields(rows);
  const seen = new Set(real);
  return [...real, ...fieldsFromSample(sample).filter((field) => !seen.has(field))];
}


/** One feeding node: what it is called, and the rows it has produced. */
export interface Source {
  id: string;
  name: string;
  kind: FlowNode["kind"];
  rows: Record<string, unknown>[];
  /** True while it keeps arriving, which is why the chart has to redraw. */
  live: boolean;
}

/**
 * Merge several sources into one set of points.
 *
 * A graph can be fed by a table that was queried once and a socket that is
 * still arriving. The static one holds its shape while the live one grows, so
 * they are laid alongside each other by position rather than zipped: pairing
 * row 400 of a feed with row 400 of a six row table would invent data.
 */
export function pointsFromSources(
  sources: Source[],
  series: ChartSeries[],
  x: string,
  window = 100
): ChartPoint[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const longest = Math.max(
    0,
    ...series.map((item) => byId.get(item.from)?.rows.length ?? 0)
  );
  if (!longest) return [];

  const from = Math.max(longest - Math.max(window, 1), 0);
  const points: ChartPoint[] = [];

  for (let index = from; index < longest; index += 1) {
    const point: ChartPoint = { x: index };

    for (const item of series) {
      const source = byId.get(item.from);
      if (!source) continue;
      // a shorter source simply stops: its line ends where its data does
      const offset = index - (longest - source.rows.length);
      const row = offset >= 0 ? source.rows[offset] : undefined;
      if (!row) continue;

      if (x) {
        const along = asNumber(at(row, x));
        if (along !== null) point.x = along;
      }
      point[seriesKey(item, sources)] = asNumber(at(row, item.field));
    }
    points.push(point);
  }
  return points;
}

/** How a series is labelled: the field alone unless two nodes feed the graph. */
export function seriesKey(item: ChartSeries, sources: Source[]): string {
  const source = sources.find((entry) => entry.id === item.from);
  return sources.length > 1 && source ? `${source.name}.${item.field}` : item.field;
}
