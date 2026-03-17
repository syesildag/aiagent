#!/usr/bin/env node

/**
 * Jobs MCP Server
 *
 * Exposes tools for listing, inspecting, enabling, and disabling scheduled
 * jobs whose state is persisted in the ai_agent_jobs PostgreSQL table.
 *
 * Tools:
 *   list_jobs          — return all registered jobs with their current state
 *   get_job_info       — return a single job's details by name
 *   enable_job         — set enabled=true for a job by name
 *   disable_job        — set enabled=false for a job by name
 *   update_job_prompt    — update only the prompt of a dynamic agent job
 *   update_job_schedule  — update only the schedule (cron expression) of a dynamic agent job
 *
 * Note: changes take effect at the job's next scheduled tick in the main
 * process (no server restart required).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { queryDatabase, closeDatabase } from "../../utils/pgClient.js";
import Logger from "../../utils/logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface JobRow {
   id: number;
   name: string;
   enabled: boolean;
   params: Record<string, unknown> | null;
   user_login: string | null;
   last_run_at: string | null;
   created_at: string;
   updated_at: string;
}

interface UserContext {
   userLogin: string | null;
   isAdmin: boolean;
}

function extractUserContext(args: Record<string, unknown>): { ctx: UserContext; cleanArgs: Record<string, unknown> } {
   const { _userLogin, _isAdmin, ...cleanArgs } = args as any;
   return {
      ctx: {
         userLogin: typeof _userLogin === 'string' ? _userLogin : null,
         isAdmin:   typeof _isAdmin  === 'boolean' ? _isAdmin  : false,
      },
      cleanArgs,
   };
}

function formatJob(row: JobRow): string {
   return JSON.stringify({
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      params: row.params ?? {},
      userLogin: row.user_login ?? null,
      lastRunAt: row.last_run_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
   }, null, 2);
}

/**
 * Basic structural validation for cron expressions.
 * Accepts 5-field (minute hour dom month dow) or 6-field
 * (second minute hour dom month dow) expressions.
 */
function isValidCronString(spec: string): boolean {
   const fields = spec.trim().split(/\s+/);
   return fields.length === 5 || fields.length === 6;
}

/**
 * Converts an arbitrary string to a lowercase slug with only
 * alphanumeric characters and hyphens, for auto-generated job names.
 */
function toSlug(value: string): string {
   return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
   try {
      const server = new McpServer({
         name: "jobs-server",
         version: "1.0.0",
      });

      // -----------------------------------------------------------------------
      // list_jobs
      // -----------------------------------------------------------------------
      server.registerTool(
         "list_jobs",
         {
            title: "List Jobs",
            description:
               "Returns all registered scheduled jobs with their current enabled state, " +
               "last run time, and configuration params.",
            inputSchema: z.object({}).shape,
         } as any,
         async (args) => {
            const { ctx } = extractUserContext(args as unknown as Record<string, unknown>);
            try {
               const rows: JobRow[] = ctx.isAdmin
                  ? await queryDatabase(
                     "SELECT id, name, enabled, params, user_login, last_run_at, created_at, updated_at " +
                     "FROM ai_agent_jobs ORDER BY name ASC"
                  )
                  : await queryDatabase(
                     "SELECT id, name, enabled, params, user_login, last_run_at, created_at, updated_at " +
                     "FROM ai_agent_jobs WHERE user_login IS NULL OR user_login = $1 ORDER BY name ASC",
                     [ctx.userLogin]
                  );
               if (rows.length === 0) {
                  return { content: [{ type: "text" as const, text: "No jobs registered." }] };
               }
               const text = `Found ${rows.length} job(s):\n\n` +
                  rows.map(r => formatJob(r)).join("\n\n---\n\n");
               return { content: [{ type: "text" as const, text }] };
            } catch (err) {
               const msg = err instanceof Error ? err.message : String(err);
               Logger.error(`[jobs-server] list_jobs error: ${msg}`);
               return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
            }
         }
      );

      // -----------------------------------------------------------------------
      // get_job_info
      // -----------------------------------------------------------------------
      server.registerTool(
         "get_job_info",
         {
            title: "Get Job Info",
            description: "Returns detailed information about a single scheduled job by name.",
            inputSchema: z.object({
               name: z.string().min(1).describe("The unique name of the job to retrieve"),
            }).shape,
         } as any,
         async (args) => {
            const { ctx, cleanArgs } = extractUserContext(args as unknown as Record<string, unknown>);
            const { name } = cleanArgs as { name: string };
            try {
               const result = await queryDatabase(
                  "SELECT id, name, enabled, params, user_login, last_run_at, created_at, updated_at " +
                  "FROM ai_agent_jobs WHERE name = $1",
                  [name]
               );
               if (result.length === 0) {
                  return { content: [{ type: "text" as const, text: `Job not found: "${name}"` }] };
               }
               const row = result[0] as JobRow;
               if (!ctx.isAdmin && row.user_login !== null && row.user_login !== ctx.userLogin) {
                  return { content: [{ type: "text" as const, text: `Job not found: "${name}"` }] };
               }
               return { content: [{ type: "text" as const, text: formatJob(row) }] };
            } catch (err) {
               const msg = err instanceof Error ? err.message : String(err);
               Logger.error(`[jobs-server] get_job_info error: ${msg}`);
               return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
            }
         }
      );

      // -----------------------------------------------------------------------
      // enable_job
      // -----------------------------------------------------------------------
      server.registerTool(
         "enable_job",
         {
            title: "Enable Job",
            description:
               "Enables a scheduled job by name. The change takes effect at the job's " +
               "next scheduled tick (no server restart required).",
            inputSchema: z.object({
               name: z.string().min(1).describe("The unique name of the job to enable"),
            }).shape,
         } as any,
         async (args) => {
            const { ctx, cleanArgs } = extractUserContext(args as unknown as Record<string, unknown>);
            const { name } = cleanArgs as { name: string };
            try {
               const rows = await queryDatabase(
                  "SELECT id, name, user_login FROM ai_agent_jobs WHERE name = $1",
                  [name]
               );
               if (rows.length === 0) {
                  return { content: [{ type: "text" as const, text: `Job not found: "${name}"` }] };
               }
               const row = rows[0] as { id: number; name: string; user_login: string | null };
               if (!ctx.isAdmin) {
                  if (row.user_login === null) {
                     return { content: [{ type: "text" as const, text: `Permission denied: cannot modify static job "${name}".` }] };
                  }
                  if (row.user_login !== ctx.userLogin) {
                     return { content: [{ type: "text" as const, text: `Permission denied: job "${name}" belongs to another user.` }] };
                  }
               }
               await queryDatabase(
                  "UPDATE ai_agent_jobs SET enabled = TRUE, updated_at = NOW() WHERE name = $1",
                  [name]
               );
               Logger.info(`[jobs-server] Enabled job: ${name}`);
               return {
                  content: [{
                     type: "text" as const,
                     text: `Job "${name}" enabled. Changes take effect at the next scheduled tick.`,
                  }],
               };
            } catch (err) {
               const msg = err instanceof Error ? err.message : String(err);
               Logger.error(`[jobs-server] enable_job error: ${msg}`);
               return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
            }
         }
      );

      // -----------------------------------------------------------------------
      // disable_job
      // -----------------------------------------------------------------------
      server.registerTool(
         "disable_job",
         {
            title: "Disable Job",
            description:
               "Disables a scheduled job by name. The change takes effect at the job's " +
               "next scheduled tick \u2014 the timer continues to fire but the body is skipped.",
            inputSchema: z.object({
               name: z.string().min(1).describe("The unique name of the job to disable"),
            }).shape,
         } as any,
         async (args) => {
            const { ctx, cleanArgs } = extractUserContext(args as unknown as Record<string, unknown>);
            const { name } = cleanArgs as { name: string };
            try {
               const rows = await queryDatabase(
                  "SELECT id, name, user_login FROM ai_agent_jobs WHERE name = $1",
                  [name]
               );
               if (rows.length === 0) {
                  return { content: [{ type: "text" as const, text: `Job not found: "${name}"` }] };
               }
               const row = rows[0] as { id: number; name: string; user_login: string | null };
               if (!ctx.isAdmin) {
                  if (row.user_login === null) {
                     return { content: [{ type: "text" as const, text: `Permission denied: cannot modify static job "${name}".` }] };
                  }
                  if (row.user_login !== ctx.userLogin) {
                     return { content: [{ type: "text" as const, text: `Permission denied: job "${name}" belongs to another user.` }] };
                  }
               }
               await queryDatabase(
                  "UPDATE ai_agent_jobs SET enabled = FALSE, updated_at = NOW() WHERE name = $1",
                  [name]
               );
               Logger.info(`[jobs-server] Disabled job: ${name}`);
               return {
                  content: [{
                     type: "text" as const,
                     text: `Job "${name}" disabled. Changes take effect at the next scheduled tick.`,
                  }],
               };
            } catch (err) {
               const msg = err instanceof Error ? err.message : String(err);
               Logger.error(`[jobs-server] disable_job error: ${msg}`);
               return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
            }
         }
      );

      // -----------------------------------------------------------------------
      // create_agent_job
      // -----------------------------------------------------------------------
      server.registerTool(
         "create_agent_job",
         {
            title: "Create Agent Job",
            description:
               "Creates a new scheduled agent job at runtime. The job is persisted to the " +
               "database and will be picked up by the main process within the polling interval " +
               "(~5 minutes) without requiring a server restart. " +
               "The schedule must be a valid cron expression (5 or 6 space-separated fields, " +
               "e.g. '0 8 * * *' for daily at 08:00).",
            inputSchema: z.object({
               agentName: z.string().min(1).describe(
                  "Name of the registered agent to run (e.g. 'general')"
               ),
               prompt: z.string().min(1).describe(
                  "The prompt to send to the agent on each scheduled run"
               ),
               schedule: z.string().min(1).describe(
                  "Cron expression for the schedule, e.g. '0 8 * * *' for daily at 08:00"
               ),
               name: z.string().min(1).optional().describe(
                  "Unique job name. Auto-generated as 'agent-job-{agentName}-{slug}' if omitted"
               ),
               enabled: z.boolean().default(true).describe(
                  "Whether the job should start enabled (default true)"
               ),
            }).shape,
         } as any,
         async (args) => {
            const { ctx, cleanArgs } = extractUserContext(args as unknown as Record<string, unknown>);
            const { agentName, prompt, schedule, enabled } = cleanArgs as {
               agentName: string;
               prompt: string;
               schedule: string;
               name?: string;
               enabled: boolean;
            };
            let { name } = cleanArgs as { name?: string };

            try {
               if (!isValidCronString(schedule)) {
                  return {
                     content: [{
                        type: "text" as const,
                        text:
                           `Invalid schedule: "${schedule}". Must be a cron expression with ` +
                           `5 or 6 space-separated fields (e.g. "0 8 * * *").`,
                     }],
                  };
               }

               if (!name) {
                  name = `agent-job-${toSlug(agentName)}-${toSlug(prompt)}`;
               }

               const existing = await queryDatabase(
                  "SELECT name FROM ai_agent_jobs WHERE name = $1",
                  [name]
               );
               if (existing.length > 0) {
                  return {
                     content: [{
                        type: "text" as const,
                        text:
                           `A job named "${name}" already exists. ` +
                           `Provide a different name or omit it to auto-generate one.`,
                     }],
                  };
               }

               const params = { type: 'dynamic', agentName, prompt, schedule };
               await queryDatabase(
                  "INSERT INTO ai_agent_jobs (name, enabled, params, user_login) VALUES ($1, $2, $3, $4)",
                  [name, enabled, JSON.stringify(params), ctx.userLogin]
               );

               Logger.info(`[jobs-server] Created dynamic agent job: ${name}`);
               return {
                  content: [{
                     type: "text" as const,
                     text:
                        `Dynamic agent job "${name}" created.\n` +
                        `Agent:    ${agentName}\n` +
                        `Schedule: ${schedule}\n` +
                        `Enabled:  ${enabled}\n\n` +
                        `The job will be picked up within ~5 minutes (or on next server restart).`,
                  }],
               };
            } catch (err) {
               const msg = err instanceof Error ? err.message : String(err);
               Logger.error(`[jobs-server] create_agent_job error: ${msg}`);
               return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
            }
         }
      );

      // -----------------------------------------------------------------------
      // update_job_prompt
      // -----------------------------------------------------------------------
      server.registerTool(
         "update_job_prompt",
         {
            title: "Update Job Prompt",
            description:
               "Updates the prompt of an existing dynamic agent job. " +
               "Only jobs created via create_agent_job can be updated — static code-defined jobs " +
               "are not affected by DB changes. " +
               "To update the schedule use update_job_schedule instead. " +
               "Changes take effect after the next server restart.",
            inputSchema: z.object({
               name: z.string().min(1).describe("The unique name of the dynamic job to update"),
               prompt: z.string().min(1).describe(
                  "The new prompt to send to the agent on each scheduled run"
               ),
            }).shape,
         } as any,
         async (args) => {
            const { ctx, cleanArgs } = extractUserContext(args as unknown as Record<string, unknown>);
            const { name, prompt } = cleanArgs as { name: string; prompt: string };

            try {
               const rows = await queryDatabase(
                  "SELECT id, name, params, user_login FROM ai_agent_jobs WHERE name = $1",
                  [name]
               );

               if (rows.length === 0) {
                  return { content: [{ type: "text" as const, text: `Job not found: "${name}"` }] };
               }

               const row = rows[0] as { id: number; name: string; params: Record<string, unknown> | null; user_login: string | null };
               if (!ctx.isAdmin) {
                  if (row.user_login === null) {
                     return { content: [{ type: "text" as const, text: `Permission denied: cannot modify static job "${name}".` }] };
                  }
                  if (row.user_login !== ctx.userLogin) {
                     return { content: [{ type: "text" as const, text: `Permission denied: job "${name}" belongs to another user.` }] };
                  }
               }
               if (row.params?.type !== 'dynamic') {
                  return {
                     content: [{
                        type: "text" as const,
                        text:
                           `Cannot update job "${name}": it is a static job. ` +
                           `Only dynamic jobs created via create_agent_job can be updated.`,
                     }],
                  };
               }

               await queryDatabase(
                  "UPDATE ai_agent_jobs SET params = jsonb_set(params, '{prompt}', to_jsonb($2::text)), updated_at = NOW() WHERE name = $1",
                  [name, prompt]
               );

               Logger.info(`[jobs-server] Updated prompt for dynamic agent job: ${name}`);
               return {
                  content: [{
                     type: "text" as const,
                     text:
                        `Updated prompt for job "${name}". ` +
                        `Changes will take effect after the next server restart.`,
                  }],
               };
            } catch (err) {
               const msg = err instanceof Error ? err.message : String(err);
               Logger.error(`[jobs-server] update_job_prompt error: ${msg}`);
               return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
            }
         }
      );

      // -----------------------------------------------------------------------
      // update_job_schedule
      // -----------------------------------------------------------------------
      server.registerTool(
         "update_job_schedule",
         {
            title: "Update Job Schedule",
            description:
               "Updates the cron schedule of an existing dynamic agent job. " +
               "Only jobs created via create_agent_job can be updated — static code-defined jobs " +
               "are not affected by DB changes. " +
               "The schedule must be a valid cron expression (5 or 6 space-separated fields, " +
               "e.g. '0 8 * * *' for daily at 08:00). " +
               "Changes take effect after the next server restart.",
            inputSchema: z.object({
               name: z.string().min(1).describe("The unique name of the dynamic job to update"),
               schedule: z.string().min(1).describe(
                  "New cron expression for the schedule, e.g. '0 8 * * *' for daily at 08:00"
               ),
            }).shape,
         } as any,
         async (args) => {
            const { ctx, cleanArgs } = extractUserContext(args as unknown as Record<string, unknown>);
            const { name, schedule } = cleanArgs as { name: string; schedule: string };

            try {
               if (!isValidCronString(schedule)) {
                  return {
                     content: [{
                        type: "text" as const,
                        text:
                           `Invalid schedule: "${schedule}". Must be a cron expression with ` +
                           `5 or 6 space-separated fields (e.g. "0 8 * * *").`,
                     }],
                  };
               }

               const rows = await queryDatabase(
                  "SELECT id, name, params, user_login FROM ai_agent_jobs WHERE name = $1",
                  [name]
               );

               if (rows.length === 0) {
                  return { content: [{ type: "text" as const, text: `Job not found: "${name}"` }] };
               }

               const row = rows[0] as { id: number; name: string; params: Record<string, unknown> | null; user_login: string | null };
               if (!ctx.isAdmin) {
                  if (row.user_login === null) {
                     return { content: [{ type: "text" as const, text: `Permission denied: cannot modify static job "${name}".` }] };
                  }
                  if (row.user_login !== ctx.userLogin) {
                     return { content: [{ type: "text" as const, text: `Permission denied: job "${name}" belongs to another user.` }] };
                  }
               }
               if (row.params?.type !== 'dynamic') {
                  return {
                     content: [{
                        type: "text" as const,
                        text:
                           `Cannot update job "${name}": it is a static job. ` +
                           `Only dynamic jobs created via create_agent_job can be updated.`,
                     }],
                  };
               }

               await queryDatabase(
                  "UPDATE ai_agent_jobs SET params = jsonb_set(params, '{schedule}', to_jsonb($2::text)), updated_at = NOW() WHERE name = $1",
                  [name, schedule]
               );

               Logger.info(`[jobs-server] Updated schedule for dynamic agent job: ${name} → ${schedule}`);
               return {
                  content: [{
                     type: "text" as const,
                     text:
                        `Updated schedule for job "${name}" to "${schedule}". ` +
                        `Changes will take effect after the next server restart.`,
                  }],
               };
            } catch (err) {
               const msg = err instanceof Error ? err.message : String(err);
               Logger.error(`[jobs-server] update_job_schedule error: ${msg}`);
               return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
            }
         }
      );

      // -----------------------------------------------------------------------
      // delete_agent_job
      // -----------------------------------------------------------------------
      server.registerTool(
         "delete_agent_job",
         {
            title: "Delete Agent Job",
            description:
               "Deletes a dynamic agent job that was created via create_agent_job. " +
               "Static jobs defined in code cannot be deleted with this tool. " +
               "The running schedule in the main process will stop firing within the next polling cycle (~5 minutes).",
            inputSchema: z.object({
               name: z.string().min(1).describe("The unique name of the dynamic job to delete"),
            }).shape,
         } as any,
         async (args) => {
            const { ctx, cleanArgs } = extractUserContext(args as unknown as Record<string, unknown>);
            const { name } = cleanArgs as { name: string };

            try {
               const rows = await queryDatabase(
                  "SELECT id, name, params, user_login FROM ai_agent_jobs WHERE name = $1",
                  [name]
               );

               if (rows.length === 0) {
                  return { content: [{ type: "text" as const, text: `Job not found: "${name}"` }] };
               }

               const row = rows[0] as { id: number; name: string; params: Record<string, unknown> | null; user_login: string | null };
               if (!ctx.isAdmin) {
                  if (row.user_login === null) {
                     return { content: [{ type: "text" as const, text: `Permission denied: cannot modify static job "${name}".` }] };
                  }
                  if (row.user_login !== ctx.userLogin) {
                     return { content: [{ type: "text" as const, text: `Permission denied: job "${name}" belongs to another user.` }] };
                  }
               }
               if (row.params?.type !== 'dynamic') {
                  return {
                     content: [{
                        type: "text" as const,
                        text:
                           `Cannot delete job "${name}": it is a static job. ` +
                           `Only dynamic jobs created via create_agent_job can be deleted.`,
                     }],
                  };
               }

               await queryDatabase("DELETE FROM ai_agent_jobs WHERE name = $1", [name]);

               Logger.info(`[jobs-server] Deleted dynamic agent job: ${name}`);
               return {
                  content: [{
                     type: "text" as const,
                     text:
                        `Dynamic agent job "${name}" deleted. ` +
                        `It will stop firing within the next polling cycle (~5 minutes).`,
                  }],
               };
            } catch (err) {
               const msg = err instanceof Error ? err.message : String(err);
               Logger.error(`[jobs-server] delete_agent_job error: ${msg}`);
               return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
            }
         }
      );

      const transport = new StdioServerTransport();
      await server.connect(transport);
      Logger.info("[jobs-server] Jobs MCP server started");

   } catch (error) {
      Logger.error("[jobs-server] Failed to start:", error);
      process.exit(1);
   }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(): Promise<void> {
   Logger.info("[jobs-server] Shutting down...");
   await closeDatabase();
   process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((error) => {
   Logger.error("[jobs-server] Unhandled error:", error);
   process.exit(1);
});
