import { Job, JobCallback, Spec, scheduleJob } from "node-schedule";
import { AiAgentJob } from "../entities/ai-agent-jobs";
import aiAgentJobRepository from "../entities/ai-agent-jobs";
import JobFactory from "./jobFactory";
import Logger from "./logger";

/**
 * Abstract base class for jobs whose enabled/disabled state is persisted to
 * the ai_agent_jobs PostgreSQL table.
 *
 * How it works:
 * - initialize() upserts a row in ai_agent_jobs on startup and does NOT
 *   call setEnable(), so the node-schedule timer is always created.
 * - getJobCallback() is the sole enabled gatekeeper: it re-reads the DB
 *   row on every tick. If enabled=false, it returns immediately (no-op).
 *   This means toggling via the jobs MCP server takes effect at the next
 *   scheduled fire without any server restart.
 * - last_run_at is updated in the DB after each successful execution.
 *
 * Subclasses must implement:
 *   getJobName()  — unique identifier stored in the DB (must be stable)
 *   getSpec()     — node-schedule Spec (RecurrenceRule, cron string, etc.)
 *   getJobBody()  — the actual work to perform on each tick
 *
 * Subclasses may override:
 *   getDefaultParams() — initial JSONB params written to DB on first startup
 */
export default abstract class DbJobFactory extends JobFactory {

   /** Unique, stable name used as the primary key in ai_agent_jobs. */
   protected abstract getJobName(): string;

   /** The actual work executed on each enabled tick. */
   protected abstract getJobBody(): Promise<void> | void;

   /**
    * Initial params written to the DB row when the job is registered for
    * the first time. Override to persist schedule info, agent name, etc.
    */
   protected getDefaultParams(): Record<string, unknown> {
      return {};
   }

   /**
    * Whether this job should be enabled when its DB row is first created.
    * Once the row exists, the DB value is authoritative — override this to
    * false if you want a job to be opt-in (disabled until explicitly enabled
    * via the jobs MCP server).
    */
   protected getInitialEnabled(): boolean {
      return true;
   }

   /**
    * Upsert the ai_agent_jobs row for this job.
    * Does NOT call setEnable() — the DB is the single source of truth for
    * enabled state, checked dynamically on every tick.
    */
   public override async initialize(): Promise<void> {
      try {
         const existing = await aiAgentJobRepository.findByName(this.getJobName());
         if (!existing) {
            const job = new AiAgentJob({
               name: this.getJobName(),
               enabled: this.getInitialEnabled(),
               params: this.getDefaultParams(),
            });
            await aiAgentJobRepository.save(job);
            Logger.info(`[DbJobFactory] Registered new job: ${this.getJobName()}`);
         } else {
            Logger.info(`[DbJobFactory] Job already registered: ${this.getJobName()} (enabled=${existing.getEnabled()})`);
         }
      } catch (error) {
         Logger.error(`[DbJobFactory] Failed to initialize job "${this.getJobName()}": ${error}`);
      }
   }

   /**
    * Always creates the schedule timer regardless of the DB enabled flag.
    * This ensures that a job enabled via the MCP server takes effect on the
    * next tick without requiring a server restart.
    */
   public override create(): Job | null {
      return scheduleJob(this.getSpec(), this.getJobCallback());
   }

   /**
    * Sealed template: re-reads enabled from DB on every tick.
    * Subclasses implement getJobBody() instead.
    */
   protected override getJobCallback(): JobCallback {
      return async (_fireDate: Date) => {
         let record: AiAgentJob | null = null;
         try {
            record = await aiAgentJobRepository.findByName(this.getJobName());
         } catch (error) {
            Logger.error(`[DbJobFactory] DB read failed for "${this.getJobName()}": ${error}`);
            return;
         }

         if (!record || !record.getEnabled()) {
            return; // disabled — silent no-op
         }

         try {
            await this.getJobBody();
         } catch (error) {
            Logger.error(`[DbJobFactory] Job "${this.getJobName()}" threw an error: ${error}`);
         }

         // Update last_run_at regardless of whether getJobBody() threw
         try {
            record.setLastRunAt(new Date());
            await aiAgentJobRepository.save(record);
         } catch (error) {
            Logger.error(`[DbJobFactory] Failed to update last_run_at for "${this.getJobName()}": ${error}`);
         }
      };
   }

   /** Returns the current DB record for this job (useful for status checks). */
   public async getStatus(): Promise<AiAgentJob | null> {
      return aiAgentJobRepository.findByName(this.getJobName());
   }

}
