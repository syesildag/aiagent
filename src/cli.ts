import "dotenv/config";
import * as readline from 'readline';
import Logger from './utils/logger';
import {
  GitHubCopilotProvider,
  LLMChatResponse,
  LLMMessage,
  LLMProvider,
  OllamaProvider,
  OpenAIProvider,
  Tool
} from './mcp/llmProviders';
import { MCPConfig, MCPServer, MCPServerManager } from './mcp/mcpManager';

// LLM Provider Implementations
// Example usage and CLI interface
async function main() {
  // Demo different LLM providers
  Logger.info('=== LLM Provider Options ===');
  Logger.info('1. Ollama (local) - Default');
  Logger.info('2. GitHub Copilot (requires API key)');
  Logger.info('3. OpenAI (requires API key)');
  Logger.info('');

  // For demo purposes, using Ollama. In production, you could:
  // - Read from environment variables
  // - Use command line arguments
  // - Prompt user for selection
  
  let llmProvider: LLMProvider;
  let model: string = process.env.LLM_MODEL || 'qwen3:4b'; // get model from .env or default
  const providerType = process.env.LLM_PROVIDER || 'ollama';
  
  Logger.debug(`Provider: ${providerType}`);
  Logger.debug(`Model: ${model}`);
  
  switch (providerType.toLowerCase()) {
    case 'github':
    case 'copilot':
      const githubApiKey = process.env.GITHUB_TOKEN;
      if (!githubApiKey) {
        Logger.error('GitHub Copilot requires GITHUB_TOKEN environment variable');
        process.exit(1);
      }
      const githubBaseUrl = process.env.GITHUB_COPILOT_BASE_URL || 'https://models.inference.ai.azure.com';
      Logger.debug(`GitHub Base URL: ${githubBaseUrl}`);
      llmProvider = new GitHubCopilotProvider(githubApiKey, githubBaseUrl);
      Logger.info('Using GitHub Copilot provider');
      break;
    
    case 'openai':
      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        Logger.error('OpenAI requires OPENAI_API_KEY environment variable');
        process.exit(1);
      }
      llmProvider = new OpenAIProvider(openaiApiKey);
      Logger.info('Using OpenAI provider');
      break;
    
    case 'ollama':
    default:
      llmProvider = new OllamaProvider();
      Logger.info('Using Ollama provider (local)');
      break;
  }

  const manager = new MCPServerManager(process.env.MCP_SERVERS_PATH, llmProvider, model);

  try {
    // Load MCP server configuration
    await manager.loadServersConfig();

    // Check if the selected LLM provider is available
    Logger.debug('Checking provider health...');
    const providerAvailable = await manager.checkHealth();
    Logger.debug(`Provider health check result: ${providerAvailable}`);
    if (!providerAvailable) {
      Logger.error(`${providerType} provider is not available. Please check your configuration.`);
      process.exit(1);
    }

    Logger.info(`${providerType} provider is available`);
    const models = await manager.getAvailableModels();
    Logger.debug(`Available models: ${JSON.stringify(models)}`);

    // Start all MCP servers
    await manager.startAllServers();
    Logger.info('All MCP servers started');

    // Show server status and capabilities
    const status = manager.getServerStatus();
    Logger.info('\nMCP Server Status and Capabilities:');
    Logger.info(JSON.stringify(status, null, 2));

    // Example interactions with the LLM using MCP tools
    Logger.info(`\n--- Interactive Chat with ${providerType.toUpperCase()} using MCP tools ---`);
    Logger.info('Type your questions or commands. Special commands:');
    Logger.info('  - "help" - Show available commands');
    Logger.info('  - "status" - Show MCP server status');
    Logger.info('  - "refresh" - Refresh tools cache');
    Logger.info('  - "cancel" - Cancel current operation');
    Logger.info('  - "clear" - Clear the screen');
    Logger.info('  - "exit" or "quit" - Exit the program');
    Logger.info('\nLLM Provider Configuration:');
    Logger.info('  - Default: Ollama (local)');
    Logger.info('  - Set LLM_PROVIDER=github and GITHUB_TOKEN=<token> for GitHub Copilot');
    Logger.info('  - Set LLM_PROVIDER=openai and OPENAI_API_KEY=<key> for OpenAI');
    Logger.info('\nDuring processing, you can:');
    Logger.info('  - Type "cancel" to cancel the current operation');
    Logger.info('  - Press Ctrl+C to cancel the current operation');
    Logger.info('\nSuggested queries to try:');
    Logger.info('  - "What tools and capabilities are available to me?"');
    Logger.info('  - "Can you list the current directory contents?"');
    Logger.info('  - "What resources can you access?"');
    Logger.info('');
    
    // Create readline interface for interactive input
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> '
    });

    // Interactive chat loop
    let currentAbortController: AbortController | null = null;
    
    const chatLoop = () => {
      rl.prompt();
      
      rl.on('line', async (input: string) => {
        const query = input.trim();
        
        if (query.toLowerCase() === 'exit' || query.toLowerCase() === 'quit') {
          // Cancel any ongoing operation
          if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
          }
          Logger.info('\nGoodbye!');
          rl.close();
          await manager.stopAllServers();
          process.exit(0);
        }
        
        if (query.toLowerCase() === 'cancel') {
          if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
            Logger.info('Operation cancelled.\n');
          } else {
            Logger.info('No operation to cancel.\n');
          }
          rl.prompt();
          return;
        }
        
        if (query.toLowerCase() === 'help') {
          Logger.info('\nAvailable commands:');
          Logger.info('  - help: Show this help message');
          Logger.info('  - status: Show MCP server status and capabilities');
          Logger.info('  - refresh: Refresh tools cache from MCP servers');
          Logger.info('  - clear: Clear the screen');
          Logger.info('  - cancel: Cancel current operation');
          Logger.info('  - exit/quit: Exit the program');
          Logger.info('\nOr ask any question to chat with the AI assistant using MCP tools.');
          Logger.info('While processing, you can press Ctrl+C to cancel the current operation.\n');
          rl.prompt();
          return;
        }
        
        if (query.toLowerCase() === 'status') {
          Logger.info('\nMCP Server Status:');
          const status = manager.getServerStatus();
          Logger.info(JSON.stringify(status, null, 2));
          
          // Also show tools cache status
          const toolsCount = manager.getCachedToolsCount();
          const cacheExists = manager.isToolsCacheValid();
          Logger.info(`\nTools Cache: ${toolsCount} tools ${cacheExists ? 'cached' : 'not cached'}`);
          Logger.info('');
          rl.prompt();
          return;
        }
        
        if (query.toLowerCase() === 'refresh') {
          Logger.info('Refreshing tools cache...');
          const tools = await manager.refreshToolsCache();
          Logger.info(`Tools cache refreshed with ${tools.length} tools.\n`);
          rl.prompt();
          return;
        }
        
        if (query.toLowerCase() === 'clear') {
          console.clear();
          Logger.info('--- Interactive Chat with LLM using MCP tools ---');
          Logger.info('Type "help" for available commands.\n');
          rl.prompt();
          return;
        }
        
        if (query === '') {
          rl.prompt();
          return;
        }
        
        try {
          // Create new AbortController for this operation
          currentAbortController = new AbortController();
          console.log('Assistant: Thinking... (type "cancel" or press Ctrl+C to cancel)');
          
          const response = await manager.chatWithLLM(query, currentAbortController.signal);
          
          // Clear the abort controller since operation completed successfully
          currentAbortController = null;
          Logger.info(`Assistant: ${response}\n`);
        } catch (error) {
          // Clear the abort controller
          currentAbortController = null;
          
          if (error instanceof Error && error.message === 'Operation cancelled by user') {
            Logger.info('Operation was cancelled.\n');
          } else {
            Logger.error(`Error: ${error}\n`);
          }
        }
        
        rl.prompt();
      });
      
      rl.on('close', async () => {
        Logger.info('\nShutting down...');
        await manager.stopAllServers();
        process.exit(0);
      });
      
      // Handle Ctrl+C gracefully
      rl.on('SIGINT', () => {
        if (currentAbortController) {
          // If there's an ongoing operation, cancel it
          currentAbortController.abort();
          currentAbortController = null;
          Logger.info('\nOperation cancelled. Type "exit" to quit or continue chatting.');
          rl.prompt();
        } else {
          // If no operation is running, just show the prompt
          Logger.info('\nType "exit" to quit gracefully.');
          rl.prompt();
        }
      });
    };

    // Start the interactive chat
    chatLoop();

  } catch (error) {
    Logger.error(`Error in main: ${error}`);
    process.exit(1);
  }
}

// Export the class for use in other modules
export {
  LLMChatResponse, LLMMessage, LLMProvider, MCPConfig,
  MCPServer, Tool
};

// Run the main function if this file is executed directly
if (require.main === module) {
  main();
}