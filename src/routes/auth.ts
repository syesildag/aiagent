import { randomBytes } from 'crypto';
import { Request, Response, Router } from "express";
import { rateLimit } from 'express-rate-limit';
import { AiAgentSession } from "../entities/ai-agent-session";
import aiagentuserRepository from "../entities/ai-agent-user";
import { asyncHandler } from "../utils/asyncHandler";
import { config } from "../utils/config";
import { hashPassword, verifyPassword } from '../utils/hashPassword';
import Logger from "../utils/logger";
import { sendAuthenticationRequired } from "./routeUtils";

export const authRouter = Router();

// Brute-force protection: at most 5 failed logins per IP per 15 minutes.
// Successful logins do not count, so a legitimate user is never locked out by their own use.
const loginRateLimit = rateLimit({
   windowMs: 15 * 60 * 1000,
   limit: 5,
   standardHeaders: 'draft-8',
   legacyHeaders: false,
   skipSuccessfulRequests: true,
   message: { error: 'Too many login attempts, please try again later.' },
});

// bcrypt hash of a random secret, compared against when the login does not exist so
// the response time does not reveal whether a username is valid.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
   dummyHashPromise ??= hashPassword(randomBytes(32).toString('hex'), config.BCRYPT_ROUNDS);
   return dummyHashPromise;
}

authRouter.post("/login", loginRateLimit, asyncHandler(async (req: Request, res: Response) => {
   // parse login and password from headers; split on the FIRST colon only so that
   // passwords containing ':' are verified in full (RFC 7617)
   const b64auth = (req.headers.authorization ?? '').split(' ')[1] ?? '';
   const decoded = Buffer.from(b64auth, 'base64').toString();
   const separator = decoded.indexOf(':');
   const userLogin = separator >= 0 ? decoded.slice(0, separator) : '';
   const password = separator >= 0 ? decoded.slice(separator + 1) : '';
   if (!userLogin || !password) {
      Logger.warn('Missing username or password in authorization header');
      sendAuthenticationRequired(res);
      return;
   }
   // Use repository pattern to find user by login
   const user = await aiagentuserRepository.findByLogin(userLogin);

   const { valid, needsRehash } = user
      ? await verifyPassword(password, user.getPassword(), config.HMAC_SECRET_KEY)
      : await verifyPassword(password, await getDummyHash()).then(() => ({ valid: false, needsRehash: false }));

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
   Logger.debug(`Creating session for user: ${userLogin}`);
   await new AiAgentSession({ name: session, userLogin }).save();

   res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ session }));
}));

// Session validation endpoint: returns 200 if the session token is still valid, 401 otherwise.
// The session middleware has already done the DB lookup and expiry check before this handler runs.
authRouter.post("/session/validate", asyncHandler(async (_req: Request, res: Response) => {
   if (!res.locals.session) {
      sendAuthenticationRequired(res);
      return;
   }
   res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ valid: true }));
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
