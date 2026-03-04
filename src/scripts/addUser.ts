import { closeDatabase } from '../utils/pgClient';
import Logger from '../utils/logger';
import { hashPassword } from '../utils/hashPassword';
import { AiAgentUser } from '../entities/ai-agent-user';
import aiagentuserRepository from '../entities/ai-agent-user';
import "dotenv/config";

async function addUser(username: string, password: string) {
  const passwordHash = await hashPassword(password);
  try {
    const existing = await aiagentuserRepository.findByLogin(username);
    if (existing) {
      // Update password hash on existing user
      const updated = new AiAgentUser({
        id: existing.getId(),
        login: username,
        password: passwordHash,
        hashVersion: 'bcrypt',
      });
      await updated.save();
      Logger.info(`User '${username}' password updated successfully.`);
    } else {
      const user = new AiAgentUser({ login: username, password: passwordHash, hashVersion: 'bcrypt' });
      await user.save();
      Logger.info(`User '${username}' added successfully.`);
    }
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
