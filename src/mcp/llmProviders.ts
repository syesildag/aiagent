import { Ollama } from 'ollama';
import Logger from '../utils/logger';
import { AuthGithubCopilot } from '../utils/githubAuth';

/**
 * Universal LLM Provider System with Centralized Token Management
 * 
 * This module provides a unified interface for multiple LLM providers with intelligent
 * token limit handling. Key features:
 * 
 * 1. **Provider Support**: OpenAI, GitHub Copilot, Ollama, and extensible for others
 * 2. **Centralized Token Limits**: Single source of truth for 80+ models via getModelMaxTokens()
 * 3. **Universal Token Handling**: Smart truncation via handleTokenLimits() for all providers
 * 4. **Conversation Preservation**: Maintains system messages and recent context when truncating
 * 5. **Tool Call Integrity**: Ensures assistant tool calls have corresponding responses
 * 
 * Usage:
 * - Each provider automatically applies model-specific token limits
 * - Token handling preserves conversation flow and tool call consistency
 * - Extensible architecture allows easy addition of new providers
 */

// Multimodal content parts (OpenAI format)
export interface TextContentPart {
  type: 'text';
  text: string;
}

export interface ImageContentPart {
  type: 'image_url';
  image_url: {
    url: string; // base64 data URL: "data:<mimeType>;base64,<data>"
    detail?: 'auto' | 'low' | 'high';
  };
}

export type ContentPart = TextContentPart | ImageContentPart;

// LLM Provider Types
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string; // Required for tool messages
}

export interface LLMChatRequest {
  model: string;
  messages: LLMMessage[];
  tools?: Tool[];
  stream?: boolean;
}

/**
 * If LLMChatRequest.stream is true, message.content is a ReadableStream (web standard), otherwise string.
 */
export interface LLMChatResponse {
  message: {
    role: string;
    /**
     * If stream is true in the request, this is a ReadableStream<string> (web standard), otherwise string.
     */
    content: string | ReadableStream<any>;
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

/**
 * Get the maximum token limit for any LLM model across all providers
 * 
 * This centralized function maintains token limits for models from all major providers:
 * - OpenAI (GPT-4, GPT-3.5, o1, etc.)
 * - Anthropic (Claude models)  
 * - Google (Gemini models)
 * - Meta (Llama models via Ollama)
 * - Mistral (Mistral/Mixtral models)
 * - Alibaba (Qwen models)
 * - And many others
 * 
 * @param model - The model name/identifier
 * @returns Maximum context window size in tokens
 * 
 * @example
 * ```typescript
 * const maxTokens = getModelMaxTokens('gpt-4o'); // Returns 128000
 * const claudeTokens = getModelMaxTokens('claude-sonnet-4'); // Returns 200000  
 * const geminiTokens = getModelMaxTokens('gemini-2.5-pro'); // Returns 1048576
 * ```
 */
export function getModelMaxTokens(model: string): number {
  // Comprehensive model token limits database
  const modelLimits: Record<string, number> = {
    // OpenAI GPT-4 models
    'gpt-4o': 128000,
    'gpt-4o-mini': 128000,
    'gpt-4': 8192,
    'gpt-4-32k': 32768,
    'gpt-4-1106-preview': 128000,
    'gpt-4-0125-preview': 128000,
    'gpt-4-turbo': 128000,
    'gpt-4-turbo-preview': 128000,
    'gpt-4-vision-preview': 128000,
    'gpt-4.1': 128000,
    'gpt-5': 128000,
    'gpt-5-mini': 128000,
    
    // OpenAI GPT-3.5 models
    'gpt-3.5-turbo': 16385,
    'gpt-3.5-turbo-16k': 16385,
    'gpt-3.5-turbo-1106': 16385,
    'gpt-3.5-turbo-0125': 16385,
    'gpt-3.5-turbo-0613': 16385,
    'gpt-3.5-turbo-instruct': 4096,
    
    // OpenAI o1 models
    'o1-preview': 128000,
    'o1-mini': 128000,
    'o3-mini': 128000,
    'o4-mini': 128000,
    
    // OpenAI legacy models
    'text-davinci-003': 4097,
    'text-davinci-002': 4097,
    'code-davinci-002': 8001,
    
    // Anthropic Claude models
    'claude-3-opus': 200000,
    'claude-3-sonnet': 200000,
    'claude-3-haiku': 200000,
    'claude-3.5-sonnet': 200000,
    'claude-3.7-sonnet': 200000,
    'claude-3.7-sonnet-thought': 200000,
    'claude-sonnet-4': 200000,
    
    // Google Gemini models
    'gemini-1.5-pro': 1048576,  // 1M tokens
    'gemini-1.5-flash': 1048576,
    'gemini-2.0-flash-001': 1048576,
    'gemini-2.5-pro': 1048576,
    'gemini-pro': 32768,
    
    // Ollama Llama models
    'llama3.2:1b': 131072,
    'llama3.2:3b': 131072,
    'llama3.1:8b': 131072,
    'llama3.1:70b': 131072,
    'llama3.1:405b': 131072,
    'llama3:8b': 8192,
    'llama3:70b': 8192,
    'llama2:7b': 4096,
    'llama2:13b': 4096,
    'llama2:70b': 4096,
    
    // Mistral models
    'mistral:7b': 32768,
    'mixtral:8x7b': 32768,
    'mixtral:8x22b': 65536,
    
    // Qwen models
    'qwen2.5:7b': 32768,
    'qwen2.5:14b': 32768,
    'qwen2.5:32b': 32768,
    'qwen2.5:72b': 32768,
    'qwen2:7b': 32768,
    'qwen2:72b': 32768,
    'qwen3:4b': 32768,
    
    // Code models
    'codellama:7b': 16384,
    'codellama:13b': 16384,
    'codellama:34b': 16384,
    'codeqwen:7b': 65536,
    'deepseek-coder:6.7b': 16384,
    'deepseek-coder:33b': 16384,
    
    // Other models
    'gemma2:2b': 8192,
    'gemma2:9b': 8192,
    'gemma2:27b': 8192,
    'phi3:3.8b': 128000,
    'phi3:14b': 128000,
    
    // Embedding models
    'text-embedding-ada-002': 8191,
    'text-embedding-3-small': 8191,
    'text-embedding-3-large': 8191,
  };

  // Try exact match first
  if (modelLimits[model]) {
    return modelLimits[model];
  }

  // Try partial matches for versioned models
  for (const [knownModel, limit] of Object.entries(modelLimits)) {
    if (model.includes(knownModel) || knownModel.includes(model)) {
      return limit;
    }
  }

  // Pattern-based matching for model families
  if (model.includes('gpt-4')) {
    return model.includes('32k') ? 32768 : 128000;
  }
  if (model.includes('gpt-3.5')) {
    return 16385;
  }
  if (model.includes('claude')) {
    return 200000;
  }
  if (model.includes('gemini')) {
    return model.includes('1.5') || model.includes('2.') ? 1048576 : 32768;
  }
  if (model.includes('llama3.1') || model.includes('llama3.2')) {
    return 131072;
  }
  if (model.includes('llama3')) {
    return 8192;
  }
  if (model.includes('llama2')) {
    return 4096;
  }
  if (model.includes('mistral') || model.includes('mixtral')) {
    return model.includes('8x22b') ? 65536 : 32768;
  }
  if (model.includes('qwen')) {
    return 32768;
  }
  if (model.includes('phi3')) {
    return 128000;
  }
  if (model.includes('o1') || model.includes('o3') || model.includes('o4')) {
    return 128000;
  }

  // Default fallback
  Logger.warn(`Unknown model '${model}', using default context limit of 8192 tokens`);
  return 8192;
}

/**
 * Extract plain text from an LLMMessage content (handles string and ContentPart[])
 */
export function getContentText(content: string | ContentPart[] | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is TextContentPart => p.type === 'text')
    .map(p => p.text)
    .join(' ');
}

/**
 * Estimate tokens for a string (rough approximation: ~4 characters per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for a full message, including binary (image_url) content parts.
 * getContentText() only returns text parts, which causes huge base64 payloads to go
 * undetected and exceed the per-request token budget.
 */
function estimateFullMessageTokens(msg: LLMMessage): number {
  let text = '';
  if (typeof msg.content === 'string') {
    text = msg.content;
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part.type === 'text') {
        text += part.text;
      } else if (part.type === 'image_url') {
        // Include the full data URL (base64 payload) in the size estimate
        text += part.image_url.url;
      }
    }
  }
  if (msg.tool_calls) {
    text += JSON.stringify(msg.tool_calls);
  }
  return estimateTokens(text);
}

/**
 * Strip image_url (and other binary) content parts from every message, replacing them
 * with a short text placeholder.  Used as a last-resort fallback so that a 413 retry
 * can succeed even when the original attachment is too large to forward.
 */
export function stripBinaryContent(messages: LLMMessage[]): LLMMessage[] {
  return messages.map(msg => {
    if (!Array.isArray(msg.content)) return msg;
    const textParts = msg.content.filter((p): p is TextContentPart => p.type === 'text');
    const binaryCount = msg.content.length - textParts.length;
    if (binaryCount === 0) return msg;
    const placeholder: TextContentPart = {
      type: 'text',
      text: `[${binaryCount} attachment(s) removed — too large for model token limit]`,
    };
    return {
      ...msg,
      content: textParts.length > 0 ? [...textParts, placeholder] : placeholder.text,
    };
  });
}

/**
 * Handle token limits by truncating messages if needed
 * This function can be used by any LLM provider to manage token limits
 * 
 * @param request - The original chat request
 * @param maxTokens - Maximum token limit (if undefined, no limits applied)
 * @returns Adjusted request with messages truncated if needed
 */
export function handleTokenLimits(request: LLMChatRequest, maxTokens?: number): LLMChatRequest {
  // If maxTokens is undefined, treat as infinity (no limits)
  if (maxTokens === undefined) {
    return request;
  }
  
  // Calculate token usage for budget management (use 80% of limit)
  const tokenBudget = Math.floor(maxTokens * 0.8);
  
  // Estimate tokens for tools
  let toolTokens = 0;
  if (request.tools && request.tools.length > 0) {
    const toolsText = JSON.stringify(request.tools);
    toolTokens = estimateTokens(toolsText);
  }

  // Estimate tokens for messages — use full content (including image_url binary payloads)
  // to avoid underestimating large attachments and sending oversized requests.
  let messageTokens = 0;
  for (const msg of request.messages) {
    messageTokens += estimateFullMessageTokens(msg);
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
    preservedTokens += estimateFullMessageTokens(systemMessage);
  }
  
  if (lastUserMessage) {
    preservedMessages.push(lastUserMessage);
    preservedTokens += estimateFullMessageTokens(lastUserMessage);
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
      blockTokens += estimateFullMessageTokens(msg);
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
      let userContent = getContentText(lastUserMessage.content);
      let userTokens = estimateTokens(userContent);
      
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

/**
 * Utility function to apply smart token handling to any LLM request
 * Automatically detects model limits and applies appropriate truncation
 * 
 * @param request - The original chat request
 * @param customMaxTokens - Override the model's default token limit (optional)
 * @returns Request with smart token management applied
 */
export function withTokenManagement(request: LLMChatRequest, customMaxTokens?: number): LLMChatRequest {
  const maxTokens = customMaxTokens || getModelMaxTokens(request.model);
  return handleTokenLimits(request, maxTokens);
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
    // Handle token limits for Ollama
    const modelMaxTokens = getModelMaxTokens(request.model);
    const adjustedRequest = handleTokenLimits(request, modelMaxTokens);

    // Convert LLMMessage to Ollama Message format.
    // Ollama's Message type only accepts content: string, with images in a
    // separate string[] field (base64 data, no data-URL prefix).
    const ollamaMessages = adjustedRequest.messages.map(msg => {
      let textContent: string;
      const images: string[] = [];

      if (typeof msg.content === 'string') {
        textContent = msg.content;
      } else {
        // ContentPart[] — split into text and image arrays
        textContent = msg.content
          .filter((p): p is TextContentPart => p.type === 'text')
          .map(p => p.text)
          .join('');
        msg.content
          .filter((p): p is ImageContentPart => p.type === 'image_url')
          .forEach(p => {
            // Strip the data-URL prefix: "data:<mime>;base64,<data>" → "<data>"
            const base64 = p.image_url.url.includes(',')
              ? p.image_url.url.split(',')[1]
              : p.image_url.url;
            images.push(base64);
          });
      }

      return {
        role: msg.role as 'user' | 'assistant' | 'system' | 'tool',
        content: textContent,
        ...(images.length > 0 ? { images } : {}),
        ...(msg.tool_calls ? {
          tool_calls: msg.tool_calls.map(tc => ({
            function: {
              name: tc.function.name,
              arguments: typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments
            }
          }))
        } : {})
      };
    });

    // Cast to any[] to satisfy Ollama's strict Message type — the runtime shape
    // is fully compatible; TypeScript cannot reconcile our role/tool_call unions.
    const ollamaMessagesCast = ollamaMessages as any[];

    let chatPromise;
    if (request.stream === true) {
      chatPromise = this.ollama.chat({
        model: adjustedRequest.model,
        messages: ollamaMessagesCast,
        tools: adjustedRequest.tools,
        stream: true
      });
    } else {
      chatPromise = this.ollama.chat({
        model: adjustedRequest.model,
        messages: ollamaMessagesCast,
        tools: adjustedRequest.tools,
        stream: false
      });
    }

    // Create a promise that rejects when the abort signal is triggered
    const abortPromise = new Promise<never>((_, reject) => {
      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          reject(new Error('Operation cancelled by user'));
        });
      }
    });

    const response = await Promise.race([chatPromise, abortPromise]);

    // Handle streaming and non-streaming responses
    if (request.stream === true) {
      // Streaming: Create a ReadableStream that handles content streaming
      const ollamaStream = response as unknown as AsyncIterable<any>;
      let collectedToolCalls: any[] = [];
      
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of ollamaStream) {
              // Handle content streaming
              if (chunk.message?.content) {
                controller.enqueue(chunk.message.content);
              }
              
              // Collect tool calls if they appear (shouldn't happen in streaming mode)
              if (chunk.message?.tool_calls) {
                collectedToolCalls.push(...chunk.message.tool_calls);
                Logger.warn('Tool calls detected in streaming mode - this indicates a design issue');
              }
              
              // Check if this is the final chunk
              if (chunk.done) {
                controller.close();
                break;
              }
            }
          } catch (error) {
            controller.error(error);
          }
        }
      });

      return {
        message: {
          role: 'assistant',
          content: stream,
          // Include tool calls if they were collected (fallback for unexpected behavior)
          tool_calls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined
        },
        done: false
      };
    } else {
      // Non-streaming: response is a ChatResponse object
      // Convert Ollama response back to LLMChatResponse format
      const chatResponse = response as any;
      const convertedToolCalls = chatResponse.message.tool_calls?.map((tc: any, index: number) => ({
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
          role: chatResponse.message.role,
          content: chatResponse.message.content,
          tool_calls: convertedToolCalls
        },
        done: chatResponse.done
      };
    }
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
  private async createHeaders(): Promise<Record<string, string>> {
    // Get the current token (this will refresh if needed)
    const currentToken = await AuthGithubCopilot.access() || this.apiKey;
    
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${currentToken}`,
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
        headers: await this.createHeaders()
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
        headers: await this.createHeaders()
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

  // GitHub Copilot API enforces a hard request-body limit of 8000 tokens,
  // regardless of the model's theoretical context window size.
  private static readonly COPILOT_REQUEST_TOKEN_LIMIT = 7500;

  async chat(request: LLMChatRequest, abortSignal?: AbortSignal): Promise<LLMChatResponse> {
    // Store the model for this request
    this.model = request.model;

    // Handle token limits for GitHub Copilot API
    // GitHub Copilot enforces a hard 8000-token cap per request regardless of what the
    // model's theoretical context window is, so we always cap at COPILOT_REQUEST_TOKEN_LIMIT.
    const modelMaxTokens = Math.min(
      getModelMaxTokens(request.model),
      GitHubCopilotProvider.COPILOT_REQUEST_TOKEN_LIMIT
    );
    const adjustedRequest = handleTokenLimits(request, modelMaxTokens);

    const requestBody: any = {
      model: adjustedRequest.model,
      messages: adjustedRequest.messages,
      stream: adjustedRequest.stream ?? false
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

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: await this.createHeaders(),
      body: JSON.stringify(requestBody),
      signal: abortSignal
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      Logger.error(`GitHub Copilot API error response: ${errorText}`);
      
      // Handle specific error cases
      if (response.status === 413) {
        // 413 Payload Too Large - try with more aggressive truncation
        Logger.warn('Payload too large (413), retrying with more aggressive truncation');
        
        try {
          // Always retry unconditionally with a more conservative token budget.
          // Also strip binary (image/file) content parts — they are often the sole
          // reason the payload is too large, and no amount of history trimming will
          // help if a multi-MB attachment is embedded in the last user message.
          const maxTokens = 5000; // Use conservative limit for 413 retry
          Logger.warn(`Retrying with ${maxTokens} token limit after 413 from model ${adjustedRequest.model}`);
          {
            const strippedRequest = { ...request, messages: stripBinaryContent(request.messages) };
            const retryRequest = handleTokenLimits(strippedRequest, maxTokens);
            
            // Try again with more aggressive truncation
            const retryBody: any = {
              model: retryRequest.model,
              messages: retryRequest.messages,
              stream: retryRequest.stream ?? false
            };
            
            if (retryRequest.tools && retryRequest.tools.length > 0) {
              retryBody.tools = retryRequest.tools.map((tool: Tool) => ({
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
              headers: await this.createHeaders(),
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
            } else {
              const retryErrorText = await retryResponse.text();
              Logger.error(`413 retry also failed (${retryResponse.status}): ${retryErrorText}`);
            }
          }
        } catch (parseError) {
          Logger.error(`Failed during 413 retry attempt: ${parseError}`);
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

    if (adjustedRequest.stream === true) {
      // Streaming mode: return ReadableStream as content
      if (!response.body) {
        throw new Error('No response body for streaming');
      }

      // Create a ReadableStream that processes Server-Sent Events
      let collectedToolCalls: any[] = [];
      
      const stream = new ReadableStream({
        start(controller) {
          const reader = response.body!.getReader();
          const decoder = new TextDecoder();

          function pump(): Promise<void> {
            return reader.read().then(({ done, value }) => {
              if (done) {
                controller.close();
                return;
              }

              // Decode the chunk
              const chunk = decoder.decode(value, { stream: true });
              const lines = chunk.split('\n');

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data === '[DONE]') {
                    controller.close();
                    return;
                  }

                  try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.choices?.[0]?.delta;
                    
                    // Handle content streaming
                    if (delta?.content) {
                      controller.enqueue(delta.content);
                    }
                    
                    // Collect tool calls if they appear (shouldn't happen in streaming mode)
                    if (delta?.tool_calls) {
                      collectedToolCalls.push(...delta.tool_calls);
                      Logger.warn('Tool calls detected in GitHub Copilot streaming mode - this indicates a design issue');
                    }
                  } catch (error) {
                    // Skip invalid JSON lines
                  }
                }
              }

              return pump();
            });
          }

          return pump();
        }
      });

      return {
        message: {
          role: 'assistant',
          content: stream,
          // Include tool calls if they were collected (fallback for unexpected behavior)
          tool_calls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined
        },
        done: false
      };
    }

    const data = await response.json();
    
    // Check for API error in successful response (Azure Models API behavior)
    if (data.error) {
      Logger.error(`GitHub Copilot API error in response: ${JSON.stringify(data.error)}`);
      
      if (data.error.code === 'tokens_limit_reached') {
        Logger.warn('Token limit reached, retrying with more aggressive truncation');
        
        // Retry with more conservative token limit, also stripping binary attachments
        const maxTokens = 6000;
        const strippedForRetry = { ...request, messages: stripBinaryContent(request.messages) };
        const retryRequest = handleTokenLimits(strippedForRetry, maxTokens);
        
        const retryBody: any = {
          model: retryRequest.model,
          messages: retryRequest.messages,
          stream: retryRequest.stream ?? false
        };
        
        if (retryRequest.tools && retryRequest.tools.length > 0) {
          retryBody.tools = retryRequest.tools.map((tool: Tool) => ({
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
            headers: await this.createHeaders(),
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
    // Handle token limits for OpenAI
    const modelMaxTokens = getModelMaxTokens(request.model);
    const adjustedRequest = handleTokenLimits(request, modelMaxTokens);

    Logger.debug(`OpenAI chat request: model=${adjustedRequest.model}, messages=${adjustedRequest.messages.length}, tools=${adjustedRequest.tools?.length || 0}`);

    const requestBody = {
      model: adjustedRequest.model,
      messages: adjustedRequest.messages,
      tools: adjustedRequest.tools,
      stream: adjustedRequest.stream ?? false
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
      Logger.error(`OpenAI API error response: ${errorText}`);
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    if (adjustedRequest.stream === true) {
      // Streaming mode: return ReadableStream as content
      if (!response.body) {
        throw new Error('No response body for streaming');
      }

      // Create a ReadableStream that processes Server-Sent Events
      let collectedToolCalls: any[] = [];
      
      const stream = new ReadableStream({
        start(controller) {
          const reader = response.body!.getReader();
          const decoder = new TextDecoder();

          function pump(): Promise<void> {
            return reader.read().then(({ done, value }) => {
              if (done) {
                controller.close();
                return;
              }

              // Decode the chunk
              const chunk = decoder.decode(value, { stream: true });
              const lines = chunk.split('\n');

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data === '[DONE]') {
                    controller.close();
                    return;
                  }

                  try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.choices?.[0]?.delta;
                    
                    // Handle content streaming
                    if (delta?.content) {
                      controller.enqueue(delta.content);
                    }
                    
                    // Collect tool calls if they appear (shouldn't happen in streaming mode)
                    if (delta?.tool_calls) {
                      collectedToolCalls.push(...delta.tool_calls);
                      Logger.warn('Tool calls detected in OpenAI streaming mode - this indicates a design issue');
                    }
                  } catch (error) {
                    // Skip invalid JSON lines
                  }
                }
              }

              return pump();
            });
          }

          return pump();
        }
      });

      return {
        message: {
          role: 'assistant',
          content: stream,
          // Include tool calls if they were collected (fallback for unexpected behavior)
          tool_calls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined
        },
        done: false
      };
    } else {
      // Non-streaming mode: return string content
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
}