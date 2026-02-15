import { Auth } from './auth';
import * as envManager from './envManager';
import Logger from './logger';

// Mock the envManager module
jest.mock('./envManager', () => ({
  updateEnvVariable: jest.fn(),
  readEnvVariable: jest.fn(),
}));

// Mock Logger
jest.mock('./logger', () => ({
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));

describe('Auth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear environment variables between tests
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('AUTH_')) {
        delete process.env[key];
      }
    });
  });

  describe('getEnvKey', () => {
    it('should generate correct environment variable names', async () => {
      // Test via the public interface
      const oauthInfo = {
        type: 'oauth' as const,
        refresh: 'refresh-token',
        access: 'access-token',
        expires: Date.now() + 3600000,
      };

      await Auth.set('github-copilot', oauthInfo);
      
      expect(envManager.updateEnvVariable).toHaveBeenCalledWith(
        'AUTH_GITHUB_COPILOT',
        expect.any(String)
      );
    });

    it('should handle service names with special characters', async () => {
      const apiKeyInfo = {
        type: 'apikey' as const,
        key: 'test-key-123',
      };

      await Auth.set('my-service@v1.0', apiKeyInfo);
      
      expect(envManager.updateEnvVariable).toHaveBeenCalledWith(
        'AUTH_MY_SERVICE_V1_0',
        expect.any(String)
      );
    });
  });

  describe('set', () => {
    it('should store OAuth authentication information', async () => {
      const oauthInfo = {
        type: 'oauth' as const,
        refresh: 'refresh-token',
        access: 'access-token',
        expires: Date.now() + 3600000,
      };

      await Auth.set('github-copilot', oauthInfo);

      expect(envManager.updateEnvVariable).toHaveBeenCalledWith(
        'AUTH_GITHUB_COPILOT',
        JSON.stringify(oauthInfo)
      );
      expect(Logger.debug).toHaveBeenCalledWith(
        'Stored auth info for service: github-copilot in environment variable: AUTH_GITHUB_COPILOT'
      );
    });

    it('should store API key authentication information', async () => {
      const apiKeyInfo = {
        type: 'apikey' as const,
        key: 'sk-1234567890',
      };

      await Auth.set('openai', apiKeyInfo);

      expect(envManager.updateEnvVariable).toHaveBeenCalledWith(
        'AUTH_OPENAI',
        JSON.stringify(apiKeyInfo)
      );
      expect(Logger.debug).toHaveBeenCalledWith(
        'Stored auth info for service: openai in environment variable: AUTH_OPENAI'
      );
    });
  });

  describe('get', () => {
    it('should retrieve OAuth authentication information from envManager', async () => {
      const oauthInfo = {
        type: 'oauth' as const,
        refresh: 'refresh-token',
        access: 'access-token',
        expires: Date.now() + 3600000,
      };

      (envManager.readEnvVariable as jest.Mock).mockReturnValue(
        JSON.stringify(oauthInfo)
      );

      const result = await Auth.get('github-copilot');

      expect(result).toEqual(oauthInfo);
      expect(envManager.readEnvVariable).toHaveBeenCalledWith('AUTH_GITHUB_COPILOT');
    });

    it('should retrieve API key authentication information', async () => {
      const apiKeyInfo = {
        type: 'apikey' as const,
        key: 'sk-1234567890',
      };

      (envManager.readEnvVariable as jest.Mock).mockReturnValue(
        JSON.stringify(apiKeyInfo)
      );

      const result = await Auth.get('openai');

      expect(result).toEqual(apiKeyInfo);
    });

    it('should return undefined if no auth info exists', async () => {
      (envManager.readEnvVariable as jest.Mock).mockReturnValue(null);

      const result = await Auth.get('nonexistent');

      expect(result).toBeUndefined();
    });

    it('should fall back to process.env if envManager returns null', async () => {
      const apiKeyInfo = {
        type: 'apikey' as const,
        key: 'test-key',
      };

      (envManager.readEnvVariable as jest.Mock).mockReturnValue(null);
      process.env.AUTH_TESTSERVICE = JSON.stringify(apiKeyInfo);

      const result = await Auth.get('testservice');

      expect(result).toEqual(apiKeyInfo);
    });

    it('should handle invalid JSON gracefully', async () => {
      (envManager.readEnvVariable as jest.Mock).mockReturnValue('invalid-json{');

      const result = await Auth.get('broken-service');

      expect(result).toBeUndefined();
      expect(Logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse auth data for service broken-service')
      );
    });

    it('should handle empty string', async () => {
      (envManager.readEnvVariable as jest.Mock).mockReturnValue('');

      const result = await Auth.get('empty-service');

      expect(result).toBeUndefined();
    });
  });

  describe('remove', () => {
    it('should remove authentication information', async () => {
      await Auth.remove('github-copilot');

      expect(envManager.updateEnvVariable).toHaveBeenCalledWith(
        'AUTH_GITHUB_COPILOT',
        ''
      );
      expect(Logger.debug).toHaveBeenCalledWith(
        'Removed auth info for service: github-copilot from environment variable: AUTH_GITHUB_COPILOT'
      );
    });

    it('should remove from process.env', async () => {
      process.env.AUTH_TESTSERVICE = 'test-value';

      await Auth.remove('testservice');

      expect(process.env.AUTH_TESTSERVICE).toBeUndefined();
    });

    it('should handle removing non-existent auth info', async () => {
      await Auth.remove('nonexistent-service');

      expect(envManager.updateEnvVariable).toHaveBeenCalledWith(
        'AUTH_NONEXISTENT_SERVICE',
        ''
      );
    });
  });

  describe('Integration tests', () => {
    it('should store and retrieve OAuth info correctly', async () => {
      const oauthInfo = {
        type: 'oauth' as const,
        refresh: 'refresh-token-123',
        access: 'access-token-456',
        expires: 1234567890,
      };

      // Mock envManager to simulate real behavior
      let storedValue: string | null = null;
      (envManager.updateEnvVariable as jest.Mock).mockImplementation((key, value) => {
        storedValue = value;
      });
      (envManager.readEnvVariable as jest.Mock).mockImplementation(() => storedValue);

      await Auth.set('test-oauth', oauthInfo);
      const retrieved = await Auth.get('test-oauth');

      expect(retrieved).toEqual(oauthInfo);
    });

    it('should store and retrieve API key info correctly', async () => {
      const apiKeyInfo = {
        type: 'apikey' as const,
        key: 'sk-test-key-789',
      };

      // Mock envManager to simulate real behavior
      let storedValue: string | null = null;
      (envManager.updateEnvVariable as jest.Mock).mockImplementation((key, value) => {
        storedValue = value;
      });
      (envManager.readEnvVariable as jest.Mock).mockImplementation(() => storedValue);

      await Auth.set('test-apikey', apiKeyInfo);
      const retrieved = await Auth.get('test-apikey');

      expect(retrieved).toEqual(apiKeyInfo);
    });

    it('should properly remove auth after storing', async () => {
      const apiKeyInfo = {
        type: 'apikey' as const,
        key: 'test-key',
      };

      // Mock envManager to simulate real behavior
      let storedValue: string | null = null;
      (envManager.updateEnvVariable as jest.Mock).mockImplementation((key, value) => {
        storedValue = value;
      });
      (envManager.readEnvVariable as jest.Mock).mockImplementation(() => storedValue);

      await Auth.set('test-service', apiKeyInfo);
      await Auth.remove('test-service');
      
      // After removal, readEnvVariable should return empty string
      (envManager.readEnvVariable as jest.Mock).mockReturnValue('');
      const retrieved = await Auth.get('test-service');

      expect(retrieved).toBeUndefined();
    });
  });
});
