import { Range, RecurrenceRule } from "node-schedule";
import JobFactory from "../utils/jobFactory";
import Logger from "../utils/logger";

export default class Watchdog extends JobFactory {

   constructor() {
      super();
      this.setEnable(false);
   }

   protected getSpec() {
      const rule = new RecurrenceRule();
      rule.minute = new Range(0, 60, 1);
      return rule;
   }

   protected getJobCallback() {
      return (fireDate: Date) => {
         Logger.debug("watchDog: " + fireDate);
      }
   }
}