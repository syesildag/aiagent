/**
 * Example: GitHub Copilot Embedding Provider Usage
 * 
 * This example demonstrates different ways to use the GitHub Copilot embedding provider:
 * 1. OAuth authentication (default)
 * 2. API key authentication
 * 3. Mixed authentication (OAuth with API key fallback)
 */

import { GitHubCopilotEmbeddingProvider, getEmbeddingService } from '../src/utils/embeddingService';
import Logger from '../src/utils/logger';

async function demonstrateGitHubCopilotEmbedding() {
  Logger.info('GitHub Copilot Embedding Provider Examples');

  // Example 1: OAuth authentication (default behavior)
  Logger.info('\n1. OAuth Authentication (default):');
  try {
    const oauthProvider = GitHubCopilotEmbeddingProvider.withOAuth({
      defaultModel: 'text-embedding-3-small'
    });
    
    const isAvailable = await oauthProvider.isAvailable();
    Logger.info(`OAuth provider available: ${isAvailable}`);
    
    if (isAvailable) {
      const embedding = await oauthProvider.generateEmbedding({
        input: 'Hello, GitHub Copilot embeddings!'
      });
      Logger.info(`Generated embedding with ${embedding.embedding.length} dimensions using model: ${embedding.model}`);
    }
  } catch (error) {
    Logger.warn(`OAuth authentication failed: ${error}`);
  }

  // Example 2: API Key authentication
  Logger.info('\n2. API Key Authentication:');
  const apiKey = process.env.GITHUB_COPILOT_API_KEY;
  if (apiKey) {
    try {
      const apiKeyProvider = GitHubCopilotEmbeddingProvider.withApiKey(apiKey, {
        defaultModel: 'text-embedding-3-small'
      });
      
      const isAvailable = await apiKeyProvider.isAvailable();
      Logger.info(`API Key provider available: ${isAvailable}`);
      
      if (isAvailable) {
        const embedding = await apiKeyProvider.generateEmbedding({
          input: 'Hello, GitHub Copilot with API key!'
        });
        Logger.info(`Generated embedding with ${embedding.embedding.length} dimensions using model: ${embedding.model}`);
      }
    } catch (error) {
      Logger.error(`API Key authentication failed: ${error}`);
    }
  } else {
    Logger.info('GITHUB_COPILOT_API_KEY environment variable not set, skipping API key example');
  }

  // Example 3: Using the global embedding service with GitHub provider
  Logger.info('\n3. Global Embedding Service with GitHub Copilot:');
  try {
    const embeddingService = getEmbeddingService({
      provider: 'github',
      github: {
        defaultModel: 'text-embedding-3-small',
        useOAuth: true
      }
    });

    const embedding = await embeddingService.generateEmbedding(
      'This is a test with the global embedding service',
      { provider: 'github' }
    );
    
    Logger.info(`Generated embedding with ${embedding.length} dimensions via global service`);
  } catch (error) {
    Logger.error(`Global service failed: ${error}`);
  }

  // Example 4: Batch embeddings
  Logger.info('\n4. Batch Embeddings:');
  try {
    const provider = GitHubCopilotEmbeddingProvider.withOAuth();
    const isAvailable = await provider.isAvailable();
    
    if (isAvailable) {
      const texts = [
        'First text for embedding',
        'Second text for embedding',
        'Third text for embedding'
      ];
      
      const embeddings = await provider.generateBatchEmbeddings({
        inputs: texts,
        model: 'text-embedding-3-small'
      });
      
      Logger.info(`Generated ${embeddings.length} batch embeddings`);
      embeddings.forEach((emb, idx) => {
        Logger.info(`  Text ${idx + 1}: ${emb.embedding.length} dimensions, model: ${emb.model}`);
      });
    }
  } catch (error) {
    Logger.error(`Batch embeddings failed: ${error}`);
  }
}

// Run the example
if (require.main === module) {
  demonstrateGitHubCopilotEmbedding()
    .then(() => {
      Logger.info('\nGitHub Copilot embedding examples completed');
      process.exit(0);
    })
    .catch((error) => {
      Logger.error('Example failed:', error);
      process.exit(1);
    });
}

export { demonstrateGitHubCopilotEmbedding };