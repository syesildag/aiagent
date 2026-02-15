# Agent System

## Overview

The agent system provides a modular architecture for creating AI-powered agents with custom behavior, tools, and validation logic. Each agent can have its own system prompt, configuration, and access to specific MCP servers.

## Architecture

### Core Components

1. **AbstractAgent** - Base class for all agents
2. **Agent Interface** - Contract that all agents must implement
3. **Agent Registry** - Central management of agent instances
4. **MCP Manager** - Provides tool access to agents

### Agent Lifecycle

```
Initialize → Register → Set MCP Manager → Ready to Chat → Shutdown
```

## Creating a Custom Agent

### Step 1: Extend AbstractAgent

```typescript
import AbstractAgent from './abstractAgent';
import { AgentName } from '../agent';

export class MyCustomAgent extends AbstractAgent {
   getName(): AgentName {
      return 'custom';
   }

   getSystemPrompt(): string {
      return `You are a custom AI assistant specialized in...`;
   }
   
   // Optional: Customize LLM options
   getOptions() {
      return {
         seed: 123,
         temperature: 0.7,
         top_p: 0.9
      };
   }
   
   // Optional: Restrict to specific MCP servers
   getAllowedServerNames(): string[] | undefined {
      return ['time-server', 'weather-server'];
   }
}
```

### Step 2: Register the Agent

Edit `src/agent.ts`:

```typescript
export type AgentName = 'general' | 'weather' | 'custom'; // Add your agent

export async function initializeAgents(): Promise<Record<AgentName, Agent>> {
   // ... existing code ...
   
   [
      new GeneralAgent(),
      new MyCustomAgent(), // Add your agent here
   ]
   .forEach(agent => {
      Agents[agent.getName()] = agent;
      agent.setMCPManager(globalMCPManager);
   });
   
   // ... rest of code ...
}
```

### Step 3: Use the Agent

Via API:
```bash
curl -X POST https://localhost:3000/chat/custom \
  -H "Content-Type: application/json" \
  -d '{"session": "session_token", "prompt": "Hello"}'
```

Via CLI:
```bash
npm run cli
> select custom
> Hello, how can you help me?
```

## Agent Methods

### Required Methods

#### `getName(): AgentName`
Returns the unique identifier for this agent.

```typescript
getName(): AgentName {
   return 'custom';
}
```

#### `getSystemPrompt(): string`
Defines the agent's behavior and capabilities.

```typescript
getSystemPrompt(): string {
   return `You are a helpful assistant that specializes in...
   
   Key capabilities:
   - Capability 1
   - Capability 2
   
   Guidelines:
   - Be clear and concise
   - Always verify information`;
}
```

### Optional Methods

#### `getOptions(): Partial<Options>`
Customize LLM parameters.

```typescript
getOptions() {
   return {
      seed: 123,           // Deterministic responses
      temperature: 0,      // Creative (1.0) vs precise (0.0)
      top_p: 0.9,         // Nucleus sampling
      top_k: 40,          // Top-k sampling
      num_predict: 2000,  // Max tokens to generate
   };
}
```

#### `getAllowedServerNames(): string[] | undefined`
Restrict agent to specific MCP servers.

```typescript
getAllowedServerNames(): string[] | undefined {
   return ['time-server', 'weather-server']; // Only these servers
   // OR
   return undefined; // All available servers
}
```

#### `shouldValidate(): boolean`
Enable validation mode for structured data extraction.

```typescript
shouldValidate(): boolean {
   return true; // Agent responses require validation
}
```

#### `validate(data: any): Promise<boolean>`
Implement custom validation logic.

```typescript
async validate(data: any): Promise<boolean> {
   // Validate the extracted data
   const schema = z.object({
      name: z.string(),
      age: z.number().positive()
   });
   
   try {
      schema.parse(data);
      return true;
   } catch {
      return false;
   }
}
```

## Agent Session Management

Each agent maintains a session that tracks conversation history and user context.

### Setting a Session

```typescript
const agent = await getAgentFromName('custom');
agent.setSession(session);
```

### Accessing Session Data

```typescript
const session = this.getSession();
const userId = session?.getUserId();
const sessionId = session?.getId();
```

## Agent Communication

### Chat Method

```typescript
const response = await agent.chat(
   "What's the weather?",
   abortSignal,  // Optional: For cancellation
   true          // Optional: Enable streaming
);
```

### Streaming Responses

```typescript
if (stream) {
   const readableStream = await agent.chat(prompt, undefined, true);
   const reader = readableStream.getReader();
   
   while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      console.log(value);
   }
}
```

## MCP Tool Access

Agents automatically gain access to tools from allowed MCP servers.

```typescript
// In your agent's system prompt
getSystemPrompt(): string {
   return `You have access to these tools:
   - get_current_time: Get the current time
   - get_weather: Get weather information
   
   Use them to answer user queries.`;
}
```

## Best Practices

### 1. Clear System Prompts
- Define agent's role and capabilities clearly
- Provide examples of expected behavior
- Set boundaries for what the agent should/shouldn't do

### 2. Appropriate Temperature Settings
- **0.0**: Deterministic, precise answers (documentation, code)
- **0.3-0.5**: Balanced (general assistance)
- **0.7-1.0**: Creative (writing, brainstorming)

### 3. Tool Access Control
- Only grant access to necessary MCP servers
- Document which tools are available in system prompt
- Test tool interactions thoroughly

### 4. Error Handling
- Always handle errors gracefully
- Provide helpful error messages
- Log errors for debugging

### 5. Session Management
- Check for session presence before accessing
- Clean up resources properly
- Don't store sensitive data in session

## Testing Agents

### Unit Tests

```typescript
import { MyCustomAgent } from './myCustomAgent';

describe('MyCustomAgent', () => {
   let agent: MyCustomAgent;
   
   beforeEach(() => {
      agent = new MyCustomAgent();
   });
   
   test('should return correct name', () => {
      expect(agent.getName()).toBe('custom');
   });
   
   test('should have appropriate system prompt', () => {
      const prompt = agent.getSystemPrompt();
      expect(prompt).toContain('specialized in');
   });
});
```

### Integration Tests

```typescript
test('agent should use MCP tools', async () => {
   const agent = await getAgentFromName('custom');
   agent.setSession(mockSession);
   
   const response = await agent.chat("What time is it?");
   expect(response).toContain('current time');
});
```

## Debugging

### Enable Debug Logging

```bash
# In .env
NODE_ENV=development
```

### Check Agent Initialization

```typescript
const agents = await initializeAgents();
Logger.info(`Available agents: ${Object.keys(agents).join(', ')}`);
```

### Monitor MCP Manager

```typescript
const mcpManager = getGlobalMCPManager();
const servers = await mcpManager.listServers();
Logger.info(`Active MCP servers: ${servers.join(', ')}`);
```

## Examples

### General Purpose Agent

```typescript
export class GeneralAgent extends AbstractAgent {
   getName(): AgentName {
      return 'general';
   }

   getSystemPrompt(): string {
      return GENERAL_ASSISTANT_SYSTEM_PROMPT;
   }
}
```

### Validation-Based Agent

```typescript
export class DataExtractionAgent extends AbstractAgent {
   getName(): AgentName {
      return 'extractor';
   }

   getSystemPrompt(): string {
      return `Extract structured data from text and return JSON.`;
   }
   
   shouldValidate(): boolean {
      return true;
   }
   
   async validate(data: any): Promise<boolean> {
      return typeof data === 'object' && data !== null;
   }
}
```

## Troubleshooting

### Agent Not Found
- Ensure agent is registered in `initializeAgents()`
- Check agent name matches exactly
- Verify TypeScript compilation succeeded

### MCP Tools Not Available
- Check MCP manager initialization
- Verify MCP server configuration in `mcp-servers.json`
- Ensure `getAllowedServerNames()` includes required servers

### Session Issues
- Verify session is set before calling chat
- Check session hasn't expired
- Ensure proper session authentication

## Related Documentation

- [MCP Integration](MCP_INTEGRATION.md)
- [LLM Providers](LLM_PROVIDERS.md)
- [Configuration Guide](CONFIGURATION.md)
- [Testing Guide](TESTING_GUIDE.md)
