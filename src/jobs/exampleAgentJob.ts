import { RecurrenceRule } from "node-schedule";
import AgentJob from "../utils/agentJob";

/**
 * Example DB-backed agent job.
 *
 * Runs the general agent with a simple capabilities-summary prompt once per
 * day at midnight. Disabled by default — enable it via the jobs MCP server:
 *
 *   enable_job({ name: "agent-job-general-exampleagentjob" })
 *
 * To create your own scheduled agent job, copy this file, change the
 * constructor arguments, and adjust the RecurrenceRule.
 */
export default class ExampleAgentJob extends AgentJob {

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
    *   enable_job({ name: "agent-job-general-exampleagentjob" })
    */
   protected override getInitialEnabled(): boolean {
      return false;
   }

}
