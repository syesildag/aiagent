import { authenticateWithGitHub, whoami } from '../utils/githubAuth';
import { updateEnvVariables } from '../utils/envManager';
import { getLLMProvider, getLLMModel } from '../utils/config';
import type { MCPServerManager } from '../mcp/mcpManager';
import * as readline from 'readline';

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
    console.log('');

    const choice = await askQuestion('Select a provider (1-4): ');

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

      default:
        console.log('Invalid choice. Please select 1, 2, 3, or 4.\n');
        break;
    }
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
