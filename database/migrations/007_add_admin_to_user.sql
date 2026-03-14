-- Migration: 007_add_admin_to_user
-- Description: Add is_admin boolean column to ai_agent_user table

ALTER TABLE public.ai_agent_user
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
