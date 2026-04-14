import { queryDatabase } from "./pgClient";

export type MemoryDuplicate = {
  id: number;
  type: string;
  source: string;
  similarity: string;
  keptId: number;
};

export type DeduplicateResult = {
  count: number;
  duplicates: MemoryDuplicate[];
};

/**
 * Find and optionally remove near-duplicate memories based on cosine similarity.
 *
 * userLogin scoping:
 *   string  — only this user's memories
 *   null    — only memories with no user_login (global)
 *   undefined (default) — all users in one pass
 */
export async function deduplicateMemories({
  threshold = 0.99,
  userLogin,
  dryRun = false,
}: {
  threshold?: number;
  userLogin?: string | null;
  dryRun?: boolean;
} = {}): Promise<DeduplicateResult> {
  const [userFilter, queryParams] =
    typeof userLogin === "string"
      ? [`AND m1.user_login = $2 AND m2.user_login = $2`, [threshold, userLogin]]
      : userLogin === null
        ? [`AND m1.user_login IS NULL AND m2.user_login IS NULL`, [threshold]]
        : [`AND m1.user_login IS NOT DISTINCT FROM m2.user_login`, [threshold]];

  const duplicates = (await queryDatabase(
    `SELECT m1.id, m1.type, m1.source,
            round((1 - (m1.embedding <=> m2.embedding))::numeric, 4) AS similarity,
            m2.id AS kept_id
       FROM ai_agent_memories AS m1
      INNER JOIN ai_agent_memories AS m2
         ON m1.id <> m2.id
        AND m1.id < m2.id
      WHERE m1.embedding_model = m2.embedding_model
        AND m1.type = m2.type
        AND (1 - (m1.embedding <=> m2.embedding)) > $1
        ${userFilter}
      ORDER BY similarity DESC`,
    queryParams,
  )) as Array<{ id: number; type: string; source: string; similarity: string; kept_id: number }>;

  const result: MemoryDuplicate[] = duplicates.map((r) => ({
    id: r.id,
    type: r.type,
    source: r.source,
    similarity: r.similarity,
    keptId: r.kept_id,
  }));

  if (!dryRun && result.length > 0) {
    await queryDatabase(
      `DELETE FROM ai_agent_memories WHERE id = ANY($1)`,
      [result.map((r) => r.id)],
    );
  }

  return { count: result.length, duplicates: result };
}
