-- Enable the vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create memories table
CREATE TABLE IF NOT EXISTS public.ai_agent_memories (
    id SERIAL PRIMARY KEY,
    type TEXT NOT NULL,
    content JSONB NOT NULL,
    source TEXT NOT NULL,
    embedding vector(384) NOT NULL,  -- BERT model outputs 384-dimensional vectors
    tags TEXT[] DEFAULT '{}',
    confidence DECIMAL(3,2) CHECK (confidence >= 0 AND confidence <= 1),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_memories_type ON ai_agent_memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_tags ON ai_agent_memories USING GIN(tags);
-- Create an index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON ai_agent_memories USING ivfflat(embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS public.ai_agent_user (
    id SERIAL PRIMARY KEY,
    login CHARACTER VARYING NOT NULL,
    password CHARACTER VARYING NOT NULL,
    CONSTRAINT user_login UNIQUE (login)
);

CREATE TABLE IF NOT EXISTS public.ai_agent_session (
    id SERIAL PRIMARY KEY,
    name CHARACTER VARYING NOT NULL,
    user_login CHARACTER VARYING NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ping TIMESTAMP WITHOUT TIME ZONE,
    CONSTRAINT session_name UNIQUE (name),
    CONSTRAINT session_user_login_fkey FOREIGN KEY (user_login)
        REFERENCES public.ai_agent_user (login) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
);