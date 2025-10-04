/**
 * Flexible Embedding Service with Multiple Provider Support
 * 
 * This service provides a unified interface for generating text embeddings using various providers:
 * - OpenAI (text-embedding-3-small, text-embedding-3-large)
 * - Ollama (nomic-embed-text, all-minilm)
 * - Local models (via transformers.js for offline capability)
 * 
 * Features:
 * - Provider fallback with intelligent error handling
 * - Batch processing for efficient bulk operations
 * - Caching support to reduce API calls
 * - Similarity calculation utilities
 * - Configuration management via existing config system
 * - Comprehensive error handling with custom error types
 */

import { config } from './config';
import Logger from './logger';
import { AppError, ExternalServiceError, ValidationError } from './errors';
import { OllamaProvider } from '../mcp/llmProviders';

// Core interfaces and types
export interface EmbeddingVector {
  embedding: number[];
  model: string;
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface EmbeddingRequest {
  input: string | string[];
  model?: string;
  dimensions?: number; // For OpenAI models that support dimension reduction
  encoding_format?: 'float' | 'base64';
  user?: string;
}

export interface EmbeddingBatchRequest {
  inputs: string[];
  model?: string;
  batchSize?: number;
  dimensions?: number;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly supportsBatch: boolean;
  readonly maxBatchSize: number;
  readonly maxTokensPerRequest: number;
  
  isAvailable(): Promise<boolean>;
  getAvailableModels(): Promise<string[]>;
  generateEmbedding(request: EmbeddingRequest): Promise<EmbeddingVector>;
  generateBatchEmbeddings(request: EmbeddingBatchRequest): Promise<EmbeddingVector[]>;
}

export interface SimilarityResult {
  similarity: number;
  distance: number;
  method: 'cosine' | 'euclidean' | 'dot';
}

// Custom error classes
export class EmbeddingError extends ExternalServiceError {
  constructor(provider: string, message: string, public readonly code?: string) {
    super(provider, message);
    this.name = 'EmbeddingError';
  }
}

export class EmbeddingValidationError extends ValidationError {
  constructor(message: string) {
    super(`Embedding validation error: ${message}`);
    this.name = 'EmbeddingValidationError';
  }
}

// Provider-specific configuration
export interface EmbeddingConfig {
  provider: 'openai' | 'ollama' | 'local' | 'auto';
  openai?: {
    apiKey: string;
    baseUrl?: string;
    defaultModel?: string;
    organization?: string;
  };
  ollama?: {
    host: string;
    defaultModel?: string;
  };
  local?: {
    modelPath?: string;
    defaultModel?: string;
  };
  fallbackProviders?: ('openai' | 'ollama' | 'local')[];
  cache?: {
    enabled: boolean;
    ttl: number;
  };
}

/**
 * OpenAI Embedding Provider
 * Supports text-embedding-3-small, text-embedding-3-large, and legacy models
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'OpenAI';
  readonly supportsBatch = true;
  readonly maxBatchSize = 2048;
  readonly maxTokensPerRequest = 8191;

  private apiKey: string;
  private baseUrl: string;
  private organization?: string;

  constructor(config: EmbeddingConfig['openai']) {
    if (!config?.apiKey) {
      throw new EmbeddingValidationError('OpenAI API key is required');
    }

    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.organization = config.organization;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.getHeaders(),
      });
      return response.ok;
    } catch (error) {
      Logger.error(`OpenAI embedding provider availability check failed: ${error}`);
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new EmbeddingError('OpenAI', `Failed to fetch models: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data
        .filter((model: any) => model.id.includes('embedding'))
        .map((model: any) => model.id);
    } catch (error) {
      throw new EmbeddingError('OpenAI', `Error fetching available models: ${error}`);
    }
  }

  async generateEmbedding(request: EmbeddingRequest): Promise<EmbeddingVector> {
    this.validateRequest(request);

    const requestBody = {
      input: request.input,
      model: request.model || 'text-embedding-3-small',
      dimensions: request.dimensions,
      encoding_format: request.encoding_format || 'float',
      user: request.user,
    };

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new EmbeddingError(
          'OpenAI',
          errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`,
          errorData.error?.code
        );
      }

      const data = await response.json();
      
      if (!data.data?.[0]?.embedding) {
        throw new EmbeddingError('OpenAI', 'Invalid response format: missing embedding data');
      }

      return {
        embedding: data.data[0].embedding,
        model: data.model,
        usage: data.usage,
      };
    } catch (error) {
      if (error instanceof EmbeddingError) {
        throw error;
      }
      throw new EmbeddingError('OpenAI', `Request failed: ${error}`);
    }
  }

  async generateBatchEmbeddings(request: EmbeddingBatchRequest): Promise<EmbeddingVector[]> {
    if (!request.inputs?.length) {
      throw new EmbeddingValidationError('Batch request must contain at least one input');
    }

    const batchSize = Math.min(request.batchSize || this.maxBatchSize, this.maxBatchSize);
    const results: EmbeddingVector[] = [];

    // Process in batches
    for (let i = 0; i < request.inputs.length; i += batchSize) {
      const batch = request.inputs.slice(i, i + batchSize);
      
      try {
        const batchResult = await this.generateEmbedding({
          input: batch,
          model: request.model,
          dimensions: request.dimensions,
        });

        // OpenAI returns multiple embeddings for batch requests
        if (Array.isArray(batchResult.embedding[0])) {
          // Multiple embeddings returned
          const embeddings = batchResult.embedding as unknown as number[][];
          embeddings.forEach((emb, idx) => {
            results.push({
              embedding: emb,
              model: batchResult.model,
              usage: batchResult.usage,
            });
          });
        } else {
          // Single embedding returned
          results.push(batchResult);
        }
      } catch (error) {
        Logger.error(`Batch processing failed for batch ${Math.floor(i / batchSize)}: ${error}`);
        throw error;
      }
    }

    return results;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    if (this.organization) {
      headers['OpenAI-Organization'] = this.organization;
    }

    return headers;
  }

  private validateRequest(request: EmbeddingRequest): void {
    if (!request.input) {
      throw new EmbeddingValidationError('Input text is required');
    }

    if (Array.isArray(request.input)) {
      if (request.input.length === 0) {
        throw new EmbeddingValidationError('Input array cannot be empty');
      }
      if (request.input.length > this.maxBatchSize) {
        throw new EmbeddingValidationError(
          `Batch size ${request.input.length} exceeds maximum ${this.maxBatchSize}`
        );
      }
    }

    // Estimate token count (rough approximation)
    const text = Array.isArray(request.input) ? request.input.join(' ') : request.input;
    const estimatedTokens = Math.ceil(text.length / 4);
    
    if (estimatedTokens > this.maxTokensPerRequest) {
      throw new EmbeddingValidationError(
        `Estimated tokens ${estimatedTokens} exceeds maximum ${this.maxTokensPerRequest}`
      );
    }
  }
}

/**
 * Ollama Embedding Provider
 * Supports local models like nomic-embed-text, all-minilm-l6-v2
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'Ollama';
  readonly supportsBatch = false; // Ollama typically processes one at a time
  readonly maxBatchSize = 1;
  readonly maxTokensPerRequest = 8192; // Depends on model, using conservative estimate

  private ollamaProvider: OllamaProvider;
  private defaultModel: string;

  constructor(config: EmbeddingConfig['ollama']) {
    this.ollamaProvider = new OllamaProvider(config?.host || 'http://localhost:11434');
    this.defaultModel = config?.defaultModel || 'nomic-embed-text';
  }

  async isAvailable(): Promise<boolean> {
    return await this.ollamaProvider.checkHealth();
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const allModels = await this.ollamaProvider.getAvailableModels();
      // Filter for embedding models (heuristic: contains 'embed' or known embedding models)
      return allModels.filter(model => 
        model.includes('embed') || 
        model.includes('nomic') ||
        model.includes('minilm') ||
        model.includes('sentence')
      );
    } catch (error) {
      throw new EmbeddingError('Ollama', `Error fetching available models: ${error}`);
    }
  }

  async generateEmbedding(request: EmbeddingRequest): Promise<EmbeddingVector> {
    if (Array.isArray(request.input)) {
      throw new EmbeddingValidationError('Ollama provider does not support batch input in single request');
    }

    const model = request.model || this.defaultModel;
    
    try {
      // Access the underlying Ollama client for embeddings
      const ollama = (this.ollamaProvider as any).ollama;
      if (!ollama) {
        throw new EmbeddingError('Ollama', 'Ollama client not available');
      }

      const response = await ollama.embed({ 
        model, 
        input: request.input 
      });

      if (!response.embeddings?.[0]) {
        throw new EmbeddingError('Ollama', 'Invalid response format: missing embedding data');
      }

      return {
        embedding: response.embeddings[0],
        model: model,
        usage: {
          prompt_tokens: Math.ceil(request.input.length / 4), // Estimate
          total_tokens: Math.ceil(request.input.length / 4),
        },
      };
    } catch (error) {
      if (error instanceof EmbeddingError) {
        throw error;
      }
      throw new EmbeddingError('Ollama', `Request failed: ${error}`);
    }
  }

  async generateBatchEmbeddings(request: EmbeddingBatchRequest): Promise<EmbeddingVector[]> {
    const results: EmbeddingVector[] = [];
    
    // Process sequentially since Ollama doesn't support batch
    for (const input of request.inputs) {
      try {
        const result = await this.generateEmbedding({
          input,
          model: request.model,
        });
        results.push(result);
      } catch (error) {
        Logger.error(`Failed to generate embedding for input: ${input.substring(0, 50)}...`);
        throw error;
      }
    }

    return results;
  }
}

/**
 * Local Embedding Provider
 * Uses transformers.js for client-side embedding generation (future implementation)
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'Local';
  readonly supportsBatch = true;
  readonly maxBatchSize = 100;
  readonly maxTokensPerRequest = 512; // Conservative for local models

  private defaultModel: string;

  constructor(config: EmbeddingConfig['local']) {
    this.defaultModel = config?.defaultModel || 'Xenova/all-MiniLM-L6-v2';
  }

  async isAvailable(): Promise<boolean> {
    // For now, return false as this is not implemented yet
    // In the future, check if transformers.js is available and models can be loaded
    return false;
  }

  async getAvailableModels(): Promise<string[]> {
    // Future: Return list of supported local models
    return [
      'Xenova/all-MiniLM-L6-v2',
      'Xenova/all-mpnet-base-v2',
      'Xenova/e5-small-v2',
    ];
  }

  async generateEmbedding(request: EmbeddingRequest): Promise<EmbeddingVector> {
    throw new EmbeddingError('Local', 'Local embedding provider not implemented yet');
  }

  async generateBatchEmbeddings(request: EmbeddingBatchRequest): Promise<EmbeddingVector[]> {
    throw new EmbeddingError('Local', 'Local embedding provider not implemented yet');
  }
}

/**
 * Main Embedding Service with Provider Management and Fallback Logic
 */
export class EmbeddingService {
  private providers: Map<string, EmbeddingProvider> = new Map();
  private primaryProvider: string;
  private fallbackProviders: string[];
  private cache: Map<string, EmbeddingVector> = new Map();
  private cacheEnabled: boolean;
  private cacheTtl: number;

  constructor(config: EmbeddingConfig) {
    this.cacheEnabled = config.cache?.enabled ?? false;
    this.cacheTtl = config.cache?.ttl ?? 3600000; // 1 hour default

    this.initializeProviders(config);
    this.primaryProvider = this.determinePrimaryProvider(config);
    this.fallbackProviders = config.fallbackProviders || [];
  }

  /**
   * Generate embedding for a single text input
   */
  async generateEmbedding(
    text: string, 
    options?: { model?: string; provider?: string }
  ): Promise<number[]> {
    const cacheKey = this.getCacheKey(text, options?.model, options?.provider);
    
    // Check cache first
    if (this.cacheEnabled) {
      const cached = this.cache.get(cacheKey);
      if (cached && this.isCacheValid(cached)) {
        Logger.debug(`Cache hit for embedding: ${text.substring(0, 50)}...`);
        return cached.embedding;
      }
    }

    const providers = options?.provider 
      ? [options.provider] 
      : [this.primaryProvider, ...this.fallbackProviders];

    let lastError: Error | null = null;

    for (const providerName of providers) {
      const provider = this.providers.get(providerName);
      if (!provider) {
        Logger.warn(`Provider ${providerName} not available, skipping`);
        continue;
      }

      try {
        const isAvailable = await provider.isAvailable();
        if (!isAvailable) {
          Logger.warn(`Provider ${providerName} is not available, trying fallback`);
          continue;
        }

        const result = await provider.generateEmbedding({
          input: text,
          model: options?.model,
        });

        // Cache the result
        if (this.cacheEnabled) {
          this.cache.set(cacheKey, { ...result, timestamp: Date.now() } as any);
        }

        Logger.debug(`Successfully generated embedding using ${providerName}`);
        return result.embedding;

      } catch (error) {
        Logger.warn(`Provider ${providerName} failed: ${error}`);
        lastError = error as Error;
        continue;
      }
    }

    // All providers failed
    throw new EmbeddingError(
      'EmbeddingService',
      `All providers failed. Last error: ${lastError?.message}`,
      'ALL_PROVIDERS_FAILED'
    );
  }

  /**
   * Generate embeddings for multiple texts efficiently
   */
  async generateBatchEmbeddings(
    texts: string[],
    options?: { model?: string; provider?: string; batchSize?: number }
  ): Promise<number[][]> {
    if (!texts.length) {
      return [];
    }

    const providerName = options?.provider || this.primaryProvider;
    const provider = this.providers.get(providerName);
    
    if (!provider) {
      throw new EmbeddingError('EmbeddingService', `Provider ${providerName} not found`);
    }

    try {
      if (provider.supportsBatch) {
        const results = await provider.generateBatchEmbeddings({
          inputs: texts,
          model: options?.model,
          batchSize: options?.batchSize,
        });
        return results.map(r => r.embedding);
      } else {
        // Fallback to sequential processing
        const results: number[][] = [];
        for (const text of texts) {
          const embedding = await this.generateEmbedding(text, options);
          results.push(embedding);
        }
        return results;
      }
    } catch (error) {
      Logger.error(`Batch embedding generation failed: ${error}`);
      throw error;
    }
  }

  /**
   * Calculate similarity between two embeddings
   */
  calculateSimilarity(
    embedding1: number[], 
    embedding2: number[], 
    method: 'cosine' | 'euclidean' | 'dot' = 'cosine'
  ): SimilarityResult {
    if (embedding1.length !== embedding2.length) {
      throw new EmbeddingValidationError(
        `Embedding dimensions don't match: ${embedding1.length} vs ${embedding2.length}`
      );
    }

    let similarity: number;
    let distance: number;

    switch (method) {
      case 'cosine':
        const dotProduct = embedding1.reduce((sum, a, i) => sum + a * embedding2[i], 0);
        const magnitude1 = Math.sqrt(embedding1.reduce((sum, a) => sum + a * a, 0));
        const magnitude2 = Math.sqrt(embedding2.reduce((sum, a) => sum + a * a, 0));
        similarity = dotProduct / (magnitude1 * magnitude2);
        distance = 1 - similarity;
        break;

      case 'dot':
        similarity = embedding1.reduce((sum, a, i) => sum + a * embedding2[i], 0);
        distance = -similarity; // Negative for consistent ordering
        break;

      case 'euclidean':
        distance = Math.sqrt(
          embedding1.reduce((sum, a, i) => sum + Math.pow(a - embedding2[i], 2), 0)
        );
        similarity = 1 / (1 + distance); // Convert distance to similarity
        break;

      default:
        throw new EmbeddingValidationError(`Unknown similarity method: ${method}`);
    }

    return { similarity, distance, method };
  }

  /**
   * Get information about available providers and models
   */
  async getProviderInfo(): Promise<Record<string, { available: boolean; models: string[] }>> {
    const info: Record<string, { available: boolean; models: string[] }> = {};

    for (const [name, provider] of this.providers) {
      try {
        const available = await provider.isAvailable();
        const models = available ? await provider.getAvailableModels() : [];
        info[name] = { available, models };
      } catch (error) {
        Logger.error(`Error getting info for provider ${name}: ${error}`);
        info[name] = { available: false, models: [] };
      }
    }

    return info;
  }

  /**
   * Clear the embedding cache
   */
  clearCache(): void {
    this.cache.clear();
    Logger.info('Embedding cache cleared');
  }

  private initializeProviders(config: EmbeddingConfig): void {
    // Initialize OpenAI provider if configured
    if (config.openai?.apiKey) {
      try {
        this.providers.set('openai', new OpenAIEmbeddingProvider(config.openai));
        Logger.info('OpenAI embedding provider initialized');
      } catch (error) {
        Logger.error(`Failed to initialize OpenAI provider: ${error}`);
      }
    }

    // Initialize Ollama provider
    try {
      this.providers.set('ollama', new OllamaEmbeddingProvider(config.ollama));
      Logger.info('Ollama embedding provider initialized');
    } catch (error) {
      Logger.error(`Failed to initialize Ollama provider: ${error}`);
    }

    // Initialize Local provider (placeholder for future)
    try {
      this.providers.set('local', new LocalEmbeddingProvider(config.local));
      Logger.info('Local embedding provider initialized (not yet functional)');
    } catch (error) {
      Logger.error(`Failed to initialize Local provider: ${error}`);
    }
  }

  private determinePrimaryProvider(config: EmbeddingConfig): string {
    if (config.provider === 'auto') {
      // Auto-select based on available providers
      const preferredOrder = ['openai', 'ollama', 'local'];
      for (const provider of preferredOrder) {
        if (this.providers.has(provider)) {
          return provider;
        }
      }
      throw new AppError('No embedding providers available');
    }

    if (!this.providers.has(config.provider)) {
      throw new AppError(`Configured provider '${config.provider}' is not available`);
    }

    return config.provider;
  }

  private getCacheKey(text: string, model?: string, provider?: string): string {
    return `${provider || this.primaryProvider}:${model || 'default'}:${text}`;
  }

  private isCacheValid(cached: any): boolean {
    if (!cached.timestamp) return false;
    return Date.now() - cached.timestamp < this.cacheTtl;
  }
}

/**
 * Factory function to create EmbeddingService with project configuration
 */
export function createEmbeddingService(overrides?: Partial<EmbeddingConfig>): EmbeddingService {
  const embeddingConfig: EmbeddingConfig = {
    provider: 'auto',
    openai: config.OPENAI_API_KEY ? {
      apiKey: config.OPENAI_API_KEY,
      baseUrl: `${config.OPENAI_BASE_URL}/v1`,
      defaultModel: 'text-embedding-3-small',
    } : undefined,
    ollama: {
      host: config.OLLAMA_HOST,
      defaultModel: 'nomic-embed-text',
    },
    local: {
      defaultModel: 'Xenova/all-MiniLM-L6-v2',
    },
    fallbackProviders: ['ollama'],
    cache: {
      enabled: true,
      ttl: 3600000, // 1 hour
    },
    ...overrides,
  };

  return new EmbeddingService(embeddingConfig);
}

/**
 * Singleton instance for convenient access
 */
let defaultEmbeddingService: EmbeddingService | null = null;

export function getEmbeddingService(overrides?: Partial<EmbeddingConfig>): EmbeddingService {
  if (!defaultEmbeddingService || overrides) {
    defaultEmbeddingService = createEmbeddingService(overrides);
  }
  return defaultEmbeddingService;
}

/**
 * Convenience function for backward compatibility with existing getEmbeddings
 */
export async function getEmbeddings(text: string, options?: { provider?: string; model?: string }): Promise<number[]> {
  const service = getEmbeddingService();
  return await service.generateEmbedding(text, options);
}