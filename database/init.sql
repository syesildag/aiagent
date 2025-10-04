-- Enable the vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create memories table
CREATE TABLE IF NOT EXISTS public.ai_agent_memories (
    id SERIAL NOT NULL,
    type TEXT NOT NULL,
    content JSONB NOT NULL,
    source TEXT NOT NULL,
    embedding vector(384) NOT NULL,  -- BERT model outputs 384-dimensional vectors
    tags TEXT[] DEFAULT '{}',
    confidence DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITHOUT TIME ZONE
);

-- Create an index for vector similarity search
CREATE INDEX ON ai_agent_memories USING ivfflat (embedding vector_l2_ops) WITH (lists = 100);

CREATE TABLE IF NOT EXISTS public.ai_agent_user (
    id SERIAL NOT NULL,
    login CHARACTER VARYING NOT NULL,
    password CHARACTER VARYING NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT user_login UNIQUE (login)
);

CREATE TABLE IF NOT EXISTS public.ai_agent_session (
    id SERIAL NOT NULL,
    name CHARACTER VARYING NOT NULL,
    user_login CHARACTER VARYING NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ping TIMESTAMP WITHOUT TIME ZONE,
    CONSTRAINT session_id PRIMARY KEY (id),
    CONSTRAINT session_name UNIQUE (name),
    CONSTRAINT session_user_login_fkey FOREIGN KEY (user_login)
        REFERENCES public.ai_agent_user (login) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
);