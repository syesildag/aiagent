import { NextFunction, Request, Response } from "express";
import { AiAgentSession } from "../entities/ai-agent-session";
import { repository } from "../repository/repository";
import { config } from "../utils/config";

/** Session tokens are 32 random bytes, hex-encoded (see routes/auth.ts). */
const SESSION_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Look up a session token and enforce expiry. Returns the live session (with
 * its ping refreshed) or undefined when the token is malformed, unknown or
 * expired. Expired sessions are deleted. Every route that authenticates must
 * go through this function so the timeout cannot be bypassed.
 */
export async function resolveActiveSession(token: unknown): Promise<AiAgentSession | undefined> {
   // Only accept well-formed string tokens: objects/arrays from a JSON body or
   // repeated query parameters must never reach the database lookup.
   if (typeof token !== 'string' || !SESSION_TOKEN_PATTERN.test(token)) {
      return undefined;
   }
   const sessionEntity = await repository.get(AiAgentSession)?.getByUniqueValues(token);
   if (!sessionEntity) {
      return undefined;
   }

   // Enforce session expiry — don't wait for the background cleanup job
   const lastActive = sessionEntity.getPing() ?? sessionEntity.getCreatedAt();
   const ageMs = Date.now() - (lastActive?.getTime() ?? 0);
   const sessionTimeoutMs = (config.SESSION_TIMEOUT_SECONDS || 3600) * 1000;
   if (ageMs > sessionTimeoutMs) {
      await sessionEntity.delete();
      return undefined;
   }

   sessionEntity.setPing(new Date());
   sessionEntity.save();
   return sessionEntity;
}

export async function sessionMiddleware(req: Request, res: Response, next: NextFunction) {
   try {
      if (req.is('application/json')) {
         const session = req.body?.session;
         if (session) {
            const sessionEntity = await resolveActiveSession(session);
            if (sessionEntity) {
               res.locals.session = sessionEntity;
            }
            // If session token is not found or is expired, just fall through —
            // do NOT return 401 here. Individual routes enforce their own auth.
         }
      }
      next();
   } catch (err) {
      // Express 4 does not catch rejected promises from async middleware.
      next(err);
   }
}
