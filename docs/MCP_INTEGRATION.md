# Model Context Protocol (MCP) Integration

## Overview

The MCP integration layer enables AI agents to interact with external tools and services through the Model Context Protocol. This provides a standardized way to extend agent capabilities with tools, resources, and prompts.

## Architecture

### Components

1. **MCPServerManager** - Manages lifecycle of MCP servers
2. **LLM Provider** - Interfaces with language models
3. **Tool Cache** - Optimizes tool availability queries
4. **Conversation History** - Tracks tool usage and results

### MCP Server Lifecycle

```
Configure → Start Process → Initialize → List Tools → Execute → Shutdown
```

## Configuration

### MCP Servers File

Create `mcp-servers.json` in project root:

```json
{
  "mcpServers": {
    "time-server": {
      "command": "node",
      "args": ["dist/examples/time-server.js"],
      "env": {}
    },
    "weather-server": {
      "command": "node",
      "args": ["dist/examples/weather-server.js"],
      "env": {
        "OPENWEATHERMAP_API_KEY": "your_api_key"
      }
    }
  }
}
```

### Configuration Options

| Property | Type | Description |
|----------|------|-------------|
| `command` | string | Executable to run (node, python, etc.) |
| `args` | string[] | Arguments passed to command |
| `env` | object | Environment variables for the server |

### Environment Variable

```bash
MCP_SERVERS_PATH=./mcp-servers.json
```

## Using MCP Manager

### Initialization

```typescript
import { MCPServerManager } from './mcp/mcpManager';
import { createLLMProvider, getLLMModel } from './mcp/llmFactory';

const llmProvider = await createLLMProvider();
const model = getLLMModel();

const mcpManager = new MCPServerManager(
   './mcp-servers.json',
   llmProvider,
   model
);

await mcpManager.ensureInitialized();
```

### Listing Available Servers

```typescript
const servers = await mcpManager.listServers();
console.log('Available servers:', servers);
// Output: ['time-server', 'weather-server']
```

### Getting Server Tools

```typescript
// Get tools from specific server
const tools = await mcpManager.getServerTools('time-server');

// Get all tools from all servers
const allTools = await mcpManager.getAllTools();

// Get tools for specific servers
const filteredTools = await mcpManager.getAllTools(['time-server', 'weather-server']);
```

### Tool Structure

```typescript
interface MCPTool {
   name: string;
   description: string;
   inputSchema: {
      type: string;
      properties: Record<string, any>;
      required?: string[];
   };
}
```

Example:
```typescript
{
   name: "get_current_time",
   description: "Returns the current time in ISO format",
   inputSchema: {
      type: "object",
      properties: {
         timezone: {
            type: "string",
            description: "IANA timezone name (e.g., 'America/New_York')"
         }
      },
      required: []
   }
}
```

## Tool Caching

Tool caching improves performance by avoiding repeated tool discovery calls.

### Cache Configuration

```typescript
// Cache is automatically enabled with 5-minute TTL
// Tools are cached per server and globally
```

### Cache Invalidation

```typescript
// Restart MCP server (automatically clears cache)
await mcpManager.restartServer('time-server');

// Stop all servers (clears all caches)
await mcpManager.stopAllServers();
```

### Cache Behavior

- **Initial Load**: First call fetches tools from MCP server
- **Subsequent Calls**: Tools served from memory cache
- **TTL**: 5 minutes (configurable)
- **Invalidation**: Server restart, explicit clear, TTL expiry

## Creating MCP Servers

### Basic Server Structure

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new Server(
   {
      name: 'my-server',
      version: '1.0.0',
   },
   {
      capabilities: {
         tools: {},
      },
   }
);

// Define tools
server.setRequestHandler('tools/list', async () => {
   return {
      tools: [
         {
            name: 'my_tool',
            description: 'Description of what this tool does',
            inputSchema: {
               type: 'object',
               properties: {
                  param1: {
                     type: 'string',
                     description: 'First parameter'
                  }
               },
               required: ['param1']
            }
         }
      ]
   };
});

// Handle tool calls
server.setRequestHandler('tools/call', async (request) => {
   const { name, arguments: args } = request.params;
   
   if (name === 'my_tool') {
      // Validate input
      const schema = z.object({
         param1: z.string()
      });
      const validated = schema.parse(args);
      
      // Execute tool logic
      const result = await myToolLogic(validated.param1);
      
      return {
         content: [
            {
               type: 'text',
               text: JSON.stringify(result)
            }
         ]
      };
   }
   
   throw new Error(`Unknown tool: ${name}`);
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Tool Implementation Best Practices

1. **Input Validation**: Always validate inputs with Zod or similar
2. **Error Handling**: Return meaningful error messages
3. **Response Format**: Return structured JSON when possible
4. **Documentation**: Provide clear descriptions for tools and parameters
5. **Idempotency**: Make tools idempotent when possible

### Example: Time Server

```typescript
server.setRequestHandler('tools/list', async () => {
   return {
      tools: [
         {
            name: 'get_current_time',
            description: 'Returns current time in ISO format',
            inputSchema: {
               type: 'object',
               properties: {
                  timezone: {
                     type: 'string',
                     description: 'IANA timezone (optional)'
                  }
               }
            }
         }
      ]
   };
});

server.setRequestHandler('tools/call', async (request) => {
   if (request.params.name === 'get_current_time') {
      const timezone = request.params.arguments?.timezone;
      const now = timezone 
         ? new Date().toLocaleString('en-US', { timeZone: timezone })
         : new Date().toISOString();
      
      return {
         content: [{ type: 'text', text: now }]
      };
   }
});
```

## MCP Resources

Resources provide read-only data access to agents.

### Defining Resources

```typescript
server.setRequestHandler('resources/list', async () => {
   return {
      resources: [
         {
            uri: 'config://app/settings',
            name: 'Application Settings',
            description: 'Current application configuration',
            mimeType: 'application/json'
         }
      ]
   };
});

server.setRequestHandler('resources/read', async (request) => {
   const { uri } = request.params;
   
   if (uri === 'config://app/settings') {
      return {
         contents: [
            {
               uri,
               mimeType: 'application/json',
               text: JSON.stringify(config)
            }
         ]
      };
   }
});
```

## MCP Prompts

Prompts provide reusable prompt templates.

```typescript
server.setRequestHandler('prompts/list', async () => {
   return {
      prompts: [
         {
            name: 'analyze_code',
            description: 'Analyze code for issues',
            arguments: [
               {
                  name: 'code',
                  description: 'Code to analyze',
                  required: true
               }
            ]
         }
      ]
   };
});

server.setRequestHandler('prompts/get', async (request) => {
   if (request.params.name === 'analyze_code') {
      const code = request.params.arguments?.code;
      return {
         messages: [
            {
               role: 'user',
               content: {
                  type: 'text',
                  text: `Analyze this code:\n\n${code}`
               }
            }
         ]
      };
   }
});
```

## Conversation History Integration

MCP tool calls are automatically tracked in conversation history.

### Tool Call Format

```typescript
{
   role: 'assistant',
   content: {
      type: 'tool_calls',
      tool_calls: [
         {
            id: 'call_123',
            type: 'function',
            function: {
               name: 'get_current_time',
               arguments: '{"timezone":"America/New_York"}'
            }
         }
      ]
   }
}
```

### Tool Result Format

```typescript
{
   role: 'tool',
   content: '2026-02-15T10:30:00-05:00',
   tool_call_id: 'call_123'
}
```

## Error Handling

### Server Startup Errors

```typescript
try {
   await mcpManager.ensureInitialized();
} catch (error) {
   Logger.error(`Failed to initialize MCP servers: ${error}`);
   // Gracefully degrade or retry
}
```

### Tool Execution Errors

```typescript
// In MCP server
try {
   const result = await executeToolLogic(args);
   return { content: [{ type: 'text', text: JSON.stringify(result) }] };
} catch (error) {
   return {
      isError: true,
      content: [{ 
         type: 'text', 
         text: `Tool execution failed: ${error.message}` 
      }]
   };
}
```

### Server Crash Recovery

```typescript
// Automatic restart on crash
mcpManager.on('server-crash', async (serverName) => {
   Logger.warn(`Server ${serverName} crashed, attempting restart`);
   await mcpManager.restartServer(serverName);
});
```

## Performance Optimization

### 1. Tool Caching
- Tools are cached for 5 minutes
- Reduces IPC overhead
- Improves response time

### 2. Lazy Initialization
- Servers start only when needed
- Reduces startup time
- Conserves resources

### 3. Connection Pooling
- Reuses MCP connections
- Minimizes overhead
- Improves throughput

## Security Considerations

### 1. Command Validation
- Validate server commands before execution
- Use absolute paths when possible
- Restrict to trusted executables

### 2. Environment Variables
- Never expose sensitive data in logs
- Use environment variables for secrets
- Validate all inputs

### 3. Resource Limits
- Set timeouts for tool calls
- Limit concurrent tool executions
- Monitor resource usage

## Testing MCP Servers

### Unit Tests

```typescript
describe('Time Server', () => {
   let server: Server;
   
   beforeEach(() => {
      server = createTimeServer();
   });
   
   test('should return current time', async () => {
      const result = await server.callTool('get_current_time', {});
      expect(result.content[0].text).toMatch(/\d{4}-\d{2}-\d{2}/);
   });
});
```

### Integration Tests

```typescript
test('MCP manager should list tools', async () => {
   const mcpManager = new MCPServerManager(config);
   await mcpManager.ensureInitialized();
   
   const tools = await mcpManager.getServerTools('time-server');
   expect(tools).toContainEqual(
      expect.objectContaining({ name: 'get_current_time' })
   );
});
```

## Troubleshooting

### Server Won't Start
- Check command path is correct
- Verify Node.js/Python version compatibility
- Check environment variables are set
- Review server logs for errors

### Tools Not Appearing
- Verify server implements `tools/list`
- Check tool schema is valid JSON Schema
- Clear tool cache and retry
- Enable debug logging

### Tool Calls Failing
- Validate input arguments match schema
- Check server error logs
- Verify server connection is active
- Test tool independently

## Examples

See working examples in:
- [time-server.ts](../examples/time-server.ts)
- [weather-server.ts](../examples/weather-server.ts)

## Related Documentation

- [Agent System](AGENT_SYSTEM.md)
- [LLM Providers](LLM_PROVIDERS.md)
- [Configuration](CONFIGURATION.md)
