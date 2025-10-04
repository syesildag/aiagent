# Embedding Service Documentation

## Overview

The Embedding Service provides a unified, flexible interface for generating text embeddings using multiple providers with automatic fallback, caching, and comprehensive error handling.

## Features

- **Multiple Providers**: OpenAI, Ollama, Local models (future)
- **Intelligent Fallback**: Automatic provider switching on failures
- **Batch Processing**: Efficient bulk embedding generation
- **Caching**: Configurable result caching to reduce API costs
- **Similarity Calculations**: Built-in cosine, euclidean, and dot product similarity
- **Type Safety**: Full TypeScript support with comprehensive error handling
- **Configuration Management**: Integrates with existing project configuration

## Quick Start

### Basic Usage

```typescript
import { getEmbeddingService } from './utils/embeddingService';

// Get the default service (auto-configured)
const embeddingService = getEmbeddingService();

// Generate a single embedding
const embedding = await embeddingService.generateEmbedding("Hello, world!");
console.log(embedding); // [0.1, -0.2, 0.3, ...]

// Generate batch embeddings
const embeddings = await embeddingService.generateBatchEmbeddings([
  "First text",
  "Second text", 
  "Third text"
]);
console.log(embeddings.length); // 3

// Calculate similarity between embeddings
const similarity = embeddingService.calculateSimilarity(
  embeddings[0], 
  embeddings[1], 
  'cosine'
);
console.log(similarity); // { similarity: 0.85, distance: 0.15, method: 'cosine' }
```

### Backward Compatibility

```typescript
import { getEmbeddings } from './utils/embeddingService';

// Drop-in replacement for existing getEmbeddings function
const embedding = await getEmbeddings("Hello, world!");
console.log(embedding); // [0.1, -0.2, 0.3, ...]
```

## Configuration

### Environment Variables

Add to your `.env` file:

```bash
# Embedding Service Configuration
EMBEDDING_PROVIDER=auto              # auto, openai, ollama, local
EMBEDDING_MODEL_OPENAI=text-embedding-3-small
EMBEDDING_MODEL_OLLAMA=nomic-embed-text
EMBEDDING_CACHE_ENABLED=true
EMBEDDING_CACHE_TTL=3600000          # 1 hour in milliseconds

# Provider-specific settings
OPENAI_API_KEY=your-openai-key
OLLAMA_HOST=http://localhost:11434
```

### Programmatic Configuration

```typescript
import { createEmbeddingService } from './utils/embeddingService';

const service = createEmbeddingService({
  provider: 'openai',
  openai: {
    apiKey: 'your-api-key',
    defaultModel: 'text-embedding-3-large', // Higher quality, more expensive
    organization: 'your-org-id',
  },
  fallbackProviders: ['ollama'],
  cache: {
    enabled: true,
    ttl: 1800000, // 30 minutes
  },
});
```

## Provider Details

### OpenAI Provider

**Supported Models**:
- `text-embedding-3-small` (1536 dimensions, fast, cost-effective)
- `text-embedding-3-large` (3072 dimensions, highest quality)
- `text-embedding-ada-002` (1536 dimensions, legacy)

**Features**:
- Batch processing up to 2048 inputs
- Dimension reduction support
- Organization-level usage tracking

```typescript
// Use specific OpenAI model
const embedding = await service.generateEmbedding("Text", {
  provider: 'openai',
  model: 'text-embedding-3-large'
});

// With dimension reduction
const service = createEmbeddingService({
  provider: 'openai',
  openai: {
    apiKey: 'your-key',
    defaultModel: 'text-embedding-3-large',
  }
});

// Request specific dimensions (only for 3rd generation models)
const result = await service.providers.get('openai').generateEmbedding({
  input: "Text",
  dimensions: 1024 // Reduce from 3072 to 1024
});
```

### Ollama Provider

**Supported Models**:
- `nomic-embed-text` (768 dimensions, recommended)
- `all-minilm-l6-v2` (384 dimensions, fast)
- Any local embedding model available in Ollama

**Features**:
- Local processing (no internet required)
- No API costs
- Sequential processing (no native batching)

```typescript
// Use Ollama with specific model
const embedding = await service.generateEmbedding("Text", {
  provider: 'ollama',
  model: 'nomic-embed-text'
});
```

### Local Provider (Future)

**Planned Features**:
- Browser-compatible via transformers.js
- Offline processing
- No API dependencies
- Smaller models for edge deployment

## Advanced Usage

### Custom Provider Selection

```typescript
// Force specific provider
const openaiEmbedding = await service.generateEmbedding("Text", {
  provider: 'openai'
});

const ollamaEmbedding = await service.generateEmbedding("Text", {
  provider: 'ollama'
});
```

### Batch Processing with Custom Batch Sizes

```typescript
// Custom batch size for large datasets
const largeTexts = [...]; // 10,000 texts

const embeddings = await service.generateBatchEmbeddings(largeTexts, {
  batchSize: 100, // Process 100 at a time
  provider: 'openai'
});
```

### Similarity Search

```typescript
// Find most similar texts
const queryEmbedding = await service.generateEmbedding("search query");
const documentEmbeddings = await service.generateBatchEmbeddings(documents);

const similarities = documentEmbeddings.map((docEmb, index) => ({
  index,
  similarity: service.calculateSimilarity(queryEmbedding, docEmb, 'cosine').similarity
}));

// Sort by similarity (highest first)
similarities.sort((a, b) => b.similarity - a.similarity);

console.log("Most similar document:", documents[similarities[0].index]);
```

### Provider Health Monitoring

```typescript
// Check provider availability
const providerInfo = await service.getProviderInfo();
console.log(providerInfo);
// {
//   openai: { available: true, models: ['text-embedding-3-small', ...] },
//   ollama: { available: false, models: [] },
//   local: { available: false, models: [] }
// }

// Use this for monitoring and alerting
if (!providerInfo.openai.available && !providerInfo.ollama.available) {
  console.error("No embedding providers available!");
}
```

### Cache Management

```typescript
// Clear cache when needed
service.clearCache();

// Check cache effectiveness (custom implementation)
let cacheHits = 0;
let cacheMisses = 0;

// Monitor cache usage in your application
const originalGenerate = service.generateEmbedding;
service.generateEmbedding = async function(text, options) {
  // This is just an example - actual implementation would track cache internally
  const result = await originalGenerate.call(this, text, options);
  return result;
};
```

## Error Handling

### Error Types

```typescript
import { 
  EmbeddingError, 
  EmbeddingValidationError 
} from './utils/embeddingService';

try {
  const embedding = await service.generateEmbedding("text");
} catch (error) {
  if (error instanceof EmbeddingValidationError) {
    console.error("Invalid input:", error.message);
  } else if (error instanceof EmbeddingError) {
    console.error(`Provider ${error.provider} failed:`, error.message);
    console.error("Error code:", error.code);
  } else {
    console.error("Unexpected error:", error);
  }
}
```

### Retry Logic

```typescript
async function generateEmbeddingWithRetry(text: string, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await service.generateEmbedding(text);
    } catch (error) {
      if (error instanceof EmbeddingValidationError) {
        throw error; // Don't retry validation errors
      }
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      console.warn(`Attempt ${attempt} failed, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}
```

## Performance Optimization

### Batch Size Guidelines

- **OpenAI**: Use batches of 100-500 for optimal throughput
- **Ollama**: Process sequentially, consider parallel instances
- **Large datasets**: Use streaming or chunked processing

```typescript
// Efficient large dataset processing
async function processLargeDataset(texts: string[]) {
  const CHUNK_SIZE = 500;
  const results: number[][] = [];
  
  for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
    const chunk = texts.slice(i, i + CHUNK_SIZE);
    const chunkEmbeddings = await service.generateBatchEmbeddings(chunk);
    results.push(...chunkEmbeddings);
    
    // Optional: Add delay to respect rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return results;
}
```

### Caching Strategy

```typescript
// Long-term cache with Redis (example)
import Redis from 'ioredis';

class PersistentEmbeddingService {
  private redis = new Redis();
  private embeddingService = getEmbeddingService();
  
  async generateEmbedding(text: string): Promise<number[]> {
    const cacheKey = `embedding:${Buffer.from(text).toString('base64')}`;
    
    // Check Redis cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    
    // Generate new embedding
    const embedding = await this.embeddingService.generateEmbedding(text);
    
    // Cache for 24 hours
    await this.redis.setex(cacheKey, 86400, JSON.stringify(embedding));
    
    return embedding;
  }
}
```

## Integration Examples

### Using with Memory Server

```typescript
// In your memory server
import { getEmbeddings } from '../utils/embeddingService';

export async function storeMemory(content: string, type: string, tags: string[]) {
  // Generate embedding using the new service
  const embedding = await getEmbeddings(content);
  
  // Store in database
  const result = await queryDatabase(
    'INSERT INTO memories (content, type, tags, embedding) VALUES ($1, $2, $3, $4)',
    [content, type, tags, `[${embedding.join(',')}]`]
  );
  
  return result;
}

export async function searchMemories(query: string, limit: number = 10) {
  // Generate query embedding
  const queryEmbedding = await getEmbeddings(query);
  
  // Search using vector similarity
  const result = await queryDatabase(`
    SELECT *, embedding <=> $1::vector as distance 
    FROM memories 
    ORDER BY distance ASC 
    LIMIT $2
  `, [`[${queryEmbedding.join(',')}]`, limit]);
  
  return result;
}
```

### Using with Semantic Search

```typescript
// Document search service
class DocumentSearchService {
  private embeddingService = getEmbeddingService();
  private documentEmbeddings = new Map<string, number[]>();
  
  async indexDocument(id: string, content: string) {
    const embedding = await this.embeddingService.generateEmbedding(content);
    this.documentEmbeddings.set(id, embedding);
  }
  
  async indexDocuments(documents: { id: string; content: string }[]) {
    const embeddings = await this.embeddingService.generateBatchEmbeddings(
      documents.map(doc => doc.content)
    );
    
    documents.forEach((doc, index) => {
      this.documentEmbeddings.set(doc.id, embeddings[index]);
    });
  }
  
  async search(query: string, topK: number = 5): Promise<Array<{ id: string; similarity: number }>> {
    const queryEmbedding = await this.embeddingService.generateEmbedding(query);
    
    const results = Array.from(this.documentEmbeddings.entries())
      .map(([id, embedding]) => ({
        id,
        similarity: this.embeddingService.calculateSimilarity(
          queryEmbedding, 
          embedding, 
          'cosine'
        ).similarity
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
    
    return results;
  }
}
```

## Migration Guide

### From Existing getEmbeddings

```typescript
// Old code
import { getEmbeddings } from './utils/getEmbeddings';
const embedding = await getEmbeddings("text");

// New code - drop-in replacement
import { getEmbeddings } from './utils/embeddingService';
const embedding = await getEmbeddings("text");

// Or use the full service for more features
import { getEmbeddingService } from './utils/embeddingService';
const service = getEmbeddingService();
const embedding = await service.generateEmbedding("text");
```

### Updating Configuration

1. Add new environment variables to `.env`
2. Update any hardcoded Ollama client usage
3. Consider enabling caching for cost savings
4. Set up fallback providers for reliability

## Best Practices

1. **Use Caching**: Enable caching to reduce API costs and improve performance
2. **Batch Processing**: Use batch operations for multiple texts
3. **Error Handling**: Always handle provider failures gracefully
4. **Provider Selection**: Use auto mode for best reliability, or specific providers for predictable behavior
5. **Monitoring**: Monitor provider health and cache effectiveness
6. **Rate Limiting**: Respect API rate limits, especially for OpenAI
7. **Security**: Keep API keys secure and rotate them regularly

## Troubleshooting

### Common Issues

**"No embedding providers available"**
- Check network connectivity
- Verify API keys
- Ensure Ollama is running (if using)

**"All providers failed"**
- Check provider health with `getProviderInfo()`
- Review error logs for specific failures
- Consider increasing retry logic

**"Rate limit exceeded"**
- Implement backoff strategy
- Use smaller batch sizes
- Enable caching to reduce requests

**High latency**
- Use local providers (Ollama) for faster response
- Enable caching for repeated requests
- Consider batch processing

### Debug Mode

```typescript
// Enable debug logging
import Logger from './utils/logger';
Logger.level = 'debug';

// The service will log provider selection, cache hits, and other debug info
const embedding = await service.generateEmbedding("text");
```

## Future Roadmap

- **Local Provider**: Browser-compatible transformers.js implementation
- **More Providers**: Azure OpenAI, Anthropic, Cohere, HuggingFace
- **Advanced Caching**: Semantic caching, distributed cache
- **Streaming**: Real-time embedding generation
- **Fine-tuning**: Custom model support
- **Monitoring**: Built-in metrics and observability