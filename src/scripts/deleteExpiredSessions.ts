import { queryDatabase } from '../utils/pgClient';
import { config } from '../utils/config';
import Logger from '../utils/logger';

export default async function deleteExpiredSessions() {
  try {
    const timeoutSeconds = config.SESSION_TIMEOUT_SECONDS;
    
    // First, get the sessions that will be deleted for logging purposes
    const selectQuery = `
      SELECT id, name, ping FROM ai_agent_session
       WHERE COALESCE(ping, created_at) < NOW() - INTERVAL '${timeoutSeconds} seconds'
    `;
    
    Logger.debug(`Executing select query: ${selectQuery}`);
    const expiredSessions = await queryDatabase(selectQuery);
    Logger.debug(`Found ${expiredSessions.length} expired sessions`);
    
    // Use a safer approach - delete sessions based on the timeout condition directly
    // This avoids potential SQL injection and malformed queries
    const deleteQuery = `
      DELETE FROM ai_agent_session 
      WHERE COALESCE(ping, created_at) < NOW() - INTERVAL '${timeoutSeconds} seconds'
    `;
    
    Logger.debug(`Executing delete query: ${deleteQuery}`);
    const deletedSessions = await queryDatabase(deleteQuery);
    Logger.debug(`Delete query result: ${JSON.stringify(deletedSessions)}`);
    
    // Log the deleted sessions
    Logger.info(`Deleted ${expiredSessions.length} expired session(s)`);
    expiredSessions.forEach(session => {
      Logger.debug(`Deleted expired session: ${session.name} (last ping: ${session.ping ? new Date(session.ping).toISOString() : 'never'})`);
    });
    
  } catch (err) {
    Logger.error(`Failed to delete expired sessions: ${err}`);
    if (err instanceof Error) {
      Logger.error(`Error details: ${JSON.stringify({
        name: err.name,
        message: err.message,
        stack: err.stack,
        cause: err.cause
      })}`);
    }
    throw err; // Re-throw to let the worker handle the error
  }
}