import { JobCallback, RecurrenceRule } from "node-schedule";
import { execFile } from "child_process";
import path from "path";
import JobFactory from "../utils/jobFactory";
import Logger from "../utils/logger";

/**
 * Job that downloads XMLTV TV guide data daily at 03:00.
 *
 * Runs scripts/download-xmltv.sh. The target directory is controlled by the
 * XMLTV_PATH environment variable (defaults to /logs inside the script).
 */
export default class XmltvDownloadJob extends JobFactory {

   protected override getSpec(): RecurrenceRule {
      const rule = new RecurrenceRule();
      rule.hour = 3;
      rule.minute = 0;
      rule.second = 0;
      return rule;
   }

   protected override getJobCallback(): JobCallback {
      return (_fireDate: Date) => {
         // Compiled output: dist/src/jobs/ → 2 levels up → dist/src/ → scripts/
         const scriptPath = path.resolve(__dirname, "../../scripts/download-xmltv.sh");
         Logger.info(`[XmltvDownloadJob] Running ${scriptPath}`);

         execFile("bash", [scriptPath], { timeout: 300_000 }, (error, stdout, stderr) => {
            if (stdout) Logger.info(`[XmltvDownloadJob] stdout: ${stdout}`);
            if (stderr) Logger.warn(`[XmltvDownloadJob] stderr: ${stderr}`);
            if (error) {
               Logger.error(`[XmltvDownloadJob] Failed: ${error.message}`);
               return;
            }
            Logger.info("[XmltvDownloadJob] Completed successfully");
         });
      };
   }
}
