import compression from "compression";
import cors from 'cors';
import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import { rateLimit } from 'express-rate-limit';
import fs from 'fs';
import helmet from 'helmet';
import https from 'https';
import schedule from "node-schedule";
import { Duplex } from "stream";
import { z } from 'zod';
import { getAgentFromName, initializeAgents, shutdownAgentSystem } from './agent';
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

// This array will hold references to the job factories, preventing them from being garbage collected.
const activeJobs: JobFactory[] = [];

// Async handler utility for error handling
function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
   return (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve(fn(req, res, next)).catch(next);
   };
}

// Load SSL certificate and private key
const options: https.ServerOptions = {
   key: fs.readFileSync('server.key'),
   cert: fs.readFileSync('server.cert')
};

const Query = z.object({
   session: z.string().optional().describe('The session id'),
   prompt: z.string().describe('user prompt')
});

const app = express();

app.use(helmet());
app.use(cors());

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
   res.status(500).send('Something broke!');
});

// JSON parsing middleware
app.use(express.json({ limit: '1mb' }));

// RAW parsing middleware
app.use(express.raw({ limit: '1mb' }));

// TEXT parsing middleware
app.use(express.text({ limit: '1mb' }));

// URLENCODED parsing middleware
app.use(express.urlencoded({ limit: '1mb', extended: true }));

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
   const hmacKey = process.env.HMAC_SECRET_KEY;
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
   const { prompt } = Query.parse(req.body);
   const agent = await getAgentFromName(req.params.agent);
   agent.setSession(res.locals.session);
   const answer = await agent.chat(prompt, undefined, true);

   if (answer instanceof ReadableStream) {
      // Set appropriate headers for streaming
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');

      await handleStreamingResponse(answer, res, agent.addAssistantMessageToHistory.bind(agent));
   } else {
      // Handle non-streaming string responses
      Logger.debug(`Non-streaming response. Length: ${answer.length} chars`);
      agent.addAssistantMessageToHistory(answer);

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(answer);
   }
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

const PORT: number = +process.env.PORT!;
const HOST: string = process.env.HOST!;
const server = https.createServer(options, app).listen(PORT, HOST, async () => {
   Logger.info(`[server]: Server is running at http://${HOST}:${PORT}`);

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
   }, +process.env.SERVER_TERMINATE_TIMEOUT!);
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