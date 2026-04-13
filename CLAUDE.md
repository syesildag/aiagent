# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build (compile TypeScript with SWC, copy PWA assets)
npm run build

# Build including webpack frontend bundle
npm run build:all

# Run production server (HTTPS)
npm start

# Run development server (HTTP, no SSL required)
npm run dev

# Run interactive CLI
npm run cli         # production
npm run cli:dev     # development

# Type-check without emitting
npm run typecheck

# Lint
npm run lint
npm run lint:fix

# Tests
npm test                                        # all tests
npx jest src/path/to/test.file.test.ts          # single test file

# Database migrations
npm run migrate                  # build + run pending migrations
npm run migrate -- status        # show migration status
npm run migrate -- reset         # reset all migrations

# Entity generator (generate TypeScript entities from PostgreSQL tables)
npm run buildEntityGen -- --table table_name --output src/entities
npm run buildEntityGen -- --schema public --output src/entities

# Add a user
npm run addUser -- <username> <password>

# Set/unset admin flag for a user
npm run setUserAdmin -- <username> <true|false>
```

Development mode (`NODE_ENV=development`) uses HTTP instead of HTTPS, so no SSL certificates are required.

## Architecture

### High-Level

Express.js HTTPS server (HTTP in dev) with a React SPA frontend. The backend orchestrates AI agents via MCP servers and supports multiple LLM providers. PostgreSQL (with pgvector) is the only database.

```
Client (Browser SPA or CLI)
  → Express.js server (src/index.ts)
    → Session auth middleware → PostgreSQL
    → Agent system (src/agent.ts)
      → AbstractAgent (src/agents/abstractAgent.ts)
        → MCPServerManager (src/mcp/mcpManager.ts)
          → LLM Provider (Ollama | OpenAI | GitHubCopilot)
          → MCP subprocess servers (stdio JSON-RPC 2.0)
```

### Key Subsystems

**Agent system** (`src/agent.ts`, `src/agents/`): `initializeAgents()` creates a single global `MCPServerManager` and assigns it to all registered agents. Add new agents by subclassing `AbstractAgent`, implementing `getName()`, `getSystemPrompt()`, and `getAllowedServerNames()`, then registering the instance in `agent.ts`. Agents can optionally override `shouldValidate()` and `validate(data)` for structured data extraction. LLM options (temperature, seed, top_p, etc.) are customizable per agent.

**MCP layer** (`src/mcp/`): `MCPServerManager` reads `mcp-servers.json`, spawns each server as a child process, and communicates via JSON-RPC 2.0 over stdio. It also handles the LLM agentic loop (tool calling, iteration limits). Tool approval is required for tools matching `DANGEROUS_TOOL_PATTERNS` in `mcpManager.ts`. MCP servers live in `src/mcp/server/` and are built independently. Tool names follow the convention `<serverName>_<toolName>` (e.g. `jobs_list_jobs`). The tools cache has a 5-minute TTL and can be explicitly invalidated via `refreshToolsCache()`. Servers start lazily on the first `chatWithLLM()` call.

**LLM providers** (`src/mcp/llmProviders.ts`, `src/mcp/llmFactory.ts`): Implements a `LLMProvider` interface with `OllamaProvider`, `OpenAIProvider`, and `GitHubCopilotProvider`. Provider is selected at startup from `config.LLM_PROVIDER`. GitHub Copilot uses OAuth device flow managed by `src/utils/githubAuth.ts` with auto-token refresh.

**Repository/ORM** (`src/repository/`): Custom decorator-based ORM over PostgreSQL. Entities extend `Entity<PK>` and annotate getter methods with `@Id`, `@Column`, `@OneToOne`, `@OneToMany`, `@ManyToOne`. Each entity file creates and registers its own `AbstractRepository` subclass via the global `repository` WeakMap (`src/repository/repository.ts`). The `@Find` decorator auto-generates find methods; method names encode ordering and filtering (e.g. `findByTypeOrderByCreatedAtDesc`). Use `getByFieldValues()` for flexible querying with ordering/limit/offset. Prefer the ORM for CRUD; use raw SQL for complex joins or vector similarity.

**Database migrations** (`database/migrations/`, `src/utils/migrationRunner.ts`): SQL files named `NNN_description.sql`. The `MigrationRunner` tracks applied versions in `ai_agent_schema_migrations`.

**Config** (`src/utils/config.ts`): All environment variables are validated with Zod at startup. Always import from `config`, never from `process.env` directly. In tests, `NODE_ENV=test` bypasses real validation and returns safe defaults.

**Streaming responses** (`src/utils/streamUtils.ts`): Chat endpoint returns NDJSON. Each line is a JSON object with a `t` field: `"text"` for content chunks, `"approval"` for human-in-the-loop tool approval requests. The browser resolves approvals by calling `POST /chat/approve/:approvalId`.

**Frontend** (`src/frontend/`): React 19 SPA using MUI. Bundled with webpack (`webpack.config.js`) into `dist/static/`. Served dynamically per agent at `/front/:agent`. Auth state lives in `AuthContext`. The service worker (`src/frontend/pwa/sw.js`) is copied to `dist/src/frontend/pwa/` during build.

**Jobs** (`src/jobs/`, `src/worker/`): Background jobs discovered at startup via `initFromPath`. Three base classes:
- `JobFactory`: Direct callback execution.
- `ThreadJobFactory`: Offloads to a Node.js worker thread pool.
- `DbJobFactory`: Persists enabled flag, params, and `last_run_at` to `ai_agent_jobs` table; can be toggled at runtime without restart.

`AgentJob` (`src/utils/agentJob.ts`) extends `DbJobFactory` and runs a named agent with a fixed prompt on a schedule. Create a subclass in `src/jobs/` to add a new agent-driven scheduled task.

**Conversation history**: Two implementations share the `IConversationHistory` interface — in-memory (default) and `DbConversationHistory` (PostgreSQL, enabled via `USE_DB_CONVERSATION_HISTORY=true`). DB-backed history stores rows in `ai_agent_conversations` and `ai_agent_conversation_messages`.

**Embedding service** (`src/utils/embeddingService.ts`): Multi-provider (OpenAI, Ollama, GitHub Copilot, local transformers.js). Supports batch generation, LRU caching (1 h TTL), and pgvector similarity search (`cosineSimilarity`, `dotProduct`, `euclideanDistance`, `findMostSimilar`).

**Slash commands & skills** (`.aiagent/commands/`, `.aiagent/skills/`): Reusable prompts with frontmatter (`description`, `allowed-tools`, `model`, etc.), argument substitution (`$1`, `$ARGUMENTS`), file inclusion (`@path`), and bash capture (`` !`cmd` ``). Skills are auto-injected into every agent's system prompt inside a `<skills>...</skills>` block.

### Entity Pattern

```ts
export class MyEntity extends Entity<number> {
  @Id('id')          getId(): number | undefined { ... }
  @Column({ columnName: 'my_col', notNull: true })
  getMyCol(): string { ... }
}

class MyRepository extends AbstractRepository<MyEntity> {
  constructor() { super('my_table', MyEntity); }
  @Find()
  async findByMyCol(val: string): Promise<MyEntity | null> { return null; }
}
const myRepository = new MyRepository();
repository.set(MyEntity, myRepository);
export default myRepository;
```

### Environment Variables

Required: `PORT`, `HOST`, `DB_USER`, `DB_HOST`, `DB_NAME`, `DB_PORT`, `HMAC_SECRET_KEY`, `SERVER_TERMINATE_TIMEOUT`.

Optional with defaults:

| Variable | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | `ollama` \| `openai` \| `github` |
| `LLM_MODEL` | `qwen3:4b` | |
| `OLLAMA_HOST` | `http://localhost:11434` | |
| `MCP_SERVERS_PATH` | `./mcp-servers.json` | |
| `MAX_LLM_ITERATIONS` | `2` | |
| `CONVERSATION_HISTORY_WINDOW_SIZE` | `10` | |
| `EMBEDDING_PROVIDER` | `auto` | `auto` \| `openai` \| `ollama` \| `github` \| `local` |
| `USE_DB_CONVERSATION_HISTORY` | `false` | |
| `SESSION_TIMEOUT_SECONDS` | `3600` | |
| `OPENAI_API_KEY` | — | Required for OpenAI provider |
| `OPENWEATHERMAP_API_KEY` | — | Required for weather MCP server |

### MCP Server Configuration (`mcp-servers.json`)

```json
{
  "servers": [
    { "name": "my-server", "command": "node", "args": ["dist/src/mcp/server/my-server.js"], "enabled": true }
  ]
}
```

New MCP servers go in `src/mcp/server/`, use `McpServer` from `@modelcontextprotocol/sdk`, and must be added to `mcp-servers.json`.

### API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/login` | Basic auth → session cookie |
| `POST` | `/chat/:agent` | Chat (NDJSON streaming or full response) |
| `POST` | `/chat/approve/:approvalId` | Resolve a pending tool-approval request |
| `POST` | `/validate/:agent` | Structured data validation |

Rate limits: 5 req/15 min (login), 100 req/15 min (chat).
