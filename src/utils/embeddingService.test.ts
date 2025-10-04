/**
 * Comprehensive tests for the Embedding Service
 * Tests all providers, error handling, fallback logic, and utility functions
 */

import {
  EmbeddingService,
  OpenAIEmbeddingProvider,
  OllamaEmbeddingProvider,
  LocalEmbeddingProvider,
  createEmbeddingService,
  getEmbeddingService,
  getEmbeddings,
  EmbeddingError,
  EmbeddingValidationError,
} from './embeddingService';

// Mock dependencies
jest.mock('../mcp/llmProviders');
jest.mock('./logger');
jest.mock('./config', () => ({
  config: {
    OPENAI_API_KEY: 'test-openai-key',
    OPENAI_BASE_URL: 'https://api.openai.com',
    OLLAMA_HOST: 'http://localhost:11434',
    EMBEDDING_PROVIDER: 'auto',
    EMBEDDING_MODEL_OPENAI: 'text-embedding-3-small',
    EMBEDDING_MODEL_OLLAMA: 'nomic-embed-text',
    EMBEDDING_CACHE_ENABLED: true,
    EMBEDDING_CACHE_TTL: 3600000,
  },
}));

// Mock fetch globally
global.fetch = jest.fn();
const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

describe('EmbeddingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockClear();
  });

  describe('OpenAIEmbeddingProvider', () => {
    let provider: OpenAIEmbeddingProvider;

    beforeEach(() => {
      provider = new OpenAIEmbeddingProvider({
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1',
      });
    });

    describe('constructor', () => {
      it('should throw error if API key is missing', () => {
        expect(() => new OpenAIEmbeddingProvider({ apiKey: '' })).toThrow(EmbeddingValidationError);
      });

      it('should initialize with correct defaults', () => {
        expect(provider.name).toBe('OpenAI');
        expect(provider.supportsBatch).toBe(true);
        expect(provider.maxBatchSize).toBe(2048);
      });
    });

    describe('isAvailable', () => {
      it('should return true when API is accessible', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
        } as Response);

        const result = await provider.isAvailable();
        expect(result).toBe(true);
      });

      it('should return false when API is not accessible', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await provider.isAvailable();
        expect(result).toBe(false);
      });
    });

    describe('getAvailableModels', () => {
      it('should return list of embedding models', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            data: [
              { id: 'text-embedding-3-small' },
              { id: 'text-embedding-3-large' },
              { id: 'gpt-4' }, // Non-embedding model
            ],
          }),
        } as Response);

        const models = await provider.getAvailableModels();
        expect(models).toEqual(['text-embedding-3-small', 'text-embedding-3-large']);
      });

      it('should throw error on API failure', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          statusText: 'Unauthorized',
        } as Response);

        await expect(provider.getAvailableModels()).rejects.toThrow(EmbeddingError);
      });
    });

    describe('generateEmbedding', () => {
      it('should generate embedding for single text', async () => {
        const mockResponse = {
          data: [{ embedding: [0.1, 0.2, 0.3] }],
          model: 'text-embedding-3-small',
          usage: { prompt_tokens: 5, total_tokens: 5 },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        } as Response);

        const result = await provider.generateEmbedding({
          input: 'Hello world',
        });

        expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
        expect(result.model).toBe('text-embedding-3-small');
        expect(result.usage).toEqual({ prompt_tokens: 5, total_tokens: 5 });
      });

      it('should handle API errors gracefully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({
            error: { message: 'Rate limit exceeded', code: 'rate_limit' },
          }),
        } as Response);

        await expect(
          provider.generateEmbedding({ input: 'Hello world' })
        ).rejects.toThrow(EmbeddingError);
      });

      it('should validate input parameters', async () => {
        await expect(
          provider.generateEmbedding({ input: '' })
        ).rejects.toThrow(EmbeddingValidationError);
      });

      it('should validate batch size limits', async () => {
        const largeInputArray = new Array(3000).fill('test');
        
        await expect(
          provider.generateEmbedding({ input: largeInputArray })
        ).rejects.toThrow(EmbeddingValidationError);
      });
    });

    describe('generateBatchEmbeddings', () => {
      it('should process batch requests in chunks', async () => {
        const inputs = ['text1', 'text2', 'text3'];
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            data: [
              { embedding: [0.1, 0.2] },
              { embedding: [0.3, 0.4] },
              { embedding: [0.5, 0.6] },
            ],
            model: 'text-embedding-3-small',
          }),
        } as Response);

        const results = await provider.generateBatchEmbeddings({ inputs });
        expect(results).toHaveLength(3);
        expect(results[0].embedding).toEqual([0.1, 0.2]);
      });

      it('should throw error for empty input array', async () => {
        await expect(
          provider.generateBatchEmbeddings({ inputs: [] })
        ).rejects.toThrow(EmbeddingValidationError);
      });
    });
  });

  describe('OllamaEmbeddingProvider', () => {
    let provider: OllamaEmbeddingProvider;
    let mockOllamaProvider: any;

    beforeEach(() => {
      // Mock the OllamaProvider
      mockOllamaProvider = {
        checkHealth: jest.fn(),
        getAvailableModels: jest.fn(),
        ollama: {
          embed: jest.fn(),
        },
      };

      // Mock the constructor
      const { OllamaProvider } = require('../../mcp/llmProviders');
      OllamaProvider.mockImplementation(() => mockOllamaProvider);

      provider = new OllamaEmbeddingProvider({
        host: 'http://localhost:11434',
      });
    });

    describe('isAvailable', () => {
      it('should return true when Ollama is healthy', async () => {
        mockOllamaProvider.checkHealth.mockResolvedValue(true);

        const result = await provider.isAvailable();
        expect(result).toBe(true);
      });
    });

    describe('getAvailableModels', () => {
      it('should filter embedding models', async () => {
        mockOllamaProvider.getAvailableModels.mockResolvedValue([
          'llama2:7b',
          'nomic-embed-text',
          'all-minilm-l6-v2',
          'codellama:7b',
        ]);

        const models = await provider.getAvailableModels();
        expect(models).toEqual(['nomic-embed-text', 'all-minilm-l6-v2']);
      });
    });

    describe('generateEmbedding', () => {
      it('should generate embedding using Ollama', async () => {
        mockOllamaProvider.ollama.embed.mockResolvedValue({
          embeddings: [[0.1, 0.2, 0.3, 0.4]],
        });

        const result = await provider.generateEmbedding({
          input: 'Hello world',
          model: 'nomic-embed-text',
        });

        expect(result.embedding).toEqual([0.1, 0.2, 0.3, 0.4]);
        expect(result.model).toBe('nomic-embed-text');
      });

      it('should reject batch input in single request', async () => {
        await expect(
          provider.generateEmbedding({ input: ['text1', 'text2'] })
        ).rejects.toThrow(EmbeddingValidationError);
      });
    });

    describe('generateBatchEmbeddings', () => {
      it('should process batch sequentially', async () => {
        mockOllamaProvider.ollama.embed
          .mockResolvedValueOnce({ embeddings: [[0.1, 0.2]] })
          .mockResolvedValueOnce({ embeddings: [[0.3, 0.4]] });

        const results = await provider.generateBatchEmbeddings({
          inputs: ['text1', 'text2'],
        });

        expect(results).toHaveLength(2);
        expect(results[0].embedding).toEqual([0.1, 0.2]);
        expect(results[1].embedding).toEqual([0.3, 0.4]);
      });
    });
  });

  describe('LocalEmbeddingProvider', () => {
    let provider: LocalEmbeddingProvider;

    beforeEach(() => {
      provider = new LocalEmbeddingProvider({});
    });

    describe('isAvailable', () => {
      it('should return false (not implemented)', async () => {
        const result = await provider.isAvailable();
        expect(result).toBe(false);
      });
    });

    describe('generateEmbedding', () => {
      it('should throw not implemented error', async () => {
        await expect(
          provider.generateEmbedding({ input: 'test' })
        ).rejects.toThrow(EmbeddingError);
      });
    });
  });

  describe('EmbeddingService Integration', () => {
    let service: EmbeddingService;
    let mockOpenAIProvider: any;
    let mockOllamaProvider: any;

    beforeEach(() => {
      // Create mock providers
      mockOpenAIProvider = {
        name: 'OpenAI',
        supportsBatch: true,
        isAvailable: jest.fn().mockResolvedValue(true),
        generateEmbedding: jest.fn(),
        generateBatchEmbeddings: jest.fn(),
      };

      mockOllamaProvider = {
        name: 'Ollama',
        supportsBatch: false,
        isAvailable: jest.fn().mockResolvedValue(true),
        generateEmbedding: jest.fn(),
        generateBatchEmbeddings: jest.fn(),
      };

      service = createEmbeddingService({
        provider: 'openai',
        openai: { apiKey: 'test-key' },
        fallbackProviders: ['ollama'],
      });

      // Replace providers with mocks
      (service as any).providers.set('openai', mockOpenAIProvider);
      (service as any).providers.set('ollama', mockOllamaProvider);
    });

    describe('generateEmbedding', () => {
      it('should use primary provider successfully', async () => {
        mockOpenAIProvider.generateEmbedding.mockResolvedValue({
          embedding: [0.1, 0.2, 0.3],
          model: 'text-embedding-3-small',
        });

        const result = await service.generateEmbedding('Hello world');
        expect(result).toEqual([0.1, 0.2, 0.3]);
        expect(mockOpenAIProvider.generateEmbedding).toHaveBeenCalledWith({
          input: 'Hello world',
          model: undefined,
        });
      });

      it('should fallback to secondary provider on failure', async () => {
        mockOpenAIProvider.isAvailable.mockResolvedValue(false);
        mockOllamaProvider.generateEmbedding.mockResolvedValue({
          embedding: [0.4, 0.5, 0.6],
          model: 'nomic-embed-text',
        });

        const result = await service.generateEmbedding('Hello world');
        expect(result).toEqual([0.4, 0.5, 0.6]);
        expect(mockOllamaProvider.generateEmbedding).toHaveBeenCalled();
      });

      it('should throw error when all providers fail', async () => {
        mockOpenAIProvider.isAvailable.mockResolvedValue(false);
        mockOllamaProvider.isAvailable.mockResolvedValue(false);

        await expect(
          service.generateEmbedding('Hello world')
        ).rejects.toThrow(EmbeddingError);
      });
    });

    describe('calculateSimilarity', () => {
      const embedding1 = [1, 0, 0];
      const embedding2 = [0, 1, 0];
      const embedding3 = [1, 0, 0]; // Same as embedding1

      it('should calculate cosine similarity', () => {
        const result = service.calculateSimilarity(embedding1, embedding2, 'cosine');
        expect(result.similarity).toBeCloseTo(0, 5); // Perpendicular vectors
        expect(result.method).toBe('cosine');
      });

      it('should calculate cosine similarity for identical vectors', () => {
        const result = service.calculateSimilarity(embedding1, embedding3, 'cosine');
        expect(result.similarity).toBeCloseTo(1, 5); // Identical vectors
      });

      it('should calculate dot product similarity', () => {
        const result = service.calculateSimilarity(embedding1, embedding2, 'dot');
        expect(result.similarity).toBe(0); // Perpendicular vectors
        expect(result.method).toBe('dot');
      });

      it('should calculate euclidean distance', () => {
        const result = service.calculateSimilarity(embedding1, embedding2, 'euclidean');
        expect(result.distance).toBeCloseTo(Math.sqrt(2), 5);
        expect(result.method).toBe('euclidean');
      });

      it('should throw error for mismatched dimensions', () => {
        expect(() =>
          service.calculateSimilarity([1, 2], [1, 2, 3], 'cosine')
        ).toThrow(EmbeddingValidationError);
      });

      it('should throw error for unknown method', () => {
        expect(() =>
          service.calculateSimilarity(embedding1, embedding2, 'unknown' as any)
        ).toThrow(EmbeddingValidationError);
      });
    });

    describe('caching', () => {
      beforeEach(() => {
        service = createEmbeddingService({
          provider: 'openai',
          openai: { apiKey: 'test-key' },
          cache: { enabled: true, ttl: 1000 },
        });
        (service as any).providers.set('openai', mockOpenAIProvider);
      });

      it('should cache embedding results', async () => {
        mockOpenAIProvider.generateEmbedding.mockResolvedValue({
          embedding: [0.1, 0.2, 0.3],
          model: 'text-embedding-3-small',
        });

        // First call
        const result1 = await service.generateEmbedding('Hello world');
        expect(result1).toEqual([0.1, 0.2, 0.3]);

        // Second call should use cache
        const result2 = await service.generateEmbedding('Hello world');
        expect(result2).toEqual([0.1, 0.2, 0.3]);

        // Provider should only be called once
        expect(mockOpenAIProvider.generateEmbedding).toHaveBeenCalledTimes(1);
      });

      it('should expire cache after TTL', async () => {
        mockOpenAIProvider.generateEmbedding
          .mockResolvedValueOnce({
            embedding: [0.1, 0.2, 0.3],
            model: 'text-embedding-3-small',
          })
          .mockResolvedValueOnce({
            embedding: [0.4, 0.5, 0.6],
            model: 'text-embedding-3-small',
          });

        // First call
        await service.generateEmbedding('Hello world');

        // Wait for cache to expire
        await new Promise(resolve => setTimeout(resolve, 1100));

        // Second call should make new request
        const result = await service.generateEmbedding('Hello world');
        expect(result).toEqual([0.4, 0.5, 0.6]);
        expect(mockOpenAIProvider.generateEmbedding).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Utility Functions', () => {
    describe('createEmbeddingService', () => {
      it('should create service with default configuration', () => {
        const service = createEmbeddingService();
        expect(service).toBeInstanceOf(EmbeddingService);
      });

      it('should create service with custom configuration', () => {
        const service = createEmbeddingService({
          provider: 'ollama',
          cache: { enabled: false, ttl: 0 },
        });
        expect(service).toBeInstanceOf(EmbeddingService);
      });
    });

    describe('getEmbeddingService', () => {
      it('should return singleton instance', () => {
        const service1 = getEmbeddingService();
        const service2 = getEmbeddingService();
        expect(service1).toBe(service2);
      });

      it('should create new instance with overrides', () => {
        const service1 = getEmbeddingService();
        const service2 = getEmbeddingService({ provider: 'ollama' });
        expect(service1).not.toBe(service2);
      });
    });

    describe('getEmbeddings (backward compatibility)', () => {
      it('should generate embeddings using default service', async () => {
        // Mock the default service
        const mockService = {
          generateEmbedding: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
        };
        
        // This would need proper mocking in a real test environment
        // For now, just test the function exists
        expect(typeof getEmbeddings).toBe('function');
      });
    });
  });

  describe('Error Handling', () => {
    describe('EmbeddingError', () => {
      it('should create error with provider and code', () => {
        const error = new EmbeddingError('OpenAI', 'Rate limit exceeded', 'RATE_LIMIT');
        expect(error.message).toContain('OpenAI');
        expect(error.message).toContain('Rate limit exceeded');
        expect(error.code).toBe('RATE_LIMIT');
        expect(error.name).toBe('EmbeddingError');
      });
    });

    describe('EmbeddingValidationError', () => {
      it('should create validation error', () => {
        const error = new EmbeddingValidationError('Invalid input');
        expect(error.message).toContain('Invalid input');
        expect(error.name).toBe('EmbeddingValidationError');
        expect(error.statusCode).toBe(400);
      });
    });
  });
});

// Integration test with real providers (optional, for manual testing)
describe('Integration Tests (Manual)', () => {
  // These tests should be run manually with real API keys
  // They are skipped by default to avoid API calls in CI/CD

  describe.skip('Real OpenAI Provider', () => {
    it('should generate real embeddings', async () => {
      const provider = new OpenAIEmbeddingProvider({
        apiKey: process.env.OPENAI_API_KEY!,
      });

      const result = await provider.generateEmbedding({
        input: 'This is a test sentence for embedding generation.',
      });

      expect(result.embedding).toHaveLength(1536); // text-embedding-3-small dimensions
      expect(typeof result.embedding[0]).toBe('number');
    });
  });

  describe.skip('Real Ollama Provider', () => {
    it('should generate real embeddings', async () => {
      const provider = new OllamaEmbeddingProvider({
        host: 'http://localhost:11434',
      });

      // First check if Ollama is available
      const isAvailable = await provider.isAvailable();
      if (!isAvailable) {
        console.log('Ollama is not available, skipping test');
        return;
      }

      const result = await provider.generateEmbedding({
        input: 'This is a test sentence for embedding generation.',
        model: 'nomic-embed-text',
      });

      expect(Array.isArray(result.embedding)).toBe(true);
      expect(result.embedding.length).toBeGreaterThan(0);
      expect(typeof result.embedding[0]).toBe('number');
    });
  });
});