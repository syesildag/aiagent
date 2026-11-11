import { LLMProvider, OllamaProvider, OpenAIProvider, GitHubCopilotProvider, AnthropicProvider } from './llmProviders';
import { ClaudeCodeProvider } from './claudeCodeProvider';
import { config, getLLMProvider, getLLMModel } from '../utils/config';
import Logger from '../utils/logger';
import { AuthGithubCopilot } from '../utils/githubAuth';

/** Claude Code provider from the CLAUDE_CODE_* settings (also used by the CLI /login flow). */
export function createClaudeCodeProvider(): ClaudeCodeProvider {
  return new ClaudeCodeProvider({
    binaryPath: config.CLAUDE_CODE_PATH,
    configDir: config.CLAUDE_CODE_CONFIG_DIR,
    oauthToken: config.CLAUDE_CODE_OAUTH_TOKEN,
  });
}

export async function createLLMProvider(): Promise<LLMProvider> {
  const providerType = getLLMProvider();
  
  switch (providerType) {
    case 'openai':
      if (!config.OPENAI_API_KEY) {
        throw new Error('OpenAI API key is required when LLM_PROVIDER is set to openai');
      }
      Logger.info('Creating OpenAI provider');
      return new OpenAIProvider(config.OPENAI_API_KEY, config.OPENAI_BASE_URL);
      
    case 'github': {
      Logger.info('Creating GitHub Copilot provider with OAuth authentication');

      const isAzureModels = config.GITHUB_COPILOT_BASE_URL.includes('models.inference.ai.azure.com');

      let token: string | null | undefined;
      if (isAzureModels) {
        // GitHub Models (Azure AI Inference) endpoint requires a PAT with models:read scope.
        // Fall back to the raw OAuth token if no PAT is configured.
        token = config.AUTH_GITHUB_COPILOT_PAT || await AuthGithubCopilot.oauthToken();
        if (!token) {
          throw new Error(
            'GitHub Models endpoint requires a PAT with models:read scope. ' +
            'Set AUTH_GITHUB_COPILOT_PAT in your .env file, or run "login" to authenticate.'
          );
        }
      } else {
        token = await AuthGithubCopilot.access();
        if (!token) {
          throw new Error('GitHub OAuth authentication failed. Please run "login" command to authenticate.');
        }
      }

      return new GitHubCopilotProvider(
        token,
        config.GITHUB_COPILOT_BASE_URL
      );
    }
      
    case 'anthropic':
      if (!config.ANTHROPIC_API_KEY) {
        throw new Error('Anthropic API key is required when LLM_PROVIDER is set to anthropic');
      }
      Logger.info('Creating Anthropic provider');
      return new AnthropicProvider(config.ANTHROPIC_API_KEY, config.ANTHROPIC_BASE_URL);

    case 'claude-code':
      Logger.info('Creating Claude Code provider (subscription via claude CLI)');
      return createClaudeCodeProvider();

    case 'ollama':
    default:
      Logger.info('Creating Ollama provider');
      return new OllamaProvider(config.OLLAMA_HOST);
  }
}

export { getLLMModel };