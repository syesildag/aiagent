import compression from "compression";
import cors from 'cors';
import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import { rateLimit } from 'express-rate-limit';
import fs from 'fs';
import helmet from 'helmet';
import https from 'https';
import { Duplex } from "stream";
import { z } from 'zod';
import { getAgentFromName, initializeAgents, shutdownAgentSystem } from './agent';
import { Session } from "./repository/entities/session";
import { repository } from "./repository/repository";
import { hashPassword } from './utils/hashPassword';
import Logger from "./utils/logger";
import { closeDatabase, queryDatabase } from "./utils/pgClient";
import randomAlphaNumeric from './utils/randomAlphaNumeric';
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

const Validate = z.object({
   session: z.string().optional().describe('The session id'),
   data: z.any().describe('The data to validate'),
   validate: z.string().optional().describe('validate name')
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
         const sessionEntity = await repository.get(Session)?.getByUniqueValues(session);
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
   const [username, password] = Buffer.from(b64auth, 'base64').toString().split(':');
   if (!username || !password) {
      Logger.warn('Missing username or password in authorization header');
      sendAuthenticationRequired(res);
      return;
   }
   const sqlQuery = ` SELECT id FROM "user" WHERE login = $1 AND password = $2`;
   const hmacKey = process.env.HMAC_SECRET_KEY;
   if (!hmacKey) {
      Logger.error('HMAC_SECRET_KEY environment variable is not set');
      res.status(500).send('Server configuration error');
      return;
   }
   const passwordHash = hashPassword(password, hmacKey);
   const results = await queryDatabase(sqlQuery, [username, passwordHash]);
   if (results.length === 0) {
      Logger.warn(`Authentication failed for user: ${username}`);
      sendAuthenticationRequired(res); // custom message
      return;
   }

   //save session to database
   const session = randomAlphaNumeric(3);
   await new Session({ name: session, username }).save();

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
   await (res.locals.session as Session).delete();
   res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ success: true }));
}));

app.post("/validate/:agent", asyncHandler(async (req: Request, res: Response) => {
   const agent = await getAgentFromName(req.params.agent);
   agent.setSession(res.locals.session);
   const { data } = Validate.parse(req.body);
   const validated = await agent.validate(data);
   const content = JSON.stringify({ validated });
   Logger.debug(content);
   res.writeHead(200, { 'Content-Type': 'application/json' }).end(content);
}));
app.post("/chat/:agent", asyncHandler(async (req: Request, res: Response) => {
   const { prompt } = Query.parse(req.body);
   const agent = await getAgentFromName(req.params.agent);
   agent.setSession(res.locals.session);
   const answer = await agent.chat(prompt);
   const validate = agent.shouldValidate();
   const response: any = { answer };
   if (validate)
      response.validate = true;
   const content = JSON.stringify(response);
   Logger.debug(content);
   res.writeHead(200, { 'Content-Type': 'application/json' }).end(content);
}));

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

   Logger.info(`${event} signal received.`);

   Logger.info('Shutting down gracefully...');

   // Shutdown MCP servers first
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