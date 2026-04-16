# MCP System

> For a concise end-to-end architecture diagram see [AGENT_SYSTEM.md](AGENT_SYSTEM.md).
> For individual MCP server documentation see the server-specific docs (e.g. [JOBS-SERVER.md](JOBS-SERVER.md)).

## Overview

The MCP (Model Context Protocol) system is the execution backbone of the agent. It:

1. Spawns and manages external MCP server sub-processes.
2. Exposes every server's tools, resources, and prompts to the LLM as callable functions.
3. Runs the **agentic loop** — the repeated LLM → tool-call → result cycle.
4. Enforces **human-in-the-loop approval** for dangerous tools.
5. Provides the **Task virtual tool** so the LLM can delegate work to specialized sub-agents.

### Key files

| File | Responsibility |
|------|----------------|
| `src/mcp/mcpManager.ts` | `MCPServerManager` + `MCPServerConnection` — core orchestration |
| `src/mcp/approvalManager.ts` | `ApprovalManager` singleton — pending approval store |
| `src/mcp/llmProviders.ts` | `LLMProvider` interface and concrete implementations |
| `src/mcp/llmFactory.ts` | `createLLMProvider()` factory function |
| `src/agent.ts` | Agent registry, sub-agent runner wiring, `initializeAgents()` |
| `mcp-servers.json` | Runtime server configuration |

---

## MCPServerManager

`MCPServerManager` is the single entry point used by agents. One global instance is created in `agent.ts` and shared across all registered agents.

### Construction

```typescript
const manager = new MCPServerManager(
  configPath,   // path to mcp-servers.json (default: './mcp-servers.json')
  llmProvider,  // LLMProvider instance (default: OllamaProvider)
  model,        // model name string (default: 'qwen3:4b')
);
```

### Lifecycle

```
new MCPServerManager()
  └─ ensureInitialized()          (lazy, on first chatWithLLM call)
       ├─ loadServersConfig()     reads mcp-servers.json
       ├─ checkHealth()           pings the LLM provider
       └─ startAllServers()       spawns one MCPServerConnection per enabled server
```

`stopAllServers()` terminates all child processes. `cleanup()` is registered for `SIGINT`, `SIGTERM`, and `exit`.

### Singleton export

```typescript
// src/mcp/mcpManager.ts
const mcpManager = new MCPServerManager();
export default mcpManager;
```

Agents obtain their manager via `agent.setMCPManager(globalMCPManager)` called from `initializeAgents()`.

---

## MCPServerConnection

Each `MCPServerConnection` wraps a single MCP server child process. It:

- Spawns the process via `child_process.spawn` with `stdio: ['pipe','pipe','pipe']`.
- Communicates over **newline-delimited JSON-RPC 2.0** on `stdin`/`stdout`.
- Sends an `initialize` handshake and `notifications/initialized` on startup.
- Discovers tools, resources, and prompts from the server via `tools/list`, `resources/list`, `prompts/list`.
- Has a **30-second request timeout** per JSON-RPC call.

### JSON-RPC flow

```
Host (MCPServerConnection)            MCP Server subprocess
  ──── initialize ────────────────────►
  ◄─── capabilities + tools list ──────
  ──── notifications/initialized ─────►
  ──── tools/list ─────────────────────►
  ◄─── [{name, description, schema}] ──
  ──── tools/call {name, arguments} ──►
  ◄─── {content: [{type, text}]} ──────
```

---

## Tool Naming Convention

When tools are exposed to the LLM they are prefixed with the server name:

```
<serverName>_<toolName>
```

Examples:
- `jobs_list_jobs`
- `memory_create`
- `weather_current_weather`

This prefix is used by `handleToolCall()` to route the call back to the correct `MCPServerConnection`.

### Resource and prompt access

Resources and prompts are also surfaced as callable tools:

| Pattern | Generated tool name |
|---------|-------------------|
| Server has resources | `<serverName>_get_resource` |
| Server exposes prompt `foo` | `<serverName>_prompt_foo` |

---

## Agentic Loop (`chatWithLLM`)

`MCPServerManager.chatWithLLM(args)` implements the full agent turn.

```
User message
  │
  ▼
Add to conversation history
  │
  ▼
Build messages array [system + history window]
  │
  ┌──────────────────────────────┐
  │   while iteration < max      │
  │                              │
  │   LLM.chat(messages, tools)  │
  │        │                     │
  │   tool_calls present?        │
  │   ├── No → return content    │
  │   └── Yes                    │
  │        │                     │
  │   for each tool call:        │
  │     ├─ approval check        │
  │     └─ handleToolCall()      │
  │          │                   │
  │   append tool results        │
  │   to messages                │
  └──────────────────────────────┘
  │
  ▼
Max iterations reached →
  final LLM call (no tools, streaming allowed)
  │
  ▼
Return response string or ReadableStream
```

### Key `ChatWithLLMArgs` options

| Field | Type | Description |
|-------|------|-------------|
| `message` | `string` | The user's text |
| `customSystemPrompt` | `string` | Agent-specific system prompt |
| `serverNames` | `string[]` | Restrict tools to these MCP servers |
| `toolNameFilter` | `string[]` | Further restrict by exact name or prefix; `"*"` allows all |
| `maxIterations` | `number` | Override `MAX_LLM_ITERATIONS` for this call |
| `freshContext` | `boolean` | Skip prior conversation history (for stateless slash commands) |
| `stream` | `boolean` | Stream the final response |
| `attachments` | `array` | Base64 files (images inline, text embedded, binary as data URL) |
| `approvalCallback` | `ToolApprovalCallback` | Called before any dangerous tool executes |
| `abortSignal` | `AbortSignal` | Cancel the loop at any iteration boundary |
| `userLogin` | `string` | Authenticated user; injected into system prompt and memory tools |

---

## Human-in-the-Loop Approval

Before executing a tool whose name matches `DANGEROUS_TOOL_PATTERNS` (or whose MCP annotation has `destructiveHint: true`), `MCPServerManager` calls the `approvalCallback`.

### Dangerous patterns (regex)

```
delete, drop, truncate, execute, run, send, write,
remove, kill, deploy, publish, destroy, reset,
wipe, format, nuke, purge
```

A tool annotated with `readOnlyHint: true` always bypasses the check.

### ApprovalManager

`approvalManager` (singleton in `src/mcp/approvalManager.ts`) stores pending decisions as promises:

```typescript
// Register a pending approval; returns a Promise<boolean>
approvalManager.register(id);

// Later, from the HTTP handler POST /chat/approve/:id
approvalManager.resolve(id, true);  // approve
approvalManager.resolve(id, false); // deny
```

Unresolved approvals auto-deny after `config.APPROVAL_TIMEOUT_MS`.

### Streaming protocol

When approval is required the chat endpoint emits an **`approval`** NDJSON event to the browser:

```json
{"t":"approval","id":"<uuid>","toolName":"jobs_disable_job","args":{...}}
```

The browser calls `POST /chat/approve/<id>` with `{ approved: true|false }` to resolve it.

---

## Virtual Task Tool (Sub-Agent Delegation)

When a `SubAgentRunner` is registered the manager injects a virtual `task` tool into every agent's tool list. This lets the LLM delegate complex sub-tasks to specialized agents without being aware of the underlying routing.

### Tool definition

```
task(description, prompt, subagent_type)
```

- `subagent_type` is an `enum` of the **permitted** sub-agent names (see filtering rules below).
- The tool description lists each permitted sub-agent and its one-sentence description automatically.

### Sub-agent server-coverage filtering

The `subagent_type` enum shown to the LLM is **not** the full list of registered sub-agents — it is filtered at `chatWithLLM` time to only include sub-agents whose `getAllowedServerNames()` is entirely covered by the calling (parent) agent's own allowed servers.

| Parent `serverNames` | Sub-agent `getAllowedServerNames()` | Included? |
|---|---|---|
| `null` (unrestricted) | anything | yes |
| `['weather', 'time']` | `['weather', 'time']` | yes |
| `['weather', 'time']` | `['weather']` | yes (subset) |
| `['weather', 'time']` | `['weather', 'memory']` | **no** — `memory` not available to parent |
| `['weather', 'time']` | `undefined` (all servers) | **no** — too permissive |

This prevents privilege escalation: a restricted agent cannot delegate to a sub-agent that would use servers outside the parent's scope.

> **Note for sub-agent authors**: a file-based agent must declare `allowedServerNames` in its frontmatter to appear as a delegation target for any restricted parent. An agent with no `allowedServerNames` (uses all servers) is only offered to unrestricted parents.

### Wiring (agent.ts)

```typescript
// After all file-based agents are loaded:
globalMCPManager.setSubAgentRunner(
  subAgentRunner,
  subAgentDescriptions,   // Record<name, description>
  subAgentAllowedServers, // Record<name, string[] | undefined>
);
```

Sub-agent calls always run with `freshContext: true` (no shared history) and without streaming.

---

## LLM Providers

All providers implement the `LLMProvider` interface:

```typescript
interface LLMProvider {
  name: string;
  checkHealth(): Promise<boolean>;
  getAvailableModels(): Promise<string[]>;
  chat(request: LLMChatRequest, abortSignal?: AbortSignal): Promise<LLMChatResponse>;
}
```

### Available providers

| Provider | `LLM_PROVIDER` value | Notes |
|----------|----------------------|-------|
| `OllamaProvider` | `ollama` (default) | Connects to `OLLAMA_HOST`; default model `qwen3:4b` |
| `OpenAIProvider` | `openai` | Requires `OPENAI_API_KEY`; optional `OPENAI_BASE_URL` |
| `GitHubCopilotProvider` | `github` | OAuth device-flow via `AuthGithubCopilot.access()` |

The active provider is created once in `llmFactory.ts → createLLMProvider()` and passed to `MCPServerManager`.

### Token limits

`getModelMaxTokens(model)` in `llmProviders.ts` returns the context-window size for 80+ models. When the conversation history exceeds the model's limit the provider truncates older messages while preserving the system prompt, the most recent context, and tool-call integrity.

---

## Tools Cache

`convertMCPToolsToLLMFormat()` converts all MCP tools into the `Tool[]` format expected by the LLM and **caches the result**. The cache is invalidated when:

- Servers are started or stopped.
- `refreshToolsCache()` is called explicitly.
- A `SubAgentRunner` is registered (`setSubAgentRunner`).

Use `getCachedToolsCount()` and `isToolsCacheValid()` to inspect cache state.

---

## mcp-servers.json

```json
{
  "servers": [
    {
      "name": "my-server",
      "command": "node",
      "args": ["dist/src/mcp/server/my-server.js"],
      "env": {
        "MY_API_KEY": "${MY_API_KEY}"
      },
      "enabled": true
    }
  ]
}
```

- `${VAR_NAME}` placeholders in `env` values are expanded from `process.env` at load time.
- Servers with `"enabled": false` are skipped.
- Add new servers here **and** build the corresponding server file in `src/mcp/server/`.

---

## Adding a New MCP Server

1. Create `src/mcp/server/my-server.ts` using `McpServer` from `@modelcontextprotocol/sdk`.
2. Register tools with `server.registerTool(name, schema, handler)`.
3. Connect with `StdioServerTransport`.
4. Add the entry to `mcp-servers.json` (see format above).
5. Build: `npm run build`.

See [src/mcp/server/jobs.ts](../src/mcp/server/jobs.ts) for a minimal reference implementation.

---

## Adding a New Agent

1. Create `src/agents/myAgent.ts` extending `AbstractAgent`.
2. Implement `getName()`, `getDescription()`, `getSystemPrompt()`, `getAllowedServerNames()`.
3. Register the instance in `src/agent.ts`:
   ```typescript
   new MyAgent(),
   ```
4. The agent automatically appears in the `task` tool's `subagent_type` enum.

See [AGENT_SYSTEM.md](AGENT_SYSTEM.md) for a full walkthrough.

---

## Related Documentation

- [AGENT_SYSTEM.md](AGENT_SYSTEM.md) — Agent architecture, `AbstractAgent`, adding agents
- [MCP_INTEGRATION.md](MCP_INTEGRATION.md) — Original MCP integration overview
- [LLM_PROVIDERS.md](LLM_PROVIDERS.md) — Provider configuration details
- [JOBS-SERVER.md](JOBS-SERVER.md) — Jobs MCP server reference
- [SLASH_COMMANDS.md](SLASH_COMMANDS.md) — `toolNameFilter`, `maxIterations`, `freshContext` in slash commands
- [CONFIGURATION.md](CONFIGURATION.md) — All environment variables
