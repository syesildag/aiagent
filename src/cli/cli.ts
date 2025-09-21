import "dotenv/config";
import * as readline from 'readline';
import Logger from '../utils/logger';
import { authenticateWithGitHub, whoami } from '../utils/githubAuth';
import { updateEnvVariables } from '../utils/envManager';
import {
  GitHubCopilotProvider,
  LLMChatResponse,
  LLMMessage,
  LLMProvider,
  OllamaProvider,
  OpenAIProvider,
  Tool
} from '../mcp/llmProviders';
import { MCPConfig, MCPServer, MCPServerManager } from '../mcp/mcpManager';

/**
 * Handle the login command - list providers and configure authentication
 */
async function handleLoginCommand(rl: readline.Interface): Promise<void> {
  console.log('\n=== LLM Provider Configuration ===');
  console.log('Available LLM providers:');
  console.log('1. Ollama (local) - No authentication required');
  console.log('2. GitHub Copilot - Requires GitHub authentication');
  console.log('3. OpenAI - Requires API key');
  console.log('');

  // Create a promise-based input function
  const askQuestion = (question: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  };

  const choice = await askQuestion('Select a provider (1-3): ');

  switch (choice) {
    case '1':
      // Ollama
      console.log('\nConfiguring Ollama provider...');
      updateEnvVariables({
        'LLM_PROVIDER': 'ollama'
      });
      console.log('✅ Ollama provider configured successfully!');
      console.log('Restart the application to use the new provider.\n');
      break;

    case '2':
      // GitHub Copilot
      console.log('\nConfiguring GitHub Copilot provider...');
      
      // Check if already authenticated
      const currentUser = await whoami();
      if (currentUser) {
        console.log(`Already authenticated as: ${currentUser}`);
        const reauth = await askQuestion('Do you want to re-authenticate? (y/N): ');
        if (reauth.toLowerCase() !== 'y' && reauth.toLowerCase() !== 'yes') {
          console.log('Using existing GitHub authentication.\n');
          updateEnvVariables({
            'LLM_PROVIDER': 'github'
          });
          console.log('✅ GitHub Copilot provider configured successfully!');
          console.log('Restart the application to use the new provider.\n');
          break;
        }
      }

      // Authenticate with GitHub
      console.log('Starting GitHub authentication...');
      try {
        const token = await authenticateWithGitHub();
        
        // Update environment variables
        updateEnvVariables({
          'LLM_PROVIDER': 'github',
          'GITHUB_TOKEN': token
        });
        
        console.log('✅ GitHub Copilot provider configured successfully!');
        console.log('Restart the application to use the new provider.\n');
      } catch (error) {
        console.error(`GitHub authentication failed: ${error}`);
        console.log('Provider configuration cancelled.\n');
      }
      break;

    case '3':
      // OpenAI
      console.log('\nConfiguring OpenAI provider...');
      const apiKey = await askQuestion('Enter your OpenAI API key: ');
      
      if (!apiKey) {
        console.log('API key is required for OpenAI provider.\n');
        break;
      }

      updateEnvVariables({
        'LLM_PROVIDER': 'openai',
        'OPENAI_API_KEY': apiKey
      });
      
      console.log('✅ OpenAI provider configured successfully!');
      console.log('Restart the application to use the new provider.\n');
      break;

    default:
      console.log('Invalid choice. Please select 1, 2, or 3.\n');
      break;
  }
}

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

  // Flag to track if MCP servers have been initialized
  let mcpInitialized = false;

  /**
   * Initialize MCP servers on first use
   */
  async function initializeMCPServers(): Promise<void> {
    if (mcpInitialized) {
      return;
    }

    try {
      console.log('Initializing MCP servers...');
      
      // Load MCP server configuration
      await manager.loadServersConfig();

      // Check if the selected LLM provider is available
      Logger.debug('Checking provider health...');
      const providerAvailable = await manager.checkHealth();
      Logger.debug(`Provider health check result: ${providerAvailable}`);
      if (!providerAvailable) {
        Logger.error(`${providerType} provider is not available. Please check your configuration.`);
        return;
      }

      Logger.info(`${providerType} provider is available`);
      const models = await manager.getAvailableModels();
      Logger.debug(`Available models: ${JSON.stringify(models)}`);

      // Start all MCP servers
      await manager.startAllServers();
      Logger.info('All MCP servers started');

      mcpInitialized = true;
      console.log('✅ MCP servers initialized successfully!\n');
    } catch (error) {
      Logger.error(`Failed to initialize MCP servers: ${error}`);
      console.log('⚠️  MCP initialization failed. Some features may not be available.\n');
    }
  }

  try {

    // Example interactions with the LLM using MCP tools
    console.log(`\n--- Interactive Chat with ${providerType.toUpperCase()} ---`);
    console.log('Type your questions or commands. Special commands:');
    console.log('  - "help" - Show available commands');
    console.log('  - "login" - Configure LLM provider and authenticate');
    console.log('  - "status" - Show MCP server status');
    console.log('  - "refresh" - Refresh tools cache');
    console.log('  - "cancel" - Cancel current operation');
    console.log('  - "clear" - Clear the screen');
    console.log('  - "exit" or "quit" - Exit the program');
    console.log('\nLLM Provider Configuration:');
    console.log('  - Default: Ollama (local)');
    console.log('  - Use "login" command to configure GitHub Copilot or OpenAI');
    console.log('\nMCP servers will be initialized on first use.');
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
          if (mcpInitialized) {
            await manager.stopAllServers();
          }
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
          console.log('  - login: Configure LLM provider and authenticate');
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

        if (query.toLowerCase() === 'login') {
          try {
            await handleLoginCommand(rl);
          } catch (error) {
            console.error(`Login failed: ${error}\n`);
          }
          rl.prompt();
          return;
        }
        
        if (query.toLowerCase() === 'status') {
          await initializeMCPServers();
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
          await initializeMCPServers();
          console.log('Refreshing tools cache...');
          const tools = await manager.refreshToolsCache();
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
          // Initialize MCP servers on first user query if not already done
          await initializeMCPServers();
          
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
        if (mcpInitialized) {
          await manager.stopAllServers();
        }
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