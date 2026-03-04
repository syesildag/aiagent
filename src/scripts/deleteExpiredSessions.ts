import { queryDatabase } from '../utils/pgClient';
import { config } from '../utils/config';
import Logger from '../utils/logger';

export default async function deleteExpiredSessions() {
  try {
    const timeoutSeconds = config.SESSION_TIMEOUT_SECONDS;

    // Single parameterized DELETE — eliminates the prior SQL-injection risk of
    // interpolating session IDs into the query string.
    const deleteQuery = `
      DELETE FROM ai_agent_session
       WHERE COALESCE(ping, created_at) < NOW() - ($1 * INTERVAL '1 second')
      RETURNING id, name, ping
    `;
    const deleted = await queryDatabase(deleteQuery, [timeoutSeconds]);
    if (deleted.length > 0) {
      Logger.debug(`Deleted ${deleted.length} expired sessions`);
    }
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
