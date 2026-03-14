import { closeDatabase } from '../utils/pgClient';
import Logger from '../utils/logger';
import aiagentuserRepository from '../entities/ai-agent-user';
import "dotenv/config";

async function setUserAdmin(username: string, isAdmin: boolean) {
  try {
    const user = await aiagentuserRepository.findByLogin(username);
    if (!user) {
      Logger.error(`User '${username}' not found.`);
      process.exit(1);
    }
    user.setIsAdmin(isAdmin);
    await user.save();
    Logger.info(`User '${username}' admin flag set to ${isAdmin}.`);
  } catch (err) {
    Logger.error(`Failed to update admin flag: ${err}`);
  } finally {
    closeDatabase();
  }
}

// CLI usage: node setUserAdmin.js <username> <true|false>
if (require.main === module) {
  const [,, username, adminFlag] = process.argv;
  if (!username || adminFlag === undefined) {
    Logger.error('Usage: node setUserAdmin.js <username> <true|false>');
    process.exit(1);
  }
  const isAdmin = adminFlag === 'true';
  setUserAdmin(username, isAdmin);
}
