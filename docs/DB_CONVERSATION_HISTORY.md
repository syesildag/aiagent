# Database-Backed Conversation History

This document describes the implementation of `DbConversationHistory`, a PostgreSQL-backed implementation of the `IConversationHistory` interface.

## Overview

The `DbConversationHistory` class provides persistent conversation storage using PostgreSQL, implementing the same interface as the existing `InMemoryConversationHistory` but with database persistence.

## Database Schema

The implementation uses three PostgreSQL tables:

### ai_agent_conversations
- `id` (PRIMARY KEY): Auto-incrementing conversation ID
- `session_id` (FOREIGN KEY): References ai_agent_session.id
- `user_id`: User identifier (optional)
- `created_at`: Timestamp when conversation was created
- `updated_at`: Timestamp when conversation was last modified
- `metadata` (JSONB): Stores conversation UUID and additional metadata

### ai_agent_conversation_messages
- `id` (PRIMARY KEY): Auto-incrementing message ID
- `conversation_id` (FOREIGN KEY): References ai_agent_conversations.id
- `role`: Message role ('user', 'assistant', 'system', 'tool')
- `content`: Message content
- `tool_calls` (JSONB): Tool call information (optional)
- `tool_call_id`: Tool call identifier (optional)
- `timestamp`: Message timestamp
- `metadata` (JSONB): Stores message UUID and additional metadata

### ai_agent_session (existing)
- `id` (PRIMARY KEY): Auto-incrementing session ID
- `name`: Session name (used as external session ID)
- `user_login` (FOREIGN KEY): References ai_agent_user.login
- `created_at`: Session creation timestamp
- `ping`: Last activity timestamp

## Key Features

### 1. Interface Compatibility
- Implements the same `IConversationHistory` interface as `InMemoryConversationHistory`
- Drop-in replacement with identical method signatures
- Maintains UUID-based conversation IDs for external compatibility

### 2. Sliding Window Management
- Automatically maintains a configurable number of recent conversations
- Removes oldest conversations when limit is exceeded
- Preserves referential integrity during cleanup

### 3. Session Management
- Integrates with existing session system
- Creates or reuses sessions based on session ID
- Defaults to existing 'serkan' user if no user specified

### 4. Data Mapping
- Maps between external UUIDs and internal database IDs
- Stores UUIDs in JSONB metadata for efficient querying
- Preserves original session and user IDs in metadata

## Usage

### Basic Usage
```typescript
import { DbConversationHistory } from './dbConversationHistory';

const history = new DbConversationHistory();

// Start a new conversation
const conversationId = await history.startNewConversation('session-123', 'serkan');

// Add messages
const message = await history.addMessage({
  role: 'user',
  content: 'Hello, world!'
});

// Get current conversation
const messages = await history.getCurrentConversation();

// Get all conversations
const conversations = await history.getConversations();
```

### Factory Pattern
The `ConversationHistoryFactory` can be configured to use database storage:

```typescript
// Set environment variable to enable database storage
process.env.USE_DB_CONVERSATION_HISTORY = 'true';

// Factory will return DbConversationHistory instance
const history = ConversationHistoryFactory.getInstance();
```

### Testing
```typescript
// Create specific implementation for testing
const dbHistory = ConversationHistoryFactory.createInstance('database');
const memoryHistory = ConversationHistoryFactory.createInstance('memory');
```

## Configuration

The implementation uses the same configuration as the in-memory version:

- `CONVERSATION_HISTORY_WINDOW_SIZE`: Maximum number of conversations to keep (default: 10)
- Database connection settings from `config.ts`

## Error Handling

The implementation includes comprehensive error handling:

- **ValidationError**: For invalid message data
- **DatabaseError**: For database-related failures
- Graceful fallbacks for missing data
- Transaction safety for data consistency

## Performance Considerations

1. **Indexing**: Database includes indexes on frequently queried columns
2. **JSONB Storage**: Efficient storage and querying of metadata
3. **Batch Operations**: Optimized for sliding window maintenance
4. **Connection Pooling**: Uses PostgreSQL connection pool for efficiency

## Migration

To migrate from in-memory to database storage:

1. Ensure database tables are created (migration scripts provided)
2. Set `USE_DB_CONVERSATION_HISTORY=true` environment variable
3. Restart application - existing code will automatically use database storage

## Monitoring

The implementation includes extensive logging:
- Conversation creation and management
- Message additions
- Sliding window maintenance
- Database operations and errors

## Testing

A test suite is provided in `dbConversationHistory.test.ts`:

```bash
# Run database conversation history tests
npm test -- --testPathPattern=dbConversationHistory.test.ts

# Run simple integration test
node test-db-conversation.js
```

## Dependencies

- PostgreSQL database with required tables
- Existing user in `ai_agent_user` table
- Node.js with TypeScript support
- pg (PostgreSQL client library)

## Future Enhancements

Potential improvements for future versions:

1. **User Management**: Automatic user creation if not exists
2. **Archival**: Move old conversations to archive tables
3. **Search**: Full-text search across conversation content
4. **Analytics**: Conversation usage statistics and reporting
5. **Backup**: Automated backup and restore capabilities