import { Range, RecurrenceRule } from "node-schedule";
import JobFactory from "../utils/jobFactory";
import Logger from "../utils/logger";
import { loadDynamicJobs } from "../utils/dynamicJobLoader";

export default class Watchdog extends JobFactory {

   protected getSpec() {
      const rule = new RecurrenceRule();
      rule.minute = new Range(0, 59, 5);
      return rule;
   }

   protected getJobCallback() {
      return (fireDate: Date) => {
         Logger.debug("watchDog: " + fireDate);
         loadDynamicJobs().catch(err =>
            Logger.error(`[Watchdog] loadDynamicJobs error: ${err}`)
         );
      }
   }
}