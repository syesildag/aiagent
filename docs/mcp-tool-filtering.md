# MCP Tool Filtering Documentation

## Overview

The `MCPServerManager` now supports filtering tools by server name, allowing agents to have specialized access to specific MCP server capabilities. This enables better performance, focused functionality, and cleaner separation of concerns.

## New Features

### 1. Agent Server Name Configuration

Agents now define their server preferences through the `getServerNames()` method in the Agent interface:

```typescript
interface Agent {
  // ... other methods
  getServerNames(): string[] | undefined;
}
```

### 3. Helper Methods

The `chatWithLLM` method automatically uses the agent's server configuration:

```typescript
async chatWithLLM(
  message: string, 
  abortSignal?: AbortSignal, 
  customSystemPrompt?: string,
  serverNames?: string[]  // Uses agent's getServerNames() if not provided
): Promise<string>
```

#### `getToolsForServers(serverNames: string[]): Tool[]`
Get tools filtered by specific server names.

#### `getAvailableServerNames(): string[]`
Get list of all available MCP server names.

#### `getToolsByServer(): Record<string, Tool[]>`
Get tools grouped by server name (existing method).

### 4. Enhanced AbstractAgent

The `AbstractAgent` class now supports:
- Automatic server filtering based on `getServerNames()` implementation
- `getAvailableTools(serverNames?: string[])` - Get available tools optionally filtered by servers
- `getAvailableServerNames()` - Get list of available server names

## Usage Examples

### Basic Agent with Server Filtering

```typescript
class DatabaseAgent extends AbstractAgent {
  private allowedServers = ['database', 'sqlite', 'postgres'];

  getName(): AgentName {
    return 'database-agent' as AgentName;
  }

  getServerNames(): string[] {
    return this.allowedServers;
  }

  getSystemPrompt(): string {
    return 'You are a database specialist agent...';
  }
}

// The agent automatically uses only its configured servers
const response = await databaseAgent.chat("Analyze the user database schema");
```

### General Purpose Agent (All Servers)

```typescript
class GeneralAgent extends AbstractAgent {
  getServerNames(): string[] | undefined {
    return undefined; // Uses all available servers
  }
}
```

### Specialized Agent Implementation

```typescript
class FileSystemAgent extends AbstractAgent {
  getName(): AgentName {
    return 'filesystem-agent' as AgentName;
  }

  getServerNames(): string[] {
    return ['filesystem', 'editor']; // Only these servers
  }

  getSystemPrompt(): string {
    return `You are a file system specialist. You can read, write, and manage files efficiently.`;
  }

  // Agent automatically uses only filesystem and editor tools
}
```

### Checking Available Tools

```typescript
// Get tools for this specific agent (respects agent's server configuration)
const agentTools = agent.getAvailableTools();

// Get tools for specific servers (override agent's configuration)
const specificTools = agent.getAvailableTools(['database', 'sqlite']);

// Get all tools grouped by server
const toolsByServer = mcpManager.getToolsByServer();
```

## Benefits

1. **Performance**: Agents only load tools they need, reducing LLM context size
2. **Security**: Restrict agent access to only required server capabilities
3. **Specialization**: Create focused agents for specific tasks (file ops, web search, etc.)
4. **Debugging**: Easier to track which tools are being used by which agents
5. **Organization**: Better separation of concerns between different agent types

## Migration Guide

Existing code needs minimal changes. Add the `getServerNames()` method to your agents:

```typescript
// Old way (still works, but not recommended)
const response = await mcpManager.chatWithLLM(message, undefined, undefined, ['filesystem']);

// New way (recommended)
class MyAgent extends AbstractAgent {
  getServerNames(): string[] {
    return ['filesystem']; // Agent defines its own server preferences
  }
}

const response = await agent.chat(message); // Automatically uses agent's servers
```

## Server Name Format

Server names correspond to the `name` field in your `mcp-servers.json` configuration:

```json
{
  "servers": [
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/user/Documents"],
      "enabled": true
    },
    {
      "name": "database", 
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "/path/to/db.sqlite"],
      "enabled": true
    }
  ]
}
```

In this example, you can filter by `["filesystem"]`, `["database"]`, or `["filesystem", "database"]`.