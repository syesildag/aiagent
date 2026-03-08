# Jobs MCP Server

A Model Context Protocol server that exposes tools for managing scheduled jobs whose state is persisted in the `ai_agent_jobs` PostgreSQL table. It allows agents to inspect, enable, and disable jobs at runtime without restarting the server.

> **Looking for how jobs are defined and scheduled?** See [JOB_SYSTEM.md](JOB_SYSTEM.md) and [DB_JOB_SYSTEM.md](DB_JOB_SYSTEM.md).

## Features

- **List all jobs** — View every registered job along with its enabled state, last run time, and configuration params
- **Inspect a single job** — Retrieve full details for a specific job by name
- **Enable / Disable jobs** — Toggle a job on or off at runtime; changes take effect at the next scheduled tick
- **No server restart required** — State changes are written to the database and picked up by the main process automatically

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

Returns all registered scheduled jobs ordered alphabetically by name.

**Arguments:** none

**Example response:**
```
Found 2 job(s):

{
  "id": 1,
  "name": "cleanup-old-conversations",
  "enabled": true,
  "params": {},
  "lastRunAt": "2026-03-08T02:00:00.000Z",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-03-08T02:00:00.000Z"
}

---

{
  "id": 2,
  "name": "refresh-embeddings",
  "enabled": false,
  "params": { "batchSize": 50 },
  "lastRunAt": null,
  "createdAt": "2026-02-15T10:00:00.000Z",
  "updatedAt": "2026-02-20T08:30:00.000Z"
}
```

---

### `get_job_info`

Returns detailed information about a single scheduled job.

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
  "lastRunAt": "2026-03-08T02:00:00.000Z",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-03-08T02:00:00.000Z"
}
```

If the job is not found, the tool returns: `Job not found: "<name>"`

---

### `enable_job`

Sets `enabled = true` for the specified job. The main process will resume executing the job at its next scheduled tick.

**Arguments:**
- `name` (string, required): The unique name of the job to enable

**Example:**
```json
{
  "name": "refresh-embeddings"
}
```

**Example response:**
```
Job "refresh-embeddings" enabled. Changes take effect at the next scheduled tick.
```

---

### `disable_job`

Sets `enabled = false` for the specified job. The scheduler timer continues to fire but the job body is skipped until the job is re-enabled.

**Arguments:**
- `name` (string, required): The unique name of the job to disable

**Example:**
```json
{
  "name": "refresh-embeddings"
}
```

**Example response:**
```
Job "refresh-embeddings" disabled. Changes take effect at the next scheduled tick.
```

---

## Database Schema

The server reads and writes the `ai_agent_jobs` table. Refer to [DB_JOB_SYSTEM.md](DB_JOB_SYSTEM.md) for the full schema and migration details. The relevant columns are:

| Column        | Type        | Description                                      |
|---------------|-------------|--------------------------------------------------|
| `id`          | integer     | Auto-incremented primary key                     |
| `name`        | text        | Unique job identifier                            |
| `enabled`     | boolean     | Whether the job runs on its scheduled tick       |
| `params`      | jsonb       | Optional job-specific configuration              |
| `last_run_at` | timestamptz | Timestamp of the most recent successful run      |
| `created_at`  | timestamptz | Row creation time                                |
| `updated_at`  | timestamptz | Last modification time (updated on enable/disable) |

## Error Handling

All tools catch database and runtime errors and return a human-readable `Error: <message>` string instead of throwing, so the agent can surface the error to the user gracefully. Errors are also written to the application log via `Logger.error`.

## Graceful Shutdown

The server listens for `SIGINT` and `SIGTERM` signals, closes the database connection pool cleanly, and exits with code `0`.

## Related Documentation

- [JOB_SYSTEM.md](JOB_SYSTEM.md) — How to define and schedule jobs in code
- [DB_JOB_SYSTEM.md](DB_JOB_SYSTEM.md) — Database-backed job persistence details
- [MCP_INTEGRATION.md](MCP_INTEGRATION.md) — Overview of the MCP layer and how servers are managed
- [CONFIGURATION.md](CONFIGURATION.md) — Environment variable reference
