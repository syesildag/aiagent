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
import { initializeAgents, shutdownAgentSystem } from './agent';
import { initFromPath } from "./utils/initFromPath";
import JobFactory from "./utils/jobFactory";
import Logger from "./utils/logger";
import { closeDatabase } from "./utils/pgClient";
import { sessionMiddleware } from './middleware/session';
import { authRouter } from './routes/auth';
import { chatRouter } from './routes/chat';
import { agentsRouter } from './routes/agents';
import { conversationsRouter } from './routes/conversations';
import { pwaRouter } from './routes/pwa';
import { healthRouter } from './routes/health';

// This array will hold references to the job factories, preventing them from being garbage collected.
const activeJobs: JobFactory[] = [];

// Load SSL certificate and private key (production only)
const options: https.ServerOptions | null = isDevelopment() ? null : {
   key: fs.readFileSync('server.key'),
   cert: fs.readFileSync('server.cert')
};

const app = express();

app.use(helmet(isDevelopment() ? {
   contentSecurityPolicy: false,
   strictTransportSecurity: false,
} : {}));
// CORS: restrict to origins listed in ALLOWED_ORIGINS (comma-separated).
// Defaults to same-origin only when the env var is absent/empty.
const buildCorsOptions = (): cors.CorsOptions => {
   const raw = config.ALLOWED_ORIGINS?.trim() ?? '';
   if (!raw) {
      const proto = isDevelopment() ? 'http' : 'https';
      return { origin: `${proto}://${config.HOST}:${config.PORT}`, credentials: false };
   }
   const whitelist = raw.split(',').map(o => o.trim()).filter(Boolean);
   return {
      origin: (origin, cb) => {
         if (!origin || whitelist.includes(origin)) cb(null, true);
         else cb(new Error('Not allowed by CORS policy'));
      },
      credentials: false,
   };
};
app.use(cors(buildCorsOptions()));

// Trust proxy headers (required for express-rate-limit behind Ingress)
app.set('trust proxy', 1);

app.use(rateLimit({
   windowMs: 1 * 60 * 1000, // 1 minute
   limit: 60, // Limit each IP to 60 requests per `window` (here, per 1 minute).
   standardHeaders: 'draft-8',
   legacyHeaders: false,
}));

app.use(compression({ filter: shouldCompress }));

function shouldCompress(req: express.Request, res: express.Response) {
   if (req.headers['x-no-compression'])
      // don't compress responses with this request header
      return false;

   // fallback to standard filter function
   return compression.filter(req, res);
}

// JSON parsing middleware
app.use(express.json({ limit: '20mb' }));

// RAW parsing middleware
app.use(express.raw({ limit: '20mb' }));

// TEXT parsing middleware
app.use(express.text({ limit: '20mb' }));

// URLENCODED parsing middleware
app.use(express.urlencoded({ limit: '20mb', extended: true }));

app.use(sessionMiddleware);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use(authRouter);
app.use('/chat', chatRouter);
app.use(agentsRouter);
app.use('/conversations', conversationsRouter);
app.use(pwaRouter);
app.use(healthRouter);

// Error-handling middleware — must be registered AFTER all routes so Express
// routes exceptions here instead of through the default opaque handler.
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
   Logger.error(err.stack);
   // If headers were already sent (e.g. streaming responses), we cannot write
   // a new HTTP status. Just destroy the socket to avoid crashing the process.
   if (res.headersSent) {
      Logger.error('Headers already sent; destroying socket to avoid crash');
      res.destroy();
      return;
   }
   res.status(500).json({ error: isDevelopment() ? err.message : 'Something broke!' });
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

// Prevent unhandled rejections/exceptions from crashing the server process.
// These are last-resort safety nets; individual handlers should catch their own errors.
process.on('unhandledRejection', (reason: unknown) => {
   Logger.error(`Unhandled promise rejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
});

process.on('uncaughtException', (err: Error) => {
   Logger.error(`Uncaught exception: ${err.stack}`);
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
   return await initFromPath<JobFactory>(__dirname, 'jobs', async (jobFactory: JobFactory) => {
      // Allow DB-backed jobs (DbJobFactory) to upsert their DB record and read
      // initial state before the timer is created. No-op for plain JobFactory subclasses.
      await jobFactory.initialize();
      const job = jobFactory.create();
      // Store reference to prevent garbage collection of the job factory and its worker pool
      activeJobs.push(jobFactory);
   });
}

scheduleJobs();