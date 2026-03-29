-- Add B-tree indexes on embedding_model so that similarity searches can filter
-- to only same-dimension rows cheaply, before computing vector distances.
--
-- Migration 010 introduced the embedding_model column but no index on it.
-- Without this index every vector search scans the entire table before applying
-- the embedding_model filter, which is unnecessarily slow.
--
-- Note on HNSW / IVFFLAT vector indexes:
--   pgvector requires a fixed dimension when creating HNSW or IVFFLAT indexes.
--   Because the embedding column is declared as vector (no fixed dimension),
--   a partial index per model using an explicit cast can be added later:
--
--     CREATE INDEX idx_memories_embedding_<model_slug>
--       ON ai_agent_memories USING hnsw ((embedding::vector(DIM)) vector_cosine_ops)
--       WHERE embedding_model = '<provider>:<model-id>';
--
--   DIM must match the actual output dimension of that model.
--   The query in memory.ts already casts the column to the query vector's
--   dimension, so no further query changes are needed to exploit such indexes.

CREATE INDEX IF NOT EXISTS idx_memories_embedding_model
  ON ai_agent_memories(embedding_model);

CREATE INDEX IF NOT EXISTS idx_document_embedding_model
  ON ai_agent_document(embedding_model);
