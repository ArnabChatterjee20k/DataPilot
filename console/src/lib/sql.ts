import type { Column } from "@/lib/columns";

export type SourceType = "sqlite" | "postgres" | "mysql" | "api";

/**
 * Quote an identifier so a column called `order` or `select` still works.
 *
 * MySQL uses backticks; everything else here uses the SQL standard double
 * quote. Embedded quote characters are doubled, which is what makes this safe
 * to interpolate.
 */
export function quoteIdentifier(name: string, source: SourceType = "sqlite"): string {
  if (source === "mysql") return "`" + name.replace(/`/g, "``") + "`";
  return '"' + name.replace(/"/g, '""') + '"';
}

export function qualify(
  table: string,
  schema?: string | null,
  source: SourceType = "sqlite"
): string {
  const quoted = quoteIdentifier(table, source);
  return schema ? `${quoteIdentifier(schema, source)}.${quoted}` : quoted;
}

/** Quote a value as a SQL literal. Single quotes are doubled, never stripped. */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * Render a filter value for its column type.
 *
 * A number column gets a bare numeric literal, a boolean gets the dialect's
 * boolean, and everything else is quoted — so `name = 'O'Brien'` no longer
 * produces a syntax error, and a numeric id is not compared as a string.
 */
export function literalFor(
  value: unknown,
  column: Pick<Column, "kind"> | undefined,
  source: SourceType = "sqlite"
): string {
  if (value === null || value === undefined) return "NULL";

  const kind = column?.kind;

  if (typeof value === "boolean" || kind === "boolean") {
    const truthy =
      value === true || value === 1 || value === "true" || value === "1" || value === "t";
    if (source === "postgres") return truthy ? "TRUE" : "FALSE";
    return truthy ? "1" : "0";
  }

  if (kind === "number") {
    const text = String(value);
    if (NUMERIC.test(text)) return text;
  }

  if (typeof value === "number" && Number.isFinite(value)) return String(value);

  if (typeof value === "object") return quoteLiteral(JSON.stringify(value));

  return quoteLiteral(String(value));
}

export interface Filter {
  column: string;
  operator: "=" | "!=" | "is null" | "is not null" | "contains" | ">" | "<";
  value?: unknown;
}

export function filterKey(filter: Filter): string {
  return `${filter.column}:${filter.operator}:${String(filter.value ?? "")}`;
}

export function describeFilter(filter: Filter): string {
  switch (filter.operator) {
    case "is null":
      return `${filter.column} is null`;
    case "is not null":
      return `${filter.column} is not null`;
    case "contains":
      return `${filter.column} contains "${String(filter.value)}"`;
    default:
      return `${filter.column} ${filter.operator} ${String(filter.value)}`;
  }
}

function filterClause(
  filter: Filter,
  columns: Map<string, Column>,
  source: SourceType
): string {
  const identifier = quoteIdentifier(filter.column, source);
  const column = columns.get(filter.column);

  switch (filter.operator) {
    case "is null":
      return `${identifier} IS NULL`;
    case "is not null":
      return `${identifier} IS NOT NULL`;
    case "contains": {
      const operator = source === "postgres" ? "ILIKE" : "LIKE";
      const pattern = `%${String(filter.value ?? "").replace(/[%_]/g, "\\$&")}%`;
      const escape = source === "sqlite" ? " ESCAPE '\\'" : "";
      const cast = source === "postgres" ? `${identifier}::text` : identifier;
      return `${cast} ${operator} ${quoteLiteral(pattern)}${escape}`;
    }
    default:
      return `${identifier} ${filter.operator} ${literalFor(filter.value, column, source)}`;
  }
}

export interface BuildOptions {
  table: string;
  schema?: string | null;
  source: SourceType;
  columns: Column[];
  filters?: Filter[];
  sort?: { column: string; direction: "asc" | "desc" } | null;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Build the SELECT the grid runs. Filters are ANDed — deliberately, so the
 * result of stacking them stays predictable.
 */
export function buildSelect(options: BuildOptions): string {
  const {
    table,
    schema,
    source,
    columns,
    filters = [],
    sort,
    search,
    limit,
    offset,
  } = options;

  const byName = new Map(columns.map((column) => [column.name, column]));
  const clauses = filters.map((filter) => filterClause(filter, byName, source));

  const searchTerm = (search ?? "").trim();
  if (searchTerm) {
    const searchable = columns.filter(
      (column) => column.kind !== "binary" && !column.sensitive
    );
    if (searchable.length) {
      const matches = searchable.map((column) =>
        filterClause(
          { column: column.name, operator: "contains", value: searchTerm },
          byName,
          source
        )
      );
      clauses.push(`(${matches.join(" OR ")})`);
    }
  }

  let statement = `SELECT * FROM ${qualify(table, schema, source)}`;
  if (clauses.length) statement += `\nWHERE ${clauses.join("\n  AND ")}`;
  if (sort) {
    statement += `\nORDER BY ${quoteIdentifier(sort.column, source)} ${
      sort.direction === "desc" ? "DESC" : "ASC"
    }`;
  }
  if (limit !== undefined && limit >= 0) statement += `\nLIMIT ${limit}`;
  if (offset) statement += `\nOFFSET ${offset}`;
  return statement;
}

/** The column a table should sort by when the user has not chosen one. */
export function defaultSortColumn(columns: Column[]): string | null {
  const preferred = ["updated_at", "modified_at", "created_at", "inserted_at"];
  for (const name of preferred) {
    const match = columns.find(
      (column) => column.name.toLowerCase() === name && column.kind === "timestamp"
    );
    if (match) return match.name;
  }
  return null;
}

export function primaryKeyOf(columns: Column[]): Column | null {
  return columns.find((column) => column.primary_key) ?? null;
}

/** Identity for a row: its primary key when there is one, else its position. */
export function rowIdentity(
  row: Record<string, unknown>,
  primaryKey: Column | null,
  index: number
): string {
  if (primaryKey) {
    const value = row[primaryKey.name];
    if (value !== null && value !== undefined) return `pk:${String(value)}`;
  }
  return `row:${index}`;
}

export function buildDelete(
  table: string,
  schema: string | null | undefined,
  source: SourceType,
  primaryKey: Column,
  values: unknown[]
): string {
  const list = values.map((value) => literalFor(value, primaryKey, source)).join(", ");
  return `DELETE FROM ${qualify(table, schema, source)} WHERE ${quoteIdentifier(
    primaryKey.name,
    source
  )} IN (${list})`;
}

export function buildInsert(
  table: string,
  schema: string | null | undefined,
  source: SourceType,
  columns: Column[],
  values: Record<string, unknown>
): string {
  const used = columns.filter((column) => {
    if (column.primary_key && !values[column.name]) return false;
    return values[column.name] !== undefined;
  });
  if (!used.length) throw new Error("Give at least one column a value");

  const names = used.map((column) => quoteIdentifier(column.name, source)).join(", ");
  const literals = used
    .map((column) => literalFor(values[column.name], column, source))
    .join(", ");
  return `INSERT INTO ${qualify(table, schema, source)} (${names}) VALUES (${literals})`;
}

export function buildUpdate(
  table: string,
  schema: string | null | undefined,
  source: SourceType,
  columns: Column[],
  primaryKey: Column,
  keyValue: unknown,
  changes: Record<string, unknown>
): string {
  const byName = new Map(columns.map((column) => [column.name, column]));
  const assignments = Object.entries(changes)
    .filter(([name]) => name !== primaryKey.name && byName.has(name))
    .map(
      ([name, value]) =>
        `${quoteIdentifier(name, source)} = ${literalFor(value, byName.get(name), source)}`
    );
  if (!assignments.length) throw new Error("Nothing changed");

  return (
    `UPDATE ${qualify(table, schema, source)} SET ${assignments.join(", ")} ` +
    `WHERE ${quoteIdentifier(primaryKey.name, source)} = ${literalFor(
      keyValue,
      primaryKey,
      source
    )}`
  );
}
