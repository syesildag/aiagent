import { askQuestionWithFunctions } from './utils/aiAgent';
import {closeDatabase} from "./utils/pgClient";
//
//const main = async () => {
//   const question = process.argv[2];
//   console.log("Question:", question);
//   const answer = await askQuestionWithFunctions(question);
//   console.log("Answer:", answer);
//   pool.end();
//};
//
//main().catch((err) => console.error(err));
import compression from "compression";
import cookieParser from "cookie-parser";
import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import { Socket } from "net";
import path from 'path';
import randomAlphaNumeric from './utils/randomAlphaNumeric';

const app = express();

app.use(compression({ filter: shouldCompress }));

function shouldCompress(req: express.Request, res: express.Response) {
   if (req.headers['x-no-compression'])
      // don't compress responses with this request header
      return false;

   // fallback to standard filter function
   return compression.filter(req, res);
}

// load the cookie-parsing middleware
app.use(cookieParser(process.env.COOKIE_SECRET));

// Serve static files
app.use('/static', express.static(path.join(__dirname, 'static'), {
   index: false,
   etag: true,
   maxAge: '1d',
   redirect: false,
   setHeaders: function (res, path, stat) {
      res.setHeader('x-timestamp', Date.now());
   },
}));

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

app.post("/:page", async (req: Request, res: Response) => {
   let answer: string = "";
   let session = req.body?.session ?? randomAlphaNumeric;
   try {
      answer = await askQuestionWithFunctions(session, req.params.page, req.body?.question);
   } catch (error) {
      res.status(500).send("Error: " + error);
   }
   res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({answer, session}));
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