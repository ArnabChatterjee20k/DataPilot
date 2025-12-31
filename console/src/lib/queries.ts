// Helper function to get table list query based on connection type
export const getTablesQuery = (connectionType: string): string => {
  switch (connectionType) {
    case "sqlite":
      return "SELECT name FROM sqlite_master WHERE type='table'";
    case "postgres":
      return "SELECT table_name as name FROM information_schema.tables WHERE table_schema = 'public'";
    case "mysql":
      return "SELECT table_name as name FROM information_schema.tables WHERE table_schema = DATABASE()";
    default:
      return "SELECT name FROM sqlite_master WHERE type='table'";
  }
};

// only user-defined schemas using a query
export const getPostgresSchemasQuery =
  (): string => `SELECT nspname AS schema_name
FROM pg_catalog.pg_namespace
WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'`;

// Helper function to get initial rows query with pagination
export const getRowsQuery = (
  entityName: string,
  limit: number = 100,
  offset: number = 0
): string => {
  return `SELECT * FROM ${entityName} LIMIT ${limit} OFFSET ${offset}`;
};

export function getQueryWithRowOffsetAndLimits(
  query: string,
  limit: number,
  offset: number
) {
  const lower = query.toLowerCase();
  let newQuery = query;

  if (limit < 0) return query;
  const hasLimit = lower.includes(" limit ");
  const hasOffset = lower.includes(" offset ");

  if (!hasLimit) {
    newQuery += ` LIMIT ${limit >= 0 ? limit : -1}`;
  }

  if (!hasOffset) {
    newQuery += ` OFFSET ${Math.max(0, offset)}`;
  }

  return newQuery;
}

export const getTableRecordsSearchQuery = (
  connectionType: string,
  table: string,
  search: string,
  columns: string[],
  limit: number = 20
): string => {
  if (!table || !columns.length) return "";

  switch (connectionType) {
    case "sqlite": {
      const q = `%${search}%`;

      const where = columns.map((col) => `${col} LIKE '${q}'`).join(" OR ");

      const orderBy = columns
        .map((col) => `CASE WHEN ${col} LIKE '${search}%' THEN 0 ELSE 1 END`)
        .join(", ");

      return `
        SELECT *
        FROM ${table}
        WHERE (${where})
        ORDER BY
          ${orderBy}
        LIMIT ${limit}
      `;
    }

    case "postgres": {
      const q = `%${search}%`;

      const where = columns.map((col) => `${col} ILIKE '${q}'`).join(" OR ");

      const orderBy = columns
        .map((col) => `CASE WHEN ${col} ILIKE '${search}%' THEN 0 ELSE 1 END`)
        .join(", ");

      return `
        SELECT *
        FROM ${table}
        WHERE (${where})
        ORDER BY
          ${orderBy}
        LIMIT ${limit}
      `;
    }

    case "mysql": {
      const q = `%${search}%`;

      const where = columns.map((col) => `${col} LIKE '${q}'`).join(" OR ");

      const orderBy = columns
        .map((col) => `CASE WHEN ${col} LIKE '${search}%' THEN 0 ELSE 1 END`)
        .join(", ");

      return `
        SELECT *
        FROM ${table}
        WHERE (${where})
        ORDER BY
          ${orderBy}
        LIMIT ${limit}
      `;
    }

    default:
      return "";
  }
};
