import "dotenv/config";
import * as readline from 'readline';
import Logger from './utils/logger';
import { LLMChatResponse, LLMMessage, LLMProvider, Tool } from './mcp/llmProviders';
import { MCPConfig, MCPServer } from './mcp/mcpManager';
import { initializeAgents, getAgentFromName, getGlobalMCPManager, reinitializeAgentSystem, Agent } from './agent';
import { slashCommandRegistry } from './utils/slashCommandRegistry';
import { processSlashCommand } from './utils/slashCommandProcessor';
import { providerService } from './services/providerService';

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

    // List loaded slash commands (registry was initialized at agent startup).
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
            await providerService.configureProvider(rl, updateManagerConfiguration);
          } catch (error) {
            console.error(`Login failed: ${error}\n`);
          }
          rl.prompt();
          return;
        }

        if (query.toLowerCase() === '/model') {
          try {
            await providerService.selectModel(rl, currentManager, updateManagerConfiguration);
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
        const slashResult = processSlashCommand(query, getGlobalMCPManager());
        if (slashResult?.kind === 'direct') {
          console.log(`\n${slashResult.response}\n`);
          rl.prompt();
          return;
        }

        const chatPrompt = slashResult?.kind === 'chat' ? slashResult.effectivePrompt : query;
        const chatToolFilter  = slashResult?.kind === 'chat' ? slashResult.toolNameFilter  : undefined;
        const chatMaxIter     = slashResult?.kind === 'chat' ? slashResult.maxIterations   : undefined;
        const chatFreshCtx    = slashResult?.kind === 'chat' ? slashResult.freshContext    : undefined;
        // ── End slash command handling ────────────────────────────────────────

        try {
          // Create new AbortController for this operation
          currentAbortController = new AbortController();
          console.log('Assistant: Thinking... (type "cancel" or press Ctrl+C to cancel)');

          const response = await generalAgent.chat(
            chatPrompt,
            currentAbortController.signal,
            true,
            undefined,
            undefined,
            chatToolFilter,
            chatMaxIter,
            chatFreshCtx,
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
