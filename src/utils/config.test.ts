// Mock environment before importing config
const mockConfig = {
  NODE_ENV: 'test',
  PORT: 3000,
  HOST: 'localhost',
  SERVER_TERMINATE_TIMEOUT: 5000,
  DB_USER: 'test',
  DB_HOST: 'localhost',
  DB_NAME: 'test',
  DB_PASSWORD: 'test',
  DB_PORT: 5432,
  OLLAMA_MODEL: 'test',
  OLLAMA_HOST: 'http://localhost:11434',
};

jest.mock('./config', () => ({
  config: mockConfig,
  isProduction: jest.fn(() => false),
  isDevelopment: jest.fn(() => false),
  isTest: jest.fn(() => true),
}));

import { isProduction, isDevelopment, isTest } from './config';

describe('Config Module', () => {
  describe('Environment helpers', () => {
    test('isProduction returns true for production environment', () => {
      (isProduction as jest.Mock).mockReturnValue(true);
      (isDevelopment as jest.Mock).mockReturnValue(false);
      (isTest as jest.Mock).mockReturnValue(false);
      
      expect(isProduction()).toBe(true);
      expect(isDevelopment()).toBe(false);
      expect(isTest()).toBe(false);
    });

    test('isDevelopment returns true for development environment', () => {
      (isProduction as jest.Mock).mockReturnValue(false);
      (isDevelopment as jest.Mock).mockReturnValue(true);
      (isTest as jest.Mock).mockReturnValue(false);
      
      expect(isDevelopment()).toBe(true);
      expect(isProduction()).toBe(false);
      expect(isTest()).toBe(false);
    });

    test('isTest returns true for test environment', () => {
      (isProduction as jest.Mock).mockReturnValue(false);
      (isDevelopment as jest.Mock).mockReturnValue(false);
      (isTest as jest.Mock).mockReturnValue(true);
      
      expect(isTest()).toBe(true);
      expect(isProduction()).toBe(false);
      expect(isDevelopment()).toBe(false);
    });
  });
});