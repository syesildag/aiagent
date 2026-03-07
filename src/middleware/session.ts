import { NextFunction, Request, Response } from "express";
import { AiAgentSession } from "../entities/ai-agent-session";
import { repository } from "../repository/repository";
import { config } from "../utils/config";

export async function sessionMiddleware(req: Request, res: Response, next: NextFunction) {
   if (req.is('application/json')) {
      const session = req.body.session;
      if (session) {
         const sessionEntity = await repository.get(AiAgentSession)?.getByUniqueValues(session);

         if (sessionEntity) {
            // Enforce session expiry — don't wait for the background cleanup job
            const lastActive = sessionEntity.getPing() ?? sessionEntity.getCreatedAt();
            const ageMs = Date.now() - (lastActive?.getTime() ?? 0);
            const sessionTimeoutMs = (config.SESSION_TIMEOUT_SECONDS || 3600) * 1000;
            if (ageMs > sessionTimeoutMs) {
               // Session expired: clean up and proceed without setting res.locals.session.
               // The route handler will decide whether auth is required.
               await sessionEntity.delete();
            } else {
               res.locals.session = sessionEntity;
               sessionEntity.setPing(new Date());
               sessionEntity.save();
            }
         }
         // If session token is not found or is expired, just fall through —
         // do NOT return 401 here. Individual routes enforce their own auth.
      }
   }
   next();
}
