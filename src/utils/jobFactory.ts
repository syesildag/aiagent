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

   public create(): Job | null {
      if (!this.isEnabled())
         return null;
      return scheduleJob(this.getSpec(), this.getJobCallback());
   }

   public close() {
   }

}