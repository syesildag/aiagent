import { Spec } from "node-schedule";
import AgentJob from "./agentJob";

/**
 * Concrete AgentJob subclass for jobs created at runtime via the jobs MCP
 * server. The job name is provided externally (stored in the ai_agent_jobs
 * DB row) rather than derived from the class name, which allows multiple
 * independent instances to coexist without naming collisions.
 */
export default class DynamicAgentJob extends AgentJob {

   private readonly jobName: string;

   constructor(name: string, agentName: string, prompt: string, spec: Spec) {
      super(agentName, prompt, spec);
      this.jobName = name;
   }

   protected override getJobName(): string {
      return this.jobName;
   }

}
