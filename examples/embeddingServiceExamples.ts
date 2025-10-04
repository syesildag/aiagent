/**
 * Embedding Service Usage Examples
 * 
 * This file demonstrates various ways to use the new embedding service
 * with different providers, configurations, and use cases.
 */

import {
    createEmbeddingService,
    getEmbeddings,
    getEmbeddingService
} from '../src/utils/embeddingService';

// Example 1: Basic Usage (Drop-in replacement)
async function basicUsage() {
  console.log('=== Basic Usage ===');
  
  // Backward compatible with existing getEmbeddings function
  const embedding = await getEmbeddings("Hello, world!");
  console.log('Embedding dimensions:', embedding.length);
  console.log('First few values:', embedding.slice(0, 5));
}

// Example 2: Using the Full Service
async function fullServiceUsage() {
  console.log('\n=== Full Service Usage ===');
  
  const service = getEmbeddingService();
  
  // Generate single embedding
  const embedding = await service.generateEmbedding("This is a test sentence");
  console.log('Single embedding generated, dimensions:', embedding.length);
  
  // Generate batch embeddings
  const texts = [
    "First document about machine learning",
    "Second document about artificial intelligence", 
    "Third document about natural language processing"
  ];
  
  const embeddings = await service.generateBatchEmbeddings(texts);
  console.log('Batch embeddings generated:', embeddings.length);
  
  // Calculate similarities
  const similarity1 = service.calculateSimilarity(embeddings[0], embeddings[1], 'cosine');
  const similarity2 = service.calculateSimilarity(embeddings[0], embeddings[2], 'cosine');
  
  console.log('Similarity between docs 1 and 2:', similarity1.similarity.toFixed(3));
  console.log('Similarity between docs 1 and 3:', similarity2.similarity.toFixed(3));
}

// Example 3: Custom Configuration
async function customConfiguration() {
  console.log('\n=== Custom Configuration ===');
  
  // Create service with specific configuration
  const service = createEmbeddingService({
    provider: 'auto', // Try best available provider
    openai: {
      apiKey: process.env.OPENAI_API_KEY || 'test-key',
      defaultModel: 'text-embedding-3-small',
    },
    ollama: {
      host: 'http://localhost:11434',
      defaultModel: 'nomic-embed-text',
    },
    fallbackProviders: ['ollama'], // Fallback to Ollama if OpenAI fails
    cache: {
      enabled: true,
      ttl: 1800000, // 30 minutes
    },
  });
  
  // Check provider availability
  const providerInfo = await service.getProviderInfo();
  console.log('Provider availability:');
  Object.entries(providerInfo).forEach(([name, info]: [string, any]) => {
    console.log(`  ${name}: ${info.available ? '✓ Available' : '✗ Unavailable'}`);
    if (info.available && info.models?.length > 0) {
      console.log(`    Models: ${info.models.slice(0, 3).join(', ')}${info.models.length > 3 ? '...' : ''}`);
    }
  });
}

// Example 4: Provider-Specific Usage
async function providerSpecificUsage() {
  console.log('\n=== Provider-Specific Usage ===');
  
  const service = getEmbeddingService();
  
  try {
    // Force OpenAI provider
    const openaiEmbedding = await service.generateEmbedding("Test with OpenAI", {
      provider: 'openai',
      model: 'text-embedding-3-small'
    });
    console.log('OpenAI embedding generated, dimensions:', openaiEmbedding.length);
  } catch (error: any) {
    console.log('OpenAI provider failed:', error.message);
  }
  
  try {
    // Force Ollama provider
    const ollamaEmbedding = await service.generateEmbedding("Test with Ollama", {
      provider: 'ollama',
      model: 'nomic-embed-text'
    });
    console.log('Ollama embedding generated, dimensions:', ollamaEmbedding.length);
  } catch (error: any) {
    console.log('Ollama provider failed:', error.message);
  }
}

// Example 5: Semantic Search Implementation
async function semanticSearchDemo() {
  console.log('\n=== Semantic Search Demo ===');
  
  const service = getEmbeddingService();
  
  // Sample documents
  const documents = [
    "The cat sat on the mat",
    "Dogs are loyal pets and great companions",
    "Machine learning is a subset of artificial intelligence",
    "Deep learning uses neural networks with many layers",
    "Cats are independent and mysterious animals",
    "Python is a popular programming language for AI",
    "Natural language processing helps computers understand text"
  ];
  
  console.log('Indexing documents...');
  const documentEmbeddings = await service.generateBatchEmbeddings(documents);
  
  // Search queries
  const queries = [
    "pets and animals",
    "artificial intelligence and programming",
    "felines"
  ];
  
  for (const query of queries) {
    console.log(`\nSearching for: "${query}"`);
    const queryEmbedding = await service.generateEmbedding(query);
    
    // Calculate similarities
    const similarities = documentEmbeddings.map((docEmb: number[], index: number) => ({
      document: documents[index],
      similarity: service.calculateSimilarity(queryEmbedding, docEmb, 'cosine').similarity
    }));
    
    // Sort by similarity and show top 3
    similarities.sort((a: any, b: any) => b.similarity - a.similarity);
    
    console.log('Top 3 results:');
    similarities.slice(0, 3).forEach((result: any, index: number) => {
      console.log(`  ${index + 1}. (${result.similarity.toFixed(3)}) ${result.document}`);
    });
  }
}

// Example 6: Performance and Caching Demo
async function performanceDemo() {
  console.log('\n=== Performance and Caching Demo ===');
  
  const service = getEmbeddingService();
  const testText = "This is a test sentence for performance measurement";
  
  // First call (no cache)
  console.log('First call (no cache):');
  const start1 = Date.now();
  await service.generateEmbedding(testText);
  const time1 = Date.now() - start1;
  console.log(`Time: ${time1}ms`);
  
  // Second call (should use cache if enabled)
  console.log('Second call (with cache):');
  const start2 = Date.now();
  await service.generateEmbedding(testText);
  const time2 = Date.now() - start2;
  console.log(`Time: ${time2}ms`);
  
  if (time2 < time1) {
    console.log('✓ Cache is working! Second call was faster.');
  } else {
    console.log('ℹ Cache may not be enabled or first call was already fast.');
  }
  
  // Batch performance
  const batchTexts = Array.from({ length: 10 }, (_, i) => `Test sentence number ${i + 1}`);
  
  console.log('\nBatch processing performance:');
  const batchStart = Date.now();
  await service.generateBatchEmbeddings(batchTexts);
  const batchTime = Date.now() - batchStart;
  console.log(`Batch (10 texts): ${batchTime}ms (${(batchTime / 10).toFixed(1)}ms per text)`);
  
  // Sequential processing comparison
  console.log('Sequential processing comparison:');
  const sequentialStart = Date.now();
  for (const text of batchTexts.slice(0, 3)) { // Just test 3 to avoid too many API calls
    await service.generateEmbedding(text);
  }
  const sequentialTime = Date.now() - sequentialStart;
  console.log(`Sequential (3 texts): ${sequentialTime}ms (${(sequentialTime / 3).toFixed(1)}ms per text)`);
}

// Example 7: Error Handling
async function errorHandlingDemo() {
  console.log('\n=== Error Handling Demo ===');
  
  const service = getEmbeddingService();
  
  try {
    // Test with invalid input
    await service.generateEmbedding("");
    console.log('Empty string was accepted (unexpected)');
  } catch (error: any) {
    console.log('✓ Properly caught empty string error:', error.message);
  }
  
  try {
    // Test with unavailable provider
    await service.generateEmbedding("test", { provider: 'nonexistent' as any });
    console.log('Nonexistent provider was accepted (unexpected)');
  } catch (error: any) {
    console.log('✓ Properly caught invalid provider error:', error.message);
  }
  
  // Test similarity calculation errors
  try {
    service.calculateSimilarity([1, 2, 3], [1, 2], 'cosine');
    console.log('Mismatched dimensions were accepted (unexpected)');
  } catch (error: any) {
    console.log('✓ Properly caught dimension mismatch error:', error.message);
  }
}

// Example 8: Real-world Integration Example
async function integrationExample() {
  console.log('\n=== Integration Example: Memory Search ===');
  
  const service = getEmbeddingService();
  
  // Simulate stored memories with embeddings
  const memories = [
    { content: "Remember to buy groceries tomorrow", type: "reminder" },
    { content: "Meeting with team at 3 PM", type: "appointment" },
    { content: "Great Italian restaurant downtown", type: "recommendation" },
    { content: "Password for the new account is secure123", type: "credential" },
    { content: "Birthday party next weekend", type: "event" }
  ];
  
  console.log('Generating embeddings for stored memories...');
  const memoryEmbeddings = await service.generateBatchEmbeddings(
    memories.map(m => m.content)
  );
  
  // Simulate search queries
  const searchQueries = [
    "food recommendations",
    "upcoming meetings",
    "shopping reminders"
  ];
  
  for (const query of searchQueries) {
    console.log(`\nSearching memories for: "${query}"`);
    const queryEmbedding = await service.generateEmbedding(query);
    
    const results = memories.map((memory, index) => ({
      ...memory,
      similarity: service.calculateSimilarity(queryEmbedding, memoryEmbeddings[index], 'cosine').similarity
    }));
    
    results.sort((a, b) => b.similarity - a.similarity);
    
    const topResult = results[0];
    console.log(`Best match (${topResult.similarity.toFixed(3)}): ${topResult.content}`);
  }
}

// Main execution function
async function runExamples() {
  try {
    await basicUsage();
    await fullServiceUsage();
    await customConfiguration();
    await providerSpecificUsage();
    await semanticSearchDemo();
    await performanceDemo();
    await errorHandlingDemo();
    await integrationExample();
    
    console.log('\n=== All Examples Completed Successfully! ===');
  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// Export for use in other files or run directly
export {
    basicUsage, customConfiguration, errorHandlingDemo, fullServiceUsage, integrationExample, performanceDemo, providerSpecificUsage, runExamples, semanticSearchDemo
};

// Run examples if this file is executed directly
if (require.main === module) {
  runExamples();
}