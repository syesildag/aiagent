import { parentPort } from 'worker_threads';
import AbstractBaseWorker from './pool/abstractBaseWorker';
import Logger from '../utils/logger';
import deleteExpiredSessions from '../scripts/deleteExpiredSessions';

class SessionTimeoutWorker extends AbstractBaseWorker<Date, void> {

   getFilename(): string {
      return __filename;
   }

   protected run(fireDate: Date): void {
      Logger.debug('sessionTimeoutWorker: ' + fireDate);
      deleteExpiredSessions().catch((error) => {
         Logger.error(`Error in sessionTimeoutWorker: ${error}`);
      });
   }
}

export default new SessionTimeoutWorker(parentPort);