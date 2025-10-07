// Mock modules
const mockPoolInstance = {
  connect: jest.fn(),
  end: jest.fn(),
  on: jest.fn()
};

const mockClient = {
  query: jest.fn(),
  release: jest.fn()
};

jest.mock('./config', () => ({
  config: {
    DB_USER: 'test',
    DB_HOST: 'localhost',
    DB_NAME: 'test',
    DB_PASSWORD: 'test',
    DB_PORT: 5432,
    DB_POOL_MAX: 20,
    DB_POOL_IDLE_TIMEOUT_MS: 30000,
    DB_POOL_CONNECTION_TIMEOUT_MS: 2000,
  }
}));

jest.mock('./logger', () => {
  const mockLogger = {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    trace: jest.fn()
  };
  return {
    default: mockLogger,
    __esModule: true
  };
});

jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPoolInstance)
}));

// Reset mocks and setup default behavior
beforeEach(() => {
  jest.clearAllMocks();
  mockPoolInstance.connect.mockResolvedValue(mockClient);
  mockPoolInstance.end.mockResolvedValue(undefined);
});

import { queryDatabase, closeDatabase } from './pgClient';

describe('pgClient', () => {
  describe('queryDatabase', () => {
    test('should execute query and return rows', async () => {
      const mockResult = { rows: [{ id: 1, name: 'test' }] };
      mockClient.query.mockResolvedValue(mockResult);

      const result = await queryDatabase('SELECT * FROM test', []);

      expect(mockPoolInstance.connect).toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith('SELECT * FROM test', []);
      expect(mockClient.release).toHaveBeenCalled();
      expect(result).toEqual(mockResult.rows);
    });

    test('should handle query errors', async () => {
      const error = new Error('Database connection failed');
      mockClient.query.mockRejectedValue(error);

      await expect(queryDatabase('SELECT * FROM test')).rejects.toThrow(error);
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('closeDatabase', () => {
    test('should close database pool', async () => {
      const result = await closeDatabase();
      expect(mockPoolInstance.end).toHaveBeenCalled();
      expect(result).toBeUndefined();
    });
  });
});