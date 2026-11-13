import { Request, Response, Router } from "express";
import Logger from "../utils/logger";
import { queryDatabase } from "../utils/pgClient";

export const healthRouter = Router();

healthRouter.get('/healthz', (_req: Request, res: Response) => {
   res.status(200).json({ status: 'ok' });
});

healthRouter.get('/readyz', async (_req: Request, res: Response) => {
   try {
      await queryDatabase('SELECT 1');
      res.status(200).json({ status: 'ready' });
   } catch (error) {
      // Unauthenticated endpoint: log the details, but do not reveal database errors
      // (host names, users, driver messages) to callers.
      Logger.error('Readiness check failed:', error);
      res.status(503).json({ status: 'not ready' });
   }
});
