---
description: List all scheduled jobs with their current status
allowed-tools: jobs
---

## Scheduled Jobs

Call the `jobs_list_jobs` tool now to retrieve all registered jobs, then present the results as a clear markdown table with the following columns:

| Name | Enabled | Last Run | Schedule/Params |
|------|---------|----------|-----------------|

- **Name**: the job name — if a `prompt` field exists in params, render it as a markdown tooltip using the syntax `[name](# "prompt text")`
- **Enabled**: ✓ if enabled, ✗ if disabled
- **Last Run**: the `lastRunAt` value, or `Never` if null
- **Schedule/Params**: extract `schedule` from params if present, otherwise show `static`

After the table, add a brief one-line summary: total jobs, how many are enabled, how many have never run.
