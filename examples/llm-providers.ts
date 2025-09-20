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

import { MCPServerManager, OllamaProvider, GitHubCopilotProvider, OpenAIProvider, LLMProvider } from '../src/cli';

async function demonstrateProviders() {
  console.log('=== LLM Provider Demonstration ===\n');

  // Example 1: Using Ollama provider directly
  console.log('1. Direct Ollama Provider Usage:');
  try {
    const ollamaProvider = new OllamaProvider();
    const ollamaManager = new MCPServerManager(process.env.MCP_SERVERS_PATH, ollamaProvider, 'qwen3:4b');

    const isHealthy = await ollamaManager.checkHealth();
    console.log(`   Ollama Health: ${isHealthy ? 'OK' : 'Not Available'}`);
    
    if (isHealthy) {
      const models = await ollamaManager.getAvailableModels();
      console.log(`   Available Models: ${models.join(', ')}`);
    }
  } catch (error) {
    console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log();

  // Example 2: Using GitHub Copilot provider (if token available)
  console.log('2. GitHub Copilot Provider Usage:');
  if (process.env.GITHUB_TOKEN) {
    try {
      const copilotProvider = new GitHubCopilotProvider(process.env.GITHUB_TOKEN);
      const copilotManager = new MCPServerManager(process.env.MCP_SERVERS_PATH, copilotProvider, 'gpt-4o');
      
      const isHealthy = await copilotManager.checkHealth();
      console.log(`   GitHub Copilot Health: ${isHealthy ? 'OK' : 'Not Available'}`);
      
      if (isHealthy) {
        const models = await copilotManager.getAvailableModels();
        console.log(`   Available Models: ${models.join(', ')}`);
      }
    } catch (error) {
      console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    console.log('   Skipped - GITHUB_TOKEN not set');
  }
  console.log();

  // Example 3: Using OpenAI provider (if API key available)
  console.log('3. OpenAI Provider Usage:');
  if (process.env.OPENAI_API_KEY) {
    try {
      const openaiProvider = new OpenAIProvider(process.env.OPENAI_API_KEY);
      const openaiManager = new MCPServerManager(process.env.MCP_SERVERS_PATH, openaiProvider, 'gpt-4');
      
      const isHealthy = await openaiManager.checkHealth();
      console.log(`   OpenAI Health: ${isHealthy ? 'OK' : 'Not Available'}`);
      
      if (isHealthy) {
        const models = await openaiManager.getAvailableModels();
        console.log(`   Available Models: ${models.join(', ')}`);
      }
    } catch (error) {
      console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    console.log('   Skipped - OPENAI_API_KEY not set');
  }
  console.log();

  console.log('=== Provider Configuration Tips ===');
  console.log('• For GitHub Copilot: Get token from https://github.com/settings/tokens');
  console.log('• For OpenAI: Get API key from https://platform.openai.com/api-keys');
  console.log('• For Ollama: Make sure Ollama is running locally (ollama serve)');
  console.log();
  console.log('Environment Variables:');
  console.log('  export GITHUB_TOKEN="your_github_token"');
  console.log('  export OPENAI_API_KEY="your_openai_key"');
  console.log('  export LLM_PROVIDER="ollama|github|openai"');
}

// Run the demonstration
if (require.main === module) {
  demonstrateProviders().catch(console.error);
}
