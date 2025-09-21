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
      
      // Use OAuth configuration if available (for premium model access like VS Code)
      const oauthConfig = config.GITHUB_OAUTH_APP_CLIENT_ID && config.GITHUB_OAUTH_APP_CLIENT_SECRET
        ? {
            clientId: config.GITHUB_OAUTH_APP_CLIENT_ID,
            clientSecret: config.GITHUB_OAUTH_APP_CLIENT_SECRET
          }
        : undefined;
      
      if (oauthConfig) {
        Logger.info('Using OAuth configuration for enhanced GitHub Copilot access');
      }
      
      return new GitHubCopilotProvider(
        config.GITHUB_TOKEN, 
        config.GITHUB_COPILOT_BASE_URL,
        {}, // extra headers
        oauthConfig
      );
      
    case 'ollama':
    default:
      Logger.info('Creating Ollama provider');
      return new OllamaProvider(config.OLLAMA_HOST);
  }
}

export function getLLMModel(): string {
  return config.LLM_MODEL;
}