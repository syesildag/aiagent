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

CREATE TABLE IF NOT EXISTS public.ai_agent_document_type (
    id SERIAL PRIMARY KEY,
    type CHARACTER VARYING NOT NULL,
    CONSTRAINT ai_agent_document_type_unique UNIQUE (type)
);

CREATE TABLE IF NOT EXISTS public.ai_agent_document (
    id SERIAL PRIMARY KEY,
    name CHARACTER VARYING NOT NULL,
    content CHARACTER VARYING NOT NULL,
    type_id INTEGER NOT NULL,
    embedding vector(384) NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT document_name_unique UNIQUE (name),
    CONSTRAINT document_content_unique UNIQUE (content),
    CONSTRAINT document_type_id_fkey FOREIGN KEY (type_id)
        REFERENCES public.ai_agent_document_type (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
);

INSERT INTO public.ai_agent_document_type (type) VALUES ('documentation') ON CONFLICT DO NOTHING;