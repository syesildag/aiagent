import { ConsoleLogger, WinstonLogger } from './logger';
import * as fs from 'fs';
import * as path from 'path';

describe('Logger', () => {
   describe('ConsoleLogger', () => {
      let logger: ConsoleLogger;
      let consoleSpies: any;

      beforeEach(() => {
         logger = new ConsoleLogger();
         consoleSpies = {
            trace: jest.spyOn(console, 'trace').mockImplementation(),
            debug: jest.spyOn(console, 'debug').mockImplementation(),
            info: jest.spyOn(console, 'info').mockImplementation(),
            warn: jest.spyOn(console, 'warn').mockImplementation(),
            error: jest.spyOn(console, 'error').mockImplementation(),
         };
      });

      afterEach(() => {
         Object.values(consoleSpies).forEach((spy: any) => spy.mockRestore());
      });

      test('should log trace messages with timestamp', () => {
         const message = 'test trace message';
         logger.trace(message);

         expect(consoleSpies.trace).toHaveBeenCalledWith(
            expect.objectContaining({
               time: expect.any(String),
               message: message
            })
         );
      });

      test('should log error messages with timestamp', () => {
         const message = 'test error message';
         logger.error(message);

         expect(consoleSpies.error).toHaveBeenCalledWith(
            expect.objectContaining({
               time: expect.any(String),
               message: message
            })
         );
      });
   });

   describe('WinstonLogger', () => {
      const testLogFile = path.join('logs', 'test-logger.log');

      beforeEach(() => {
         process.env.LOG_FILE = testLogFile;
         process.env.LOG_LEVEL = 'silly';
      });

      afterEach(() => {
         delete process.env.LOG_FILE;
         delete process.env.LOG_LEVEL;
         if (fs.existsSync(testLogFile)) {
            fs.unlinkSync(testLogFile);
         }
      });

      test('should not throw when calling all log methods', () => {
         const logger = new WinstonLogger();
         expect(() => logger.trace('trace msg')).not.toThrow();
         expect(() => logger.debug('debug msg')).not.toThrow();
         expect(() => logger.info('info msg')).not.toThrow();
         expect(() => logger.warn('warn msg')).not.toThrow();
         expect(() => logger.error('error msg')).not.toThrow();
      });
   });
});
