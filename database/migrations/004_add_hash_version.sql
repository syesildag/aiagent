-- Migration 004: Add hash_version column to ai_agent_user
-- Tracks the password hashing algorithm: 'hmac' (legacy) or 'bcrypt' (current)
ALTER TABLE ai_agent_user
  ADD COLUMN IF NOT EXISTS hash_version VARCHAR(10) NOT NULL DEFAULT 'hmac';

-- Index for any future queries filtering by hash_version
CREATE INDEX IF NOT EXISTS idx_ai_agent_user_hash_version ON ai_agent_user (hash_version);
