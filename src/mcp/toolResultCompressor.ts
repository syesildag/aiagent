/**
 * Recursively removes null, undefined, empty-string, empty-array, and empty-object
 * fields from a parsed JSON value. Returns the pruned value, or undefined if the
 * entire value should be dropped (e.g. a top-level null).
 */
function pruneEmpty(value: unknown): unknown {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  if (Array.isArray(value)) {
    const pruned = value.map(pruneEmpty).filter(v => v !== undefined);
    return pruned.length === 0 ? undefined : pruned;
  }
  if (typeof value === 'object') {
    const pruned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const prunedV = pruneEmpty(v);
      if (prunedV !== undefined) {
        pruned[k] = prunedV;
      }
    }
    return Object.keys(pruned).length === 0 ? undefined : pruned;
  }
  return value;
}

/**
 * Compresses a tool result string for storage in conversation history.
 *
 * Steps:
 * 1. Parse as JSON (if valid): prune null/empty fields, compact re-serialize.
 * 2. Truncate to maxChars with a marker suffix if still over limit.
 * 3. Fall back to plain truncation for non-JSON strings (error messages, etc.).
 *
 * The live session's messages[] array always receives the full tool result.
 * Only the history-persisted copy goes through this function.
 */
export function compressForHistory(result: string, maxChars: number): string {
  let compressed: string;

  try {
    const parsed = JSON.parse(result);
    const pruned = pruneEmpty(parsed);
    compressed = JSON.stringify(pruned ?? parsed);
  } catch {
    compressed = result;
  }

  if (compressed.length <= maxChars) {
    return compressed;
  }
  return compressed.slice(0, maxChars) + '...[history truncated]';
}
