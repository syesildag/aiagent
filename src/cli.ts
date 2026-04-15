import "dotenv/config";
import * as readline from 'readline';
import Logger from './utils/logger';
import { config } from './utils/config';
import { authenticateWithGitHub, whoami } from './utils/githubAuth';
import { updateEnvVariables } from './utils/envManager';
import { LLMChatResponse, LLMMessage, LLMProvider, Tool } from './mcp/llmProviders';
import { MCPConfig, MCPServer, MCPServerManager } from './mcp/mcpManager';
import { initializeAgents, getAgentFromName, getGlobalMCPManager, reinitializeAgentSystem, Agent } from './agent';
import { slashCommandRegistry } from './utils/slashCommandRegistry';
import { processCommand } from './utils/commandProcessor';

/**
 * Handle the login command - list providers and configure authentication
 */
async function handleLoginCommand(rl: readline.Interface, updateManagerCallback: () => Promise<void>): Promise<void> {
  console.log('\n=== LLM Provider Configuration ===');
  console.log('Available LLM providers:');
  console.log('1. Ollama (local) - No authentication required');
  console.log('2. GitHub Copilot - Requires GitHub authentication');
  console.log('3. OpenAI - Requires API key');
  console.log('4. Anthropic - Requires API key');
  console.log('');

  // Create a promise-based input function
  const askQuestion = (question: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  };

  const choice = await askQuestion('Select a provider (1-4): ');

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
          await updateManagerCallback();

          console.log('✅ GitHub Copilot provider configured successfully!');
          console.log('Manager instance updated with new provider configuration.\n');
          break;
        }
      }

      // Authenticate with GitHub
      console.log('Starting GitHub authentication...');
      try {
        await authenticateWithGitHub();

        // Update environment variables
        updateEnvVariables({
          'LLM_PROVIDER': 'github'
        });

        // Update the manager with new provider configuration
        await updateManagerCallback();

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
      await updateManagerCallback();

      console.log('✅ OpenAI provider configured successfully!');
      console.log('Manager instance updated with new provider configuration.\n');
      break;

    case '4':
      // Anthropic
      console.log('\nConfiguring Anthropic provider...');
      const anthropicApiKey = await askQuestion('Enter your Anthropic API key: ');

      if (!anthropicApiKey) {
        console.log('API key is required for Anthropic provider.\n');
        break;
      }

      updateEnvVariables({
        'LLM_PROVIDER': 'anthropic',
        'ANTHROPIC_API_KEY': anthropicApiKey
      });

      // Update the manager with new provider configuration
      await updateManagerCallback();

      console.log('✅ Anthropic provider configured successfully!');
      console.log('Manager instance updated with new provider configuration.\n');
      break;

    default:
      console.log('Invalid choice. Please select 1, 2, 3, or 4.\n');
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

  const currentProvider = config.LLM_PROVIDER;
  const currentModel = config.LLM_MODEL;

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
    await updateManagerCallback();

    console.log(`✅ Model updated to: ${selectedModel}`);
    console.log('Manager instance updated with new model configuration.\n');

  } else if (choiceNum === availableModels.length + 1) {
    const customModel = await askQuestion('Enter custom model name: ');
    if (customModel) {
      updateEnvVariables({
        'LLM_MODEL': customModel
      });

      // Update the manager with new model configuration
      await updateManagerCallback();

      console.log(`✅ Model updated to: ${customModel}`);
      console.log('Manager instance updated with new model configuration.\n');
    } else {
      console.log('Model selection cancelled.\n');
    }
  } else {
    console.log('Invalid choice. Please select a valid option.\n');
  }
}

async function main() {
  // Initialize the agent system — creates the MCP manager, registers all agents,
  // loads file-based agents from .aiagent/agents/, and wires up the sub-agent runner.
  await initializeAgents();

  let generalAgent: Agent = await getAgentFromName('general');
  let currentManager = getGlobalMCPManager()!;

  /**
   * Re-initialize the agent system after a provider or model change.
   * Reassigns local bindings so the chat loop picks up the new config automatically.
   */
  async function updateManagerConfiguration(): Promise<void> {
    await reinitializeAgentSystem();
    generalAgent = await getAgentFromName('general');
    currentManager = getGlobalMCPManager()!;
    Logger.info('Agent system re-initialized with new provider/model settings');
  }

  try {
    console.log(`\n--- Interactive Chat with ${currentManager.getProviderName().toUpperCase()} (${currentManager.getCurrentModel()}) ---`);
    console.log('Type your questions or commands. Special commands:');
    console.log('  - "/help" - Show available commands');
    console.log('  - "/login" - Configure LLM provider and authenticate');
    console.log('  - "/outlook" - Authenticate with Microsoft for Outlook/Calendar access');
    console.log('  - "/model" - List and select available models');
    console.log('  - "/status" - Show MCP server status');
    console.log('  - "/refresh" - Refresh tools cache');
    console.log('  - "/new or /newchat" - Start a new conversation');
    console.log('  - "/history" - Show conversation history');
    console.log('  - "/current" - Show current conversation');
    console.log('  - "/clearchat" - Clear conversation history');
    console.log('  - "/cancel" - Cancel current operation');
    console.log('  - "/clear" - Clear the screen');
    console.log('  - "/exit" or "/quit" - Exit the program');
    console.log('\nLLM Provider Configuration:');
    console.log('  - Default: Ollama (local)');
    console.log('  - Use "login" command to configure GitHub Copilot, OpenAI, or Anthropic');
    console.log('\nMCP servers will be initialized on first use.');
    console.log('');

    // Load slash commands and skills from .aiagent/ directory
    slashCommandRegistry.initialize();
    const loadedCommands = slashCommandRegistry.listCommands();
    if (loadedCommands.length > 0) {
      console.log(`Loaded ${loadedCommands.length} slash command(s). Type /help for list.`);
      console.log('');
    }

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
      rl.on('line', async (input: string) => {
        const query = input.trim();

        if (query.toLowerCase() === '/exit' || query.toLowerCase() === '/quit') {
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

        if (query.toLowerCase() === '/cancel') {
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

        if (query.toLowerCase() === '/help') {
          console.log('\nAvailable commands:');
          console.log('  - /help: Show this help message');
          console.log('  - /login: Configure LLM provider and authenticate');
          console.log('  - /outlook: Authenticate with Microsoft for Outlook/Calendar access');
          console.log('  - /model: List and select available models');
          console.log('  - /status: Show MCP server status and capabilities');
          console.log('  - /refresh: Refresh tools cache from MCP servers');
          console.log('  - /clear: Clear the screen');
          console.log('  - /new or /newchat: Start a new conversation');
          console.log('  - /history: Show conversation history');
          console.log('  - /current: Show current conversation messages');
          console.log('  - /clearchat: Clear all conversation history');
          console.log('  - /cancel: Cancel current operation');
          console.log('  - /exit or /quit: Exit the program');

          // Show loaded slash commands
          const cmds = slashCommandRegistry.listCommands();
          if (cmds.length > 0) {
            console.log('\nSlash commands (from .aiagent/skills/):');
            for (const cmd of cmds) {
              const hint = cmd.argumentHint ? ` ${cmd.argumentHint}` : '';
              const desc = cmd.description ? ` — ${cmd.description}` : '';
              console.log(`  /${cmd.name}${hint}${desc}`);
            }
          }

          console.log('\nOr ask any question to chat with the AI assistant using MCP tools.');
          console.log('While processing, you can press Ctrl+C to cancel the current operation.\n');
          rl.prompt();
          return;
        }

        if (query.toLowerCase() === '/outlook') {
          console.log('\n=== Outlook / Microsoft Graph Authentication ===');
          try {
            const { acquireToken, clearTokenCache, pca } = await import('./mcp/server/outlook/auth.js');

            // Clear all cached state so stale tokens don't interfere
            clearTokenCache();
            const accounts = await pca.getTokenCache().getAllAccounts();
            for (const account of accounts) {
              await pca.getTokenCache().removeAccount(account);
            }
            console.log('Starting device code authentication...');
            console.log('A URL and code will be printed below — open the URL and enter the code.\n');
            const result = await acquireToken();
            if (result) {
              console.log(`✅ Outlook authenticated successfully! (account: ${result.account?.username})`);
              console.log('Token cached to disk. The outlook MCP server will use it automatically.\n');
            } else {
              console.log('❌ Authentication failed or was cancelled.\n');
            }
          } catch (error) {
            console.error(`Outlook authentication failed: ${error}\n`);
          }
          rl.prompt();
          return;
        }

        if (query.toLowerCase() === '/login') {
          try {
            await handleLoginCommand(rl, updateManagerConfiguration);
          } catch (error) {
            console.error(`Login failed: ${error}\n`);
          }
          rl.prompt();
          return;
        }

        if (query.toLowerCase() === '/model') {
          try {
            await handleModelCommand(rl, currentManager, updateManagerConfiguration);
          } catch (error) {
            console.error(`Model selection failed: ${error}\n`);
          }
          rl.prompt();
          return;
        }

        if (query.toLowerCase() === '/status') {
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

        if (query.toLowerCase() === '/refresh') {
          console.log('Refreshing tools cache...');
          const tools = await currentManager.refreshToolsCache();
          console.log(`Tools cache refreshed with ${tools.length} tools.\n`);
          rl.prompt();
          return;
        }

        if (query.toLowerCase() === '/clear') {
          console.clear();
          console.log('--- Interactive Chat with LLM using MCP tools ---');
          console.log('Type "/help" for available commands.\n');
          rl.prompt();
          return;
        }

        if (query.toLowerCase() === '/new' || query.toLowerCase() === '/newchat') {
          try {
            const conversationId = await currentManager.startNewConversation();
            console.log(`Started new conversation: ${conversationId}\n`);
          } catch (error) {
            console.error(`Failed to start new conversation: ${error}\n`);
          }
          rl.prompt();
          return;
        }

        if (query.toLowerCase() === '/history') {
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

        if (query.toLowerCase() === '/current') {
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

        if (query.toLowerCase() === '/clearchat') {
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

        // ── Slash command handling ────────────────────────────────────────────
        if (slashCommandRegistry.hasCommand(query)) {
          const parsed = slashCommandRegistry.parseInput(query)!;
          const cmd = slashCommandRegistry.getCommand(parsed.name)!;

          if (cmd.disableModelInvocation) {
            // Print the raw body without calling the LLM
            const processed = processCommand(cmd, parsed.args, slashCommandRegistry.getSkills());
            console.log(`\n${processed}\n`);
            rl.prompt();
            return;
          }

          try {
            currentAbortController = new AbortController();
            const processedPrompt = processCommand(cmd, parsed.args, slashCommandRegistry.getSkills());
            console.log(`Assistant: Thinking... (/${cmd.name})`);

            const response = await generalAgent.chat(
              processedPrompt,
              currentAbortController.signal,
              true,
              undefined,
              undefined,
              cmd.allowedTools,
              cmd.maxIterations,
              cmd.freshContext,
            );

            currentAbortController = null;

            if (response instanceof ReadableStream) {
              process.stdout.write('Assistant: ');
              const reader = response.getReader();
              try {
                let assistantMessage = '';
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  process.stdout.write(value);
                  assistantMessage += value;
                }
                console.log('\n');
                generalAgent.addAssistantMessageToHistory(assistantMessage);
              } finally {
                reader.releaseLock();
              }
            } else {
              const text = typeof response === 'string' ? response : 'kind' in response && response.kind === 'mixed' ? response.text : '';
              console.log(`Assistant: ${text}\n`);
              generalAgent.addAssistantMessageToHistory(text);
            }
          } catch (error) {
            currentAbortController = null;
            if (error instanceof Error && error.message === 'Operation cancelled by user') {
              console.log('Operation was cancelled.\n');
            } else {
              console.error(`Error: ${error}\n`);
            }
          }

          rl.resume();
          rl.prompt();
          return;
        }
        // ── End slash command handling ────────────────────────────────────────

        try {
          // Create new AbortController for this operation
          currentAbortController = new AbortController();
          console.log('Assistant: Thinking... (type "cancel" or press Ctrl+C to cancel)');

          const response = await generalAgent.chat(
            query,
            currentAbortController.signal,
            true,
          );

          // Clear the abort controller since operation completed successfully
          currentAbortController = null;
          
          // Handle streaming response
          if (response instanceof ReadableStream) {
            process.stdout.write('Assistant: ');
            const reader = response.getReader();
            
            try {
              let assistantMessage = '';
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                // The stream returns string chunks directly
                process.stdout.write(value);
                assistantMessage += value;
              }
              console.log('\n'); // Add newline after streaming is complete
              generalAgent.addAssistantMessageToHistory(assistantMessage);
            } finally {
              reader.releaseLock();
            }
          } else {
            // Handle non-streaming response (fallback)
            const text = typeof response === 'string' ? response : 'kind' in response && response.kind === 'mixed' ? response.text : '';
            console.log(`Assistant: ${text}\n`);
            generalAgent.addAssistantMessageToHistory(text);
          }
        } catch (error) {
          // Clear the abort controller
          currentAbortController = null;

          if (error instanceof Error && error.message === 'Operation cancelled by user') {
            console.log('Operation was cancelled.\n');
          } else {
            console.error(`Error: ${error}\n`);
          }
        }

        rl.resume();
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
          console.log('\nOperation cancelled. Type "/exit" to quit or continue chatting.');
          rl.prompt();
        } else {
          // If no operation is running, just show the prompt
          console.log('\nType "/exit" to quit gracefully.');
          rl.prompt();
        }
      });

      rl.prompt();
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