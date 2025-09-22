import { Ollama } from 'ollama';
import Logger from '../utils/logger';

// LLM Provider Types
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string; // Required for tool messages
}

export interface LLMChatRequest {
  model: string;
  messages: LLMMessage[];
  tools?: Tool[];
  stream?: boolean;
}

export interface LLMChatResponse {
  message: {
    role: string;
    content: string;
    tool_calls?: ToolCall[];
  };
  done?: boolean;
}

export interface LLMProvider {
  name: string;
  checkHealth(): Promise<boolean>;
  getAvailableModels(): Promise<string[]>;
  chat(request: LLMChatRequest, abortSignal?: AbortSignal): Promise<LLMChatResponse>;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Tool {
  type: 'function';
  serverName?: string; // Optional server name for MCP tools
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, any>;
      required: string[];
    };
  };
}

// LLM Provider Implementations
export class OllamaProvider implements LLMProvider {
  name = 'Ollama';
  private ollama: Ollama;

  constructor(baseUrl: string = 'http://localhost:11434') {
    this.ollama = new Ollama({ host: baseUrl });
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.ollama.list();
      return true;
    } catch (error) {
      Logger.error(`Ollama health check failed: ${error}`);
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await this.ollama.list();
      return response.models.map(model => model.name);
    } catch (error) {
      Logger.error(`Error getting available models: ${error}`);
      return [];
    }
  }

  async chat(request: LLMChatRequest, abortSignal?: AbortSignal): Promise<LLMChatResponse> {
    // Convert LLMMessage to Ollama Message format
    const ollamaMessages = request.messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      tool_calls: msg.tool_calls?.map(tc => ({
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'string' 
            ? JSON.parse(tc.function.arguments) 
            : tc.function.arguments
        }
      }))
    }));

    const chatPromise = this.ollama.chat({
      model: request.model,
      messages: ollamaMessages,
      tools: request.tools,
      stream: false
    });

    // Create a promise that rejects when the abort signal is triggered
    const abortPromise = new Promise<never>((_, reject) => {
      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          reject(new Error('Operation cancelled by user'));
        });
      }
    });

    const response = await Promise.race([chatPromise, abortPromise]);
    
    // Convert Ollama response back to LLMChatResponse format
    const convertedToolCalls = response.message.tool_calls?.map((tc: any, index: number) => ({
      id: `call_${index}`,
      type: 'function' as const,
      function: {
        name: tc.function.name,
        arguments: typeof tc.function.arguments === 'string' 
          ? tc.function.arguments 
          : JSON.stringify(tc.function.arguments)
      }
    }));

    return {
      message: {
        role: response.message.role,
        content: response.message.content,
        tool_calls: convertedToolCalls
      },
      done: response.done
    };
  }
}

export class GitHubCopilotProvider implements LLMProvider {
  name = 'GitHub Copilot';
  private baseUrl: string;
  private apiKey: string;
  private extraHeaders: Record<string, string>;

  /**
   * Create headers for GitHub Copilot API requests
   */
  private createHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...this.extraHeaders
    };

    // Use VS Code-like headers for better compatibility
    if (this.useOAuth) {
      // OAuth-specific headers (like VS Code uses)
      headers['Editor-Version'] = 'vscode/1.95.0';
      headers['Editor-Plugin-Version'] = 'copilot-chat/0.22.0';
      headers['Copilot-Integration-Id'] = 'vscode-chat';
      headers['User-Agent'] = 'GitHubCopilotChat/0.22.0';
      // Don't add X-GitHub-Api-Version for OAuth to avoid conflicts
    } else {
      // Personal token headers
      headers['Editor-Version'] = 'AI-Agent/1.0';
      headers['Editor-Plugin-Version'] = 'AI-Agent/1.0';
      headers['Copilot-Integration-Id'] = 'vscode-chat';      
    }

    return headers;
  }

  /**
   * Get the current model being used
   */
  get currentModel(): string | undefined {
    return this.model;
  }

  private model?: string;
  private useOAuth: boolean;

  constructor(
    apiKey: string, 
    baseUrl: string = 'https://api.githubcopilot.com',
    extraHeaders: Record<string, string> = {},
    oauthConfig?: { clientId: string; clientSecret: string }
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.extraHeaders = extraHeaders;
    this.useOAuth = !!oauthConfig;
    
    // Debug logging to check token validity
    Logger.debug(`GitHubCopilotProvider initialized with:`);
    Logger.debug(`  Base URL: ${baseUrl}`);
    Logger.debug(`  API Key length: ${apiKey?.length || 0}`);
    Logger.debug(`  API Key starts with: ${apiKey?.substring(0, 10) || 'undefined'}...`);
    Logger.debug(`  OAuth enabled: ${this.useOAuth}`);
    Logger.debug(`  Extra headers: ${JSON.stringify(extraHeaders)}`);
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.createHeaders()
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        Logger.error(`GitHub Copilot health check failed: ${response.status} ${response.statusText} - ${errorText}`);
        return false;
      }
      
      return true;
    } catch (error) {
      Logger.error(`GitHub Copilot health check failed: ${error}`);
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.createHeaders()
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      // Handle both OpenAI-style (data.data) and Azure Models style (direct array) responses
      const models = data.data || data;
      const modelIds = models?.map((model: any) => model.id || model.name) || ['gpt-4o', 'gpt-4o-mini'];
      
      // Log available models for debugging
      Logger.info(`Available GitHub Copilot models: ${JSON.stringify(modelIds)}`);
      
      return modelIds;
    } catch (error) {
      Logger.error(`Error getting GitHub Copilot models: ${error}`);
      return ['gpt-4o', 'gpt-4o-mini']; // Fallback to known models
    }
  }

  async chat(request: LLMChatRequest, abortSignal?: AbortSignal): Promise<LLMChatResponse> {
    // Store the model for this request
    this.model = request.model;

    const requestBody: any = {
      model: request.model,
      messages: request.messages,
      stream: request.stream || false
    };

    // Only include tools if they exist and are not empty
    if (request.tools && request.tools.length > 0) {
      // Convert tools to the format expected by GitHub Copilot API
      requestBody.tools = request.tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters
        }
      }));
    }

    Logger.debug(`GitHub Copilot chat request: model=${request.model}, messages=${request.messages.length}, tools=${requestBody.tools?.length || 0}`);
    Logger.debug(`Request body: ${JSON.stringify(requestBody, null, 2)}`);

    const chatPromise = fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.createHeaders(),
      body: JSON.stringify(requestBody),
      signal: abortSignal
    });

    const response = await chatPromise;
    
    if (!response.ok) {
      const errorText = await response.text();
      Logger.error(`GitHub Copilot API error response: ${errorText}`);
      
      // Handle specific error cases
      if (response.status === 400) {
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error?.code === 'model_max_prompt_tokens_exceeded' && 
              errorData.error?.message?.includes('limit of 0')) {

            // Log available models for debugging
            const availableModels = await this.getAvailableModels();
            Logger.warn(`Model '${request.model}' appears to be unavailable (token limit of 0).`);
            Logger.warn(`Available models: ${JSON.stringify(availableModels)}`);Ò

            throw new Error(`Model '${request.model}' is not available. Available models: ${availableModels.join(', ')}`);
          }
        } catch (parseError) {
          // If we can't parse the error, fall through to generic error
        }
      }
      
      throw new Error(`GitHub Copilot API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    
    if (!choice) {
      throw new Error('No response from GitHub Copilot');
    }

    return {
      message: {
        role: choice.message.role,
        content: choice.message.content || '',
        tool_calls: choice.message.tool_calls
      },
      done: true
    };
  }

  /**
   * Create a new GitHubCopilotProvider with additional headers
   */
  static withExtraHeaders(
    apiKey: string,
    extraHeaders: Record<string, string>,
    baseUrl: string = 'https://api.githubcopilot.com'
  ): GitHubCopilotProvider {
    return new GitHubCopilotProvider(apiKey, baseUrl, extraHeaders);
  }
}

export class OpenAIProvider implements LLMProvider {
  name = 'OpenAI';
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey: string, baseUrl: string = 'https://api.openai.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      return response.ok;
    } catch (error) {
      Logger.error(`OpenAI health check failed: ${error}`);
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.data?.map((model: any) => model.id) || [];
    } catch (error) {
      Logger.error(`Error getting OpenAI models: ${error}`);
      return [];
    }
  }

  async chat(request: LLMChatRequest, abortSignal?: AbortSignal): Promise<LLMChatResponse> {
    Logger.debug(`GitHub Copilot chat request: model=${request.model}, messages=${request.messages.length}, tools=${request.tools?.length || 0}`);

    const requestBody = {
      model: request.model,
      messages: request.messages,
      tools: request.tools,
      stream: request.stream || false
    };

    Logger.debug(`Request body: ${JSON.stringify(requestBody, null, 2)}`);

    const chatPromise = fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: abortSignal
    });

    const response = await chatPromise;
    
    if (!response.ok) {
      const errorText = await response.text();
      Logger.error(`GitHub Copilot API error response: ${errorText}`);
      throw new Error(`GitHub Copilot API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    
    if (!choice) {
      throw new Error('No response from OpenAI');
    }

    return {
      message: {
        role: choice.message.role,
        content: choice.message.content || '',
        tool_calls: choice.message.tool_calls
      },
      done: true
    };
  }
}