import DynamicAgentJob from "./dynamicAgentJob";
import Logger from "./logger";
import { queryDatabase } from "./pgClient";
import JobFactory from "./jobFactory";

/**
 * Tracks names of dynamic jobs already scheduled in this process lifetime,
 * so repeated calls do not re-schedule jobs that are already running.
 */
const scheduledDynamicJobNames = new Set<string>();

/**
 * Holds references to dynamically created job instances to prevent
 * them from being garbage collected.
 */
export const dynamicActiveJobs: JobFactory[] = [];

/**
 * Queries the DB for dynamic agent jobs (params->>'type' = 'dynamic') and
 * schedules any not yet active in this process. Safe to call repeatedly.
 * New jobs created via the jobs MCP server will be picked up here within
 * the polling interval without requiring a server restart.
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

   for (const row of rows) {
      if (scheduledDynamicJobNames.has(row.name)) continue;

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
         const job = new DynamicAgentJob(row.name, agentName, prompt, schedule);
         await job.initialize();
         job.create();
         dynamicActiveJobs.push(job);
         scheduledDynamicJobNames.add(row.name);
         Logger.info(`[loadDynamicJobs] Scheduled dynamic job: ${row.name}`);
      } catch (err) {
         Logger.error(`[loadDynamicJobs] Failed to schedule job "${row.name}": ${err}`);
      }
   }
}
