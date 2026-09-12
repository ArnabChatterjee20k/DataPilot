/**
 * The paths a node's own output offers, read off the output itself.
 *
 * Writing `rows.*.total` from memory means knowing the shape of what came
 * back, which is exactly what someone is looking at the result panel to find
 * out. Reading the shape and offering it removes the guess.
 */

/** Past this depth a path is more likely a mistake than a checkable field. */
const MAX_DEPTH = 4;

/** Past this many, the list stops being a help. */
const MAX_PATHS = 40;

export function pathsIn(value: unknown, prefix = "", depth = 0): string[] {
  if (depth > MAX_DEPTH || value == null) return prefix ? [prefix] : [];

  if (Array.isArray(value)) {
    if (!value.length) return prefix ? [prefix] : [];
    // one branch for every item rather than one per index: a check about a
    // table is nearly always about all of its rows
    const each = prefix ? `${prefix}.*` : "*";
    return [...(prefix ? [prefix] : []), ...pathsIn(value[0], each, depth + 1)];
  }

  if (typeof value === "object") {
    const found: string[] = prefix ? [prefix] : [];
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      found.push(...pathsIn(child, prefix ? `${prefix}.${key}` : key, depth + 1));
    }
    return found;
  }

  return prefix ? [prefix] : [];
}

/** Every path worth offering for a check, nearest the surface first. */
export function checkablePaths(result: unknown): string[] {
  const seen = new Set<string>();
  for (const path of pathsIn(result)) {
    if (path) seen.add(path);
  }
  return [...seen]
    .sort((a, b) => a.split(".").length - b.split(".").length || a.localeCompare(b))
    .slice(0, MAX_PATHS);
}
