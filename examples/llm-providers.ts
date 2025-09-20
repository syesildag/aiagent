#!/usr/bin/env ts-node

/**
 * Example demonstrating different LLM provider configurations
 * 
 * Usage:
 * 1. Using Ollama (default, local):
 *    npm run start
 * 
 * 2. Using GitHub Copilot:
 *    GITHUB_TOKEN=your_token LLM_PROVIDER=github npm run start
 * 
 * 3. Using OpenAI:
 *    OPENAI_API_KEY=your_key LLM_PROVIDER=openai npm run start
 */

import { GitHubCopilotProvider, OllamaProvider, OpenAIProvider } from '../src/mcp/llmProviders';
import { MCPServerManager } from '../src/mcp/mcpManager';
import Logger from '../src/utils/logger';

async function demonstrateProviders() {
  Logger.info('=== LLM Provider Demonstration ===\n');

  // Example 1: Using Ollama provider directly
  Logger.info('1. Direct Ollama Provider Usage:');
  try {
    const ollamaProvider = new OllamaProvider();
    const ollamaManager = new MCPServerManager(process.env.MCP_SERVERS_PATH, ollamaProvider, 'qwen3:4b');

    const isHealthy = await ollamaManager.checkHealth();
    Logger.info(`   Ollama Health: ${isHealthy ? 'OK' : 'Not Available'}`);
    
    if (isHealthy) {
      const models = await ollamaManager.getAvailableModels();
      Logger.info(`   Available Models: ${models.join(', ')}`);
    }
  } catch (error) {
    Logger.info(`   Error: ${error instanceof Error ? error.message : String(error)}`);
  }
  Logger.info('');

  // Example 2: Using GitHub Copilot provider (if token available)
  Logger.info('2. GitHub Copilot Provider Usage:');
  if (process.env.GITHUB_TOKEN) {
    try {
      const copilotProvider = new GitHubCopilotProvider(process.env.GITHUB_TOKEN);
      const copilotManager = new MCPServerManager(process.env.MCP_SERVERS_PATH, copilotProvider, 'gpt-4o');
      
      const isHealthy = await copilotManager.checkHealth();
      Logger.info(`   GitHub Copilot Health: ${isHealthy ? 'OK' : 'Not Available'}`);
      
      if (isHealthy) {
        const models = await copilotManager.getAvailableModels();
        Logger.info(`   Available Models: ${models.join(', ')}`);
      }
    } catch (error) {
      Logger.info(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    Logger.info('   Skipped - GITHUB_TOKEN not set');
  }
  Logger.info('');

  // Example 3: Using OpenAI provider (if API key available)
  Logger.info('3. OpenAI Provider Usage:');
  if (process.env.OPENAI_API_KEY) {
    try {
      const openaiProvider = new OpenAIProvider(process.env.OPENAI_API_KEY);
      const openaiManager = new MCPServerManager(process.env.MCP_SERVERS_PATH, openaiProvider, 'gpt-4');
      
      const isHealthy = await openaiManager.checkHealth();
      Logger.info(`   OpenAI Health: ${isHealthy ? 'OK' : 'Not Available'}`);
      
      if (isHealthy) {
        const models = await openaiManager.getAvailableModels();
        Logger.info(`   Available Models: ${models.join(', ')}`);
      }
    } catch (error) {
      Logger.info(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    Logger.info('   Skipped - OPENAI_API_KEY not set');
  }
  Logger.info('');

  Logger.info('=== Provider Configuration Tips ===');
  Logger.info('• For GitHub Copilot: Get token from https://github.com/settings/tokens');
  Logger.info('• For OpenAI: Get API key from https://platform.openai.com/api-keys');
  Logger.info('• For Ollama: Make sure Ollama is running locally (ollama serve)');
  Logger.info('');
  Logger.info('Environment Variables:');
  Logger.info('  export GITHUB_TOKEN="your_github_token"');
  Logger.info('  export OPENAI_API_KEY="your_openai_key"');
  Logger.info('  export LLM_PROVIDER="ollama|github|openai"');
}

// Run the demonstration
if (require.main === module) {
  demonstrateProviders().catch(Logger.error);
}
