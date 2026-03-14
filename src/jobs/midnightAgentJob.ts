import { RecurrenceRule } from "node-schedule";
import AgentJob from "../utils/agentJob";

/**
 * DB-backed agent job that runs at midnight.
 *
 * Runs the general agent with a simple capabilities-summary prompt once per
 * day at midnight. Disabled by default — enable it via the jobs MCP server:
 *
 *   enable_job({ name: "agent-job-general-midnightagentjob" })
 *
 * To create your own scheduled agent job, copy this file, change the
 * constructor arguments, and adjust the RecurrenceRule.
 */
export default class MidnightAgentJob extends AgentJob {

   constructor() {
      const rule = new RecurrenceRule();
      rule.hour = 0;
      rule.minute = 0;
      rule.second = 0;

      super(
         'general',
         'Summarize your capabilities in one sentence.',
         rule,
      );
   }

   /**
    * Start disabled — must be explicitly enabled via the jobs MCP server:
    *   enable_job({ name: "agent-job-general-midnightagentjob" })
    */
   protected override getInitialEnabled(): boolean {
      return false;
   }

}
