import { queryDatabase, closeDatabase } from '../src/utils/pgClient';
import Logger from '../src/utils/logger';
import { hashPassword } from '../src/utils/hashPassword';
import "dotenv/config";

async function addUser(username: string, password: string) {
  const hmacKey = process.env.HMAC_SECRET_KEY;
  if (!hmacKey) {
    Logger.error('HMAC_SECRET_KEY environment variable is not set');
    process.exit(1);
  }
  const passwordHash = hashPassword(password, hmacKey);
  try {
    await queryDatabase(
      `INSERT INTO "user" (login, password) VALUES ($1, $2)`,
      [username, passwordHash]
    );
    Logger.info(`User '${username}' added successfully.`);
  } catch (err) {
    Logger.error(`Failed to add user: ${err}`);
  } finally {
    closeDatabase();
  }
}

// CLI usage: node addUser.js <username> <password>
if (require.main === module) {
  const [,, username, password] = process.argv;
  if (!username || !password) {
    Logger.error('Usage: node addUser.js <username> <password>');
    process.exit(1);
  }
  addUser(username, password);
}
