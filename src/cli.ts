import "dotenv/config";
import * as readline from 'readline';
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
  console.log('=== LLM Provider Options ===');
  console.log('1. Ollama (local) - Default');
  console.log('2. GitHub Copilot (requires API key)');
  console.log('3. OpenAI (requires API key)');
  console.log('');

  // For demo purposes, using Ollama. In production, you could:
  // - Read from environment variables
  // - Use command line arguments
  // - Prompt user for selection
  
  let llmProvider: LLMProvider;
  const providerType = process.env.LLM_PROVIDER || 'ollama';
  
  switch (providerType.toLowerCase()) {
    case 'github':
    case 'copilot':
      const githubApiKey = process.env.GITHUB_TOKEN;
      if (!githubApiKey) {
        console.error('GitHub Copilot requires GITHUB_TOKEN environment variable');
        process.exit(1);
      }
      llmProvider = new GitHubCopilotProvider(githubApiKey);
      console.log('Using GitHub Copilot provider');
      break;
    
    case 'openai':
      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        console.error('OpenAI requires OPENAI_API_KEY environment variable');
        process.exit(1);
      }
      llmProvider = new OpenAIProvider(openaiApiKey);
      console.log('Using OpenAI provider');
      break;
    
    case 'ollama':
    default:
      llmProvider = new OllamaProvider();
      console.log('Using Ollama provider (local)');
      break;
  }

  const manager = new MCPServerManager(process.env.MCP_SERVERS_PATH, llmProvider);

  try {
    // Load MCP server configuration
    await manager.loadServersConfig();

    // Check if the selected LLM provider is available
    const providerAvailable = await manager.checkHealth();
    if (!providerAvailable) {
      console.error(`${providerType} provider is not available. Please check your configuration.`);
      process.exit(1);
    }

    console.log(`${providerType} provider is available`);
    const models = await manager.getAvailableModels();
    console.log('Available models:', models);

    // Start all MCP servers
    await manager.startAllServers();
    console.log('All MCP servers started');

    // Show server status and capabilities
    const status = manager.getServerStatus();
    console.log('\nMCP Server Status and Capabilities:');
    console.log(JSON.stringify(status, null, 2));

    // Example interactions with the LLM using MCP tools
    console.log(`\n--- Interactive Chat with ${providerType.toUpperCase()} using MCP tools ---`);
    console.log('Type your questions or commands. Special commands:');
    console.log('  - "help" - Show available commands');
    console.log('  - "status" - Show MCP server status');
    console.log('  - "refresh" - Refresh tools cache');
    console.log('  - "cancel" - Cancel current operation');
    console.log('  - "clear" - Clear the screen');
    console.log('  - "exit" or "quit" - Exit the program');
    console.log('\nLLM Provider Configuration:');
    console.log('  - Default: Ollama (local)');
    console.log('  - Set LLM_PROVIDER=github and GITHUB_TOKEN=<token> for GitHub Copilot');
    console.log('  - Set LLM_PROVIDER=openai and OPENAI_API_KEY=<key> for OpenAI');
    console.log('\nDuring processing, you can:');
    console.log('  - Type "cancel" to cancel the current operation');
    console.log('  - Press Ctrl+C to cancel the current operation');
    console.log('\nSuggested queries to try:');
    console.log('  - "What tools and capabilities are available to me?"');
    console.log('  - "Can you list the current directory contents?"');
    console.log('  - "What resources can you access?"');
    console.log('');
    
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
          console.log('\nGoodbye!');
          rl.close();
          await manager.stopAllServers();
          process.exit(0);
        }
        
        if (query.toLowerCase() === 'cancel') {
          if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
            console.log('Operation cancelled.\n');
          } else {
            console.log('No operation to cancel.\n');
          }
          rl.prompt();
          return;
        }
        
        if (query.toLowerCase() === 'help') {
          console.log('\nAvailable commands:');
          console.log('  - help: Show this help message');
          console.log('  - status: Show MCP server status and capabilities');
          console.log('  - refresh: Refresh tools cache from MCP servers');
          console.log('  - clear: Clear the screen');
          console.log('  - cancel: Cancel current operation');
          console.log('  - exit/quit: Exit the program');
          console.log('\nOr ask any question to chat with the AI assistant using MCP tools.');
          console.log('While processing, you can press Ctrl+C to cancel the current operation.\n');
          rl.prompt();
          return;
        }
        
        if (query.toLowerCase() === 'status') {
          console.log('\nMCP Server Status:');
          const status = manager.getServerStatus();
          console.log(JSON.stringify(status, null, 2));
          
          // Also show tools cache status
          const toolsCount = manager.getCachedToolsCount();
          const cacheExists = manager.isToolsCacheValid();
          console.log(`\nTools Cache: ${toolsCount} tools ${cacheExists ? 'cached' : 'not cached'}`);
          console.log('');
          rl.prompt();
          return;
        }
        
        if (query.toLowerCase() === 'refresh') {
          console.log('Refreshing tools cache...');
          const tools = manager.refreshToolsCache();
          console.log(`Tools cache refreshed with ${tools.length} tools.\n`);
          rl.prompt();
          return;
        }
        
        if (query.toLowerCase() === 'clear') {
          console.clear();
          console.log('--- Interactive Chat with LLM using MCP tools ---');
          console.log('Type "help" for available commands.\n');
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
          console.log(`Assistant: ${response}\n`);
        } catch (error) {
          // Clear the abort controller
          currentAbortController = null;
          
          if (error instanceof Error && error.message === 'Operation cancelled by user') {
            console.log('Operation was cancelled.\n');
          } else {
            console.error(`Error: ${error}\n`);
          }
        }
        
        rl.prompt();
      });
      
      rl.on('close', async () => {
        console.log('\nShutting down...');
        await manager.stopAllServers();
        process.exit(0);
      });
      
      // Handle Ctrl+C gracefully
      rl.on('SIGINT', () => {
        if (currentAbortController) {
          // If there's an ongoing operation, cancel it
          currentAbortController.abort();
          currentAbortController = null;
          console.log('\nOperation cancelled. Type "exit" to quit or continue chatting.');
          rl.prompt();
        } else {
          // If no operation is running, just show the prompt
          console.log('\nType "exit" to quit gracefully.');
          rl.prompt();
        }
      });
    };

    // Start the interactive chat
    chatLoop();

  } catch (error) {
    console.error('Error in main:', error);
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