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
   error: (message: any) => void;
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
   error(message: any) {
      console.error(this.createLogMessage(message));
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
   error(_message: any) {
      // do nothing
   }
}

const Logger: Logger = process.env.NODE_ENV === 'production' ? new DummyLogger() : new ConsoleLogger();

export default Logger;