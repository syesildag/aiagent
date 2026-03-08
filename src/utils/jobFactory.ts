import { Job, JobCallback, Spec, scheduleJob } from "node-schedule";

export default abstract class JobFactory {

   private enabled: boolean = true;

   protected abstract getSpec(): Spec;
   protected abstract getJobCallback(): JobCallback;

   protected isEnabled() {
      return this.enabled;
   }

   protected setEnable(enabled: boolean) {
      this.enabled = enabled;
   }

   /**
    * Called once before create() during server startup. Subclasses can override
    * to perform async initialization (e.g. syncing state with a database).
    * The default implementation is a no-op so existing jobs are unaffected.
    */
   public async initialize(): Promise<void> {
   }

   public create(): Job | null {
      if (!this.isEnabled())
         return null;
      return scheduleJob(this.getSpec(), this.getJobCallback());
   }

   public close() {
   }

}