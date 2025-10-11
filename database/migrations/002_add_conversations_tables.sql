-- Add conversations table to support persistent conversation history
-- This table stores conversation metadata and has a foreign key to ai_agent_session

CREATE TABLE IF NOT EXISTS public.ai_agent_conversations (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL,
    user_id VARCHAR(255),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}',
    CONSTRAINT fk_conversations_session 
        FOREIGN KEY (session_id) 
        REFERENCES public.ai_agent_session (id) 
        ON UPDATE CASCADE 
        ON DELETE CASCADE
);

-- Create conversations messages table to store individual messages
CREATE TABLE IF NOT EXISTS public.ai_agent_conversation_messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    tool_calls JSONB,
    tool_call_id VARCHAR(255),
    timestamp TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}',
    CONSTRAINT fk_messages_conversation 
        FOREIGN KEY (conversation_id) 
        REFERENCES public.ai_agent_conversations (id) 
        ON UPDATE CASCADE 
        ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON ai_agent_conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON ai_agent_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON ai_agent_conversations(created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON ai_agent_conversations(updated_at);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON ai_agent_conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_role ON ai_agent_conversation_messages(role);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON ai_agent_conversation_messages(timestamp);

-- Add trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_conversations_updated_at 
    BEFORE UPDATE ON ai_agent_conversations 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();