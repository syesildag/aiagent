#!/usr/bin/env node

/**
 * Jobs MCP Server
 *
 * Exposes tools for listing, inspecting, enabling, and disabling scheduled
 * jobs whose state is persisted in the ai_agent_jobs PostgreSQL table.
 *
 * Tools:
 *   list_jobs        — return all registered jobs with their current state
 *   get_job_info     — return a single job's details by name
 *   enable_job       — set enabled=true for a job by name
 *   disable_job      — set enabled=false for a job by name
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
   last_run_at: string | null;
   created_at: string;
   updated_at: string;
}

function formatJob(row: JobRow): string {
   return JSON.stringify({
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      params: row.params ?? {},
      lastRunAt: row.last_run_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
   }, null, 2);
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
         async () => {
            try {
               const result = await queryDatabase(
                  "SELECT id, name, enabled, params, last_run_at, created_at, updated_at " +
                  "FROM ai_agent_jobs ORDER BY name ASC"
               );
               const rows: JobRow[] = result;
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
            const { name } = args as unknown as { name: string };
            try {
               const result = await queryDatabase(
                  "SELECT id, name, enabled, params, last_run_at, created_at, updated_at " +
                  "FROM ai_agent_jobs WHERE name = $1",
                  [name]
               );
               if (result.length === 0) {
                  return { content: [{ type: "text" as const, text: `Job not found: "${name}"` }] };
               }
               return { content: [{ type: "text" as const, text: formatJob(result[0] as JobRow) }] };
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
            const { name } = args as unknown as { name: string };
            try {
               const result = await queryDatabase(
                  "UPDATE ai_agent_jobs SET enabled = TRUE, updated_at = NOW() " +
                  "WHERE name = $1 RETURNING id, name, enabled, updated_at",
                  [name]
               );
               if (result.length === 0) {
                  return { content: [{ type: "text" as const, text: `Job not found: "${name}"` }] };
               }
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
            const { name } = args as unknown as { name: string };
            try {
               const result = await queryDatabase(
                  "UPDATE ai_agent_jobs SET enabled = FALSE, updated_at = NOW() " +
                  "WHERE name = $1 RETURNING id, name, enabled, updated_at",
                  [name]
               );
               if (result.length === 0) {
                  return { content: [{ type: "text" as const, text: `Job not found: "${name}"` }] };
               }
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
