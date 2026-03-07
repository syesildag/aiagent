import express, { Request, Response, Router } from "express";
import fs from 'fs';
import path from 'path';
import { getAgentFromName } from '../agent';
import { asyncHandler } from "../utils/asyncHandler";
import { generateFrontendHTML } from '../utils/frontendTemplate';
import { generateManifest } from '../utils/pwaManifest';

export const pwaRouter = Router();

// Cached service worker content (read from disk once on first request)
let cachedSwJs: string | null = null;

// Service worker – served under /static but allowed to control root scope via header
pwaRouter.get('/static/sw.js', (req: Request, res: Response) => {
   if (!cachedSwJs) {
      cachedSwJs = fs.readFileSync(path.join(__dirname, '../frontend/pwa/sw.js'), 'utf-8');
   }
   res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
   res.setHeader('Service-Worker-Allowed', '/');
   res.setHeader('Cache-Control', 'no-cache');
   res.send(cachedSwJs);
});

// Serve static files
pwaRouter.use('/static', express.static(path.join(__dirname, '../../static'), {
   index: false,
   etag: true,
   maxAge: '1d',
   redirect: false,
   setHeaders: function (_res, _path, _stat) {
      _res.setHeader('x-timestamp', Date.now());
   },
}));

// Web app manifest – dynamically generated per agent
pwaRouter.get('/front/:agent/manifest.json', (req: Request, res: Response) => {
   res.setHeader('Cache-Control', 'no-cache');
   res.json(generateManifest(req.params.agent));
});

// Frontend endpoint - serves React chat interface
pwaRouter.get("/front/:agent", asyncHandler(async (req: Request, res: Response) => {
   const agentName = req.params.agent;

   try {
      await getAgentFromName(agentName);
   } catch (error) {
      res.status(404).send(`Agent "${agentName}" not found`);
      return;
   }

   const html = generateFrontendHTML('', agentName);
   res.setHeader('Content-Type', 'text/html; charset=utf-8');
   res.send(html);
}));
