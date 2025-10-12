-- Migration: 001_initial_schema
-- Description: Create initial database schema with users, sessions, documents, and memories
-- Created: 2025-10-12

-- Enable the vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create migration tracking table
CREATE TABLE IF NOT EXISTS public.ai_agent_schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    description TEXT
);

-- Create users table
CREATE TABLE IF NOT EXISTS public.ai_agent_user (
    id SERIAL PRIMARY KEY,
    login CHARACTER VARYING NOT NULL,
    password CHARACTER VARYING NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_login UNIQUE (login)
);

-- Create sessions table
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

-- Create document types table
CREATE TABLE IF NOT EXISTS public.ai_agent_document_type (
    id SERIAL PRIMARY KEY,
    type CHARACTER VARYING NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ai_agent_document_type_unique UNIQUE (type)
);

-- Create documents table
CREATE TABLE IF NOT EXISTS public.ai_agent_document (
    id SERIAL PRIMARY KEY,
    name CHARACTER VARYING NOT NULL,
    content CHARACTER VARYING NOT NULL,
    type_id INTEGER NOT NULL,
    embedding vector(384) NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT document_name_unique UNIQUE (name),
    CONSTRAINT document_content_unique UNIQUE (content),
    CONSTRAINT document_type_id_fkey FOREIGN KEY (type_id)
        REFERENCES public.ai_agent_document_type (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
);

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
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_memories_type ON ai_agent_memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_tags ON ai_agent_memories USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON ai_agent_memories USING ivfflat(embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_documents_type_id ON ai_agent_document(type_id);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON ai_agent_document(created_at);

CREATE INDEX IF NOT EXISTS idx_sessions_user_login ON ai_agent_session(user_login);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON ai_agent_session(created_at);

-- Insert default data
INSERT INTO public.ai_agent_document_type (type) VALUES ('documentation') ON CONFLICT (type) DO NOTHING;

-- Add trigger functions for updated_at timestamps
CREATE OR REPLACE FUNCTION ai_agent_update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers for updated_at (drop if exists first to avoid conflicts)
DROP TRIGGER IF EXISTS update_users_updated_at ON ai_agent_user;
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON ai_agent_user 
    FOR EACH ROW EXECUTE FUNCTION ai_agent_update_updated_at_column();

DROP TRIGGER IF EXISTS update_documents_updated_at ON ai_agent_document;
CREATE TRIGGER update_documents_updated_at 
    BEFORE UPDATE ON ai_agent_document 
    FOR EACH ROW EXECUTE FUNCTION ai_agent_update_updated_at_column();

DROP TRIGGER IF EXISTS update_memories_updated_at ON ai_agent_memories;
CREATE TRIGGER update_memories_updated_at 
    BEFORE UPDATE ON ai_agent_memories 
    FOR EACH ROW EXECUTE FUNCTION ai_agent_update_updated_at_column();

-- Record this migration
INSERT INTO public.ai_agent_schema_migrations (version, description) 
VALUES ('001', 'Create initial database schema with users, sessions, documents, and memories')
ON CONFLICT (version) DO NOTHING;