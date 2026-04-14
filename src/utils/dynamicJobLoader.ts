import { Job } from "node-schedule";
import DynamicAgentJob from "./dynamicAgentJob";
import Logger from "./logger";
import { queryDatabase } from "./pgClient";

interface DynamicJobEntry {
   factory: DynamicAgentJob;
   scheduledJob: Job | null;
}

/**
 * Registry of dynamic jobs currently scheduled in this process, keyed by job
 * name. Used to detect new jobs (schedule them) and deleted jobs (cancel them)
 * on each polling cycle.
 */
const dynamicJobRegistry = new Map<string, DynamicJobEntry>();

/**
 * Queries the DB for dynamic agent jobs (params->>'type' = 'dynamic') and
 * reconciles them against the in-process registry:
 *   - Jobs in DB but not in registry → schedule them.
 *   - Jobs in registry but not in DB → cancel their timers and remove them.
 *
 * Safe to call repeatedly. Changes (creates and deletes) made via the jobs MCP
 * server are picked up here within the polling interval without a server restart.
 */
export async function loadDynamicJobs(): Promise<void> {
   let rows: Array<{ name: string; params: Record<string, unknown> }>;
   try {
      rows = await queryDatabase(
         `SELECT name, params FROM ai_agent_jobs WHERE params->>'type' = 'dynamic'`
      ) as typeof rows;
   } catch (err) {
      Logger.error(`[loadDynamicJobs] DB query failed: ${err}`);
      return;
   }

   const dbNames = new Set(rows.map(r => r.name));

   // Cancel timers for jobs that were deleted from the DB.
   for (const [name, entry] of dynamicJobRegistry) {
      if (!dbNames.has(name)) {
         entry.scheduledJob?.cancel();
         dynamicJobRegistry.delete(name);
         Logger.info(`[loadDynamicJobs] Cancelled deleted dynamic job: ${name}`);
      }
   }

   // Schedule jobs that exist in the DB but are not yet registered.
   for (const row of rows) {
      if (dynamicJobRegistry.has(row.name)) continue;

      const { agentName, prompt, schedule } = (row.params ?? {}) as {
         agentName?: string;
         prompt?: string;
         schedule?: string;
      };

      if (!agentName || !prompt || !schedule) {
         Logger.warn(`[loadDynamicJobs] Skipping job "${row.name}": missing required params`);
         continue;
      }

      try {
         const factory = new DynamicAgentJob(row.name, agentName, prompt, schedule);
         await factory.initialize();
         const scheduledJob = factory.create();
         dynamicJobRegistry.set(row.name, { factory, scheduledJob });
         Logger.info(`[loadDynamicJobs] Scheduled dynamic job: ${row.name}`);
      } catch (err) {
         Logger.error(`[loadDynamicJobs] Failed to schedule job "${row.name}": ${err}`);
      }
   }
}
