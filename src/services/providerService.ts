import { authenticateWithGitHub, whoami } from '../utils/githubAuth';
import { updateEnvVariables } from '../utils/envManager';
import { config, getLLMProvider, getLLMModel } from '../utils/config';
import { capitalize } from '../utils/stringCase';
import { createClaudeCodeProvider } from '../mcp/llmFactory';
import type { ClaudeCodeAuthStatus, ClaudeCodeProvider } from '../mcp/claudeCodeProvider';
import type { MCPServerManager } from '../mcp/mcpManager';
import * as readline from 'readline';

const CLAUDE_CODE_MODEL_ALIASES = ['sonnet', 'opus', 'haiku'];

/** e.g. "me@example.com (Claude Pro)". Shown only on the user's own terminal. */
function describeClaudeAccount(status: ClaudeCodeAuthStatus): string {
  const plan = status.subscriptionType ? ` (Claude ${capitalize(status.subscriptionType)})` : '';
  return `${status.email ?? 'unknown account'}${plan}`;
}

/**
 * Lets a child process own the terminal (stdin/stdout) while `task` runs: readline is
 * paused and raw mode switched off, then both are restored even if the task fails.
 */
async function handOverTerminal<T>(rl: readline.Interface, task: () => Promise<T>): Promise<T> {
  const stdin = process.stdin;
  const wasRaw = stdin.isTTY ? stdin.isRaw : false;
  rl.pause();
  if (stdin.isTTY) stdin.setRawMode(false);
  try {
    return await task();
  } finally {
    if (stdin.isTTY) stdin.setRawMode(wasRaw);
    rl.resume();
  }
}

/**
 * Handles LLM provider and model configuration.
 * Extracted from src/cli.ts handleLoginCommand / handleModelCommand so the
 * same logic is reachable from both the CLI and (eventually) an HTTP admin route.
 *
 * Methods return descriptive strings; callers decide whether to print to stdout
 * or send as an HTTP response.
 */
export class ProviderService {
  /**
   * Interactive provider configuration (Ollama / GitHub Copilot / OpenAI / Anthropic).
   * Uses readline for input — pass the existing rl instance from the CLI.
   */
  async configureProvider(
    rl: readline.Interface,
    updateManagerCallback: () => Promise<void>,
  ): Promise<void> {
    const askQuestion = (question: string): Promise<string> =>
      new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));

    console.log('\n=== LLM Provider Configuration ===');
    console.log('Available LLM providers:');
    console.log('1. Ollama (local) - No authentication required');
    console.log('2. GitHub Copilot - Requires GitHub authentication');
    console.log('3. OpenAI - Requires API key');
    console.log('4. Anthropic - Requires API key');
    console.log('5. Claude Code - Uses your Claude Pro/Max subscription via the claude CLI (no API key)');
    console.log('');

    const choice = await askQuestion('Select a provider (1-5): ');

    switch (choice) {
      case '1':
        console.log('\nConfiguring Ollama provider...');
        updateEnvVariables({ LLM_PROVIDER: 'ollama' });
        await updateManagerCallback();
        console.log('✅ Ollama provider configured successfully!');
        console.log('Manager instance updated with new provider configuration.\n');
        break;

      case '2': {
        console.log('\nConfiguring GitHub Copilot provider...');
        const currentUser = await whoami();
        if (currentUser) {
          console.log(`Already authenticated as: ${currentUser}`);
          const reauth = await askQuestion('Do you want to re-authenticate? (y/N): ');
          if (reauth.toLowerCase() !== 'y' && reauth.toLowerCase() !== 'yes') {
            console.log('Using existing GitHub authentication.\n');
            updateEnvVariables({ LLM_PROVIDER: 'github' });
            await updateManagerCallback();
            console.log('✅ GitHub Copilot provider configured successfully!');
            console.log('Manager instance updated with new provider configuration.\n');
            break;
          }
        }
        console.log('Starting GitHub authentication...');
        try {
          await authenticateWithGitHub();
          updateEnvVariables({ LLM_PROVIDER: 'github' });
          await updateManagerCallback();
          console.log('✅ GitHub Copilot provider configured successfully!');
          console.log('Manager instance updated with new provider configuration.\n');
        } catch (error) {
          console.error(`GitHub authentication failed: ${error}`);
          console.log('Provider configuration cancelled.\n');
        }
        break;
      }

      case '3': {
        console.log('\nConfiguring OpenAI provider...');
        const apiKey = await askQuestion('Enter your OpenAI API key: ');
        if (!apiKey) { console.log('API key is required for OpenAI provider.\n'); break; }
        updateEnvVariables({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: apiKey });
        await updateManagerCallback();
        console.log('✅ OpenAI provider configured successfully!');
        console.log('Manager instance updated with new provider configuration.\n');
        break;
      }

      case '4': {
        console.log('\nConfiguring Anthropic provider...');
        const anthropicApiKey = await askQuestion('Enter your Anthropic API key: ');
        if (!anthropicApiKey) { console.log('API key is required for Anthropic provider.\n'); break; }
        updateEnvVariables({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: anthropicApiKey });
        await updateManagerCallback();
        console.log('✅ Anthropic provider configured successfully!');
        console.log('Manager instance updated with new provider configuration.\n');
        break;
      }

      case '5': {
        console.log('\nConfiguring Claude Code provider (your Claude Pro/Max subscription)...');
        const claudeCode = createClaudeCodeProvider();
        let status = await claudeCode.getAuthStatus();
        if (!status) {
          console.log(`❌ Could not run the claude CLI at "${config.CLAUDE_CODE_PATH}". ` +
            'Install Claude Code, or set CLAUDE_CODE_PATH to the absolute path of the claude binary.\n');
          break;
        }

        if (status.loggedIn) {
          console.log(`Claude Code is signed in as ${describeClaudeAccount(status)}.`);
          const keep = (await askQuestion('Use this account? (Y/n): ')).toLowerCase();
          if (keep === 'n' || keep === 'no') {
            status = await this.signInToClaudeCode(rl, claudeCode);
          }
        } else {
          console.log('Claude Code is not signed in.');
          status = await this.signInToClaudeCode(rl, claudeCode);
        }

        if (!status?.loggedIn) {
          console.log('Provider configuration cancelled.\n');
          break;
        }
        if (status.authMethod !== 'claude.ai') {
          console.log('⚠️  This login is not a Claude subscription, so usage is billed to an API account. ' +
            'Run /login again and sign in with your Claude account to use your Pro/Max plan.');
        }

        const currentModel = getLLMModel();
        const isClaudeModel = CLAUDE_CODE_MODEL_ALIASES.includes(currentModel) || currentModel.startsWith('claude-');
        updateEnvVariables({ LLM_PROVIDER: 'claude-code', LLM_MODEL: isClaudeModel ? currentModel : 'sonnet' });
        await updateManagerCallback();
        console.log(`✅ Claude Code provider configured with ${describeClaudeAccount(status)}.`);
        console.log('Use /model to pick sonnet, opus or haiku.\n');
        break;
      }

      default:
        console.log('Invalid choice. Please select 1, 2, 3, 4, or 5.\n');
        break;
    }
  }

  /**
   * Runs Anthropic's own sign-in (`claude auth login`, opens the browser) on this terminal,
   * then reports the resulting account. Returns null if the sign-in failed.
   */
  private async signInToClaudeCode(
    rl: readline.Interface,
    claudeCode: ClaudeCodeProvider,
  ): Promise<ClaudeCodeAuthStatus | null> {
    console.log('Opening the Claude sign-in page in your browser — choose your Claude account (Pro/Max).');
    console.log('Note: unless CLAUDE_CODE_CONFIG_DIR is set, this login is shared with Claude Code on this machine.');
    try {
      await handOverTerminal(rl, () => claudeCode.login());
    } catch (error) {
      console.error(`Claude Code sign-in failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
    const status = await claudeCode.getAuthStatus();
    if (status?.loggedIn) {
      console.log(`Signed in as ${describeClaudeAccount(status)}.`);
    }
    return status;
  }

  /**
   * Interactive model selection for the given manager.
   */
  async selectModel(
    rl: readline.Interface,
    manager: MCPServerManager,
    updateManagerCallback: () => Promise<void>,
  ): Promise<void> {
    const askQuestion = (question: string): Promise<string> =>
      new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));

    console.log('\n=== Model Selection ===');
    const currentProvider = getLLMProvider();
    const currentModel = getLLMModel();
    console.log(`Current provider: ${currentProvider}`);
    console.log(`Current model: ${currentModel}\n`);

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
        updateEnvVariables({ LLM_MODEL: customModel });
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
      updateEnvVariables({ LLM_MODEL: selectedModel });
      await updateManagerCallback();
      console.log(`✅ Model updated to: ${selectedModel}`);
      console.log('Manager instance updated with new model configuration.\n');
    } else if (choiceNum === availableModels.length + 1) {
      const customModel = await askQuestion('Enter custom model name: ');
      if (customModel) {
        updateEnvVariables({ LLM_MODEL: customModel });
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
}

export const providerService = new ProviderService();
