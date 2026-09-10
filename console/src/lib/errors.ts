/** Pull a readable message out of whatever the SDK or fetch threw. */
export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (!error) return fallback;
  if (typeof error === "string") return error;

  const candidate = error as {
    detail?: unknown;
    message?: string;
    error?: { detail?: unknown };
    response?: { data?: { detail?: unknown } };
  };

  const detail =
    candidate.detail ?? candidate.error?.detail ?? candidate.response?.data?.detail;

  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: string; loc?: unknown[] } | undefined;
    if (first?.msg) {
      const field = Array.isArray(first.loc) ? first.loc.slice(1).join(".") : "";
      return field ? `${field}: ${first.msg}` : first.msg;
    }
  }
  if (candidate.message) return candidate.message;
  return fallback;
}

/**
 * A status the server uses when it could not reach the database at all, as
 * opposed to the query being wrong. The difference matters: one is fixed in
 * the editor, the other is fixed somewhere else entirely.
 */
export function isUnreachable(status: number | undefined): boolean {
  return status === 503 || status === 502 || status === 504;
}
