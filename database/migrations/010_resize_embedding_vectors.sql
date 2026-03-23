-- Replace hardcoded vector(1536) columns with dimension-agnostic vector columns.
--
-- Rationale: tying the schema to a specific embedding dimension couples the
-- database to a single provider.  When the active provider changes (or falls
-- back to a different model), stored embeddings become unqueryable.
--
-- Solution:
--   • Use vector (no dimension) so any provider's output is accepted.
--   • Add an embedding_model column (e.g. "local:Xenova/all-MiniLM-L6-v2")
--     recorded at insert time.
--   • Similarity searches filter WHERE embedding_model = $N so that only
--     same-dimension rows are compared — eliminating dimension-mismatch errors.
--
-- Existing 1536-dim embeddings are incompatible with new providers and are
-- dropped.  Memory content (JSONB) and document content are fully preserved.

-- ai_agent_memories --------------------------------------------------------

DROP INDEX IF EXISTS idx_memories_embedding;

ALTER TABLE ai_agent_memories DROP COLUMN embedding;
ALTER TABLE ai_agent_memories ADD COLUMN embedding vector;
ALTER TABLE ai_agent_memories ADD COLUMN embedding_model TEXT;

-- ai_agent_document --------------------------------------------------------

ALTER TABLE ai_agent_document DROP COLUMN embedding;
ALTER TABLE ai_agent_document ADD COLUMN embedding vector;
ALTER TABLE ai_agent_document ADD COLUMN embedding_model TEXT;
