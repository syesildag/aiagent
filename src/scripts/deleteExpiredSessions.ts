import { closeDatabase, queryDatabase } from '../utils/pgClient';
import { config } from '../utils/config';
import Logger from '../utils/logger';

import aiagentsessionRepository from '../entities/ai-agent-session';

export default async function deleteExpiredSessions() {
  try {
    const timeoutSeconds = config.SESSION_TIMEOUT_SECONDS;
    
    // Delete expired sessions in a single query
    const deleteQuery = `
      SELECT id, name, ping FROM ai_agent_session
       WHERE COALESCE(ping, created_at) < NOW() - INTERVAL '${timeoutSeconds} seconds'
    `;
    
    const deletedSessions = await queryDatabase(deleteQuery);
    for (const deletedSession of deletedSessions) {
        try {
            await aiagentsessionRepository.deleteById(deletedSession.id);
            Logger.debug(`Deleted expired session: ${deletedSession.name} (last ping: ${deletedSession.ping ? new Date(deletedSession.ping).toISOString() : 'never'})`);
        } catch (error) {
            Logger.error(`Failed to delete session with ID ${deletedSession.id}: ${error}`);
        }
    }
  } catch (err) {
    Logger.error(`Failed to delete expired sessions: ${err}`);
  } finally {
    closeDatabase();
  }
}