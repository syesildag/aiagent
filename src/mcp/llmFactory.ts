import { LLMProvider, OllamaProvider, OpenAIProvider, GitHubCopilotProvider } from './llmProviders';
import { config } from '../utils/config';
import Logger from '../utils/logger';
import { AuthGithubCopilot } from '../utils/githubAuth';

export async function createLLMProvider(): Promise<LLMProvider> {
  const providerType = config.LLM_PROVIDER;
  
  switch (providerType) {
    case 'openai':
      if (!config.OPENAI_API_KEY) {
        throw new Error('OpenAI API key is required when LLM_PROVIDER is set to openai');
      }
      Logger.info('Creating OpenAI provider');
      return new OpenAIProvider(config.OPENAI_API_KEY, config.OPENAI_BASE_URL);
      
    case 'github':
      Logger.info('Creating GitHub Copilot provider with OAuth authentication');
      
      // Authenticate using OAuth device flow
      const token = await AuthGithubCopilot.access();
      if (!token) {
        throw new Error('GitHub OAuth authentication failed. Please run "login" command to authenticate.');
      }
      
      return new GitHubCopilotProvider(
        token, 
        config.GITHUB_COPILOT_BASE_URL
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