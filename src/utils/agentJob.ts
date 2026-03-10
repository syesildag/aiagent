import { RecurrenceRule, Spec } from "node-schedule";
import { getAgentFromName } from "../agent";
import DbJobFactory from "./dbJobFactory";
import Logger from "./logger";

/**
 * Abstract base class for scheduled jobs that run an AI agent with a fixed prompt.
 *
 * Usage — create a concrete subclass in src/jobs/:
 *
 *   export default class MyDailyBriefing extends AgentJob {
 *     constructor() {
 *       const rule = new RecurrenceRule();
 *       rule.hour = 8;
 *       rule.minute = 0;
 *       super('general', 'Give me a brief summary of pending tasks.', rule);
 *       this.setEnable(true);
 *     }
 *   }
 *
 * The enabled flag is persisted to ai_agent_jobs. It can be toggled at runtime
 * via the jobs MCP server; the change takes effect on the next scheduled tick.
 *
 * The agentName and prompt are stored in the DB params column (informational).
 * The schedule string is also stored there so the MCP server can display it.
 */
export default abstract class AgentJob extends DbJobFactory {

   private readonly agentName: string;
   private readonly prompt: string;
   private readonly spec: Spec;

   constructor(agentName: string, prompt: string, spec: Spec) {
      super();
      this.agentName = agentName;
      this.prompt = prompt;
      this.spec = spec;
   }

   protected override getJobName(): string {
      return `agent-job-${this.agentName}-${this.constructor.name.toLowerCase()}`;
   }

   protected override getSpec(): Spec {
      return this.spec;
   }

   protected override getDefaultParams(): Record<string, unknown> {
      return {
         agentName: this.agentName,
         prompt: this.prompt,
         schedule: specToString(this.spec),
      };
   }

   /**
    * Fetches the named agent lazily (agents are initialized after jobs are
    * scheduled) and runs the configured prompt.  Errors are logged but not
    * re-thrown so the job schedule remains intact.
    */
   protected override async getJobBody(): Promise<void> {
      Logger.info(`[AgentJob] Running job "${this.getJobName()}" — agent="${this.agentName}"`);
      const agent = await getAgentFromName(this.agentName);
      if (!agent) {
         Logger.error(`[AgentJob] Agent "${this.agentName}" not found — skipping job "${this.getJobName()}"`);
         return;
      }
      const result = await agent.chat(
         this.prompt,
         undefined, // no AbortSignal
         false,     // no streaming — we just want the full text result
         undefined, // no attachments
         undefined, // no approval callback
         undefined, // no tool filter
         undefined, // use default max iterations
         true,      // freshContext — isolated from any user conversation
      );
      const text = typeof result === 'string' ? result : '';
      Logger.info(`[AgentJob] "${this.getJobName()}" completed. Response length: ${text.length} chars`);
   }

}

/**
 * Converts a node-schedule Spec to a human-readable string for the params column.
 * Only the most common types are handled; everything else is serialised with JSON.
 */
function specToString(spec: Spec): string {
   if (typeof spec === 'string') {
      return spec;
   }
   if (spec instanceof Date) {
      return spec.toISOString();
   }
   if (spec instanceof RecurrenceRule) {
      const parts: string[] = [];
      if (spec.second !== null && spec.second !== undefined) parts.push(`second=${JSON.stringify(spec.second)}`);
      if (spec.minute !== null && spec.minute !== undefined) parts.push(`minute=${JSON.stringify(spec.minute)}`);
      if (spec.hour   !== null && spec.hour   !== undefined) parts.push(`hour=${JSON.stringify(spec.hour)}`);
      if (spec.date   !== null && spec.date   !== undefined) parts.push(`date=${JSON.stringify(spec.date)}`);
      if (spec.month  !== null && spec.month  !== undefined) parts.push(`month=${JSON.stringify(spec.month)}`);
      if (spec.dayOfWeek !== null && spec.dayOfWeek !== undefined) parts.push(`dayOfWeek=${JSON.stringify(spec.dayOfWeek)}`);
      return parts.length > 0 ? `RecurrenceRule(${parts.join(', ')})` : 'RecurrenceRule(every-second)';
   }
   return JSON.stringify(spec);
}
