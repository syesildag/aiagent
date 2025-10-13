/**
 * Flexible Embedding Service with Multiple Provider Support
 * 
 * This service provides a unified interface for generating text embeddings using various providers:
 * - OpenAI (text-embedding-3-small, text-embedding-3-large)
 * - Ollama (nomic-embed-text, all-minilm)
 * - Local models (via transformers.js for offline capability)
 * - GitHub Copilot (OpenAI-compatible embeddings via Copilot API)
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
import { AuthGithubCopilot } from './githubAuth';
import { LRUCache } from 'lru-cache';

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

// Provider type definition
export type EmbeddingProviderType = 'openai' | 'ollama' | 'local' | 'github' | 'auto';

// Provider-specific configuration
export interface EmbeddingConfig {
  provider: EmbeddingProviderType;
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
  github?: {
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string;
    useOAuth?: boolean;
    extraHeaders?: Record<string, string>;
  };
  fallbackProviders?: Exclude<EmbeddingProviderType, 'auto'>[];
  cache?: {
    enabled: boolean;
    ttl: number;
    maxSize?: number; // Maximum number of entries in cache
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

      // If input was an array (batch request), return all embeddings
      if (Array.isArray(request.input)) {
        return {
          embedding: data.data.map((item: any) => item.embedding),
          model: data.model,
          usage: data.usage,
        } as any; // Special case for batch processing
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

        // Check if this is a batch response (multiple embeddings)
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
 * GitHub Copilot Embedding Provider
 * 
 * Supports both OAuth and API key authentication:
 * - OAuth: Uses AuthGithubCopilot.access() for token-based authentication (default)
 * - API Key: Uses provided API key directly for authentication
 * 
 * Authentication priority:
 * 1. If useOAuth=true: Try OAuth first, fallback to API key if OAuth fails
 * 2. If useOAuth=false: Use API key directly
 * 3. If no API key provided and OAuth fails: Throw authentication error
 */
export class GitHubCopilotEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'GitHub Copilot';
  readonly supportsBatch = true;
  readonly maxBatchSize = 2048;
  readonly maxTokensPerRequest = 8191;

  private apiKey?: string;
  private baseUrl: string;
  private defaultModel: string;
  private useOAuth: boolean;
  private extraHeaders: Record<string, string>;

  constructor(config?: EmbeddingConfig['github']) {
    this.apiKey = config?.apiKey;
    this.baseUrl = (config?.baseUrl || 'https://copilot-proxy.githubusercontent.com').replace(/\/$/, '');
    this.defaultModel = config?.defaultModel || 'text-embedding-3-small';
    // If an API key is explicitly provided, prefer token-based auth over OAuth
    this.useOAuth = config?.useOAuth ?? (!config?.apiKey);
    this.extraHeaders = config?.extraHeaders || {};
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: await this.createHeaders(),
      });
      return response.ok;
    } catch (error) {
      Logger.error(`GitHub Copilot embedding provider availability check failed: ${error}`);
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: await this.createHeaders(),
      });

      if (!response.ok) {
        throw new EmbeddingError('GitHub Copilot', `Failed to fetch models: ${response.statusText}`);
      }

      const data = await response.json();
      const models = data.data || data;

      return Array.isArray(models)
        ? models
            .map((model: any) => model.id || model.name)
            .filter((id: string) => id && id.includes('embedding'))
        : ['text-embedding-3-small'];
    } catch (error) {
      throw new EmbeddingError(
        'GitHub Copilot',
        `Error fetching available models: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async generateEmbedding(request: EmbeddingRequest): Promise<EmbeddingVector> {
    this.validateRequest(request);

    const model = request.model || this.defaultModel;
    const requestBody = {
      model,
      input: request.input,
      encoding_format: request.encoding_format || 'float',
      dimensions: request.dimensions,
      user: request.user,
    };

    try {
  const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: await this.createHeaders(),
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        let errorPayload: any = null;
        let errorText: string = '';
        
        try {
          // First try to get the response as text
          errorText = await response.text();
          
          // Then try to parse it as JSON if it looks like JSON
          if (errorText.trim().startsWith('{') || errorText.trim().startsWith('[')) {
            errorPayload = JSON.parse(errorText);
          }
        } catch (parseError) {
          Logger.warn(`Failed to parse GitHub Copilot embedding error response: ${parseError}`);
          // errorText will still contain the plain text response
        }

        // Use structured error message if available, otherwise use the raw text or status
        const errorMessage = errorPayload?.error?.message || 
                            errorPayload?.message || 
                            (errorText.trim() || `HTTP ${response.status}: ${response.statusText}`);
        const errorCode = errorPayload?.error?.code || errorPayload?.code;
        
        throw new EmbeddingError('GitHub Copilot', errorMessage, errorCode);
      }

      const data = await response.json();
      if (!data.data || !data.data.length) {
        throw new EmbeddingError('GitHub Copilot', 'Invalid response format: missing embedding data');
      }

      if (Array.isArray(request.input)) {
        const embeddings = data.data.map((item: any) => item.embedding);
        return {
          embedding: embeddings,
          model: data.model || model,
          usage: data.usage,
        } as any;
      }

      return {
        embedding: data.data[0].embedding,
        model: data.model || model,
        usage: data.usage,
      };
    } catch (error) {
      if (error instanceof EmbeddingError) {
        throw error;
      }

      throw new EmbeddingError(
        'GitHub Copilot',
        `Request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async generateBatchEmbeddings(request: EmbeddingBatchRequest): Promise<EmbeddingVector[]> {
    if (!request.inputs?.length) {
      throw new EmbeddingValidationError('Batch request must contain at least one input');
    }

    const batchSize = Math.min(request.batchSize || this.maxBatchSize, this.maxBatchSize);
    const results: EmbeddingVector[] = [];

    for (let i = 0; i < request.inputs.length; i += batchSize) {
      const batch = request.inputs.slice(i, i + batchSize);
      try {
        const batchResult = await this.generateEmbedding({
          input: batch,
          model: request.model,
          dimensions: request.dimensions,
        });

        if (Array.isArray(batchResult.embedding[0])) {
          const embeddings = batchResult.embedding as unknown as number[][];
          embeddings.forEach(embedding =>
            results.push({
              embedding,
              model: batchResult.model,
              usage: batchResult.usage,
            })
          );
        } else {
          results.push(batchResult);
        }
      } catch (error) {
        Logger.error(`GitHub Copilot batch processing failed for batch ${Math.floor(i / batchSize)}: ${error}`);
        throw error;
      }
    }

    return results;
  }

  private async createHeaders(): Promise<Record<string, string>> {
    let token: string | null = null;

    // Authentication strategy based on configuration
    if (this.useOAuth) {
      // Try OAuth first, fallback to API key if available
      try {
        token = (await AuthGithubCopilot.access()) || null;
      } catch (error) {
        Logger.warn(`GitHub Copilot OAuth failed, trying fallback: ${error}`);
      }
      
      if (!token && this.apiKey) {
        Logger.info('Using GitHub Copilot API key as fallback for OAuth');
        token = this.apiKey || null;
      }
    } else {
      // Use API key directly when OAuth is disabled
      token = this.apiKey || null;
    }

    if (!token) {
      const authMethod = this.useOAuth ? 'OAuth token or API key' : 'API key';
      throw new EmbeddingError(
        'GitHub Copilot', 
        `No GitHub Copilot ${authMethod} available. ${
          this.useOAuth 
            ? 'Try running authentication or provide an API key in config.'
            : 'Please provide an API key in the github.apiKey configuration.'
        }`
      );
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...this.extraHeaders,
    };

    // Set appropriate headers based on auth method
    if (this.useOAuth && token !== this.apiKey) {
      // Using OAuth token - VS Code-like headers
      headers['Editor-Version'] = 'vscode/1.95.0';
      headers['Editor-Plugin-Version'] = 'copilot-chat/0.22.0';
      headers['Copilot-Integration-Id'] = 'vscode-chat';
      headers['User-Agent'] = 'GitHubCopilotChat/0.22.0';
    } else {
      // Using API key - AI Agent headers
      headers['Editor-Version'] = 'AI-Agent/1.0';
      headers['Editor-Plugin-Version'] = 'AI-Agent/1.0';
      headers['Copilot-Integration-Id'] = 'ai-agent';
      headers['User-Agent'] = 'AI-Agent/1.0';
    }

    return headers;
  }

  private validateRequest(request: EmbeddingRequest): void {
    if (!request.input || (Array.isArray(request.input) && request.input.length === 0)) {
      throw new EmbeddingValidationError('Input text is required');
    }

    if (Array.isArray(request.input) && request.input.length > this.maxBatchSize) {
      throw new EmbeddingValidationError(
        `Batch size ${request.input.length} exceeds maximum ${this.maxBatchSize}`
      );
    }

    const text = Array.isArray(request.input) ? request.input.join(' ') : request.input;
    const estimatedTokens = Math.ceil(text.length / 4);

    if (estimatedTokens > this.maxTokensPerRequest) {
      throw new EmbeddingValidationError(
        `Estimated tokens ${estimatedTokens} exceeds maximum ${this.maxTokensPerRequest}`
      );
    }
  }

  /**
   * Create a new GitHubCopilotEmbeddingProvider with API key authentication
   * This is a convenience method for token-based authentication without OAuth
   */
  static withApiKey(
    apiKey: string,
    options?: {
      baseUrl?: string;
      defaultModel?: string;
      extraHeaders?: Record<string, string>;
    }
  ): GitHubCopilotEmbeddingProvider {
    return new GitHubCopilotEmbeddingProvider({
      apiKey,
      baseUrl: options?.baseUrl,
      defaultModel: options?.defaultModel,
      useOAuth: false, // Explicitly disable OAuth when using API key
      extraHeaders: options?.extraHeaders,
    });
  }

  /**
   * Create a new GitHubCopilotEmbeddingProvider with OAuth authentication
   * This is a convenience method for OAuth-based authentication
   */
  static withOAuth(options?: {
    baseUrl?: string;
    defaultModel?: string;
    extraHeaders?: Record<string, string>;
    fallbackApiKey?: string;
  }): GitHubCopilotEmbeddingProvider {
    return new GitHubCopilotEmbeddingProvider({
      apiKey: options?.fallbackApiKey,
      baseUrl: options?.baseUrl,
      defaultModel: options?.defaultModel,
      useOAuth: true, // Explicitly enable OAuth
      extraHeaders: options?.extraHeaders,
    });
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
  readonly maxBatchSize = 32; // Smaller batch size for local processing
  readonly maxTokensPerRequest = 512;

  private defaultModel: string;
  private pipeline: any = null;
  private modelCache: Map<string, any> = new Map();

  constructor(config: EmbeddingConfig['local']) {
    this.defaultModel = config?.defaultModel || 'Xenova/all-MiniLM-L6-v2';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { pipeline } = await import('@xenova/transformers');
      return true;
    } catch (error) {
      Logger.warn(`Transformers.js not available for local embeddings: ${error}`);
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    return [
      'Xenova/all-MiniLM-L6-v2',        // 384 dimensions
      'Xenova/all-mpnet-base-v2',       // 768 dimensions
      'Xenova/e5-small-v2',             // 384 dimensions
      'Xenova/e5-base-v2',              // 768 dimensions
      'Xenova/sentence-transformers/paraphrase-MiniLM-L6-v2', // 384 dimensions
    ];
  }

  private async getPipeline(model?: string): Promise<any> {
    const modelName = model || this.defaultModel;
    
    if (this.modelCache.has(modelName)) {
      return this.modelCache.get(modelName);
    }

    try {
      const { pipeline } = await import('@xenova/transformers');
      Logger.info(`Loading local embedding model: ${modelName}`);
      
      const pipe = await pipeline('feature-extraction', modelName, {
        quantized: false,
        local_files_only: false,
        cache_dir: './.transformers-cache'
      });
      
      this.modelCache.set(modelName, pipe);
      Logger.info(`Local embedding model loaded successfully: ${modelName}`);
      return pipe;
    } catch (error) {
      throw new EmbeddingError('Local', `Failed to load model ${modelName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async mean_pooling(model_output: any, attention_mask: any): Promise<number[]> {
    // Perform mean pooling on the token embeddings
    const input_mask_expanded = attention_mask.unsqueeze(-1).expand(model_output.size()).to(model_output.dtype);
    const sum_embeddings = model_output.mul(input_mask_expanded).sum(1);
    const sum_mask = input_mask_expanded.sum(1);
    return sum_embeddings.div(sum_mask.clamp(1e-9));
  }

  async generateEmbedding(request: EmbeddingRequest): Promise<EmbeddingVector> {
    if (Array.isArray(request.input)) {
      throw new EmbeddingValidationError('Local provider does not support array input in single request');
    }

    const pipeline = await this.getPipeline(request.model);
    const text = request.input;

    try {
      Logger.debug(`Generating local embedding for text: ${text.substring(0, 100)}...`);
      
      // Generate embedding using the pipeline
      const output = await pipeline(text, { pooling: 'mean', normalize: true });
      
      // Extract the embedding vector
      let embedding: number[];
      if (output && output.data) {
        embedding = Array.from(output.data);
      } else if (Array.isArray(output)) {
        embedding = output;
      } else {
        throw new Error('Unexpected output format from embedding model');
      }

      Logger.debug(`Generated local embedding with ${embedding.length} dimensions`);

      return {
        embedding,
        model: request.model || this.defaultModel,
        usage: {
          prompt_tokens: Math.ceil(text.length / 4), // Rough estimation
          total_tokens: Math.ceil(text.length / 4)
        }
      };
    } catch (error) {
      throw new EmbeddingError('Local', `Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async generateBatchEmbeddings(request: EmbeddingBatchRequest): Promise<EmbeddingVector[]> {
    const { inputs, batchSize = this.maxBatchSize } = request;
    const results: EmbeddingVector[] = [];

    // Process in batches to manage memory
    for (let i = 0; i < inputs.length; i += batchSize) {
      const batch = inputs.slice(i, i + batchSize);
      const batchPromises = batch.map(text => 
        this.generateEmbedding({ 
          input: text, 
          model: request.model 
        })
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }
}



/**
 * Main Embedding Service with Provider Management and Fallback Logic
 */
export class EmbeddingService {
  private providers: Map<string, EmbeddingProvider> = new Map();
  private primaryProvider: string;
  private fallbackProviders: string[];
  private cache: LRUCache<string, EmbeddingVector>;
  private cacheEnabled: boolean;
  private cacheTtl: number;

  constructor(config: EmbeddingConfig) {
    this.cacheEnabled = config.cache?.enabled ?? false;
    this.cacheTtl = config.cache?.ttl ?? 3600000; // 1 hour default
    
    // Initialize LRU cache with size and TTL limits
    const maxCacheSize = config.cache?.maxSize ?? 1000;
    this.cache = new LRUCache<string, EmbeddingVector>({
      max: maxCacheSize,
      ttl: this.cacheTtl,
      updateAgeOnGet: true, // Reset TTL on access
      updateAgeOnHas: false,
    });

    this.initializeProviders(config);
    this.primaryProvider = this.determinePrimaryProvider(config);
    this.fallbackProviders = config.fallbackProviders || [];
  }

  /**
   * Generate embedding for a single text input
   */
  async generateEmbedding(
    text: string, 
    options?: { model?: string; provider?: Exclude<EmbeddingProviderType, 'auto'> }
  ): Promise<number[]> {
    // Validate input
    if (!text || text.trim().length === 0) {
      throw new EmbeddingValidationError('Text input cannot be empty or contain only whitespace');
    }
    
    const cacheKey = this.getCacheKey(text, options?.model, options?.provider);
    
    // Check cache first
    if (this.cacheEnabled) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
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

        // Cache the result (lru-cache handles TTL automatically)
        if (this.cacheEnabled) {
          this.cache.set(cacheKey, result);
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
    options?: { model?: string; provider?: Exclude<EmbeddingProviderType, 'auto'>; batchSize?: number }
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

  /**
   * Get comprehensive cache statistics
   */
  getCacheStats(): { 
    size: number; 
    maxSize: number; 
    enabled: boolean;
    calculatedSize: number;
    ttl: number;
  } {
    return {
      size: this.cache.size,
      maxSize: this.cache.max,
      enabled: this.cacheEnabled,
      calculatedSize: this.cache.calculatedSize,
      ttl: this.cacheTtl,
    };
  }

  /**
   * Manually trigger cache cleanup to remove expired entries
   */
  cleanupCache(): void {
    if (this.cacheEnabled) {
      const beforeSize = this.cache.size;
      // LRU cache automatically handles cleanup, but we can force it
      this.cache.purgeStale();
      const afterSize = this.cache.size;
      Logger.debug(`Cache cleanup: removed ${beforeSize - afterSize} expired entries`);
    }
  }

  /**
   * Check if a specific text embedding is cached
   */
  isCached(text: string, options?: { model?: string; provider?: Exclude<EmbeddingProviderType, 'auto'> }): boolean {
    if (!this.cacheEnabled) return false;
    const cacheKey = this.getCacheKey(text, options?.model, options?.provider);
    return this.cache.has(cacheKey);
  }

  /**
   * Get remaining TTL for a cached embedding (in milliseconds)
   */
  getCacheTTL(text: string, options?: { model?: string; provider?: Exclude<EmbeddingProviderType, 'auto'> }): number | undefined {
    if (!this.cacheEnabled) return undefined;
    const cacheKey = this.getCacheKey(text, options?.model, options?.provider);
    return this.cache.getRemainingTTL(cacheKey);
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

    // Initialize GitHub Copilot provider when requested or configured
    const wantsGithubProvider =
      config.github !== undefined ||
      config.provider === 'github' ||
      config.fallbackProviders?.includes('github');

    if (wantsGithubProvider) {
      try {
        this.providers.set('github', new GitHubCopilotEmbeddingProvider(config.github));
        Logger.info('GitHub Copilot embedding provider initialized');
      } catch (error) {
        Logger.error(`Failed to initialize GitHub Copilot provider: ${error}`);
      }
    }

    // Initialize Ollama provider
    try {
      this.providers.set('ollama', new OllamaEmbeddingProvider(config.ollama));
      Logger.info('Ollama embedding provider initialized');
    } catch (error) {
      Logger.error(`Failed to initialize Ollama provider: ${error}`);
    }

    // Initialize Local provider with transformers.js
    try {
      this.providers.set('local', new LocalEmbeddingProvider(config.local));
      Logger.info('Local embedding provider initialized with transformers.js');
    } catch (error) {
      Logger.error(`Failed to initialize Local provider: ${error}`);
    }
  }

  private determinePrimaryProvider(config: EmbeddingConfig): string {
    if (config.provider === 'auto') {
      // Auto-select based on available providers, prioritizing local
      const preferredOrder: Exclude<EmbeddingProviderType, 'auto'>[] = ['local', 'github', 'openai', 'ollama'];
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
}

/**
 * Factory function to create EmbeddingService with project configuration
 */
export function createEmbeddingService(overrides?: Partial<EmbeddingConfig>): EmbeddingService {
  const baseConfig: EmbeddingConfig = {
    provider: config.EMBEDDING_PROVIDER as EmbeddingProviderType,
    openai: config.OPENAI_API_KEY
      ? {
          apiKey: config.OPENAI_API_KEY,
          baseUrl: `${config.OPENAI_BASE_URL}/v1`,
          defaultModel: 'text-embedding-3-small',
        }
      : undefined,
    github: {
      apiKey: config.AUTH_GITHUB_COPILOT,
      baseUrl: config.GITHUB_COPILOT_EMBEDDINGS_BASE_URL,
      defaultModel: 'text-embedding-3-small',
      // Use OAuth by default if no explicit API key is provided
      useOAuth: !config.AUTH_GITHUB_COPILOT,
    },
    ollama: {
      host: config.OLLAMA_HOST,
      defaultModel: 'nomic-embed-text',
    },
    local: {
      defaultModel: 'Xenova/all-MiniLM-L6-v2',
    },
    cache: {
      enabled: true,
      ttl: 3600000,
      maxSize: 1000,
    },
  };

  const mergedConfig: EmbeddingConfig = {
    ...baseConfig,
    ...overrides,
  };

  if (mergedConfig.fallbackProviders === undefined) {
    const fallbackOrder: Exclude<EmbeddingProviderType, 'auto'>[] = ['local', 'github', 'ollama', 'openai'];
    mergedConfig.fallbackProviders = fallbackOrder.filter(provider => provider !== mergedConfig.provider);
  }

  return new EmbeddingService(mergedConfig);
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
export async function getEmbeddings(text: string, options?: { provider?: Exclude<EmbeddingProviderType, 'auto'>; model?: string }): Promise<number[]> {
  const service = getEmbeddingService();
  return await service.generateEmbedding(text, options);
}