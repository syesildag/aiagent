import { ConsoleLogger, DummyLogger } from './logger';

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

   describe('DummyLogger', () => {
      let logger: DummyLogger;

      beforeEach(() => {
         logger = new DummyLogger();
      });

      test('should not throw when calling log methods', () => {
         expect(() => logger.trace('test')).not.toThrow();
         expect(() => logger.debug('test')).not.toThrow();
         expect(() => logger.info('test')).not.toThrow();
         expect(() => logger.warn('test')).not.toThrow();
         expect(() => logger.error('test')).not.toThrow();
      });
   });
});