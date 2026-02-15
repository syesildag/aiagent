import { createLLMProvider, getLLMModel } from './llmFactory';
import { OllamaProvider, OpenAIProvider, GitHubCopilotProvider } from './llmProviders';
import { config } from '../utils/config';
import Logger from '../utils/logger';
import { AuthGithubCopilot } from '../utils/githubAuth';

// Mock dependencies
jest.mock('./llmProviders');
jest.mock('../utils/config');
jest.mock('../utils/logger');
jest.mock('../utils/githubAuth');

const mockConfig = config as jest.Mocked<typeof config>;
const mockAuthGithubCopilot = AuthGithubCopilot as jest.Mocked<typeof AuthGithubCopilot>;

describe('LLM Factory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set default config values
    mockConfig.LLM_PROVIDER = 'ollama';
    mockConfig.LLM_MODEL = 'llama2';
    mockConfig.OLLAMA_HOST = 'http://localhost:11434';
    mockConfig.OPENAI_API_KEY = '';
    mockConfig.OPENAI_BASE_URL = 'https://api.openai.com/v1';
    mockConfig.GITHUB_COPILOT_BASE_URL = 'https://api.githubcopilot.com';
  });

  describe('createLLMProvider', () => {
    describe('Ollama provider', () => {
      it('should create OllamaProvider when LLM_PROVIDER is ollama', async () => {
        mockConfig.LLM_PROVIDER = 'ollama';
        mockConfig.OLLAMA_HOST = 'http://localhost:11434';

        await createLLMProvider();

        expect(OllamaProvider).toHaveBeenCalledWith('http://localhost:11434');
        expect(Logger.info).toHaveBeenCalledWith('Creating Ollama provider');
      });

      it('should create OllamaProvider by default when provider is not specified', async () => {
        mockConfig.LLM_PROVIDER = '' as any;

        await createLLMProvider();

        expect(OllamaProvider).toHaveBeenCalledWith(mockConfig.OLLAMA_HOST);
        expect(Logger.info).toHaveBeenCalledWith('Creating Ollama provider');
      });

      it('should create OllamaProvider for unknown provider types', async () => {
        mockConfig.LLM_PROVIDER = 'unknown-provider' as any;

        await createLLMProvider();

        expect(OllamaProvider).toHaveBeenCalledWith(mockConfig.OLLAMA_HOST);
        expect(Logger.info).toHaveBeenCalledWith('Creating Ollama provider');
      });

      it('should use custom OLLAMA_HOST if configured', async () => {
        mockConfig.LLM_PROVIDER = 'ollama';
        mockConfig.OLLAMA_HOST = 'http://custom-host:11434';

        await createLLMProvider();

        expect(OllamaProvider).toHaveBeenCalledWith('http://custom-host:11434');
      });
    });

    describe('OpenAI provider', () => {
      it('should create OpenAIProvider when LLM_PROVIDER is openai', async () => {
        mockConfig.LLM_PROVIDER = 'openai';
        mockConfig.OPENAI_API_KEY = 'sk-test-key-123';
        mockConfig.OPENAI_BASE_URL = 'https://api.openai.com/v1';

        await createLLMProvider();

        expect(OpenAIProvider).toHaveBeenCalledWith(
          'sk-test-key-123',
          'https://api.openai.com/v1'
        );
        expect(Logger.info).toHaveBeenCalledWith('Creating OpenAI provider');
      });

      it('should throw error when OPENAI_API_KEY is not set', async () => {
        mockConfig.LLM_PROVIDER = 'openai';
        mockConfig.OPENAI_API_KEY = '';

        await expect(createLLMProvider()).rejects.toThrow(
          'OpenAI API key is required when LLM_PROVIDER is set to openai'
        );
      });

      it('should use custom OPENAI_BASE_URL if configured', async () => {
        mockConfig.LLM_PROVIDER = 'openai';
        mockConfig.OPENAI_API_KEY = 'sk-test-key';
        mockConfig.OPENAI_BASE_URL = 'https://custom.openai.com/v1';

        await createLLMProvider();

        expect(OpenAIProvider).toHaveBeenCalledWith(
          'sk-test-key',
          'https://custom.openai.com/v1'
        );
      });
    });

    describe('GitHub Copilot provider', () => {
      it('should create GitHubCopilotProvider when LLM_PROVIDER is github', async () => {
        mockConfig.LLM_PROVIDER = 'github';
        mockConfig.GITHUB_COPILOT_BASE_URL = 'https://api.githubcopilot.com';
        
        mockAuthGithubCopilot.access = jest.fn().mockResolvedValue('test-copilot-token');

        await createLLMProvider();

        expect(mockAuthGithubCopilot.access).toHaveBeenCalled();
        expect(GitHubCopilotProvider).toHaveBeenCalledWith(
          'test-copilot-token',
          'https://api.githubcopilot.com'
        );
        expect(Logger.info).toHaveBeenCalledWith('Creating GitHub Copilot provider with OAuth authentication');
      });

      it('should throw error when OAuth authentication fails', async () => {
        mockConfig.LLM_PROVIDER = 'github';
        mockAuthGithubCopilot.access = jest.fn().mockResolvedValue(null);

        await expect(createLLMProvider()).rejects.toThrow(
          'GitHub OAuth authentication failed. Please run "login" command to authenticate.'
        );
      });

      it('should throw error when OAuth access returns undefined', async () => {
        mockConfig.LLM_PROVIDER = 'github';
        mockAuthGithubCopilot.access = jest.fn().mockResolvedValue(undefined);

        await expect(createLLMProvider()).rejects.toThrow(
          'GitHub OAuth authentication failed. Please run "login" command to authenticate.'
        );
      });

      it('should use custom GITHUB_COPILOT_BASE_URL if configured', async () => {
        mockConfig.LLM_PROVIDER = 'github';
        mockConfig.GITHUB_COPILOT_BASE_URL = 'https://custom.githubcopilot.com';
        mockAuthGithubCopilot.access = jest.fn().mockResolvedValue('test-token');

        await createLLMProvider();

        expect(GitHubCopilotProvider).toHaveBeenCalledWith(
          'test-token',
          'https://custom.githubcopilot.com'
        );
      });

      it('should handle OAuth token refresh', async () => {
        mockConfig.LLM_PROVIDER = 'github';
        mockAuthGithubCopilot.access = jest.fn()
          .mockResolvedValueOnce('first-token')
          .mockResolvedValueOnce('refreshed-token');

        await createLLMProvider();
        
        expect(GitHubCopilotProvider).toHaveBeenCalledWith(
          'first-token',
          expect.any(String)
        );

        // Create another provider (simulating token refresh)
        jest.clearAllMocks();
        await createLLMProvider();

        expect(GitHubCopilotProvider).toHaveBeenCalledWith(
          'refreshed-token',
          expect.any(String)
        );
      });
    });

    describe('Error handling', () => {
      it('should propagate errors from OllamaProvider constructor', async () => {
        mockConfig.LLM_PROVIDER = 'ollama';
        (OllamaProvider as jest.Mock).mockImplementationOnce(() => {
          throw new Error('Ollama connection failed');
        });

        await expect(createLLMProvider()).rejects.toThrow('Ollama connection failed');
      });

      it('should propagate errors from OpenAIProvider constructor', async () => {
        mockConfig.LLM_PROVIDER = 'openai';
        mockConfig.OPENAI_API_KEY = 'sk-test';
        (OpenAIProvider as jest.Mock).mockImplementationOnce(() => {
          throw new Error('OpenAI initialization failed');
        });

        await expect(createLLMProvider()).rejects.toThrow('OpenAI initialization failed');
      });

      it('should handle OAuth access errors', async () => {
        mockConfig.LLM_PROVIDER = 'github';
        mockAuthGithubCopilot.access = jest.fn().mockRejectedValue(
          new Error('OAuth authentication error')
        );

        await expect(createLLMProvider()).rejects.toThrow('OAuth authentication error');
      });
    });
  });

  describe('getLLMModel', () => {
    it('should return the configured LLM model', () => {
      mockConfig.LLM_MODEL = 'llama2';

      const model = getLLMModel();

      expect(model).toBe('llama2');
    });

    it('should return different model when configuration changes', () => {
      mockConfig.LLM_MODEL = 'gpt-4';
      expect(getLLMModel()).toBe('gpt-4');

      mockConfig.LLM_MODEL = 'claude-3';
      expect(getLLMModel()).toBe('claude-3');

      mockConfig.LLM_MODEL = 'mixtral';
      expect(getLLMModel()).toBe('mixtral');
    });

    it('should handle empty model string', () => {
      mockConfig.LLM_MODEL = '';

      const model = getLLMModel();

      expect(model).toBe('');
    });
  });

  describe('Integration scenarios', () => {
    it('should create appropriate provider based on environment configuration', async () => {
      // Scenario 1: Development with Ollama
      mockConfig.LLM_PROVIDER = 'ollama';
      mockConfig.OLLAMA_HOST = 'http://localhost:11434';
      
      await createLLMProvider();
      expect(OllamaProvider).toHaveBeenCalledTimes(1);

      jest.clearAllMocks();

      // Scenario 2: Production with OpenAI
      mockConfig.LLM_PROVIDER = 'openai';
      mockConfig.OPENAI_API_KEY = 'sk-prod-key';
      
      await createLLMProvider();
      expect(OpenAIProvider).toHaveBeenCalledTimes(1);

      jest.clearAllMocks();

      // Scenario 3: Using GitHub Copilot
      mockConfig.LLM_PROVIDER = 'github';
      mockAuthGithubCopilot.access = jest.fn().mockResolvedValue('copilot-token');
      
      await createLLMProvider();
      expect(GitHubCopilotProvider).toHaveBeenCalledTimes(1);
    });

    it('should handle provider switching at runtime', async () => {
      // Start with Ollama
      mockConfig.LLM_PROVIDER = 'ollama';
      await createLLMProvider();
      expect(OllamaProvider).toHaveBeenCalledTimes(1);

      jest.clearAllMocks();

      // Switch to OpenAI
      mockConfig.LLM_PROVIDER = 'openai';
      mockConfig.OPENAI_API_KEY = 'sk-key';
      await createLLMProvider();
      expect(OpenAIProvider).toHaveBeenCalledTimes(1);
      expect(OllamaProvider).not.toHaveBeenCalled();
    });
  });
});
