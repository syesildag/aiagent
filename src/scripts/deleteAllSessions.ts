import { closeDatabase } from '../utils/pgClient';
import { Session } from '../repository/entities/session';
import { repository } from '../repository/repository';
import Logger from '../utils/logger';

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
