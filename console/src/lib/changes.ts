import type { Column } from "@/lib/columns";
import { parseDate } from "@/lib/format";
import { rowIdentity } from "@/lib/sql";

/** Rows touched within this window count as recent. */
export const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface RowChanges {
  /** Row identities whose values differ from the previous load. */
  changed: Set<string>;
  /** Row identities that were not present in the previous load. */
  added: Set<string>;
  /** Row identities whose recency column falls inside RECENT_WINDOW_MS. */
  recent: Set<string>;
  recencyColumn: string | null;
}

export const NO_CHANGES: RowChanges = {
  changed: new Set(),
  added: new Set(),
  recent: new Set(),
  recencyColumn: null,
};

/** The timestamp column that best represents "when this row last changed". */
export function recencyColumn(columns: Column[]): string | null {
  const preferred = ["updated_at", "modified_at", "created_at", "inserted_at"];
  for (const name of preferred) {
    const match = columns.find(
      (column) => column.name.toLowerCase() === name && column.kind === "timestamp"
    );
    if (match) return match.name;
  }
  return columns.find((column) => column.kind === "timestamp")?.name ?? null;
}

function fingerprint(row: Record<string, unknown>): string {
  try {
    return JSON.stringify(row);
  } catch {
    return String(row);
  }
}

/**
 * Compare a freshly loaded page against the one it replaced.
 *
 * Rows are matched by primary key, so a row that moved position is still the
 * same row; without a primary key nothing is reported, because position is not
 * identity and highlighting on it would be noise.
 */
export function diffRows(
  rows: Record<string, unknown>[],
  previous: Record<string, unknown>[] | undefined,
  columns: Column[],
  primaryKey: Column | null
): RowChanges {
  const recency = recencyColumn(columns);
  const recent = new Set<string>();

  if (recency) {
    const cutoff = Date.now() - RECENT_WINDOW_MS;
    rows.forEach((row, index) => {
      const date = parseDate(row[recency]);
      if (date && date.getTime() >= cutoff) {
        recent.add(rowIdentity(row, primaryKey, index));
      }
    });
  }

  if (!previous || !primaryKey) {
    return { changed: new Set(), added: new Set(), recent, recencyColumn: recency };
  }

  const before = new Map<string, string>();
  previous.forEach((row, index) => {
    before.set(rowIdentity(row, primaryKey, index), fingerprint(row));
  });

  const changed = new Set<string>();
  const added = new Set<string>();

  rows.forEach((row, index) => {
    const identity = rowIdentity(row, primaryKey, index);
    const seen = before.get(identity);
    if (seen === undefined) added.add(identity);
    else if (seen !== fingerprint(row)) changed.add(identity);
  });

  return { changed, added, recent, recencyColumn: recency };
}
