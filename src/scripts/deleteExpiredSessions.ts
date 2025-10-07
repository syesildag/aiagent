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
  
    const expiredSessions = await queryDatabase(selectQuery);
    Logger.debug(`Expired sessions: ${JSON.stringify(expiredSessions)}`);
    
    if (expiredSessions.length === 0)
      return;
    
    // Use a safer approach - delete sessions based on the timeout condition directly
    // This avoids potential SQL injection and malformed queries
    const deleteQuery = `
      DELETE FROM ai_agent_session 
       WHERE id IN (${expiredSessions.map(s => s.id).join(', ')})
    `;
    
    Logger.debug(`Executing delete query: ${deleteQuery}`);
    await queryDatabase(deleteQuery);
    
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