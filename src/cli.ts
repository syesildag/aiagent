import "dotenv/config";
import * as readline from 'readline';
import Logger from './utils/logger';
import { authenticateWithGitHub, whoami } from './utils/githubAuth';
import { updateEnvVariables } from './utils/envManager';
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

/**
 * Handle the login command - list providers and configure authentication
 */
async function handleLoginCommand(rl: readline.Interface, updateManagerCallback: () => Promise<void>): Promise<void> {
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

      // Update the manager with new provider configuration
      await updateManagerCallback();

      console.log('✅ Ollama provider configured successfully!');
      console.log('Manager instance updated with new provider configuration.\n');
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

          // Update the manager with new provider configuration
          updateManagerCallback();

          console.log('✅ GitHub Copilot provider configured successfully!');
          console.log('Manager instance updated with new provider configuration.\n');
          break;
        }
      }

      // Authenticate with GitHub
      console.log('Starting GitHub authentication...');
      try {
        const token = await authenticateWithGitHub();

        // Update environment variables
        updateEnvVariables({
          'LLM_PROVIDER': 'github'
        });

        // Update the manager with new provider configuration
        updateManagerCallback();

        console.log('✅ GitHub Copilot provider configured successfully!');
        console.log('Manager instance updated with new provider configuration.\n');
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

      // Update the manager with new provider configuration
      updateManagerCallback();

      console.log('✅ OpenAI provider configured successfully!');
      console.log('Manager instance updated with new provider configuration.\n');
      break;

    default:
      console.log('Invalid choice. Please select 1, 2, or 3.\n');
      break;
  }
}

/**
 * Handle the model command - list available models and let user choose
 */
async function handleModelCommand(rl: readline.Interface, manager: MCPServerManager, updateManagerCallback: () => Promise<void>): Promise<void> {
  console.log('\n=== Model Selection ===');

  // Create a promise-based input function
  const askQuestion = (question: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  };

  const currentProvider = process.env.LLM_PROVIDER || 'ollama';
  const currentModel = process.env.LLM_MODEL || 'llama3.2:3b';

  console.log(`Current provider: ${currentProvider}`);
  console.log(`Current model: ${currentModel}\n`);

  // Get available models from the provider
  let availableModels: string[] = [];
  try {
    console.log('Fetching available models...');
    availableModels = await manager.getAvailableModels();
  } catch (error) {
    console.log(`❌ Error fetching models: ${error}`);
    console.log('You can still set a custom model name.\n');
  }

  if (availableModels.length === 0) {
    console.log(`❌ No predefined models available for provider: ${currentProvider}`);
    console.log('You can still set a custom model name.\n');

    const customModel = await askQuestion('Enter custom model name (or press Enter to cancel): ');
    if (customModel) {
      updateEnvVariables({
        'LLM_MODEL': customModel
      });
      console.log(`✅ Model updated to: ${customModel}`);
      console.log('Restart the application to use the new model.\n');
    } else {
      console.log('Model selection cancelled.\n');
    }
    return;
  }

  console.log(`Available models for ${currentProvider}:`);
  availableModels.forEach((model, index) => {
    const current = model === currentModel ? ' (current)' : '';
    console.log(`${index + 1}. ${model}${current}`);
  });
  console.log(`${availableModels.length + 1}. Enter custom model name`);
  console.log('');

  const choice = await askQuestion(`Select a model (1-${availableModels.length + 1}): `);
  const choiceNum = parseInt(choice);

  if (choiceNum >= 1 && choiceNum <= availableModels.length) {
    const selectedModel = availableModels[choiceNum - 1];

    if (selectedModel === currentModel) {
      console.log(`Model "${selectedModel}" is already selected.\n`);
      return;
    }

    updateEnvVariables({
      'LLM_MODEL': selectedModel
    });

    // Update the manager with new model configuration
    updateManagerCallback();

    console.log(`✅ Model updated to: ${selectedModel}`);
    console.log('Manager instance updated with new model configuration.\n');

  } else if (choiceNum === availableModels.length + 1) {
    const customModel = await askQuestion('Enter custom model name: ');
    if (customModel) {
      updateEnvVariables({
        'LLM_MODEL': customModel
      });

      // Update the manager with new model configuration
      updateManagerCallback();

      console.log(`✅ Model updated to: ${customModel}`);
      console.log('Manager instance updated with new model configuration.\n');
    } else {
      console.log('Model selection cancelled.\n');
    }
  } else {
    console.log('Invalid choice. Please select a valid option.\n');
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
  let model: string = process.env.LLM_MODEL || 'llama3.2:3b'; // get model from .env or default
  const providerType = process.env.LLM_PROVIDER || 'ollama';
  let actualProviderType = providerType; // Track the actual provider being used (after fallbacks)

  Logger.debug(`Provider: ${providerType}`);
  Logger.debug(`Model: ${model}`);

  switch (providerType.toLowerCase()) {
    case 'github':
    case 'copilot':
      // Use OAuth system to get current GitHub Copilot token
      const { AuthGithubCopilot } = await import('./utils/githubAuth.js');
      try {
        const githubApiKey = await AuthGithubCopilot.access();
        if (!githubApiKey) {
          Logger.error('GitHub Copilot requires authentication. Run "login" command to authenticate.');
          Logger.info('Falling back to Ollama provider...');
          llmProvider = new OllamaProvider();
          model = 'llama3.2:3b'; // Default model for Ollama
          actualProviderType = 'ollama'; // Update actual provider type
        } else {
          const githubBaseUrl = process.env.GITHUB_COPILOT_BASE_URL || 'https://api.githubcopilot.com';
          Logger.debug(`GitHub Base URL: ${githubBaseUrl}`);
          llmProvider = new GitHubCopilotProvider(githubApiKey, githubBaseUrl);
          Logger.info('Using GitHub Copilot provider');
          actualProviderType = 'github'; // Keep original provider type
        }
      } catch (error) {
        Logger.error(`GitHub Copilot authentication failed: ${error}`);
        Logger.info('Falling back to Ollama provider...');
        llmProvider = new OllamaProvider();
        model = 'llama3.2:3b'; // Default model for Ollama
        actualProviderType = 'ollama'; // Update actual provider type
      }
      break;

    case 'openai':
      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        Logger.error('OpenAI requires OPENAI_API_KEY environment variable');
        Logger.info('Falling back to Ollama provider...');
        llmProvider = new OllamaProvider();
        model = 'llama3.2:3b'; // Default model for Ollama
        actualProviderType = 'ollama';
        break;
      }
      else {
        llmProvider = new OpenAIProvider(openaiApiKey);
        Logger.info('Using OpenAI provider');
        actualProviderType = 'openai';
        break;
      }

    case 'ollama':
    default:
      llmProvider = new OllamaProvider();
      Logger.info('Using Ollama provider (local)');
      actualProviderType = 'ollama';
      break;
  }

  const currentManager = new MCPServerManager(process.env.MCP_SERVERS_PATH, llmProvider, model);

  /**
   * Create a new LLM provider based on current environment variables
   */
  async function createLLMProvider(): Promise<LLMProvider> {
    const currentProviderType = process.env.LLM_PROVIDER || 'ollama';

    switch (currentProviderType.toLowerCase()) {
      case 'github':
      case 'copilot':
        const { AuthGithubCopilot } = await import('./utils/githubAuth.js');
        try {
          const githubApiKey = await AuthGithubCopilot.access();
          if (!githubApiKey) {
            Logger.error('GitHub Copilot requires authentication. Run "login" command to authenticate.');
            Logger.info('Falling back to Ollama provider...');
            return new OllamaProvider();
          }
          const githubBaseUrl = process.env.GITHUB_COPILOT_BASE_URL || 'https://api.githubcopilot.com';
          return new GitHubCopilotProvider(githubApiKey, githubBaseUrl);
        } catch (error) {
          Logger.error(`GitHub Copilot authentication failed: ${error}`);
          Logger.info('Falling back to Ollama provider...');
          return new OllamaProvider();
        }

      case 'openai':
        const openaiApiKey = process.env.OPENAI_API_KEY;
        if (!openaiApiKey) {
          Logger.error('OpenAI requires OPENAI_API_KEY environment variable');
          throw new Error('OpenAI configuration incomplete');
        }
        return new OpenAIProvider(openaiApiKey);

      case 'ollama':
      default:
        return new OllamaProvider();
    }
  }

  /**
   * Update the manager's LLM provider and model based on current environment variables
   */
  async function updateManagerConfiguration(): Promise<void> {
    const newProvider = await createLLMProvider();
    const newModel = process.env.LLM_MODEL || 'llama3.2:3b';

    currentManager.updateConfiguration(newProvider, newModel);
    Logger.info('Manager configuration updated with new provider/model settings');
  }

  try {

    // Example interactions with the LLM using MCP tools
    console.log(`\n--- Interactive Chat with ${actualProviderType.toUpperCase()} ---`);
    console.log('Type your questions or commands. Special commands:');
    console.log('  - "help" - Show available commands');
    console.log('  - "login" - Configure LLM provider and authenticate');
    console.log('  - "status" - Show MCP server status');
    console.log('  - "refresh" - Refresh tools cache');
    console.log('  - "new/newchat" - Start a new conversation');
    console.log('  - "history" - Show conversation history');
    console.log('  - "current" - Show current conversation');
    console.log('  - "clearchat" - Clear conversation history');
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
    let isShuttingDown = false;

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
          if (!isShuttingDown) {
            isShuttingDown = true;
            console.log('\nGoodbye!');
            rl.close();
            await currentManager.stopAllServers();
            process.exit(0);
          }
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
          console.log('  - model: List and select available models');
          console.log('  - status: Show MCP server status and capabilities');
          console.log('  - refresh: Refresh tools cache from MCP servers');
          console.log('  - clear: Clear the screen');
          console.log('  - new/newchat: Start a new conversation');
          console.log('  - history: Show conversation history');
          console.log('  - current: Show current conversation messages');
          console.log('  - clearchat: Clear all conversation history');
          console.log('  - cancel: Cancel current operation');
          console.log('  - exit/quit: Exit the program');
          console.log('\nOr ask any question to chat with the AI assistant using MCP tools.');
          console.log('While processing, you can press Ctrl+C to cancel the current operation.\n');
          rl.prompt();
          return;
        }

        if (query.toLowerCase() === 'login') {
          try {
            await handleLoginCommand(rl, updateManagerConfiguration);
          } catch (error) {
            console.error(`Login failed: ${error}\n`);
          }
          rl.prompt();
          return;
        }

        if (query.toLowerCase() === 'model') {
          try {
            await handleModelCommand(rl, currentManager, updateManagerConfiguration);
          } catch (error) {
            console.error(`Model selection failed: ${error}\n`);
          }
          rl.prompt();
          return;
        }

        if (query.toLowerCase() === 'status') {
          console.log('\nMCP Server Status:');
          console.log('\nllmProvider:' + currentManager.getProviderName());
          console.log('\nmodel:' + currentManager.getCurrentModel());
          const status = currentManager.getServerStatus();
          console.log(JSON.stringify(status, null, 2));

          // Also show tools cache status
          const toolsCount = currentManager.getCachedToolsCount();
          const cacheExists = currentManager.isToolsCacheValid();
          console.log(`\nTools Cache: ${toolsCount} tools ${cacheExists ? 'cached' : 'not cached'}`);
          console.log('');
          rl.prompt();
          return;
        }

        if (query.toLowerCase() === 'refresh') {
          console.log('Refreshing tools cache...');
          const tools = await currentManager.refreshToolsCache();
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

        if (query.toLowerCase() === 'new' || query.toLowerCase() === 'newchat') {
          try {
            const conversationId = await currentManager.startNewConversation();
            console.log(`Started new conversation: ${conversationId}\n`);
          } catch (error) {
            console.error(`Failed to start new conversation: ${error}\n`);
          }
          rl.prompt();
          return;
        }

        if (query.toLowerCase() === 'history') {
          try {
            const conversations = await currentManager.getConversations();
            console.log('\nConversation History:');
            if (conversations.length === 0) {
              console.log('No conversations found.\n');
            } else {
              conversations.forEach((conv, index) => {
                console.log(`${index + 1}. ID: ${conv.id} - ${conv.messages.length} messages (${conv.createdAt})`);
              });
              console.log('');
            }
          } catch (error) {
            console.error(`Failed to get conversation history: ${error}\n`);
          }
          rl.prompt();
          return;
        }

        if (query.toLowerCase() === 'current') {
          try {
            const messages = await currentManager.getCurrentConversation();
            console.log('\nCurrent Conversation:');
            if (messages.length === 0) {
              console.log('No messages in current conversation.\n');
            } else {
              messages.forEach((msg, index) => {
                console.log(`${index + 1}. [${msg.role}]: ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}`);
              });
              console.log('');
            }
          } catch (error) {
            console.error(`Failed to get current conversation: ${error}\n`);
          }
          rl.prompt();
          return;
        }

        if (query.toLowerCase() === 'clearchat') {
          try {
            await currentManager.clearConversationHistory();
            console.log('All conversation history cleared.\n');
          } catch (error) {
            console.error(`Failed to clear conversation history: ${error}\n`);
          }
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

          const response = await currentManager.chatWithLLM(query, currentAbortController.signal, `
            You are a helpful AI assistant.
            Use available tools to answer user queries.
            If no tools are needed, just answer directly.

            Follow these steps for each interaction:

            1. User Identification:
              - You should assume that you are interacting with Serkan
              - If you have not identified Serkan, proactively try to do so.

            2. Memory Retrieval:
              - Always begin your chat by retrieving all the information from your knowledge graph
              - Always refer to your knowledge graph as your "memory"

            3. Memory
              - While conversing with the user, be attentive to any new information that falls into these categories:
                a) Basic Identity (age, gender, location, job title, education level, etc.)
                b) Behaviors (interests, habits, etc.)
                c) Preferences (communication style, preferred salutlanguage, etc.)
                d) Goals (goals, targets, aspirations, etc.)
                e) Relationships (personal and professional relationships up to 3 degrees of separation)

            4. Memory Update:
              - If any new information was gathered during the interaction, update your memory as follows:
                a) Create entities for recurring organizations, people, and significant events
                b) Connect them to the current entities using relations
                c) Store facts about them as observations
            `);

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
        if (!isShuttingDown) {
          isShuttingDown = true;
          console.log('\nShutting down...');
          await currentManager.stopAllServers();
          process.exit(0);
        }
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