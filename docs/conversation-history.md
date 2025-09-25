# Conversation History Implementation

This document describes the conversation history system implemented for the AI Agent project, providing in-memory conversation management with a sliding window pattern and interface-based design for future database implementations.

## Overview

The conversation history system provides:
- **In-memory conversation storage** with automatic message persistence
- **Sliding window management** to limit memory usage (default: 10 conversations)
- **Interface-based design** for easy database implementation switching
- **Automatic integration** with MCP Server Manager chat functionality
- **CLI commands** for conversation management
- **Environment configuration** for window size customization

## Architecture

### Core Components

1. **IConversationHistory Interface** (`src/descriptions/conversationTypes.ts`)
   - Defines the contract for all conversation history implementations
   - Supports async operations for future database compatibility
   - Includes methods for message management, conversation switching, and history maintenance

2. **InMemoryConversationHistory** (`src/utils/conversationHistory.ts`)
   - In-memory implementation of the conversation history interface
   - Automatic sliding window maintenance
   - Message validation using Zod schemas
   - Thread-safe conversation management

3. **ConversationHistoryFactory** (`src/utils/conversationHistoryFactory.ts`)
   - Singleton factory pattern for implementation switching
   - Easy configuration for different storage backends
   - Lazy initialization for memory efficiency

4. **MCPServerManager Integration** (`src/mcp/mcpManager.ts`)
   - Automatic message persistence during chat interactions
   - Conversation management methods exposed
   - Seamless integration with existing LLM workflows

## Configuration

### Environment Variables

```bash
# Set conversation history window size (default: 10)
CONVERSATION_HISTORY_WINDOW_SIZE=15
```

### Configuration File

The conversation history window size is managed in `src/utils/config.ts`:

```typescript
export const config = {
  // ... other config options
  CONVERSATION_HISTORY_WINDOW_SIZE: Number(process.env.CONVERSATION_HISTORY_WINDOW_SIZE) || 10,
};
```

## Usage

### Automatic Usage (Recommended)

Conversation history is automatically managed when using the `MCPServerManager.chatWithLLM()` method:

```typescript
import { MCPServerManager } from './src/mcp/mcpManager';
import { OllamaProvider } from './src/mcp/llmProviders';

const manager = new MCPServerManager('./mcp-servers.json', new OllamaProvider());

// Messages are automatically stored in conversation history
const response = await manager.chatWithLLM("Hello, how are you?");
console.log(response);

// Continue the conversation - history is maintained
const response2 = await manager.chatWithLLM("What did I just ask you?");
console.log(response2);
```

### Manual Conversation Management

```typescript
// Start a new conversation
const conversationId = await manager.startNewConversation('session1', 'user123');

// Get current conversation messages
const messages = await manager.getCurrentConversation();

// Get all conversations in sliding window
const conversations = await manager.getConversations();

// Clear conversation history
await manager.clearConversationHistory();

// Get conversation count
const count = await manager.getConversationCount();
```

### CLI Commands

The CLI interface provides several conversation management commands:

- `new` or `newchat` - Start a new conversation
- `history` - Show conversation history
- `current` - Show current conversation messages
- `clearchat` - Clear all conversation history
- `help` - Show all available commands

Example CLI session:
```bash
$ npm start

> help
Available commands:
  - new/newchat: Start a new conversation
  - history: Show conversation history
  - current: Show current conversation messages
  - clearchat: Clear all conversation history
  ...

> Hello, I'm testing the conversation history
Assistant: Hello! I can see that you're testing the conversation history feature...

> current
Current Conversation:
1. [user]: Hello, I'm testing the conversation history
2. [assistant]: Hello! I can see that you're testing the conversation history feature...

> new
Started new conversation: a1b2c3d4-...

> history
Conversation History:
1. ID: original-conversation-id - 2 messages (2025-01-01T10:00:00.000Z)
2. ID: a1b2c3d4-... - 0 messages (2025-01-01T10:05:00.000Z)
```

## Interface Design

### IConversationHistory Interface

```typescript
export interface IConversationHistory {
  addMessage(message: Omit<Message, 'id' | 'timestamp'>): Promise<Message>;
  getCurrentConversation(): Promise<Message[]>;
  getConversations(limit?: number): Promise<Conversation[]>;
  startNewConversation(sessionId?: string, userId?: string): Promise<string>;
  getConversation(conversationId: string): Promise<Conversation | null>;
  clearHistory(): Promise<void>;
  getConversationCount(): Promise<number>;
}
```

### Message Schema

```typescript
export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  timestamp: z.date(),
  metadata: z.record(z.any()).optional()
});

export type Message = z.infer<typeof MessageSchema>;
```

### Conversation Schema

```typescript
export const ConversationSchema = z.object({
  id: z.string(),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  messages: z.array(MessageSchema),
  createdAt: z.date(),
  updatedAt: z.date(),
  metadata: z.record(z.any()).optional()
});

export type Conversation = z.infer<typeof ConversationSchema>;
```

## Sliding Window Behavior

The sliding window maintains a fixed number of conversations (default: 10) to prevent unlimited memory growth:

1. **Window Size**: Configurable via `CONVERSATION_HISTORY_WINDOW_SIZE` environment variable
2. **Maintenance**: Automatically removes oldest conversations when limit is exceeded
3. **Preservation**: Most recent conversations are always preserved
4. **Current Conversation**: The active conversation is never removed during window maintenance

### Example Sliding Window Behavior

```typescript
// With CONVERSATION_HISTORY_WINDOW_SIZE=3
// Initial state: []

await manager.startNewConversation(); // [conv1]
await manager.startNewConversation(); // [conv1, conv2] 
await manager.startNewConversation(); // [conv1, conv2, conv3]
await manager.startNewConversation(); // [conv2, conv3, conv4] (conv1 removed)
await manager.startNewConversation(); // [conv3, conv4, conv5] (conv2 removed)
```

## Future Database Implementation

The interface-based design allows for easy database implementation:

1. **Create Database Implementation**: Implement `IConversationHistory` interface
2. **Update Factory**: Modify `ConversationHistoryFactory` to return database implementation
3. **Configuration**: Add environment variables for database connection
4. **Migration**: No changes needed to existing code using the interface

Example future database implementation:

```typescript
export class DatabaseConversationHistory implements IConversationHistory {
  constructor(private db: DatabaseConnection) {}
  
  async addMessage(message: Omit<Message, 'id' | 'timestamp'>): Promise<Message> {
    // Database implementation
  }
  
  // ... other interface methods
}
```

## Testing

Comprehensive test suite covers:
- Message addition and validation
- Conversation management
- Sliding window behavior
- Error handling
- Edge cases

Run tests with:
```bash
npm test -- --testNamePattern="ConversationHistory"
```

## Performance Considerations

### In-Memory Implementation

- **Memory Usage**: Linear growth with conversation count (limited by sliding window)
- **Performance**: O(1) for most operations, O(n) for sliding window maintenance
- **Concurrency**: Thread-safe with proper async handling

### Sliding Window Benefits

- **Memory Bounded**: Fixed maximum memory usage
- **Performance Stable**: Consistent performance regardless of usage duration
- **Automatic Cleanup**: No manual maintenance required

## Error Handling

The system includes comprehensive error handling:

- **Message Validation**: Zod schema validation for all messages
- **Conversation Integrity**: Automatic conversation creation if none exists
- **Graceful Degradation**: Continues operation even if individual operations fail
- **Logging**: Detailed logging for debugging and monitoring

## Integration Points

### With MCPServerManager

```typescript
class MCPServerManager {
  private conversationHistory: IConversationHistory;
  
  async chatWithLLM(message: string): Promise<string> {
    // Add user message to history
    await this.conversationHistory.addMessage({
      role: 'user',
      content: message
    });
    
    // ... process with LLM
    
    // Add assistant response to history
    await this.conversationHistory.addMessage({
      role: 'assistant', 
      content: response
    });
    
    return response;
  }
}
```

### With CLI Interface

The CLI automatically has access to all conversation management functions through the MCPServerManager instance, providing a seamless user experience for conversation management.

## Summary

The conversation history implementation provides a robust, scalable solution for managing AI conversation state with the following key benefits:

- **Automatic Integration**: Works seamlessly with existing chat functionality
- **Memory Efficient**: Sliding window prevents unbounded memory growth
- **Future-Proof**: Interface design allows easy database migration
- **User Friendly**: CLI commands for easy conversation management
- **Well Tested**: Comprehensive test coverage ensures reliability
- **Configurable**: Environment variable configuration for different use cases

This implementation serves as a solid foundation for conversation management in the AI Agent system while remaining flexible for future enhancements and database integration.