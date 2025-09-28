import { closeDatabase } from '../src/utils/pgClient';
import { Session } from '../src/repository/entities/session';
import { repository } from '../src/repository/repository';
import Logger from '../src/utils/logger';

async function deleteAllSessions() {
  try {
    const sessionRepository = repository.get(Session);
    if (!sessionRepository) {
      throw new Error('Session repository not found');
    }
    
    await sessionRepository.truncate();
    Logger.info('All session entries deleted successfully.');
  } catch (err) {
    Logger.error(`Failed to delete sessions: ${err}`);
  } finally {
    closeDatabase();
  }
}

if (require.main === module) {
  deleteAllSessions();
}
