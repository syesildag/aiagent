-- Migration: 008_add_user_login_to_jobs
-- Description: Associate dynamic agent jobs with the user who created them

ALTER TABLE public.ai_agent_jobs
    ADD COLUMN IF NOT EXISTS user_login CHARACTER VARYING;

CREATE INDEX IF NOT EXISTS idx_ai_agent_jobs_user_login
    ON public.ai_agent_jobs(user_login);
