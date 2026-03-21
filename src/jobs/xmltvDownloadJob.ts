import { RecurrenceRule } from "node-schedule";
import { execFile } from "child_process";
import path from "path";
import DbJobFactory from "../utils/dbJobFactory";
import Logger from "../utils/logger";

/**
 * DB-backed job that downloads XMLTV TV guide data daily at 03:00.
 *
 * Runs scripts/download-xmltv.sh. The target directory is controlled by the
 * XMLTV_PATH environment variable (defaults to /logs inside the script).
 *
 * Enabled by default — disable via the jobs MCP server:
 *   disable_job({ name: "shell-xmltv-download" })
 */
export default class XmltvDownloadJob extends DbJobFactory {

   protected override getJobName(): string {
      return "shell-xmltv-download";
   }

   protected override getSpec(): RecurrenceRule {
      const rule = new RecurrenceRule();
      rule.hour = 3;
      rule.minute = 0;
      rule.second = 0;
      return rule;
   }

   protected override getJobBody(): Promise<void> {
      // Compiled output: dist/src/jobs/ → 2 levels up → dist/src/ → scripts/
      const scriptPath = path.resolve(__dirname, "../../scripts/download-xmltv.sh");
      Logger.info(`[XmltvDownloadJob] Running ${scriptPath}`);

      return new Promise((resolve, reject) => {
         execFile("bash", [scriptPath], { timeout: 300_000 }, (error, stdout, stderr) => {
            if (stdout) Logger.info(`[XmltvDownloadJob] stdout: ${stdout}`);
            if (stderr) Logger.warn(`[XmltvDownloadJob] stderr: ${stderr}`);
            if (error) {
               Logger.error(`[XmltvDownloadJob] Failed: ${error.message}`);
               return reject(error);
            }
            Logger.info("[XmltvDownloadJob] Completed successfully");
            resolve();
         });
      });
   }

   protected override getDefaultParams(): Record<string, unknown> {
      return {
         script: "scripts/download-xmltv.sh",
         schedule: "daily at 03:00",
      };
   }
}
