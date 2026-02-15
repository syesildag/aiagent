import {
  getModelMaxTokens,
  handleTokenLimits,
  OllamaProvider,
  GitHubCopilotProvider,
  OpenAIProvider,
  LLMChatRequest,
  LLMMessage,
  Tool
} from './llmProviders';
import { AuthGithubCopilot } from '../utils/githubAuth';
import Logger from '../utils/logger';

// Mock dependencies
jest.mock('../utils/logger');
jest.mock('../utils/githubAuth');
jest.mock('ollama');

const mockAuthGithubCopilot = AuthGithubCopilot as jest.Mocked<typeof AuthGithubCopilot>;

// Mock fetch globally
global.fetch = jest.fn();

describe('LLM Providers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  describe('getModelMaxTokens', () => {
    describe('OpenAI models', () => {
      it('should return correct tokens for GPT-4 models', () => {
        expect(getModelMaxTokens('gpt-4o')).toBe(128000);
        expect(getModelMaxTokens('gpt-4o-mini')).toBe(128000);
        expect(getModelMaxTokens('gpt-4-turbo')).toBe(128000);
        expect(getModelMaxTokens('gpt-4-32k')).toBe(32768);
        expect(getModelMaxTokens('gpt-4')).toBe(8192);
      });

      it('should return correct tokens for GPT-3.5 models', () => {
        expect(getModelMaxTokens('gpt-3.5-turbo')).toBe(16385);
        expect(getModelMaxTokens('gpt-3.5-turbo-16k')).toBe(16385);
        expect(getModelMaxTokens('gpt-3.5-turbo-instruct')).toBe(4096);
      });

      it('should return correct tokens for o1 models', () => {
        expect(getModelMaxTokens('o1-preview')).toBe(128000);
        expect(getModelMaxTokens('o1-mini')).toBe(128000);
        expect(getModelMaxTokens('o3-mini')).toBe(128000);
      });
    });

    describe('Anthropic models', () => {
      it('should return correct tokens for Claude models', () => {
        expect(getModelMaxTokens('claude-3-opus')).toBe(200000);
        expect(getModelMaxTokens('claude-3-sonnet')).toBe(200000);
        expect(getModelMaxTokens('claude-3.5-sonnet')).toBe(200000);
        expect(getModelMaxTokens('claude-sonnet-4')).toBe(200000);
      });
    });

    describe('Google models', () => {
      it('should return correct tokens for Gemini models', () => {
        expect(getModelMaxTokens('gemini-1.5-pro')).toBe(1048576);
        expect(getModelMaxTokens('gemini-2.5-pro')).toBe(1048576);
        expect(getModelMaxTokens('gemini-pro')).toBe(32768);
      });
    });

    describe('Ollama models', () => {
      it('should return correct tokens for Llama models', () => {
        expect(getModelMaxTokens('llama3.2:3b')).toBe(131072);
        expect(getModelMaxTokens('llama3.1:8b')).toBe(131072);
        expect(getModelMaxTokens('llama3:8b')).toBe(8192);
        expect(getModelMaxTokens('llama2:7b')).toBe(4096);
      });

      it('should return correct tokens for Mistral models', () => {
        expect(getModelMaxTokens('mistral:7b')).toBe(32768);
        expect(getModelMaxTokens('mixtral:8x7b')).toBe(32768);
        expect(getModelMaxTokens('mixtral:8x22b')).toBe(65536);
      });

      it('should return correct tokens for Qwen models', () => {
        expect(getModelMaxTokens('qwen2.5:7b')).toBe(32768);
        expect(getModelMaxTokens('qwen2:72b')).toBe(32768);
      });
    });

    describe('Pattern matching', () => {
      it('should handle partial matches for GPT models', () => {
        // Note: 'gpt-4-custom-version' matches 'gpt-4' in partial match which returns 8192
        expect(getModelMaxTokens('gpt-4-custom-version')).toBe(8192);
        expect(getModelMaxTokens('gpt-3.5-custom')).toBe(16385);
      });

      it('should handle partial matches for Claude models', () => {
        expect(getModelMaxTokens('claude-custom-model')).toBe(200000);
      });

      it('should handle partial matches for Gemini models', () => {
        expect(getModelMaxTokens('gemini-1.5-custom')).toBe(1048576);
        expect(getModelMaxTokens('gemini-custom')).toBe(32768);
      });

      it('should handle partial matches for Llama models', () => {
        expect(getModelMaxTokens('llama3.1-custom')).toBe(131072);
        expect(getModelMaxTokens('llama3-custom')).toBe(8192);
        expect(getModelMaxTokens('llama2-custom')).toBe(4096);
      });
    });

    describe('Fallback behavior', () => {
      it('should return default 8192 for unknown models', () => {
        expect(getModelMaxTokens('unknown-model')).toBe(8192);
        expect(getModelMaxTokens('custom-model-v1')).toBe(8192);
      });

      it('should log warning for unknown models', () => {
        getModelMaxTokens('completely-unknown-model');
        expect(Logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Unknown model')
        );
      });
    });
  });

  describe('handleTokenLimits', () => {
    const createTestRequest = (messageCount: number): LLMChatRequest => ({
      model: 'gpt-4',
      messages: Array(messageCount).fill(null).map((_, i) => ({
        role: 'user' as const,
        content: 'A'.repeat(1000) // ~250 tokens per message
      }))
    });

    it('should return request unchanged when maxTokens is undefined', () => {
      const request = createTestRequest(10);
      const result = handleTokenLimits(request, undefined);
      expect(result).toEqual(request);
    });

    it('should handle requests within token budget', () => {
      const request = createTestRequest(5);
      const result = handleTokenLimits(request, 10000);
      expect(result.messages.length).toBeLessThanOrEqual(request.messages.length);
    });

    it('should include tools in token calculation', () => {
      const tools: Tool[] = [{
        type: 'function',
        function: {
          name: 'testTool',
          description: 'A test tool with a lot of description text that takes up tokens',
          parameters: {
            type: 'object',
            properties: {
              arg1: { type: 'string', description: 'Argument 1' },
              arg2: { type: 'number', description: 'Argument 2' }
            },
            required: ['arg1']
          }
        }
      }];

      const request: LLMChatRequest = {
        model: 'gpt-4',
        messages: createTestRequest(10).messages,
        tools
      };

      const result = handleTokenLimits(request, 5000);
      expect(result).toBeDefined();
      expect(result.tools).toEqual(tools);
    });

    it('should handle messages with tool_calls', () => {
      const request: LLMChatRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'Hello' },
          {
            role: 'assistant',
            content: 'Let me help',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: {
                name: 'testFunc',
                arguments: JSON.stringify({ arg: 'value' })
              }
            }]
          },
          { role: 'tool', content: 'Result', tool_call_id: 'call_1' }
        ]
      };

      const result = handleTokenLimits(request, 10000);
      expect(result.messages.length).toBeGreaterThan(0);
    });

    it('should handle empty messages array', () => {
      const request: LLMChatRequest = {
        model: 'gpt-4',
        messages: []
      };

      const result = handleTokenLimits(request, 1000);
      expect(result.messages).toEqual([]);
    });
  });

  describe('OllamaProvider', () => {
    let provider: OllamaProvider;
    let mockOllama: any;

    beforeEach(() => {
      // Mock the Ollama class
      const { Ollama } = require('ollama');
      mockOllama = {
        list: jest.fn(),
        chat: jest.fn()
      };
      (Ollama as jest.Mock).mockImplementation(() => mockOllama);
      
      provider = new OllamaProvider('http://localhost:11434');
    });

    describe('constructor', () => {
      it('should initialize with default baseUrl', () => {
        const defaultProvider = new OllamaProvider();
        expect(defaultProvider).toBeDefined();
        expect(defaultProvider.name).toBe('Ollama');
      });

      it('should initialize with custom baseUrl', () => {
        const customProvider = new OllamaProvider('http://custom:11434');
        expect(customProvider).toBeDefined();
      });
    });

    describe('checkHealth', () => {
      it('should return true when Ollama is available', async () => {
        mockOllama.list.mockResolvedValue({ models: [] });
        const result = await provider.checkHealth();
        expect(result).toBe(true);
        expect(mockOllama.list).toHaveBeenCalled();
      });

      it('should return false when Ollama is unavailable', async () => {
        mockOllama.list.mockRejectedValue(new Error('Connection failed'));
        const result = await provider.checkHealth();
        expect(result).toBe(false);
        expect(Logger.error).toHaveBeenCalled();
      });
    });

    describe('getAvailableModels', () => {
      it('should return list of model names', async () => {
        mockOllama.list.mockResolvedValue({
          models: [
            { name: 'llama2:7b' },
            { name: 'llama3:8b' },
            { name: 'mistral:7b' }
          ]
        });

        const result = await provider.getAvailableModels();
        expect(result).toEqual(['llama2:7b', 'llama3:8b', 'mistral:7b']);
      });

      it('should return empty array on error', async () => {
        mockOllama.list.mockRejectedValue(new Error('Failed'));
        const result = await provider.getAvailableModels();
        expect(result).toEqual([]);
        expect(Logger.error).toHaveBeenCalled();
      });
    });

    describe('chat', () => {
      const testRequest: LLMChatRequest = {
        model: 'llama2:7b',
        messages: [
          { role: 'user', content: 'Hello' }
        ]
      };

      it('should handle non-streaming chat requests', async () => {
        const mockResponse = {
          message: {
            role: 'assistant',
            content: 'Hello! How can I help?'
          },
          done: true
        };

        mockOllama.chat.mockResolvedValue(mockResponse);

        const result = await provider.chat(testRequest);
        expect(result.message.content).toBe('Hello! How can I help?');
        expect(result.done).toBe(true);
        expect(mockOllama.chat).toHaveBeenCalledWith(
          expect.objectContaining({
            model: 'llama2:7b',
            stream: false
          })
        );
      });

      it('should handle streaming chat requests', async () => {
        const request = { ...testRequest, stream: true };
        
        // Mock async iterable for streaming
        const mockStream = {
          async *[Symbol.asyncIterator]() {
            yield { message: { content: 'Hello' }, done: false };
            yield { message: { content: ' there' }, done: false };
            yield { message: { content: '!' }, done: true };
          }
        };

        mockOllama.chat.mockResolvedValue(mockStream);

        const result = await provider.chat(request);
        expect(result.message.content).toBeInstanceOf(ReadableStream);
        expect(result.done).toBe(false);
      });

      it('should convert tool calls to correct format', async () => {
        const requestWithTools: LLMChatRequest = {
          model: 'llama2:7b',
          messages: [{ role: 'user', content: 'Use a tool' }],
          tools: [{
            type: 'function',
            function: {
              name: 'testTool',
              description: 'A test tool',
              parameters: {
                type: 'object',
                properties: {},
                required: []
              }
            }
          }]
        };

        mockOllama.chat.mockResolvedValue({
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              function: {
                name: 'testTool',
                arguments: { arg: 'value' }
              }
            }]
          },
          done: true
        });

        const result = await provider.chat(requestWithTools);
        expect(result.message.tool_calls).toBeDefined();
        expect(result.message.tool_calls![0].id).toContain('call_');
        expect(result.message.tool_calls![0].function.name).toBe('testTool');
      });

      it('should handle abort signal', async () => {
        const abortController = new AbortController();
        const request = { ...testRequest };

        // Trigger abort before chat completes
        mockOllama.chat.mockImplementation(() => {
          abortController.abort();
          return new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Operation cancelled by user')), 10);
          });
        });

        await expect(provider.chat(request, abortController.signal))
          .rejects.toThrow('Operation cancelled by user');
      });
    });
  });

  describe('GitHubCopilotProvider', () => {
    let provider: GitHubCopilotProvider;

    beforeEach(() => {
      mockAuthGithubCopilot.access = jest.fn().mockResolvedValue('test-token');
      provider = new GitHubCopilotProvider(
        'test-api-key',
        'https://api.githubcopilot.com'
      );
    });

    describe('constructor', () => {
      it('should initialize with required parameters', () => {
        expect(provider).toBeDefined();
        expect(provider.name).toBe('GitHub Copilot');
        expect(Logger.debug).toHaveBeenCalled();
      });

      it('should accept extra headers', () => {
        const customProvider = new GitHubCopilotProvider(
          'key',
          'https://api.githubcopilot.com',
          { 'X-Custom-Header': 'value' }
        );
        expect(customProvider).toBeDefined();
      });

      it('should accept OAuth config', () => {
        const oauthProvider = new GitHubCopilotProvider(
          'key',
          'https://api.githubcopilot.com',
          {},
          { clientId: 'id', clientSecret: 'secret' }
        );
        expect(oauthProvider).toBeDefined();
      });
    });

    describe('checkHealth', () => {
      it('should return true when API is accessible', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: async () => ({ data: [] })
        } as Response);

        const result = await provider.checkHealth();
        expect(result).toBe(true);
        expect(global.fetch).toHaveBeenCalledWith(
          'https://api.githubcopilot.com/models',
          expect.any(Object)
        );
      });

      it('should return false when API returns error', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: async () => 'Unauthorized'
        } as Response);

        const result = await provider.checkHealth();
        expect(result).toBe(false);
        expect(Logger.error).toHaveBeenCalled();
      });

      it('should return false on network error', async () => {
        (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

        const result = await provider.checkHealth();
        expect(result).toBe(false);
        expect(Logger.error).toHaveBeenCalled();
      });
    });

    describe('getAvailableModels', () => {
      it('should return list of model IDs (OpenAI-style response)', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: async () => ({
            data: [
              { id: 'gpt-4o' },
              { id: 'gpt-4o-mini' }
            ]
          })
        } as Response);

        const result = await provider.getAvailableModels();
        expect(result).toEqual(['gpt-4o', 'gpt-4o-mini']);
      });

      it('should handle Azure-style response (direct array)', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: async () => [
            { name: 'gpt-4o' },
            { name: 'gpt-4o-mini' }
          ]
        } as Response);

        const result = await provider.getAvailableModels();
        expect(result).toEqual(['gpt-4o', 'gpt-4o-mini']);
      });

      it('should return fallback models on error', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error'
        } as Response);

        const result = await provider.getAvailableModels();
        expect(result).toEqual(['gpt-4o', 'gpt-4o-mini']);
        expect(Logger.error).toHaveBeenCalled();
      });
    });

    describe('chat', () => {
      const testRequest: LLMChatRequest = {
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'Hello' }
        ]
      };

      it('should handle successful chat request', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                role: 'assistant',
                content: 'Hello! How can I help?'
              }
            }]
          })
        } as Response);

        const result = await provider.chat(testRequest);
        expect(result.message.content).toBe('Hello! How can I help?');
        expect(result.done).toBe(true);
      });

      it('should include tools in request when provided', async () => {
        const requestWithTools: LLMChatRequest = {
          ...testRequest,
          tools: [{
            type: 'function',
            function: {
              name: 'testTool',
              description: 'A test tool',
              parameters: {
                type: 'object',
                properties: {},
                required: []
              }
            }
          }]
        };

        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                role: 'assistant',
                content: 'Using tool'
              }
            }]
          })
        } as Response);

        await provider.chat(requestWithTools);
        
        const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
        const requestBody = JSON.parse(fetchCall[1].body);
        expect(requestBody.tools).toBeDefined();
        expect(requestBody.tools[0].function.name).toBe('testTool');
      });

      it('should handle 413 Payload Too Large error', async () => {
        (global.fetch as jest.Mock)
          .mockResolvedValueOnce({
            ok: false,
            status: 413,
            statusText: 'Payload Too Large',
            text: async () => JSON.stringify({
              error: { code: 'tokens_limit_reached', message: 'Too large' }
            })
          } as Response)
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              choices: [{
                message: {
                  role: 'assistant',
                  content: 'Retried successfully'
                }
              }]
            })
          } as Response);

        const result = await provider.chat(testRequest);
        expect(result.message.content).toBe('Retried successfully');
        expect(Logger.info).toHaveBeenCalledWith(
          expect.stringContaining('Successfully retried')
        );
      });

      it('should handle 400 Bad Request with unavailable model', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: async () => JSON.stringify({
            error: {
              code: 'model_max_prompt_tokens_exceeded',
              message: 'Model has limit of 0'
            }
          })
        } as Response);

        // Note: The specific error is caught by the catch block and falls through to generic error
        await expect(provider.chat(testRequest)).rejects.toThrow(
          'GitHub Copilot API error: 400 Bad Request'
        );
      });

      it('should throw error when no choices in response', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: async () => ({
            choices: []
          })
        } as Response);

        await expect(provider.chat(testRequest)).rejects.toThrow(
          'No response from GitHub Copilot'
        );
      });

      it('should use OAuth token when available', async () => {
        mockAuthGithubCopilot.access = jest.fn().mockResolvedValue('oauth-token');

        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: async () => ({
            choices: [{
              message: { role: 'assistant', content: 'Response' }
            }]
          })
        } as Response);

        await provider.chat(testRequest);

        const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
        const headers = fetchCall[1].headers;
        expect(headers.Authorization).toContain('oauth-token');
      });
    });
  });

  describe('OpenAIProvider', () => {
    let provider: OpenAIProvider;

    beforeEach(() => {
      provider = new OpenAIProvider('test-api-key', 'https://api.openai.com');
    });

    describe('constructor', () => {
      it('should initialize with required parameters', () => {
        expect(provider).toBeDefined();
        expect(provider.name).toBe('OpenAI');
      });

      it('should use default baseUrl when not provided', () => {
        const defaultProvider = new OpenAIProvider('key');
        expect(defaultProvider).toBeDefined();
      });
    });

    describe('checkHealth', () => {
      it('should return true when API is accessible', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true
        } as Response);

        const result = await provider.checkHealth();
        expect(result).toBe(true);
      });

      it('should return false on API error', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: false
        } as Response);

        const result = await provider.checkHealth();
        expect(result).toBe(false);
      });

      it('should return false on network error', async () => {
        (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

        const result = await provider.checkHealth();
        expect(result).toBe(false);
        expect(Logger.error).toHaveBeenCalled();
      });
    });

    describe('getAvailableModels', () => {
      it('should return list of model IDs', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: async () => ({
            data: [
              { id: 'gpt-4' },
              { id: 'gpt-3.5-turbo' }
            ]
          })
        } as Response);

        const result = await provider.getAvailableModels();
        expect(result).toEqual(['gpt-4', 'gpt-3.5-turbo']);
      });

      it('should return empty array on error', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: false,
          status: 401,
          statusText: 'Unauthorized'
        } as Response);

        const result = await provider.getAvailableModels();
        expect(result).toEqual([]);
        expect(Logger.error).toHaveBeenCalled();
      });
    });

    describe('chat', () => {
      const testRequest: LLMChatRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'Hello' }
        ]
      };

      it('should handle successful chat request', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                role: 'assistant',
                content: 'Hello! How can I help?'
              }
            }]
          })
        } as Response);

        const result = await provider.chat(testRequest);
        expect(result.message.content).toBe('Hello! How can I help?');
        expect(result.done).toBe(true);
        expect(Logger.debug).toHaveBeenCalled();
      });

      it('should include Authorization header', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: async () => ({
            choices: [{
              message: { role: 'assistant', content: 'Response' }
            }]
          })
        } as Response);

        await provider.chat(testRequest);

        const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
        expect(fetchCall[1].headers.Authorization).toBe('Bearer test-api-key');
      });

      it('should handle API errors', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'Server error'
        } as Response);

        await expect(provider.chat(testRequest)).rejects.toThrow(
          'OpenAI API error'
        );
        expect(Logger.error).toHaveBeenCalled();
      });

      it('should throw error when no choices in response', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: async () => ({
            choices: []
          })
        } as Response);

        await expect(provider.chat(testRequest)).rejects.toThrow(
          'No response from OpenAI'
        );
      });

      it('should handle abort signal', async () => {
        const abortController = new AbortController();

        (global.fetch as jest.Mock).mockImplementation(() => {
          abortController.abort();
          return Promise.reject(new Error('The user aborted a request'));
        });

        await expect(provider.chat(testRequest, abortController.signal))
          .rejects.toThrow();
      });

      it('should include tools in request', async () => {
        const requestWithTools: LLMChatRequest = {
          ...testRequest,
          tools: [{
            type: 'function',
            function: {
              name: 'testTool',
              description: 'Test',
              parameters: {
                type: 'object',
                properties: {},
                required: []
              }
            }
          }]
        };

        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [{
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'testTool',
                    arguments: '{}'
                  }
                }]
              }
            }]
          })
        } as Response);

        const result = await provider.chat(requestWithTools);
        expect(result.message.tool_calls).toBeDefined();
        expect(result.message.tool_calls![0].function.name).toBe('testTool');
      });
    });
  });
});
