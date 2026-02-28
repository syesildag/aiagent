-- Migration: 003_add_user_login_to_memories
-- Description: Add user_login column to ai_agent_memories for per-user memory isolation
-- Created: 2026-02-28

ALTER TABLE public.ai_agent_memories
    ADD COLUMN IF NOT EXISTS user_login CHARACTER VARYING;

-- Backfill existing rows with a sentinel value so they stay visible to all users
-- (NULL means "global / unscoped" and queries can opt-in to include them)
-- Comment out the line below if you prefer NULLs to mean "unowned":
-- UPDATE public.ai_agent_memories SET user_login = 'system' WHERE user_login IS NULL;

-- Index to speed up per-user lookups / combined type+user queries
CREATE INDEX IF NOT EXISTS idx_memories_user_login ON public.ai_agent_memories(user_login);
CREATE INDEX IF NOT EXISTS idx_memories_user_login_type ON public.ai_agent_memories(user_login, type);

-- Optional FK – enable only if every memory will always have a user:
-- ALTER TABLE public.ai_agent_memories
--     ADD CONSTRAINT memories_user_login_fkey FOREIGN KEY (user_login)
--         REFERENCES public.ai_agent_user (login)
--         ON UPDATE CASCADE ON DELETE CASCADE;
