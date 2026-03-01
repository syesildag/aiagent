import compression from "compression";
import cors from 'cors';
import { config, isDevelopment } from './utils/config';
import express, { NextFunction, Request, Response } from "express";
import { rateLimit } from 'express-rate-limit';
import fs from 'fs';
import helmet from 'helmet';
import http from 'http';
import https from 'https';
import schedule from "node-schedule";
import { Duplex } from "stream";
import { z } from 'zod';
import { getAgentFromName, getGlobalMCPManager, initializeAgents, shutdownAgentSystem } from './agent';
import { AiAgentSession } from "./entities/ai-agent-session";
import aiagentuserRepository from "./entities/ai-agent-user";
import { repository } from "./repository/repository";
import { hashPassword } from './utils/hashPassword';
import { initFromPath } from "./utils/initFromPath";
import JobFactory from "./utils/jobFactory";
import Logger from "./utils/logger";
import { closeDatabase, queryDatabase } from "./utils/pgClient";
import randomAlphaNumeric from './utils/randomAlphaNumeric';
import { handleStreamingResponse } from './utils/streamUtils';
import { generateFrontendHTML } from './utils/frontendTemplate';
import { generateManifest } from './utils/pwaManifest';
import { approvalManager } from './mcp/approvalManager';
import path from 'path';

// This array will hold references to the job factories, preventing them from being garbage collected.
const activeJobs: JobFactory[] = [];

// Cached service worker content (read from disk once on first request)
let cachedSwJs: string | null = null;

// Async handler utility for error handling
function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
   return (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve(fn(req, res, next)).catch(next);
   };
}

// Load SSL certificate and private key (production only)
const options: https.ServerOptions | null = isDevelopment() ? null : {
   key: fs.readFileSync('server.key'),
   cert: fs.readFileSync('server.cert')
};

const Query = z.object({
   session: z.string().optional().describe('The session id'),
   prompt: z.string().describe('user prompt'),
   imageBase64: z.string().optional().describe('base64-encoded image data'),
   imageMimeType: z.string().optional().describe('MIME type of the image, e.g. image/png')
});

const app = express();

app.use(helmet(isDevelopment() ? {
   contentSecurityPolicy: false,
   strictTransportSecurity: false,
} : {}));
app.use(cors());

// Trust proxy headers (required for express-rate-limit behind Ingress)
app.set('trust proxy', 1);

app.use(rateLimit({
   windowMs: 1 * 60 * 1000, // 1 minute
   limit: 60, // Limit each IP to 60 requests per `window` (here, per 1 minute).
   standardHeaders: 'draft-8', // draft-6: `RateLimit-*` headers; draft-7 & draft-8: combined `RateLimit` header
   legacyHeaders: false, // Disable the `X-RateLimit-*` headers.
   // store: ... , // Redis, Memcached, etc. See https://github.com/express-rate-limit/express-rate-limit
}));

app.use(compression({ filter: shouldCompress }));

function shouldCompress(req: express.Request, res: express.Response) {
   if (req.headers['x-no-compression'])
      // don't compress responses with this request header
      return false;

   // fallback to standard filter function
   return compression.filter(req, res);
}

// Error-handling middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
   Logger.error(err.stack);
   if (isDevelopment()) {
      res.status(500).send(`<pre>${err.message}\n${err.stack}</pre>`);
   } else {
      res.status(500).send('Something broke!');
   }
});

// JSON parsing middleware
app.use(express.json({ limit: '20mb' }));

// RAW parsing middleware
app.use(express.raw({ limit: '20mb' }));

// TEXT parsing middleware
app.use(express.text({ limit: '20mb' }));

// URLENCODED parsing middleware
app.use(express.urlencoded({ limit: '20mb', extended: true }));

// Custom middleware for token-based authentication
async function sessionMiddleware(req: Request, res: Response, next: NextFunction) {
   if (req.headers['content-type'] === 'application/json') {
      const session = req.body.session;
      if (session) {
         const sessionEntity = await repository.get(AiAgentSession)?.getByUniqueValues(session);
         if (!sessionEntity) {
            sendAuthenticationRequired(res);
            return;
         }
         res.locals.session = sessionEntity;
         sessionEntity.setPing(new Date());
         sessionEntity.save();
      }
   }
   next();
}

app.use(sessionMiddleware);

app.post("/login", asyncHandler(async (req: Request, res: Response) => {
   // parse login and password from headers
   const b64auth = (req.headers.authorization ?? '').split(' ')[1] ?? '';
   const [userLogin, password] = Buffer.from(b64auth, 'base64').toString().split(':');
   if (!userLogin || !password) {
      Logger.warn('Missing username or password in authorization header');
      sendAuthenticationRequired(res);
      return;
   }
   const hmacKey = config.HMAC_SECRET_KEY;
   if (!hmacKey) {
      Logger.error('HMAC_SECRET_KEY environment variable is not set');
      res.status(500).send('Server configuration error');
      return;
   }
   const passwordHash = hashPassword(password, hmacKey);

   // Use repository pattern to find user by login
   const user = await aiagentuserRepository.findByLogin(userLogin);

   if (!user || user.getPassword() !== passwordHash) {
      Logger.warn(`Authentication failed for user: ${userLogin}`);
      sendAuthenticationRequired(res); // custom message
      return;
   }

   //save session to database
   const session = randomAlphaNumeric(3);
   Logger.debug(`Creating session for user: ${userLogin}, session: ${session}`);
   await new AiAgentSession({ name: session, userLogin }).save();

   res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ session }));
}));

// Logout endpoint: deletes session from database
app.post("/logout", asyncHandler(async (req: Request, res: Response) => {
   if (!res.locals.session) {
      Logger.warn('Logout failed: Missing session');
      res.status(400).send('Missing session');
      return;
   }
   // Delete session from database
   await (res.locals.session as AiAgentSession).delete();
   res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ success: true }));
}));

app.post("/chat/:agent", asyncHandler(async (req: Request, res: Response) => {
   const { prompt, imageBase64, imageMimeType } = Query.parse(req.body);
   const agent = await getAgentFromName(req.params.agent);
   agent.setSession(res.locals.session);
   const imageData = imageBase64 && imageMimeType ? { base64: imageBase64, mimeType: imageMimeType } : undefined;

   // All responses use NDJSON so we can multiplex approval events and text chunks
   // on the same stream (MCP 2025-11-25 human-in-the-loop pattern).
   res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
   res.setHeader('Transfer-Encoding', 'chunked');
   res.setHeader('Cache-Control', 'no-cache');
   res.flushHeaders();  // open the connection now so early writes (approvals) reach the client

   // Approval callback: broadcasts the approval request event to the browser
   // and then suspends tool execution until the user decides.
   const approvalCallback = async (
     toolName: string,
     args: Record<string, unknown>,
     description: string,
   ): Promise<boolean> => {
     const request = approvalManager.buildRequest(toolName, args, description);
     const decision = approvalManager.register(request.id);
     // Emit the approval event as an NDJSON line
     res.write(
       JSON.stringify({
         t: 'approval',
         id: request.id,
         tool: request.toolName,
         args: request.args,
         desc: request.description,
       }) + '\n',
     );
     return decision;
   };

   const answer = await agent.chat(prompt, undefined, true, imageData, approvalCallback);

   if (answer instanceof ReadableStream) {
      await handleStreamingResponse(answer, res, agent.addAssistantMessageToHistory.bind(agent));
   } else {
      // Wrap non-streaming response as an NDJSON text event
      agent.addAssistantMessageToHistory(answer);
      res.write(JSON.stringify({ t: 'text', v: answer }) + '\n');
      res.end();
   }
}));

// Approve / deny a pending tool execution (called by the browser when the user decides)
app.post("/chat/approve/:approvalId", asyncHandler(async (req: Request, res: Response) => {
   const { approvalId } = req.params;
   const { approved } = z.object({ approved: z.boolean() }).parse(req.body);
   const resolved = approvalManager.resolve(approvalId, approved);
   if (!resolved) {
      res.status(404).json({ error: 'Approval request not found or already resolved' });
      return;
   }
   Logger.info(`Tool approval ${approvalId}: ${approved ? 'APPROVED' : 'DENIED'}`);
   res.json({ success: true });
}));

// Info endpoint - returns current model, provider and all available models for the agent
app.get("/info/:agent", asyncHandler(async (req: Request, res: Response) => {
   await getAgentFromName(req.params.agent); // validates agent exists
   const manager = getGlobalMCPManager();
   const models = manager ? await manager.getAvailableModels() : [];
   res.json({
      model: manager?.getCurrentModel() ?? '',
      provider: manager?.getProviderName() ?? '',
      models
   });
}));

// Model switch endpoint - changes the active model
app.post("/model/:agent", asyncHandler(async (req: Request, res: Response) => {
   await getAgentFromName(req.params.agent);
   const { model } = z.object({ model: z.string() }).parse(req.body);
   const manager = getGlobalMCPManager();
   if (!manager) {
      res.status(503).json({ error: 'Agent not initialised' });
      return;
   }
   manager.updateModel(model);
   Logger.info(`Model switched to: ${model}`);
   res.json({ model });
}));

// ---------------------------------------------------------------------------
// PWA routes
// ---------------------------------------------------------------------------

// Service worker – must be served from root scope
app.get('/sw.js', (req: Request, res: Response) => {
   if (!cachedSwJs) {
      cachedSwJs = fs.readFileSync(path.join(__dirname, 'frontend/pwa/sw.js'), 'utf-8');
   }
   res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
   res.setHeader('Service-Worker-Allowed', '/');
   res.setHeader('Cache-Control', 'no-cache');
   res.send(cachedSwJs);
});

// Web app manifest – dynamically generated per agent
app.get('/front/:agent/manifest.json', (req: Request, res: Response) => {
   res.setHeader('Cache-Control', 'no-cache');
   res.json(generateManifest(req.params.agent));
});

// Frontend endpoint - serves React chat interface
app.get("/front/:agent", asyncHandler(async (req: Request, res: Response) => {
   const agentName = req.params.agent;
   
   // Validate agent exists
   try {
      await getAgentFromName(agentName);
   } catch (error) {
      res.status(404).send(`Agent "${agentName}" not found`);
      return;
   }

   // Serve HTML that loads the bundle from a separate endpoint
   const html = generateFrontendHTML('', agentName);
   res.setHeader('Content-Type', 'text/html; charset=utf-8');
   res.send(html);
}));

// Serve static files
app.use('/static', express.static(path.join(__dirname, '..', 'static'), {
   index: false,
   etag: true,
   maxAge: '1d',
   redirect: false,
   setHeaders: function (res, path, stat) {
      res.setHeader('x-timestamp', Date.now());
   },
}));

// Health endpoint
app.get('/healthz', (req: Request, res: Response) => {
   // Basic health check: server is up
   res.status(200).json({ status: 'ok' });
});

// Readiness endpoint
app.get('/readyz', async (req: Request, res: Response) => {
   // Readiness check: database and agent system
   try {
      // Example: check database connection
      await queryDatabase('SELECT 1');
      // Optionally, check agent system readiness here
      res.status(200).json({ status: 'ready' });
   } catch (error) {
      Logger.error('Readiness check failed:', error);
      res.status(503).json({ status: 'not ready', error: error instanceof Error ? error.message : String(error) });
   }
});

const PORT: number = config.PORT;
const HOST: string = config.HOST;
const server = (isDevelopment()
   ? http.createServer(app)
   : https.createServer(options!, app)
).listen(PORT, HOST, async () => {
   const protocol = isDevelopment() ? 'http' : 'https';
   Logger.info(`[server]: Server is running at ${protocol}://${HOST}:${PORT}`);

   try {
      await initializeAgents();
      Logger.info(`[server]: Agent system initialized successfully`);
   } catch (error) {
      Logger.error(`[server]: Failed to initialize agent system: ${error instanceof Error ? error.message : String(error)}`);
   }
});
let connections: Array<Duplex> = [];
server.on('connection', connection => {
   connections.push(connection);
   const filterConnections = () => {
      connections = connections.filter(curr => curr !== connection)
   };
   connection.on('error', (err: Error) => {
      Logger.error(`Error in connection: ${err.message}`);
      filterConnections();
   });
   connection.on('close', () => {
      filterConnections();
   });
});

process.on('SIGTERM', (signal) => {
   gracefulShutdown(signal).catch((error) => {
      Logger.error(`Error during graceful shutdown: ${error}`);
      process.exit(1);
   });
});

process.on('SIGINT', (signal) => {
   gracefulShutdown(signal).catch((error) => {
      Logger.error(`Error during graceful shutdown: ${error}`);
      process.exit(1);
   });
});

function sendAuthenticationRequired(res: Response) {
   res.set('WWW-Authenticate', 'Basic realm="401"'); // change this
   res.status(401).send('Authentication required.');
}

async function gracefulShutdown(event: NodeJS.Signals) {

   let scheduler = schedule.gracefulShutdown();

   Logger.info(`${event} signal received.`);

   Logger.info('Shutting down gracefully...');

   // Shutdown job worker pools first
   try {
      Logger.info('Shutting down job worker pools...');
      for (const activeJob of activeJobs) {
         activeJob.close();
      }
      Logger.info('Job worker pools shut down successfully');
   } catch (error) {
      Logger.error(`Error shutting down job worker pools: ${error}`);
   }

   // Shutdown MCP servers
   try {
      await shutdownAgentSystem();
      Logger.info('Agent system and MCP servers shut down successfully');
   } catch (error) {
      Logger.error(`Error shutting down agent system: ${error}`);
   }

   //close the postgresql pool
   closeDatabase();

   connections.forEach(connection => {
      Logger.info(`Closing active connection ${connection}`);
      connection.end();
   });

   server.close(async (err?: Error) => {
      Logger.info(`Server closed with ${err ?? 'Success'}`);
      process.exit(0);
   });

   setTimeout(() => {
      Logger.error('Could not close connections in time, forcefully shutting down');
      connections.forEach(curr => curr.destroy());
      process.exit(1);
   }, config.SERVER_TERMINATE_TIMEOUT);
}

/**
 * Convenience function to schedule jobs using the default configuration
 */
async function scheduleJobs() {
   return await initFromPath<JobFactory>(__dirname, 'jobs', (jobFactory: JobFactory) => {
      const job = jobFactory.create();
      // Store reference to prevent garbage collection of the job factory and its worker pool
      activeJobs.push(jobFactory);
   });
}

scheduleJobs();