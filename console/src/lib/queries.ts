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
