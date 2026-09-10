import type { Column, ColumnKind } from "@/lib/columns";

export type { ColumnKind };

/** What a cell holds, beyond its printed text. */
export type CellState = "value" | "null" | "empty" | "masked";

export interface FormattedCell {
  text: string;
  state: CellState;
  /** Full untruncated text, for copy and for the expanded view. */
  full: string;
  title?: string;
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
  ["second", 1000],
];

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
  style: "narrow",
});

export function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const fromEpoch = new Date(value < 1e12 ? value * 1000 : value);
    return Number.isNaN(fromEpoch.getTime()) ? null : fromEpoch;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "3h ago" / "in 2d", falling back to the absolute value when far away. */
export function relativeTime(value: unknown): string | null {
  const date = parseDate(value);
  if (!date) return null;

  const delta = date.getTime() - Date.now();
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(delta) >= ms || unit === "second") {
      return relativeFormatter.format(Math.round(delta / ms), unit);
    }
  }
  return null;
}

export function absoluteTime(value: unknown): string | null {
  const date = parseDate(value);
  return date ? date.toISOString().replace("T", " ").replace("Z", " UTC") : null;
}

const numberFormatter = new Intl.NumberFormat();

export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : numberFormatter.format(value);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function prettyJson(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export interface FormatOptions {
  kind?: ColumnKind;
  /** Sensitive columns are masked until the viewer asks to reveal them. */
  masked?: boolean;
  /** Show timestamps as "3h ago" rather than the raw value. */
  relativeDates?: boolean;
}

export function formatCell(value: unknown, options: FormatOptions = {}): FormattedCell {
  const { kind = "text", masked = false, relativeDates = true } = options;

  if (value === null || value === undefined) {
    return { text: "null", state: "null", full: "" };
  }

  if (masked) {
    const full = stringify(value);
    return { text: "••••••••", state: "masked", full, title: "Hidden — click to reveal" };
  }

  if (typeof value === "boolean") {
    return { text: value ? "true" : "false", state: "value", full: String(value) };
  }

  if (kind === "timestamp" && relativeDates) {
    const relative = relativeTime(value);
    if (relative) {
      return {
        text: relative,
        state: "value",
        full: stringify(value),
        title: absoluteTime(value) ?? undefined,
      };
    }
  }

  if (kind === "json") {
    const full = stringify(value);
    return { text: full, state: "value", full, title: prettyJson(value) };
  }

  const text = stringify(value);
  if (text === "") {
    return { text: "empty", state: "empty", full: "" };
  }
  return { text, state: "value", full: text };
}

/** Columns whose values are short and repeat are rendered as pills. */
export function looksEnumLike(
  kind: ColumnKind,
  distinctCount: number | null | undefined,
  rowCount: number
): boolean {
  if (kind !== "text" && kind !== "boolean") return false;
  if (kind === "boolean") return true;
  if (!distinctCount || rowCount < 3) return false;
  return distinctCount <= 8 && distinctCount <= rowCount / 2;
}

const PILL_CLASSES = [
  "bg-sky-500/15 text-sky-300 border-sky-500/25",
  "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  "bg-amber-500/15 text-amber-300 border-amber-500/25",
  "bg-violet-500/15 text-violet-300 border-violet-500/25",
  "bg-rose-500/15 text-rose-300 border-rose-500/25",
  "bg-teal-500/15 text-teal-300 border-teal-500/25",
];

/** Stable colour for an enum value, so the same value always looks the same. */
export function pillClass(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return PILL_CLASSES[hash % PILL_CLASSES.length];
}

export const KIND_LABEL: Record<ColumnKind, string> = {
  uuid: "uuid",
  text: "text",
  number: "number",
  boolean: "bool",
  timestamp: "time",
  json: "json",
  binary: "binary",
};

export const KIND_CLASS: Record<ColumnKind, string> = {
  uuid: "text-violet-400",
  text: "text-muted-foreground",
  number: "text-sky-400",
  boolean: "text-emerald-400",
  timestamp: "text-amber-400",
  json: "text-teal-400",
  binary: "text-rose-400",
};

/** Space the header spends on the drag grip, sort arrow and options chevron. */
const HEADER_CHROME = 80;
const CELL_PADDING = 34;
const MIN_WIDTH = 104;
const MAX_WIDTH = 420;

/** Width a column needs, from its header and the first rows of data. */
export function estimateColumnWidth(
  column: Column,
  rows: Record<string, unknown>[],
  sample = 30
): number {
  const characterWidth = column.monospace ? 8.6 : 7.9;

  // the header carries controls as well as the name, so it is measured
  // separately - otherwise a short name like "total" gets clipped by them
  let width = column.name.length * 7.4 + HEADER_CHROME;

  for (const row of rows.slice(0, sample)) {
    const value = row[column.name];
    if (value === null || value === undefined) continue;
    const cellWidth = stringify(value).length * characterWidth + CELL_PADDING;
    if (cellWidth > width) width = cellWidth;
  }

  return Math.round(Math.min(Math.max(width, MIN_WIDTH), MAX_WIDTH));
}
