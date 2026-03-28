/*
TRACE: Provides very detailed information, more fine-grained than DEBUG. It is useful for tracing the flow of the application.
DEBUG: Used for fine-grained informational events that are most useful to debug an application.
INFO: Logs informational messages that highlight the progress of the application at a coarse-grained level.
WARN: Indicates potentially harmful situations that might not stop the application but should be looked into.
ERROR: Logs error events that might still allow the application to continue running.
*/

import winston from 'winston';

export interface Logger {
   trace: (message: any) => void;
   debug: (message: any) => void;
   info: (message: any) => void;
   warn: (message: any) => void;
   error(message?: any, ...optionalParams: any[]): void;
}

export class ConsoleLogger implements Logger {

   createLogMessage(message: any) {
      return {
         time: new Date().toISOString(),
         message: message
      };
   }

   trace(message: any) {
      console.trace(this.createLogMessage(message));
   }
   debug(message: any) {
      console.debug(this.createLogMessage(message));
   }
   info(message: any) {
      console.info(this.createLogMessage(message));
   }
   warn(message: any) {
      console.warn(this.createLogMessage(message));
   }
   error(message?: any, ...optionalParams: any[]) {
      console.error(this.createLogMessage(message), ...optionalParams);
   }
}

// Winston level mapping: our 'trace' → Winston's 'silly' (lowest level)
// process.env is read directly to avoid circular import (config.ts imports Logger)
export class WinstonLogger implements Logger {
   private w: winston.Logger;

   constructor() {
      this.w = winston.createLogger({
         level: process.env.LOG_LEVEL ?? 'info',
         format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
         ),
         transports: [
            new winston.transports.File({
               filename: process.env.LOG_FILE ?? 'logs/app.log',
               maxsize: 10 * 1024 * 1024, // rotate at 10 MB
               maxFiles: 5,               // keep 5 rotated files
               tailable: true,            // newest log always in logs/app.log
            }),
         ],
      });
   }

   trace(message: any)  { this.w.silly(String(message)); }
   debug(message: any)  { this.w.debug(String(message)); }
   info(message: any)   { this.w.info(String(message)); }
   warn(message: any)   { this.w.warn(String(message)); }
   error(message?: any, ...optionalParams: any[]) {
      const serialized = optionalParams.map(p =>
         p instanceof Error ? { message: p.message, stack: p.stack, name: p.name } : p
      );
      this.w.error(String(message), serialized.length ? { params: serialized } : {});
   }
}

// Detect if we're running in an MCP server context
const isMcpServer = () => {
   const scriptName = process.argv[1];
   return scriptName && (scriptName.includes('/mcp/server/') || scriptName.includes('\\mcp\\server\\'));
};

const Logger: Logger = (() => {
   if (process.env.NODE_ENV === 'production' || isMcpServer()) {
      // WinstonLogger writes only to a file — safe for MCP stdio + production
      return new WinstonLogger();
   } else {
      return new ConsoleLogger();
   }
})();

export default Logger;
