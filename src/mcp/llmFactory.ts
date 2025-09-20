import { LLMProvider, OllamaProvider, OpenAIProvider, GitHubCopilotProvider } from './llmProviders';
import { config } from '../utils/config';
import Logger from '../utils/logger';

export function createLLMProvider(): LLMProvider {
  const providerType = config.LLM_PROVIDER;
  
  switch (providerType) {
    case 'openai':
      if (!config.OPENAI_API_KEY) {
        throw new Error('OpenAI API key is required when LLM_PROVIDER is set to openai');
      }
      Logger.info('Creating OpenAI provider');
      return new OpenAIProvider(config.OPENAI_API_KEY, config.OPENAI_BASE_URL);
      
    case 'github':
      if (!config.GITHUB_TOKEN) {
        throw new Error('GitHub token is required when LLM_PROVIDER is set to github');
      }
      Logger.info('Creating GitHub Copilot provider');
      return new GitHubCopilotProvider(config.GITHUB_TOKEN, config.GITHUB_COPILOT_BASE_URL);
      
    case 'ollama':
    default:
      Logger.info('Creating Ollama provider');
      return new OllamaProvider(config.OLLAMA_HOST);
  }
}

export function getLLMModel(): string {
  return config.LLM_MODEL;
}