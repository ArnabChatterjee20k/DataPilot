import type { ColumnModel } from "@/lib/sdk";

export type ColumnKind = NonNullable<ColumnModel["kind"]>;

/**
 * The column shape the UI works with.
 *
 * Every field on the generated `ColumnModel` is optional because it has a
 * server-side default; normalising once here keeps `?? false` out of every
 * component that touches a column.
 */
export interface Column {
  name: string;
  type: string | null;
  kind: ColumnKind;
  nullable: boolean;
  default: string | null;
  primary_key: boolean;
  indexed: boolean;
  sensitive: boolean;
  monospace: boolean;
  position: number;
}

export function toColumn(model: ColumnModel, index = 0): Column {
  return {
    name: model.name,
    type: model.type ?? null,
    kind: model.kind ?? "text",
    nullable: model.nullable ?? true,
    default: model.default ?? null,
    primary_key: model.primary_key ?? false,
    indexed: model.indexed ?? false,
    sensitive: model.sensitive ?? false,
    monospace: model.monospace ?? false,
    position: model.position ?? index + 1,
  };
}

export function toColumns(models: ColumnModel[] | undefined | null): Column[] {
  return (models ?? []).map(toColumn);
}

const JSON_SHAPE = /^\s*[[{][\s\S]*[\]}]\s*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;
const NUMERIC = /^-?\d+(\.\d+)?$/;

function kindOfValue(value: unknown): ColumnKind | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "object") return "json";
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (JSON_SHAPE.test(trimmed)) return "json";
  if (ISO_DATE.test(trimmed) && !Number.isNaN(Date.parse(trimmed))) return "timestamp";
  if (NUMERIC.test(trimmed)) return "number";
  return "text";
}

/**
 * Sharpen column kinds using the rows on screen.
 *
 * A free-form query has no table behind it, so the server can only report the
 * driver's own type - which SQLite leaves empty. Reading the values recovers
 * the difference between a number, a timestamp and a JSON document, and only
 * ever refines a column the server called plain text.
 */
export function refineColumns(columns: Column[], rows: Record<string, unknown>[]): Column[] {
  if (!rows.length) return columns;

  return columns.map((column) => {
    if (column.kind !== "text") return column;

    let agreed: ColumnKind | null = null;
    let seen = 0;

    for (const row of rows) {
      const kind = kindOfValue(row[column.name]);
      if (!kind) continue;
      seen += 1;
      if (agreed === null) agreed = kind;
      else if (agreed !== kind) return column;
    }

    if (!seen || agreed === null || agreed === "text") return column;
    return {
      ...column,
      kind: agreed,
      monospace: column.monospace || agreed === "json",
    };
  });
}

/** Number of distinct values per column across the given rows. */
export function distinctCounts(
  columns: Column[],
  rows: Record<string, unknown>[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const column of columns) {
    const seen = new Set<string>();
    for (const row of rows) {
      const value = row[column.name];
      if (value === null || value === undefined) continue;
      seen.add(typeof value === "object" ? JSON.stringify(value) : String(value));
    }
    counts[column.name] = seen.size;
  }
  return counts;
}

/**
 * Apply a saved column order, keeping columns the order does not mention (a
 * table can gain a column between sessions) in their natural position.
 */
export function applyColumnOrder(columns: Column[], order: string[]): Column[] {
  if (!order.length) return columns;

  const byName = new Map(columns.map((column) => [column.name, column]));
  const ordered: Column[] = [];

  for (const name of order) {
    const column = byName.get(name);
    if (column) {
      ordered.push(column);
      byName.delete(name);
    }
  }
  return [...ordered, ...columns.filter((column) => byName.has(column.name))];
}

/** Move `from` to sit where `to` currently is. */
export function moveColumn(names: string[], from: string, to: string): string[] {
  const next = names.filter((name) => name !== from);
  const target = next.indexOf(to);
  if (target === -1) return names;
  next.splice(target, 0, from);
  return next;
}
