-- Migration: 009_fix_conversations_session_fk
-- Description: Drop the CASCADE foreign key from ai_agent_conversations.session_id
--              so that conversations are not deleted when their session is removed
--              (e.g. on logout or session expiry). session_id is retained as a
--              plain reference column; user_id is the durable ownership key.

ALTER TABLE public.ai_agent_conversations
    DROP CONSTRAINT fk_conversations_session;
