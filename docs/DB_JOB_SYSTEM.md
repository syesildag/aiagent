# DB-Backed Job System

## Overview

The DB-backed job system extends the base [Job System](JOB_SYSTEM.md) with persistent state stored in PostgreSQL. Jobs that subclass `DbJobFactory` have their `enabled` flag, run history, and configuration params persisted to the `ai_agent_jobs` table. Their state can be toggled at runtime via the **jobs MCP server** without restarting the server.

## Architecture

```
JobFactory (base, in-memory enabled flag)
  └── DbJobFactory (enabled flag persisted to ai_agent_jobs table)
        └── AgentJob  (runs a named AI agent with a fixed prompt on schedule)
              └── YourConcreteJob  (defines agentName, prompt, Spec)
```

### How enabled/disabled works

`DbJobFactory` always creates the `node-schedule` timer regardless of the DB `enabled` value. On every tick the callback re-reads the DB row:

```
node-schedule tick
  │
  ├─ SELECT enabled FROM ai_agent_jobs WHERE name = ?
  │
  ├─ enabled = false ──► return  (silent no-op)
  │
  └─ enabled = true  ──► getJobBody()
                          └─ UPDATE last_run_at = NOW()
```

This means:
- A job disabled via the MCP server takes effect at its **next scheduled tick** — no restart needed.
- A job enabled via the MCP server resumes at its **next scheduled tick** — no restart needed.
- Initial `enabled` state is set once when the DB row is first created (controlled by `getInitialEnabled()`). After that, the DB is the sole source of truth.

## Database Schema

```sql
CREATE TABLE ai_agent_jobs (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL UNIQUE,  -- stable job identifier
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    params      JSONB,                         -- agentName, prompt, schedule, type, etc.
    user_login  CHARACTER VARYING,             -- owning user; NULL for static/system jobs
    last_run_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Migrations:
- `database/migrations/006_add_jobs_table.sql` — initial table
- `database/migrations/008_add_user_login_to_jobs.sql` — adds `user_login` column

## DbJobFactory

`src/utils/dbJobFactory.ts`

Abstract base for all DB-persistent jobs. Subclasses must implement three methods:

| Method | Required | Purpose |
|---|---|---|
| `getJobName(): string` | **Yes** | Unique, stable DB key. Must not change once deployed. |
| `getSpec(): Spec` | **Yes** | node-schedule `RecurrenceRule`, cron string, or `Date`. |
| `getJobBody(): Promise<void> \| void` | **Yes** | Work performed on each enabled tick. |
| `getDefaultParams(): Record<string, unknown>` | No | Initial JSONB params written on first startup. |
| `getInitialEnabled(): boolean` | No | Whether the job starts enabled. Default: `true`. |

### Minimal example

```typescript
import { RecurrenceRule } from "node-schedule";
import DbJobFactory from "../utils/dbJobFactory";

export default class CleanupJob extends DbJobFactory {

   protected getJobName() { return "cleanup-job"; }

   protected getSpec() {
      const rule = new RecurrenceRule();
      rule.hour = 3;
      rule.minute = 0;
      return rule; // 03:00 daily
   }

   protected async getJobBody() {
      await deleteStaleRecords();
   }
}
```

Drop the file in `src/jobs/` — it is discovered and scheduled automatically on startup.

### Controlling initial enabled state

```typescript
protected override getInitialEnabled(): boolean {
   return false; // opt-in: must be enabled via MCP server before it runs
}
```

Once the DB row exists, `getInitialEnabled()` has no effect. Use the MCP server to toggle.

## AgentJob

`src/utils/agentJob.ts`

Abstract subclass of `DbJobFactory` that runs a named AI agent with a fixed prompt on a schedule. Ideal for automated reporting, summaries, or any recurring LLM task.

### Constructor

```typescript
constructor(agentName: string, prompt: string, spec: Spec)
```

| Parameter | Type | Description |
|---|---|---|
| `agentName` | `string` | Must match a registered agent name (e.g. `'general'`, `'weather'`) |
| `prompt` | `string` | The prompt sent to the agent on every enabled tick |
| `spec` | `Spec` | node-schedule `RecurrenceRule`, cron string, or `Date` |

The `agentName`, `prompt`, and a human-readable schedule string are stored in the `params` JSONB column for inspection via the MCP server.

### Creating an AgentJob subclass

```typescript
import { RecurrenceRule } from "node-schedule";
import AgentJob from "../utils/agentJob";

export default class DailyWeatherBriefing extends AgentJob {

   constructor() {
      const rule = new RecurrenceRule();
      rule.hour = 8;
      rule.minute = 0;
      rule.second = 0;

      super(
         'weather',
         'Give me today\'s weather forecast for Istanbul and flag any severe alerts.',
         rule,
      );
   }
}
```

Drop the file in `src/jobs/`. On startup the agent system is initialized first, then the job is scheduled. The agent is resolved **lazily** at execution time so there is no circular initialization issue.

### Notes

- The result returned by `agent.chat()` is logged at `INFO` level. It is not persisted — implement a subclass of `DbJobFactory` directly and call `queryDatabase()` if you need to store results.
- Errors thrown by the agent are caught and logged; they do not crash the job or affect its schedule.
- The job runs with `freshContext: true` so it does not share or pollute any user conversation history.

## Jobs MCP Server

`src/mcp/server/jobs.ts`

A subprocess MCP server that reads and writes the `ai_agent_jobs` table. The general agent (and any agent with access to the `jobs` MCP server) can manage jobs in natural language.

### Tools

All tools enforce access control based on the calling user's `is_admin` flag. See [JOBS-SERVER.md — Access Control](JOBS-SERVER.md#access-control) for the full permission matrix.

| Tool | Purpose |
|---|---|
| `list_jobs` | List visible jobs (all for admins; own + static for non-admins) |
| `get_job_info` | Get details of a single visible job |
| `enable_job` | Set `enabled = true` (own jobs for non-admins; any for admins) |
| `disable_job` | Set `enabled = false` (own jobs for non-admins; any for admins) |
| `create_agent_job` | Create a new dynamic job; `user_login` is set to the calling user |
| `update_job_prompt` | Update `prompt`/`schedule` of a dynamic job |
| `delete_agent_job` | Delete a dynamic job |

For full argument details and example responses, see [JOBS-SERVER.md](JOBS-SERVER.md).

### Configuration (`mcp-servers.json`)

```json
{
  "name": "jobs",
  "command": "node",
  "args": ["dist/src/mcp/server/jobs.js"],
  "enabled": true
}
```

## Example: ExampleAgentJob

`src/jobs/exampleAgentJob.ts`

A ready-to-use demo. It is **disabled by default** (`getInitialEnabled()` returns `false`).

To enable it:

```
# via MCP tool call
enable_job({ name: "agent-job-general-exampleagentjob" })

# or directly in PostgreSQL
UPDATE ai_agent_jobs SET enabled = true WHERE name = 'agent-job-general-exampleagentjob';
```

## Startup flow

```
server start
  │
  └─ scheduleJobs()
       │
       └─ for each file in src/jobs/
            │
            ├─ new MyJob()
            ├─ await myJob.initialize()       ← upserts ai_agent_jobs row
            └─ myJob.create()                 ← always creates node-schedule timer
```

`initialize()` on plain `JobFactory` subclasses is a no-op, so existing jobs (`SessionTimeout`, `Watchdog`) are unaffected.

## Adding a new DB-backed job: checklist

1. Create `src/jobs/myJob.ts` extending `AgentJob` or `DbJobFactory`.
2. Implement `getJobName()` (stable, unique string), `getSpec()`, and `getJobBody()`.
3. Optionally override `getDefaultParams()` and `getInitialEnabled()`.
4. Run `npm run migrate` to apply `006_add_jobs_table.sql` if not already applied.
5. Build: `npm run build`.
6. The job row appears in `ai_agent_jobs` after first startup.

## Entity & Repository

`src/entities/ai-agent-jobs.ts`

```typescript
import aiAgentJobRepository from "../entities/ai-agent-jobs";

// Find by name
const job = await aiAgentJobRepository.findByName("my-job-name");

// Save changes (e.g. toggle enabled)
job.setEnabled(false);
await aiAgentJobRepository.save(job);

// Check ownership
const owner = job.getUserLogin(); // string | undefined — null for static jobs
```

The repository follows the same decorator-based ORM pattern as all other entities. See [ENTITY_CREATION_GUIDE.md](ENTITY_CREATION_GUIDE.md) for details.
