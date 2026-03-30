-- Add indexes on embedding_model and partial HNSW vector indexes per model.
--
-- Migration 010 dropped the IVFFLAT index (it was tied to vector(1536)) and
-- added embedding_model TEXT, but created no new indexes. Without indexes:
--   - every similarity search scans all rows before filtering by model
--   - the vector <=> distance is computed for every row in the table
--
-- B-tree index on embedding_model:
--   Fast filtering so only same-dimension rows reach the vector scan.
--
-- HNSW partial indexes (one per known model):
--   pgvector HNSW requires a fixed-dimension column. Because the schema uses
--   dimension-free vector, each partial index uses a cast (embedding::vector(N))
--   scoped to rows WHERE embedding_model = '<value>'. All rows sharing the same
--   model always have the same dimension, so the cast is safe.
--   The query planner uses a partial index when the query's WHERE clause
--   includes the matching embedding_model literal.
--
-- When a new embedding model is introduced, add a new partial index in a
-- subsequent migration:
--   CREATE INDEX ... USING hnsw ((embedding::vector(DIM)) vector_cosine_ops)
--   WHERE embedding_model = '<provider>:<model-id>';

-- B-tree indexes for fast filtering (used for all models, including unknown ones)
CREATE INDEX IF NOT EXISTS idx_memories_embedding_model
  ON ai_agent_memories(embedding_model);

CREATE INDEX IF NOT EXISTS idx_document_embedding_model
  ON ai_agent_document(embedding_model);

-- HNSW partial indexes for ai_agent_memories ---------------------------------

-- local:Snowflake/snowflake-arctic-embed-s  (384 dims)
CREATE INDEX IF NOT EXISTS idx_memories_emb_local_snowflake_s
  ON ai_agent_memories
  USING hnsw ((embedding::vector(384)) vector_cosine_ops)
  WHERE embedding_model = 'local:Snowflake/snowflake-arctic-embed-s';

-- local:Xenova/all-MiniLM-L6-v2  (384 dims)
CREATE INDEX IF NOT EXISTS idx_memories_emb_local_minilm
  ON ai_agent_memories
  USING hnsw ((embedding::vector(384)) vector_cosine_ops)
  WHERE embedding_model = 'local:Xenova/all-MiniLM-L6-v2';

-- local:nomic-ai/nomic-embed-text-v1.5  (768 dims)
CREATE INDEX IF NOT EXISTS idx_memories_emb_local_nomic
  ON ai_agent_memories
  USING hnsw ((embedding::vector(768)) vector_cosine_ops)
  WHERE embedding_model = 'local:nomic-ai/nomic-embed-text-v1.5';

-- ollama:nomic-embed-text  (768 dims)
CREATE INDEX IF NOT EXISTS idx_memories_emb_ollama_nomic
  ON ai_agent_memories
  USING hnsw ((embedding::vector(768)) vector_cosine_ops)
  WHERE embedding_model = 'ollama:nomic-embed-text';

-- openai:text-embedding-nomic-embed-text-v1.5  (768 dims)
CREATE INDEX IF NOT EXISTS idx_memories_emb_openai_nomic
  ON ai_agent_memories
  USING hnsw ((embedding::vector(768)) vector_cosine_ops)
  WHERE embedding_model = 'openai:text-embedding-nomic-embed-text-v1.5';

-- github:text-embedding-nomic-embed-text-v1.5  (768 dims)
CREATE INDEX IF NOT EXISTS idx_memories_emb_github_nomic
  ON ai_agent_memories
  USING hnsw ((embedding::vector(768)) vector_cosine_ops)
  WHERE embedding_model = 'github:text-embedding-nomic-embed-text-v1.5';

-- HNSW partial indexes for ai_agent_document ---------------------------------

CREATE INDEX IF NOT EXISTS idx_documents_emb_local_snowflake_s
  ON ai_agent_document
  USING hnsw ((embedding::vector(384)) vector_cosine_ops)
  WHERE embedding_model = 'local:Snowflake/snowflake-arctic-embed-s';

CREATE INDEX IF NOT EXISTS idx_documents_emb_local_minilm
  ON ai_agent_document
  USING hnsw ((embedding::vector(384)) vector_cosine_ops)
  WHERE embedding_model = 'local:Xenova/all-MiniLM-L6-v2';

CREATE INDEX IF NOT EXISTS idx_documents_emb_local_nomic
  ON ai_agent_document
  USING hnsw ((embedding::vector(768)) vector_cosine_ops)
  WHERE embedding_model = 'local:nomic-ai/nomic-embed-text-v1.5';

CREATE INDEX IF NOT EXISTS idx_documents_emb_ollama_nomic
  ON ai_agent_document
  USING hnsw ((embedding::vector(768)) vector_cosine_ops)
  WHERE embedding_model = 'ollama:nomic-embed-text';

CREATE INDEX IF NOT EXISTS idx_documents_emb_openai_nomic
  ON ai_agent_document
  USING hnsw ((embedding::vector(768)) vector_cosine_ops)
  WHERE embedding_model = 'openai:text-embedding-nomic-embed-text-v1.5';

CREATE INDEX IF NOT EXISTS idx_documents_emb_github_nomic
  ON ai_agent_document
  USING hnsw ((embedding::vector(768)) vector_cosine_ops)
  WHERE embedding_model = 'github:text-embedding-nomic-embed-text-v1.5';
