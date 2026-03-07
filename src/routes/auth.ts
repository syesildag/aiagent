import { randomBytes } from 'crypto';
import { Request, Response, Router } from "express";
import { AiAgentSession } from "../entities/ai-agent-session";
import aiagentuserRepository from "../entities/ai-agent-user";
import { asyncHandler } from "../utils/asyncHandler";
import { config } from "../utils/config";
import { hashPassword, verifyPassword } from '../utils/hashPassword';
import Logger from "../utils/logger";

export const authRouter = Router();

function sendAuthenticationRequired(res: Response) {
   // Do NOT set WWW-Authenticate: Basic — that triggers the browser's native
   // login popup instead of letting the frontend handle the 401 itself.
   res.status(401).json({ error: 'Authentication required.' });
}

authRouter.post("/login", asyncHandler(async (req: Request, res: Response) => {
   // parse login and password from headers
   const b64auth = (req.headers.authorization ?? '').split(' ')[1] ?? '';
   const [userLogin, password] = Buffer.from(b64auth, 'base64').toString().split(':');
   if (!userLogin || !password) {
      Logger.warn('Missing username or password in authorization header');
      sendAuthenticationRequired(res);
      return;
   }
   // Use repository pattern to find user by login
   const user = await aiagentuserRepository.findByLogin(userLogin);

   const { valid, needsRehash } = user
      ? await verifyPassword(password, user.getPassword(), config.HMAC_SECRET_KEY)
      : { valid: false, needsRehash: false };

   if (!valid) {
      Logger.warn(`Authentication failed for user: ${userLogin}`);
      sendAuthenticationRequired(res);
      return;
   }

   // Lazy upgrade: re-hash with bcrypt if still using legacy HMAC
   if (needsRehash) {
      const newHash = await hashPassword(password, config.BCRYPT_ROUNDS);
      user!.setPassword(newHash);
      user!.setHashVersion('bcrypt');
      await user!.save();
      Logger.info(`Password re-hashed to bcrypt for user: ${userLogin}`);
   }

   //save session to database
   const session = randomBytes(32).toString('hex');
   Logger.debug(`Creating session for user: ${userLogin}, session: ${session}`);
   await new AiAgentSession({ name: session, userLogin }).save();

   res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ session }));
}));

// Logout endpoint: deletes session from database
authRouter.post("/logout", asyncHandler(async (req: Request, res: Response) => {
   // If session is still set (valid), delete it. If it was already gone (expired
   // or previously deleted), treat the logout as successful — the end state is
   // the same either way and we must not trigger a 401 → logout loop.
   if (res.locals.session) {
      await (res.locals.session as AiAgentSession).delete();
   } else {
      Logger.debug('Logout: session not found (already expired or deleted) — treating as success');
   }
   res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ success: true }));
}));
