-- Migration: 006_add_jobs_table
-- Description: Create ai_agent_jobs table for DB-persistent job state

CREATE TABLE IF NOT EXISTS public.ai_agent_jobs (
    id SERIAL PRIMARY KEY,
    name CHARACTER VARYING(255) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    params JSONB,
    last_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ai_agent_jobs_name_unique UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_jobs_name ON ai_agent_jobs(name);
CREATE INDEX IF NOT EXISTS idx_ai_agent_jobs_enabled ON ai_agent_jobs(enabled);

DROP TRIGGER IF EXISTS ai_agent_update_jobs_updated_at ON ai_agent_jobs;
CREATE TRIGGER ai_agent_update_jobs_updated_at
    BEFORE UPDATE ON ai_agent_jobs
    FOR EACH ROW EXECUTE FUNCTION ai_agent_update_updated_at_column();
