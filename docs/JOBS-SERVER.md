# Jobs MCP Server

A Model Context Protocol server that exposes tools for managing scheduled jobs whose state is persisted in the `ai_agent_jobs` PostgreSQL table. It allows agents to inspect, enable, and disable jobs at runtime without restarting the server.

> **Looking for how jobs are defined and scheduled?** See [JOB_SYSTEM.md](JOB_SYSTEM.md) and [DB_JOB_SYSTEM.md](DB_JOB_SYSTEM.md).

## Features

- **List jobs** — View registered jobs (visibility depends on caller's role — see [Access Control](#access-control))
- **Inspect a single job** — Retrieve full details for a specific job by name
- **Enable / Disable jobs** — Toggle a job on or off at runtime; changes take effect at the next scheduled tick
- **Create dynamic jobs** — Schedule a new agent job at runtime without restarting the server
- **Update / Delete dynamic jobs** — Modify or remove jobs created via `create_agent_job`
- **No server restart required** — State changes are written to the database and picked up by the main process automatically
- **Per-user job ownership** — Dynamic jobs are associated with the user who created them; access is governed by the caller's `is_admin` flag

## MCP Server Configuration

The server is pre-registered in `mcp-servers.json`:

```json
{
  "name": "jobs",
  "command": "node",
  "args": ["dist/src/mcp/server/jobs.js"],
  "enabled": true
}
```

The server communicates over **stdio** using JSON-RPC 2.0 and requires an active PostgreSQL connection (configured via the standard `DB_*` environment variables — see [CONFIGURATION.md](CONFIGURATION.md)).

## Available Tools

### `list_jobs`

Returns registered scheduled jobs ordered alphabetically by name. Visibility depends on the caller's role (see [Access Control](#access-control)).

**Arguments:** none

**Example response:**
```
Found 2 job(s):

{
  "id": 1,
  "name": "cleanup-old-conversations",
  "enabled": true,
  "params": {},
  "userLogin": null,
  "lastRunAt": "2026-03-08T02:00:00.000Z",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-03-08T02:00:00.000Z"
}

---

{
  "id": 2,
  "name": "agent-job-general-my-summary",
  "enabled": true,
  "params": { "type": "dynamic", "agentName": "general", "prompt": "...", "schedule": "0 8 * * *" },
  "userLogin": "alice",
  "lastRunAt": null,
  "createdAt": "2026-03-10T10:00:00.000Z",
  "updatedAt": "2026-03-10T10:00:00.000Z"
}
```

---

### `get_job_info`

Returns detailed information about a single scheduled job. Non-admin callers cannot retrieve jobs owned by other users (returns "not found").

**Arguments:**
- `name` (string, required): The unique name of the job to retrieve

**Example:**
```json
{
  "name": "cleanup-old-conversations"
}
```

**Example response:**
```json
{
  "id": 1,
  "name": "cleanup-old-conversations",
  "enabled": true,
  "params": {},
  "userLogin": null,
  "lastRunAt": "2026-03-08T02:00:00.000Z",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-03-08T02:00:00.000Z"
}
```

If the job is not found (or not visible to the caller), the tool returns: `Job not found: "<name>"`

---

### `enable_job`

Sets `enabled = true` for the specified job. The main process will resume executing the job at its next scheduled tick.

Non-admin callers can only enable their own dynamic jobs.

**Arguments:**
- `name` (string, required): The unique name of the job to enable

**Example response:**
```
Job "refresh-embeddings" enabled. Changes take effect at the next scheduled tick.
```

---

### `disable_job`

Sets `enabled = false` for the specified job. The scheduler timer continues to fire but the job body is skipped until the job is re-enabled.

Non-admin callers can only disable their own dynamic jobs.

**Arguments:**
- `name` (string, required): The unique name of the job to disable

**Example response:**
```
Job "refresh-embeddings" disabled. Changes take effect at the next scheduled tick.
```

---

### `create_agent_job`

Creates a new dynamic agent job at runtime. The job is persisted to the database with `user_login` set to the calling user and is picked up by the main process within the Watchdog polling interval (~5 minutes) without a server restart.

**Arguments:**
- `agentName` (string, required): Name of the registered agent to run (e.g. `'general'`)
- `prompt` (string, required): The prompt sent to the agent on each scheduled run
- `schedule` (string, required): Cron expression — 5 or 6 space-separated fields (e.g. `'0 8 * * *'` for daily at 08:00)
- `name` (string, optional): Unique job name. Auto-generated as `agent-job-{agentName}-{slug}` if omitted
- `enabled` (boolean, default `true`): Whether the job starts enabled

**Example:**
```json
{
  "agentName": "general",
  "prompt": "Summarise yesterday's activity and email it to the team.",
  "schedule": "0 9 * * 1-5"
}
```

**Example response:**
```
Dynamic agent job "agent-job-general-summarise-yesterday-s-activ" created.
Agent:    general
Schedule: 0 9 * * 1-5
Enabled:  true

The job will be picked up within ~5 minutes (or on next server restart).
```

---

### `update_job_prompt`

Updates the `prompt` and/or `schedule` of an existing dynamic job. Only works on jobs with `params.type = 'dynamic'`. Non-admin callers can only update their own jobs. Changes take effect after the next server restart.

**Arguments:**
- `name` (string, required): The unique name of the dynamic job to update
- `prompt` (string, optional): New prompt text
- `schedule` (string, optional): New cron expression

At least one of `prompt` or `schedule` must be provided.

---

### `delete_agent_job`

Deletes a dynamic agent job. Static code-defined jobs cannot be deleted with this tool. The running schedule stops within the next Watchdog polling cycle (~5 minutes). Non-admin callers can only delete their own jobs.

**Arguments:**
- `name` (string, required): The unique name of the dynamic job to delete

---

## Access Control

The jobs server enforces role-based access using the calling user's identity, injected server-side by `MCPServerManager` — the LLM cannot forge these values.

| Tool | Admin | Non-admin |
|---|---|---|
| `list_jobs` | All jobs | Static (system) jobs + own dynamic jobs |
| `get_job_info` | Any job | Own dynamic + static jobs only |
| `enable_job` | Any job | Own dynamic jobs only |
| `disable_job` | Any job | Own dynamic jobs only |
| `create_agent_job` | Creates as self | Creates as self |
| `update_job_prompt` | Any dynamic job | Own dynamic jobs only |
| `delete_agent_job` | Any dynamic job | Own dynamic jobs only |

**Static jobs** (code-defined, `user_login IS NULL`) are visible to all users but modifiable only by admins.

**"Not found" vs "permission denied":** When a non-admin attempts to access another user's job, the server returns `Job not found: "<name>"` rather than a permission error to avoid exposing the existence of other users' jobs.

See [AUTHENTICATION.md](AUTHENTICATION.md) for how to grant admin capability to a user.

## Database Schema

The server reads and writes the `ai_agent_jobs` table. Refer to [DB_JOB_SYSTEM.md](DB_JOB_SYSTEM.md) for the full schema and migration details. The relevant columns are:

| Column        | Type        | Description                                      |
|---------------|-------------|--------------------------------------------------|
| `id`          | integer     | Auto-incremented primary key                     |
| `name`        | text        | Unique job identifier                            |
| `enabled`     | boolean     | Whether the job runs on its scheduled tick       |
| `params`      | jsonb       | Optional job-specific configuration              |
| `user_login`  | varchar     | Login of the user who created the job; `NULL` for static/system jobs |
| `last_run_at` | timestamptz | Timestamp of the most recent successful run      |
| `created_at`  | timestamptz | Row creation time                                |
| `updated_at`  | timestamptz | Last modification time                           |

## Error Handling

All tools catch database and runtime errors and return a human-readable `Error: <message>` string instead of throwing, so the agent can surface the error to the user gracefully. Errors are also written to the application log via `Logger.error`.

## Graceful Shutdown

The server listens for `SIGINT` and `SIGTERM` signals, closes the database connection pool cleanly, and exits with code `0`.

## Related Documentation

- [JOB_SYSTEM.md](JOB_SYSTEM.md) — How to define and schedule jobs in code
- [DB_JOB_SYSTEM.md](DB_JOB_SYSTEM.md) — Database-backed job persistence details
- [MCP_INTEGRATION.md](MCP_INTEGRATION.md) — Overview of the MCP layer and how servers are managed
- [CONFIGURATION.md](CONFIGURATION.md) — Environment variable reference
