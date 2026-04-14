import { RecurrenceRule } from "node-schedule";
import JobFactory from "../utils/jobFactory";
import { deduplicateMemories } from "../utils/memoryDeduplication";
import Logger from "../utils/logger";

export default class MemoryDeduplicateJob extends JobFactory {

   protected getSpec() {
      const rule = new RecurrenceRule();
      rule.hour = 2;
      rule.minute = 0;
      return rule;
   }

   protected getJobCallback() {
      return async (_fireDate: Date) => {
         try {
            const { count } = await deduplicateMemories();
            Logger.info(`[MemoryDeduplicateJob] Removed ${count} duplicate(s)`);
         } catch (err) {
            Logger.error(`[MemoryDeduplicateJob] Deduplication failed: ${err}`);
         }
      };
   }
}
