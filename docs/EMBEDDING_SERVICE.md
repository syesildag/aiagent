# Embedding Service

## Overview

The Embedding Service provides a unified interface for generating text embeddings across multiple providers (OpenAI, Ollama, GitHub Copilot, Local). It includes caching, batch processing, and similarity calculation utilities.

## Features

- **Multi-Provider Support**: OpenAI, Ollama, GitHub Copilot, Local (transformers.js)
- **Automatic Fallback**: Tries multiple providers if primary fails
- **Caching**: LRU cache to reduce API calls
- **Batch Processing**: Efficient bulk embedding generation
- **Similarity Calculations**: Cosine similarity, dot product, Euclidean distance
- **Type-Safe**: Full TypeScript support

## Configuration

### Environment Variables

```bash
# Provider Selection
EMBEDDING_PROVIDER=openai|ollama|github|local|auto

# Model Selection
EMBEDDING_MODEL_OPENAI=text-embedding-3-small
EMBEDDING_MODEL_OLLAMA=nomic-embed-text

# Caching
EMBEDDING_CACHE_ENABLED=true
EMBEDDING_CACHE_TTL=3600000  # 1 hour in milliseconds

# Provider-specific
OPENAI_API_KEY=sk-your-key
OLLAMA_HOST=http://localhost:11434
```

### Provider Auto-Selection

When `EMBEDDING_PROVIDER=auto`, the service selects based on availability:

```
1. OpenAI (if API key present)
2. GitHub Copilot (if authenticated)  
3. Ollama (if running)
4. Local (fallback)
```

## Basic Usage

### Generate Single Embedding

```typescript
import { generateEmbedding } from './utils/embeddingService';

const embedding = await generateEmbedding(
   'The quick brown fox jumps over the lazy dog'
);

console.log(embedding.embedding); // [0.123, -0.456, ...]
console.log(embedding.model);     // 'text-embedding-3-small'
console.log(embedding.usage);      // { prompt_tokens: 10, total_tokens: 10 }
```

### Specify Provider

```typescript
// Use OpenAI
const embedding = await generateEmbedding(
   'Hello world',
   'openai',
   'text-embedding-3-small'
);

// Use Ollama
const embedding = await generateEmbedding(
   'Hello world',
   'ollama',
   'nomic-embed-text'
);

// Use GitHub Copilot
const embedding = await generateEmbedding(
   'Hello world',
   'github'
);
```

## Batch Processing

### Generate Multiple Embeddings

```typescript
import { generateEmbeddingsBatch } from './utils/embeddingService';

const texts = [
   'First document',
   'Second document',
   'Third document'
];

const embeddings = await generateEmbeddingsBatch(texts, {
   provider: 'openai',
   model: 'text-embedding-3-small',
   batchSize: 100  // Process in batches of 100
});

embeddings.forEach((result, index) => {
   console.log(`Text ${index}: ${result.embedding.length} dimensions`);
});
```

### Batch Options

```typescript
interface EmbeddingBatchRequest {
   inputs: string[];         // Texts to embed
   provider?: string;        // Provider override
   model?: string;           // Model override
   batchSize?: number;       // Items per batch (default: 100)
   dimensions?: number;      // Output dimensions (OpenAI only)
}
```

## Similarity Calculations

### Cosine Similarity

Most common for embeddings:

```typescript
import { cosineSimilarity } from './utils/embeddingService';

const emb1 = await generateEmbedding('machine learning');
const emb2 = await generateEmbedding('artificial intelligence');

const similarity = cosineSimilarity(
   emb1.embedding,
   emb2.embedding
);

console.log(`Similarity: ${similarity}`); // 0.85 (high similarity)
```

### Dot Product

Fast but assumes normalized vectors:

```typescript
import { dotProduct } from './utils/embeddingService';

const score = dotProduct(
   emb1.embedding,
   emb2.embedding
);
```

### Euclidean Distance

Measures distance (lower = more similar):

```typescript
import { euclideanDistance } from './utils/embeddingService';

const distance = euclideanDistance(
   emb1.embedding,
   emb2.embedding
);

console.log(`Distance: ${distance}`); // 0.15 (close)
```

### Find Most Similar

```typescript
import { findMostSimilar } from './utils/embeddingService';

const query = await generateEmbedding('python programming');
const documents = [
   await generateEmbedding('javascript coding'),
   await generateEmbedding('machine learning'),
   await generateEmbedding('python development'),
];

const mostSimilar = findMostSimilar(
   query.embedding,
   documents.map(d => d.embedding)
);

console.log(`Most similar index: ${mostSimilar.index}`); // 2
console.log(`Similarity score: ${mostSimilar.score}`);   // 0.92
```

## Caching

### How Caching Works

Embeddings are cached based on:
- Input text (exact match)
- Provider
- Model

```typescript
// First call - generates embedding
const emb1 = await generateEmbedding('hello world');

// Second call - uses cache (instant)
const emb2 = await generateEmbedding('hello world');

// Different text - generates new embedding
const emb3 = await generateEmbedding('goodbye world');
```

### Cache Configuration

```typescript
import { EmbeddingService } from './utils/embeddingService';

const service = new EmbeddingService({
   provider: 'openai',
   cacheEnabled: true,
   cacheTTL: 3600000  // 1 hour
});
```

### Cache Statistics

```typescript
const stats = service.getCacheStats();

console.log(`Hits: ${stats.hits}`);
console.log(`Misses: ${stats.misses}`);
console.log(`Hit rate: ${stats.hitRate}%`);
console.log(`Size: ${stats.size} entries`);
```

### Clear Cache

```typescript
// Clear all cached embeddings
service.clearCache();

// Clear specific embedding
service.clearCacheEntry('hello world', 'openai', 'text-embedding-3-small');
```

## Provider-Specific Features

### OpenAI

**Models:**
- `text-embedding-3-small`: 1536 dimensions, cost-effective
- `text-embedding-3-large`: 3072 dimensions, highest quality
- `text-embedding-ada-002`: 1536 dimensions, legacy

**Dimension Reduction:**
```typescript
const embedding = await generateEmbedding(
   'hello world',
   'openai',
   'text-embedding-3-large',
   { dimensions: 512 }  // Reduce from 3072 to 512
);
```

### Ollama

**Models:**
- `nomic-embed-text`: 768 dimensions, general purpose
- `all-minilm`: 384 dimensions, fast and efficient
- `mxbai-embed-large`: 1024 dimensions, high quality

**Setup:**
```bash
ollama pull nomic-embed-text
ollama pull all-minilm
```

### GitHub Copilot

Uses OpenAI models via Copilot API:

```typescript
// Requires GitHub Copilot authentication
const embedding = await generateEmbedding(
   'hello world',
   'github'
);
```

### Local (Transformers.js)

Runs entirely offline with local models:

```typescript
// First run downloads model (~100MB)
const embedding = await generateEmbedding(
   'hello world',
   'local'
);

// Subsequent runs use cached model
```

## Advanced Usage

### Custom Provider

```typescript
class CustomEmbeddingProvider {
   async generateEmbedding(text: string): Promise<number[]> {
      // Your implementation
      return [/* embedding vector */];
   }
}

const service = new EmbeddingService({
   customProvider: new CustomEmbeddingProvider()
});
```

### Error Handling with Retries

```typescript
async function generateWithRetry(
   text: string,
   maxRetries: number = 3
): Promise<EmbeddingVector> {
   for (let i = 0; i < maxRetries; i++) {
      try {
         return await generateEmbedding(text);
      } catch (error) {
         if (i === maxRetries - 1) throw error;
         
         const delay = Math.pow(2, i) * 1000; // Exponential backoff
         await new Promise(resolve => setTimeout(resolve, delay));
         
         Logger.warn(`Retry ${i + 1}/${maxRetries} after ${delay}ms`);
      }
   }
   throw new Error('Failed after all retries');
}
```

### Provider Fallback Chain

```typescript
async function generateWithFallback(text: string): Promise<EmbeddingVector> {
   const providers = ['openai', 'github', 'ollama', 'local'];
   
   for (const provider of providers) {
      try {
         return await generateEmbedding(text, provider);
      } catch (error) {
         Logger.warn(`Provider ${provider} failed: ${error.message}`);
         continue;
      }
   }
   
   throw new Error('All providers failed');
}
```

## Database Integration

### Storing Embeddings

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create table with vector column
CREATE TABLE documents (
   id SERIAL PRIMARY KEY,
   content TEXT,
   embedding vector(1536),  -- Dimension matches model
   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for similarity search
CREATE INDEX ON documents USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

### Insert Embeddings

```typescript
import { generateEmbedding } from './utils/embeddingService';
import { queryDatabase } from './utils/pgClient';

async function insertDocument(content: string) {
   const { embedding } = await generateEmbedding(content);
   
   await queryDatabase(
      'INSERT INTO documents (content, embedding) VALUES ($1, $2)',
      [content, JSON.stringify(embedding)]
   );
}

// Insert example
await insertDocument('Machine learning is a subset of AI');
```

See [INSERT_EMBEDDINGS_GUIDE.md](INSERT_EMBEDDINGS_GUIDE.md) for detailed guide.

### Similarity Search

```typescript
async function searchSimilar(query: string, limit: number = 5) {
   const { embedding } = await generateEmbedding(query);
   
   const results = await queryDatabase(
      `SELECT id, content, 
              1 - (embedding <=> $1::vector) as similarity
       FROM documents
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [JSON.stringify(embedding), limit]
   );
   
   return results.rows;
}

// Search example
const similar = await searchSimilar('What is AI?', 5);
console.log(similar);
// [
//   { id: 1, content: 'Machine learning is...', similarity: 0.89 },
//   { id: 2, content: 'Artificial intelligence...', similarity: 0.85 },
//   ...
// ]
```

## Performance Optimization

### 1. Batch Processing

```typescript
// ❌ Slow - individual requests
for (const text of texts) {
   await generateEmbedding(text);
}

// ✅ Fast - batch request
await generateEmbeddingsBatch(texts);
```

### 2. Caching

```typescript
// Enable caching for repeated queries
const service = new EmbeddingService({
   cacheEnabled: true,
   cacheTTL: 3600000
});
```

### 3. Use Smaller Models

```typescript
// ❌ Expensive - large model
await generateEmbedding(text, 'openai', 'text-embedding-3-large');

// ✅ Cost-effective - small model (usually sufficient)
await generateEmbedding(text, 'openai', 'text-embedding-3-small');
```

### 4. Dimension Reduction

```typescript
// Reduce dimensions for storage/speed
const embedding = await generateEmbedding(
   text,
   'openai',
   'text-embedding-3-large',
   { dimensions: 512 }  // 6x smaller
);
```

## Error Handling

### Provider Errors

```typescript
import { 
   ExternalServiceError,
   ValidationError 
} from './utils/errors';

try {
   const embedding = await generateEmbedding(text);
} catch (error) {
   if (error instanceof ExternalServiceError) {
      Logger.error(`Provider error: ${error.message}`);
      // Try fallback provider
   } else if (error instanceof ValidationError) {
      Logger.error(`Invalid input: ${error.message}`);
      // Handle validation error
   } else {
      Logger.error(`Unexpected error: ${error}`);
   }
}
```

### Rate Limiting

```typescript
// Implement rate limiting for API calls
const rateLimiter = new RateLimiter(100, 60000); // 100 per minute

async function generateWithRateLimit(text: string) {
   await rateLimiter.acquire();
   return await generateEmbedding(text);
}
```

## Testing

### Unit Tests

```typescript
describe('Embedding Service', () => {
   test('should generate embedding', async () => {
      const result = await generateEmbedding('test');
      
      expect(result.embedding).toBeDefined();
      expect(result.embedding.length).toBeGreaterThan(0);
      expect(result.model).toBeDefined();
   });
   
   test('should calculate cosine similarity', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [1, 0, 0];
      const similarity = cosineSimilarity(vec1, vec2);
      
      expect(similarity).toBe(1); // Identical vectors
   });
});
```

### Integration Tests

```typescript
test('should use cache for repeated queries', async () => {
   const service = new EmbeddingService({ cacheEnabled: true });
   
   const emb1 = await service.generate('test');
   const emb2 = await service.generate('test');
   
   expect(emb1.embedding).toEqual(emb2.embedding);
   expect(service.getCacheStats().hits).toBe(1);
});
```

## Troubleshooting

### Provider Not Available
```
Error: Provider 'openai' not available
Solution: Set OPENAI_API_KEY environment variable
```

### Dimension Mismatch
```
Error: Vector dimensions don't match
Solution: Ensure all vectors use same model/dimensions
```

### Cache Issues
```
Error: Cache full
Solution: Increase cache size or clear cache
```

## Related Documentation

- [INSERT_EMBEDDINGS_GUIDE.md](INSERT_EMBEDDINGS_GUIDE.md)
- [LLM Providers](LLM_PROVIDERS.md)
- [Configuration](CONFIGURATION.md)
