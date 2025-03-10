import compression from "compression";
import crypto from 'crypto';
import fs from 'fs';
import https from 'https';
import { askQuestionWithFunctions } from './agent';
import { closeDatabase, queryDatabase } from "./utils/pgClient";

import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import { Duplex } from "stream";
import { z } from 'zod';
import { Session } from "./repository/entities/session";
import { registry } from "./repository/registry";
import randomAlphaNumeric from './utils/randomAlphaNumeric';
import Logger from "./utils/logger";

// Load SSL certificate and private key
const options: https.ServerOptions = {
   key: fs.readFileSync('server.key'),
   cert: fs.readFileSync('server.cert')
};

const Query = z.object({
   session: z.string().optional().describe('The session id'),
   question: z.string().describe('The question to ask the AI')
});

const app = express();

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
   console.error(err.stack);
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

app.post("/login", async (req: Request, res: Response) => {

   // parse login and password from headers
   const b64auth = (req.headers.authorization ?? '').split(' ')[1] ?? ''
   const [username, password] = Buffer.from(b64auth, 'base64').toString().split(':')
   const sqlQuery = ` SELECT id FROM "user" WHERE login = $1 AND password = $2`;
   const results = await queryDatabase(sqlQuery, [username, crypto.createHash('sha256').update(password).digest('base64')]);
   if (results.length === 0)
      sendAuthenticationRequired(res); // custom message

   //save session to database
   const session = randomAlphaNumeric(3);

   new Session({ name: session, username }).save();

   res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ session }));
});

app.post("/:agent", async (req: Request, res: Response) => {

   let answer: string = "";

   const { session, question } = Query.parse(req.body);

   if (!session)
      sendAuthenticationRequired(res);

   const sessionEntity = await registry.get(Session)?.getByUniqueValues(session);

   if (!sessionEntity)
      sendAuthenticationRequired(res);

   sessionEntity!.setPing(new Date());

   sessionEntity!.save();

   let error;
   try {
      const agentName = req.params.agent;
      answer = await askQuestionWithFunctions(session!, agentName, question);
   } catch (e) {
      error = e;
   }

   if (error)
      res.status(500).send("Error: " + error);
   else {
      const content = JSON.stringify({ answer, session });
      Logger.debug(content);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(content);
   }
});
const PORT: number = +process.env.PORT!;
const HOST: string = process.env.HOST!;
const server = https.createServer(options, app).listen(PORT, HOST, async () => {
   console.log(`[server]: Server is running at http://${HOST}:${PORT}`);
});

let connections: Array<Duplex> = [];
server.on('connection', connection => {
   connections.push(connection);
   const filterConnections = () => {
      connections = connections.filter(curr => curr !== connection)
   };
   connection.on('error', (err: Error) => {
      console.error(`Error in connection: ${err.message}`);
      filterConnections();
   });
   connection.on('close', () => {
      filterConnections();
   });
});

process.on('SIGTERM', gracefulShutdown);

process.on('SIGINT', gracefulShutdown);

function sendAuthenticationRequired(res: Response) {
   res.set('WWW-Authenticate', 'Basic realm="401"'); // change this
   res.status(401).send('Authentication required.');
}

function gracefulShutdown(event: NodeJS.Signals) {

   console.log(`${event} signal received.`);

   console.log('Shutting down gracefully...');

   //close the postgresql pool
   closeDatabase();

   connections.forEach(connection => {
      console.log(`Closing active connection ${connection}`);
      connection.end();
   });

   server.close(async (err?: Error) => {
      console.log(`Server closed with ${err ?? 'Success'}`);
      process.exit(0);
   });

   setTimeout(() => {
      console.error('Could not close connections in time, forcefully shutting down');
      connections.forEach(curr => curr.destroy());
      process.exit(1);
   }, +process.env.SERVER_TERMINATE_TIMEOUT!);
}