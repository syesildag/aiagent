/*
TRACE: Provides very detailed information, more fine-grained than DEBUG. It is useful for tracing the flow of the application.
DEBUG: Used for fine-grained informational events that are most useful to debug an application.
INFO: Logs informational messages that highlight the progress of the application at a coarse-grained level.
WARN: Indicates potentially harmful situations that might not stop the application but should be looked into.
ERROR: Logs error events that might still allow the application to continue running.
*/

import { isProduction } from "./environment";

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

   //create a method trace which logs
   trace(message: any) {
      console.trace(this.createLogMessage(message));
   }
   //create a method debug which logs
   debug(message: any) {
      console.debug(this.createLogMessage(message));
   }
   //create a method info which logs
   info(message: any) {
      console.info(this.createLogMessage(message));
   }
   //create a method warn which logs
   warn(message: any) {
      console.warn(this.createLogMessage(message));
   }
   //create a method error which logs
   error(message: any) {
      console.error(this.createLogMessage(message));
   }
}

export class DummyLogger implements Logger {
   //create a method trace which logs
   trace(message: any) {
      //do nothing
   }
   //create a method debug which logs
   debug(message: any) {
      //do nothing
   }
   //create a method info which logs
   info(message: any) {
      //do nothing
   }
   //create a method warn which logs
   warn(message: any) {
      //do nothing
   }
   //create a method error which logs
   error(message: any) {
      //do nothing
   }
}

const Logger: Logger = isProduction() ? new DummyLogger : new ConsoleLogger();

export default Logger;