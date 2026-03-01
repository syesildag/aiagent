/*
TRACE: Provides very detailed information, more fine-grained than DEBUG. It is useful for tracing the flow of the application.
DEBUG: Used for fine-grained informational events that are most useful to debug an application.
INFO: Logs informational messages that highlight the progress of the application at a coarse-grained level.
WARN: Indicates potentially harmful situations that might not stop the application but should be looked into.
ERROR: Logs error events that might still allow the application to continue running.
*/

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

export class FileLogger implements Logger {
   private logFile: string;

   constructor(logFile: string = process.env.MCP_LOG_FILE ?? '') {
      this.logFile = logFile;
   }

   createLogMessage(message: any) {
      return {
         time: new Date().toISOString(),
         message: message
      };
   }

   private writeToFile(level: string, message: any, ...optionalParams: any[]) {
      if (!this.logFile) return;
      const fs = require('fs');
      const logEntry = `[${level}] ${JSON.stringify(this.createLogMessage(message))}\n`;
      fs.appendFileSync(this.logFile, logEntry);
      if (optionalParams.length > 0) {
         fs.appendFileSync(this.logFile, `Additional params: ${JSON.stringify(optionalParams)}\n`);
      }
   }

   trace(message: any) {
      this.writeToFile('TRACE', message);
   }
   debug(message: any) {
      this.writeToFile('DEBUG', message);
   }
   info(message: any) {
      this.writeToFile('INFO', message);
   }
   warn(message: any) {
      this.writeToFile('WARN', message);
   }
   error(message?: any, ...optionalParams: any[]) {
      this.writeToFile('ERROR', message, ...optionalParams);
   }
}

export class DummyLogger implements Logger {
   trace(_message: any) {
      // do nothing
   }
   debug(_message: any) {
      // do nothing
   }
   info(_message: any) {
      // do nothing
   }
   warn(_message: any) {
      // do nothing
   }
   error(_message?: any, ...optionalParams: any[]) {
      // do nothing
   }
}

// Detect if we're running in an MCP server context
const isMcpServer = () => {
   // Check if the current script is an MCP server
   const scriptName = process.argv[1];
   return scriptName && (scriptName.includes('/mcp/server/') || scriptName.includes('\\mcp\\server\\'));
};

const Logger: Logger = (() => {
   if (process.env.NODE_ENV === 'production') {
      return new DummyLogger();
   } else if (isMcpServer()) {
      // Use FileLogger for MCP servers to avoid stdio conflicts
      return new FileLogger();
   } else {
      return new ConsoleLogger();
   }
})();

export default Logger;