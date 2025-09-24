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

  /**
   * Estimate tokens for a string (rough approximation: ~4 characters per token)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Handle token limits by truncating messages if needed
   */
  private handleTokenLimits(request: LLMChatRequest, maxTokens: number = 8000): LLMChatRequest {
    // Calculate token usage for budget management (use 80% of limit)
    const tokenBudget = Math.floor(maxTokens * 0.8);
    
    // Estimate tokens for tools
    let toolTokens = 0;
    if (request.tools && request.tools.length > 0) {
      const toolsText = JSON.stringify(request.tools);
      toolTokens = this.estimateTokens(toolsText);
    }

    // Estimate tokens for messages
    let messageTokens = 0;
    const messageTexts = request.messages.map(msg => {
      let content = msg.content || '';
      if (msg.tool_calls) {
        content += JSON.stringify(msg.tool_calls);
      }
      return content;
    });
    
    for (const text of messageTexts) {
      messageTokens += this.estimateTokens(text);
    }

    const totalTokens = toolTokens + messageTokens;
    
    Logger.debug(`Token estimation: tools=${toolTokens}, messages=${messageTokens}, total=${totalTokens}, budget=${tokenBudget}`);

    // If within budget, return as-is
    if (totalTokens <= tokenBudget) {
      return request;
    }

    Logger.warn(`Token limit exceeded (${totalTokens} > ${tokenBudget}), truncating messages`);

    // Build a smarter message preservation strategy
    const systemMessage = request.messages.find(msg => msg.role === 'system');
    const lastUserMessage = request.messages.filter(msg => msg.role === 'user').pop();
    
    // Start with minimal viable conversation: system + last user
    let preservedMessages: LLMMessage[] = [];
    let preservedTokens = toolTokens;
    
    if (systemMessage) {
      preservedMessages.push(systemMessage);
      preservedTokens += this.estimateTokens(systemMessage.content || '');
    }
    
    if (lastUserMessage) {
      preservedMessages.push(lastUserMessage);
      preservedTokens += this.estimateTokens(lastUserMessage.content || '');
    }

    Logger.debug(`Starting with minimal messages: ${preservedMessages.length} messages, ${preservedTokens} tokens`);

    // Try to add complete assistant-tool conversation blocks from most recent backwards
    const messages = request.messages;
    const conversationBlocks: LLMMessage[][] = [];
    
    // Group messages into conversation blocks (assistant + tool responses)
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      
      // Skip if already included or if it's system/last user
      if (msg === systemMessage || msg === lastUserMessage) continue;
      
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        const block: LLMMessage[] = [msg];
        const toolCallIds = msg.tool_calls.map(tc => tc.id);
        
        // Find all corresponding tool responses immediately following
        for (let j = i + 1; j < messages.length; j++) {
          const responseMsg = messages[j];
          if (responseMsg.role === 'tool' && responseMsg.tool_call_id && 
              toolCallIds.includes(responseMsg.tool_call_id)) {
            block.push(responseMsg);
          } else if (responseMsg.role !== 'tool') {
            // Stop when we hit a non-tool message
            break;
          }
        }
        
        // Only add complete blocks (all tool calls have responses)
        const foundResponses = block.filter(m => m.role === 'tool').length;
        if (foundResponses === toolCallIds.length) {
          conversationBlocks.push(block);
        }
      } else if (msg.role === 'user' && msg !== lastUserMessage) {
        // Add standalone user messages as single-item blocks
        conversationBlocks.push([msg]);
      }
    }

    // Add conversation blocks from most recent first, if they fit in budget
    conversationBlocks.reverse(); // Most recent first
    
    for (const block of conversationBlocks) {
      let blockTokens = 0;
      for (const msg of block) {
        let content = msg.content || '';
        if (msg.tool_calls) {
          content += JSON.stringify(msg.tool_calls);
        }
        blockTokens += this.estimateTokens(content);
      }
      
      if (preservedTokens + blockTokens <= tokenBudget) {
        // Insert before the last user message to maintain conversation order
        const insertIndex = preservedMessages.length - (lastUserMessage ? 1 : 0);
        preservedMessages.splice(insertIndex, 0, ...block);
        preservedTokens += blockTokens;
        Logger.debug(`Added conversation block with ${block.length} messages, ${blockTokens} tokens`);
      } else {
        Logger.debug(`Skipping conversation block: would exceed budget (${preservedTokens + blockTokens} > ${tokenBudget})`);
        break;
      }
    }

    // If still over budget, try aggressive truncation
    if (preservedTokens > tokenBudget) {
      Logger.warn(`Still over budget after basic truncation (${preservedTokens} > ${tokenBudget}), using aggressive fallback`);
      
      // Use only 50% of limit for aggressive fallback
      const aggressiveBudget = Math.floor(maxTokens * 0.5);
      
      // Try to fit just system message and truncated user message
      const truncatedRequest: LLMChatRequest = {
        ...request,
        messages: systemMessage ? [systemMessage] : []
      };

      if (lastUserMessage) {
        let userContent = lastUserMessage.content;
        let userTokens = this.estimateTokens(userContent);
        
        // Truncate user message if too long
        if (userTokens > aggressiveBudget / 2) {
          const targetLength = Math.floor((aggressiveBudget / 2) * 4); // Convert back to characters
          userContent = userContent.substring(0, targetLength) + '... [truncated]';
        }
        
        truncatedRequest.messages.push({
          ...lastUserMessage,
          content: userContent
        });
      }

      return truncatedRequest;
    }

    Logger.debug(`Message truncation successful: preserved ${preservedMessages.length} messages, ${preservedTokens} tokens`);
    
    // Debug: Log the message structure to verify correctness
    Logger.debug('Final message structure:');
    for (let i = 0; i < preservedMessages.length; i++) {
      const msg = preservedMessages[i];
      if (msg.role === 'assistant' && msg.tool_calls) {
        Logger.debug(`  ${i}: assistant with ${msg.tool_calls.length} tool calls: ${msg.tool_calls.map(tc => tc.id).join(', ')}`);
      } else if (msg.role === 'tool') {
        Logger.debug(`  ${i}: tool response for call_id: ${msg.tool_call_id}`);
      } else {
        Logger.debug(`  ${i}: ${msg.role} message`);
      }
    }
    
    // Validate message integrity - ensure all assistant tool_calls have corresponding tool responses
    const assistantMessages = preservedMessages.filter(msg => msg.role === 'assistant' && msg.tool_calls);
    for (const assistantMsg of assistantMessages) {
      if (!assistantMsg.tool_calls) continue;
      
      for (const toolCall of assistantMsg.tool_calls) {
        const hasResponse = preservedMessages.some(msg => 
          msg.role === 'tool' && msg.tool_call_id === toolCall.id
        );
        
        if (!hasResponse) {
          Logger.error(`Validation failed: tool_call_id ${toolCall.id} has no corresponding tool response`);
          Logger.error('This would cause a 400 error from the API');
          
          // Emergency fallback: remove this assistant message and its orphaned tool calls
          const filteredMessages = preservedMessages.filter(msg => msg !== assistantMsg);
          Logger.warn('Emergency fallback: removing assistant message with orphaned tool calls');
          
          return {
            ...request,
            messages: filteredMessages
          };
        }
      }
    }

    return {
      ...request,
      messages: preservedMessages
    };
  }

  async chat(request: LLMChatRequest, abortSignal?: AbortSignal): Promise<LLMChatResponse> {
    // Store the model for this request
    this.model = request.model;

    // Handle token limits for GitHub Copilot API
    const adjustedRequest = this.handleTokenLimits(request);

    const requestBody: any = {
      model: adjustedRequest.model,
      messages: adjustedRequest.messages,
      stream: adjustedRequest.stream || false
    };

    // Only include tools if they exist and are not empty
    if (adjustedRequest.tools && adjustedRequest.tools.length > 0) {
      // Convert tools to the format expected by GitHub Copilot API
      requestBody.tools = adjustedRequest.tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters
        }
      }));
    }

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
      if (response.status === 413) {
        // 413 Payload Too Large - try with more aggressive truncation
        Logger.warn('Payload too large (413), retrying with more aggressive truncation');
        
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error?.code === 'tokens_limit_reached') {
            // Extract the actual token limit from the error message if available
            const maxTokens = 6000; // Use more conservative limit for retry
            const retryRequest = this.handleTokenLimits(request, maxTokens);
            
            // Try again with more aggressive truncation
            const retryBody: any = {
              model: retryRequest.model,
              messages: retryRequest.messages,
              stream: retryRequest.stream || false
            };
            
            if (retryRequest.tools && retryRequest.tools.length > 0) {
              retryBody.tools = retryRequest.tools.map(tool => ({
                type: 'function',
                function: {
                  name: tool.function.name,
                  description: tool.function.description,
                  parameters: tool.function.parameters
                }
              }));
            }
            
            const retryResponse = await fetch(`${this.baseUrl}/chat/completions`, {
              method: 'POST',
              headers: this.createHeaders(),
              body: JSON.stringify(retryBody),
              signal: abortSignal
            });
            
            if (retryResponse.ok) {
              const retryData = await retryResponse.json();
              const retryChoice = retryData.choices?.[0];
              
              if (retryChoice) {
                Logger.info('Successfully retried with truncated payload');
                return {
                  message: {
                    role: retryChoice.message.role,
                    content: retryChoice.message.content || '',
                    tool_calls: retryChoice.message.tool_calls
                  },
                  done: true
                };
              }
            }
          }
        } catch (parseError) {
          Logger.error(`Failed to parse error response for retry: ${parseError}`);
        }
        
        throw new Error(`GitHub Copilot API error: 413 Payload Too Large. Request body too large for ${adjustedRequest.model} model. Max size: 8000 tokens.`);
      }
      
      if (response.status === 400) {
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error?.code === 'model_max_prompt_tokens_exceeded' && 
              errorData.error?.message?.includes('limit of 0')) {

            // Log available models for debugging
            const availableModels = await this.getAvailableModels();
            Logger.warn(`Model '${adjustedRequest.model}' appears to be unavailable (token limit of 0).`);
            Logger.warn(`Available models: ${JSON.stringify(availableModels)}`);

            throw new Error(`Model '${adjustedRequest.model}' is not available. Available models: ${availableModels.join(', ')}`);
          }
          
          if (errorData.error?.code === 'tokens_limit_reached') {
            throw new Error(`GitHub Copilot API error: ${errorData.error.message}`);
          }
        } catch (parseError) {
          // If we can't parse the error, fall through to generic error
        }
      }
      
      throw new Error(`GitHub Copilot API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Check for API error in successful response (Azure Models API behavior)
    if (data.error) {
      Logger.error(`GitHub Copilot API error in response: ${JSON.stringify(data.error)}`);
      
      if (data.error.code === 'tokens_limit_reached') {
        Logger.warn('Token limit reached, retrying with more aggressive truncation');
        
        // Retry with more conservative token limit
        const maxTokens = 6000;
        const retryRequest = this.handleTokenLimits(request, maxTokens);
        
        const retryBody: any = {
          model: retryRequest.model,
          messages: retryRequest.messages,
          stream: retryRequest.stream || false
        };
        
        if (retryRequest.tools && retryRequest.tools.length > 0) {
          retryBody.tools = retryRequest.tools.map(tool => ({
            type: 'function',
            function: {
              name: tool.function.name,
              description: tool.function.description,
              parameters: tool.function.parameters
            }
          }));
        }
        
        try {
          const retryResponse = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: this.createHeaders(),
            body: JSON.stringify(retryBody),
            signal: abortSignal
          });
          
          if (retryResponse.ok) {
            const retryData = await retryResponse.json();
            
            // Check for error in retry response as well
            if (retryData.error) {
              throw new Error(`GitHub Copilot API error after retry: ${retryData.error.message}`);
            }
            
            const retryChoice = retryData.choices?.[0];
            if (retryChoice) {
              Logger.info('Successfully retried with truncated payload');
              return {
                message: {
                  role: retryChoice.message.role,
                  content: retryChoice.message.content || '',
                  tool_calls: retryChoice.message.tool_calls
                },
                done: true
              };
            }
          }
        } catch (retryError) {
          Logger.error(`Retry failed: ${retryError}`);
        }
      }
      
      throw new Error(`GitHub Copilot API error: ${data.error.message || data.error.code}`);
    }
    
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