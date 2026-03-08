import { parentPort } from 'worker_threads';
import AbstractBaseWorker from './pool/abstractBaseWorker';
import Logger from '../utils/logger';
import deleteExpiredSessions from '../scripts/deleteExpiredSessions';

class SessionTimeoutWorker extends AbstractBaseWorker<Date, void> {

   getFilename(): string {
      return __filename;
   }

   protected async run(fireDate: Date): Promise<void> {
      Logger.debug('sessionTimeoutWorker: ' + fireDate);
      await deleteExpiredSessions();
   }
}

export default new SessionTimeoutWorker(parentPort);