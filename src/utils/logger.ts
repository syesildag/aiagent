/*
TRACE: Provides very detailed information, more fine-grained than DEBUG. It is useful for tracing the flow of the application.
DEBUG: Used for fine-grained informational events that are most useful to debug an application.
INFO: Logs informational messages that highlight the progress of the application at a coarse-grained level.
WARN: Indicates potentially harmful situations that might not stop the application but should be looked into.
ERROR: Logs error events that might still allow the application to continue running.
*/

import { isProduction } from "./environment";

export interface Logger {
   trace: (message: string) => void;
   debug: (message: string) => void;
   info: (message: string) => void;
   warn: (message: string) => void;
   error: (message: string) => void;
}

//create class ConsoleLogger which implements Logger interface
export class ConsoleLogger implements Logger {

   createLogMessage(message: string) {
      return {
         time: new Date().toISOString(),
         message: message
      };
   }

   //create a method trace which logs
   trace(message: string) {
      console.trace(this.createLogMessage(message));
   }
   //create a method debug which logs
   debug(message: string) {
      console.debug(this.createLogMessage(message));
   }
   //create a method info which logs
   info(message: string) {
      console.info(this.createLogMessage(message));
   }
   //create a method warn which logs
   warn(message: string) {
      console.warn(this.createLogMessage(message));
   }
   //create a method error which logs
   error(message: string) {
      console.error(this.createLogMessage(message));
   }
}

//create class DummyLogger which implements Logger interface
export class DummyLogger implements Logger {
   //create a method trace which logs
   trace(message: string) {
      //do nothing
   }
   //create a method debug which logs
   debug(message: string) {
      //do nothing
   }
   //create a method info which logs
   info(message: string) {
      //do nothing
   }
   //create a method warn which logs
   warn(message: string) {
      //do nothing
   }
   //create a method error which logs
   error(message: string) {
      //do nothing
   }
}

const Logger: Logger = isProduction() ? new DummyLogger : new ConsoleLogger();

export default Logger;