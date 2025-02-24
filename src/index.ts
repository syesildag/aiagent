import compression from "compression";
import crypto from 'crypto';
import { askQuestionWithFunctions } from './utils/aiAgent';
import { closeDatabase, queryDatabase } from "./utils/pgClient";

import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import { Socket } from "net";
import { z } from 'zod';
import randomAlphaNumeric from './utils/randomAlphaNumeric';

const AIQuery = z.object({
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
   const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':')
   const sqlQuery = ` SELECT id FROM "user" WHERE login = $1 AND password = $2`;
   const results = await queryDatabase(sqlQuery, [login, crypto.createHash('sha256').update(password).digest('base64')]);
   if(results.length === 0)
      sendAuthenticationRequired(res); // custom message

   //save session to database
   const session = randomAlphaNumeric(2);
   await queryDatabase(`INSERT INTO session (name, username) VALUES ($1, $2)`, [session, login]);

   res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({session}));
});

app.post("/:agent", async (req: Request, res: Response) => {
   let answer: string = "";

   const {session, question} = AIQuery.parse(req.body);

   if (!session)
      sendAuthenticationRequired(res);

   let sqlQuery = `SELECT username FROM session WHERE name = $1`;
   const results = await queryDatabase(sqlQuery, [session]);
   if (results.length === 0)
      sendAuthenticationRequired(res);

   sqlQuery = `UPDATE session SET ping = NOW() WHERE name = $1`;
   await queryDatabase(sqlQuery, [session]);

   //const username = results[0].username;

   let error;
   try {
      const agentName = req.params.agent;
      answer = await askQuestionWithFunctions(session!, agentName, question);
   } catch (e) {
      error = e;
   }

   if(error)
      res.status(500).send("Error: " + error);
   else
   res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ answer, session }));
});
const PORT: number = +process.env.PORT!;
const HOST: string = process.env.HOST!;
const server = app.listen(PORT, HOST, async () => {
   console.log(`[server]: Server is running at http://${HOST}:${PORT}`);
});

let connections: Array<Socket> = [];
server.on('connection', connection => {
   connections.push(connection);
   connection.on('close', hadError => {
      if (hadError)
         console.error('Socket closed with an error');
      connections = connections.filter(curr => curr !== connection)
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
      console.log(`Closing active connection ${connection.remoteAddress}:${connection.remotePort}`);
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