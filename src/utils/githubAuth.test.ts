import { AuthGithubCopilot, requestDeviceCode, pollForToken, authenticateWithGitHub, getGitHubUser, whoami, getBestGitHubToken } from './githubAuth';
import { Auth } from './auth';
import Logger from './logger';

// Mock dependencies
jest.mock('./auth');
jest.mock('./logger');
jest.mock('./config', () => ({
  config: {
    GITHUB_COPILOT_CLIENT_ID: 'test-client-id',
  },
}));

// Mock global fetch
global.fetch = jest.fn();

describe('AuthGithubCopilot', () => {
  const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('authorize', () => {
    it('should request device code successfully', async () => {
      const mockResponse = {
        device_code: 'device-123',
        user_code: 'USER-CODE',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as unknown as Response);

      const result = await AuthGithubCopilot.authorize();

      expect(result).toEqual({
        device: 'device-123',
        user: 'USER-CODE',
        verification: 'https://github.com/login/device',
        interval: 5,
        expiry: 900,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://github.com/login/device/code',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            client_id: 'test-client-id',
            scope: 'read:user',
          }),
        })
      );
    });

    it('should use default interval if not provided', async () => {
      const mockResponse = {
        device_code: 'device-123',
        user_code: 'USER-CODE',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as unknown as Response);

      const result = await AuthGithubCopilot.authorize();

      expect(result.interval).toBe(5);
    });
  });

  describe('poll', () => {
    it('should return "complete" when access token is received', async () => {
      const mockResponse = {
        access_token: 'gho_token123',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as unknown as Response);

      const result = await AuthGithubCopilot.poll('device-code-123');

      expect(result).toBe('complete');
      expect(Auth.set).toHaveBeenCalledWith('github-copilot', {
        type: 'oauth',
        refresh: 'gho_token123',
        access: '',
        expires: 0,
      });
    });

    it('should return "pending" when authorization is pending', async () => {
      const mockResponse = {
        error: 'authorization_pending',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as unknown as Response);

      const result = await AuthGithubCopilot.poll('device-code-123');

      expect(result).toBe('pending');
      expect(Auth.set).not.toHaveBeenCalled();
    });

    it('should return "failed" when error occurs', async () => {
      const mockResponse = {
        error: 'access_denied',
        error_description: 'User denied access',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as unknown as Response);

      const result = await AuthGithubCopilot.poll('device-code-123');

      expect(result).toBe('failed');
    });

    it('should return "failed" when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
      } as unknown as Response);

      const result = await AuthGithubCopilot.poll('device-code-123');

      expect(result).toBe('failed');
    });
  });

  describe('access', () => {
    it('should return cached token if still valid', async () => {
      const futureTimestamp = Date.now() + 3600000;
      (Auth.get as jest.Mock).mockResolvedValue({
        type: 'oauth',
        refresh: 'refresh-token',
        access: 'cached-token',
        expires: futureTimestamp,
      });

      const token = await AuthGithubCopilot.access();

      expect(token).toBe('cached-token');
      expect(Logger.debug).toHaveBeenCalledWith('Using cached Copilot access token');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should refresh token if expired', async () => {
      const pastTimestamp = Date.now() - 1000;
      (Auth.get as jest.Mock).mockResolvedValue({
        type: 'oauth',
        refresh: 'refresh-token',
        access: 'expired-token',
        expires: pastTimestamp,
      });

      const mockTokenResponse = {
        token: 'new-copilot-token',
        expires_at: Math.floor((Date.now() + 3600000) / 1000),
        refresh_in: 3000,
        endpoints: {
          api: 'https://api.github.com',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokenResponse,
      } as unknown as Response);

      const token = await AuthGithubCopilot.access();

      expect(token).toBe('new-copilot-token');
      expect(Auth.set).toHaveBeenCalledWith('github-copilot', {
        type: 'oauth',
        refresh: 'refresh-token',
        access: 'new-copilot-token',
        expires: mockTokenResponse.expires_at * 1000,
      });
    });

    it('should return undefined if no auth info exists', async () => {
      (Auth.get as jest.Mock).mockResolvedValue(undefined);

      const token = await AuthGithubCopilot.access();

      expect(token).toBeUndefined();
      expect(Logger.debug).toHaveBeenCalledWith('No OAuth authentication stored. Please run \'login\' command.');
    });

    it('should clear auth and return null on refresh failure', async () => {
      const pastTimestamp = Date.now() - 1000;
      (Auth.get as jest.Mock).mockResolvedValue({
        type: 'oauth',
        refresh: 'invalid-refresh-token',
        access: '',
        expires: pastTimestamp,
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid token',
      } as unknown as Response);

      const result = await AuthGithubCopilot.access();
      
      expect(result).toBeNull();
      expect(Auth.remove).toHaveBeenCalledWith('github-copilot');
      expect(Logger.error).toHaveBeenCalled();
    });

    it('should handle JSON parsing errors', async () => {
      const pastTimestamp = Date.now() - 1000;
      (Auth.get as jest.Mock).mockResolvedValue({
        type: 'oauth',
        refresh: 'refresh-token',
        access: '',
        expires: pastTimestamp,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      } as unknown as Response);

      const result = await AuthGithubCopilot.access();
      
      expect(result).toBeNull();
      expect(Auth.remove).toHaveBeenCalledWith('github-copilot');
      expect(Logger.error).toHaveBeenCalled();
    });
  });
});

describe('Legacy API Functions', () => {
  const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('requestDeviceCode', () => {
    it('should return device code data', async () => {
      const mockResponse = {
        device_code: 'device-123',
        user_code: 'USER-CODE',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as unknown as Response);

      const result = await requestDeviceCode();

      expect(result).toEqual({
        device_code: 'device-123',
        user_code: 'USER-CODE',
        verification_uri: 'https://github.com/login/device',
        interval: 5,
        expires_in: 900,
      });
    });
  });

  describe('pollForToken', () => {
    it('should resolve with token on successful authentication', async () => {
      // Mock successful poll
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token-123' }),
      } as unknown as Response);

      const futureTimestamp = Date.now() + 3600000;
      (Auth.get as jest.Mock).mockResolvedValue({
        type: 'oauth',
        refresh: 'token-123',
        access: 'copilot-token',
        expires: futureTimestamp,
      });

      const result = await pollForToken('device-code', 1);

      expect(result).toBe('copilot-token');
    });

    it('should reject on authentication failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: 'access_denied' }),
      } as unknown as Response);

      await expect(pollForToken('device-code', 1)).rejects.toThrow('Authentication failed');
    });
  });

  describe('getGitHubUser', () => {
    it('should fetch and return user data', async () => {
      const mockUser = {
        login: 'testuser',
        id: 12345,
        name: 'Test User',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockUser,
      } as unknown as Response);

      const result = await getGitHubUser('token-123');

      expect(result).toEqual(mockUser);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/user',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token-123',
          }),
        })
      );
    });

    it('should handle unauthorized errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
      } as unknown as Response);

      await getGitHubUser('invalid-token');

      expect(Logger.error).toHaveBeenCalledWith('You are not authorized. Run the `login` command.');
    });
  });

  describe('whoami', () => {
    it('should return username if authenticated', async () => {
      (Auth.get as jest.Mock).mockResolvedValue({
        type: 'oauth',
        refresh: 'token-123',
        access: 'copilot-token',
        expires: Date.now() + 3600000,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: 'testuser' }),
      } as unknown as Response);

      const result = await whoami();

      expect(result).toBe('testuser');
    });

    it('should return undefined if no auth info', async () => {
      (Auth.get as jest.Mock).mockResolvedValue(undefined);

      const result = await whoami();

      expect(result).toBeUndefined();
    });

    it('should return undefined on error', async () => {
      (Auth.get as jest.Mock).mockResolvedValue({
        type: 'oauth',
        refresh: 'token-123',
        access: 'copilot-token',
        expires: Date.now() + 3600000,
      });

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await whoami();

      expect(result).toBeUndefined();
      // Logger.error is called inside the catch block
      expect(Logger.debug).toHaveBeenCalled();
    });
  });

  describe('getBestGitHubToken', () => {
    it('should return copilot token if available', async () => {
      const futureTimestamp = Date.now() + 3600000;
      (Auth.get as jest.Mock).mockResolvedValue({
        type: 'oauth',
        refresh: 'refresh-token',
        access: 'copilot-token',
        expires: futureTimestamp,
      });

      const result = await getBestGitHubToken();

      expect(result).toBe('copilot-token');
    });

    it('should return null if no token available', async () => {
      (Auth.get as jest.Mock).mockResolvedValue(undefined);

      const result = await getBestGitHubToken();

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      (Auth.get as jest.Mock).mockRejectedValue(new Error('Auth error'));

      const result = await getBestGitHubToken();

      expect(result).toBeNull();
    });
  });
});
