import { Ollama } from 'ollama';
import Logger from '../utils/logger';
import { AuthGithubCopilot } from '../utils/githubAuth';
import { config } from '../utils/config';

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
    'gpt-4.1': 1047576,
    'gpt-4.1-mini': 1047576,
    'gpt-4.1-nano': 1047576,
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
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for a full message, including binary (image_url) content parts.
 *
 * For text we use the 4-chars-per-token heuristic.
 * For image_url parts we use OpenAI's tile-based formula rather than measuring
 * the raw base64 string (which would massively over-count):
 *   low-detail  → 85 tokens flat
 *   high-detail → 85 + 170 × ⌈W/512⌉ × ⌈H/512⌉   (max ~1275 for 1920px)
 * Because we don't know the image dimensions at this point we use a conservative
 * upper-bound of 1275 tokens per image.  That is still orders of magnitude more
 * accurate than counting base64 characters and prevents the truncation logic
 * from falsely stripping images that are well within model token limits.
 */
const IMAGE_TOKEN_ESTIMATE = 1275; // worst-case high-detail 1024×1024 OpenAI tile cost

export function estimateFullMessageTokens(msg: LLMMessage): number {
  let text = '';
  let imageCount = 0;
  if (typeof msg.content === 'string') {
    text = msg.content;
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part.type === 'text') {
        text += part.text;
      } else if (part.type === 'image_url') {
        // Count images by their API token cost, not by base64 byte length
        imageCount += 1;
      }
    }
  }
  if (msg.tool_calls) {
    text += JSON.stringify(msg.tool_calls);
  }
  return estimateTokens(text) + imageCount * IMAGE_TOKEN_ESTIMATE;
}

/**
 * Trim a conversation array so that the total estimated token count stays within
 * the given budget, keeping the most recent messages.
 *
 * The function walks from the tail backwards, accumulating token estimates until
 * the budget is exhausted.  It then returns the suffix that fits, preserving
 * message order.  No messages are modified — only the oldest ones are dropped.
 *
 * Generic so it works with both LLMMessage[] and the internal Message[] type used
 * by conversation history — callers supply the per-message estimator function.
 *
 * @param messages - Full conversation history (chronological order)
 * @param tokenBudget - Maximum total tokens allowed across all returned messages
 * @param estimateFn - Function that estimates tokens for a single message
 * @returns The most-recent subset of messages that fits within the budget
 */
export function trimConversationToTokenBudget<T>(
  messages: T[],
  tokenBudget: number,
  estimateFn: (msg: T) => number
): T[] {
  let accumulated = 0;
  let cutIndex = messages.length; // index of the first kept message

  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateFn(messages[i]);
    if (accumulated + msgTokens > tokenBudget) {
      break;
    }
    accumulated += msgTokens;
    cutIndex = i;
  }

  const trimmed = messages.slice(cutIndex);
  if (cutIndex > 0) {
    Logger.debug(
      `trimConversationToTokenBudget: dropped ${cutIndex} message(s), kept ${trimmed.length}, ~${accumulated} tokens (budget=${tokenBudget})`
    );
  }
  return trimmed;
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
 * Sanitize a message sequence to remove structurally invalid tool messages.
 *
 * Two cases are fixed:
 *  1. A `tool` message whose `tool_call_id` has no matching preceding assistant
 *     `tool_calls` entry (e.g. the assistant message was sliced off by token
 *     budget trimming) → the orphaned tool message is dropped.
 *  2. An `assistant` message with `tool_calls` that is not followed by all of
 *     its expected `tool` responses before the next non-tool message → the
 *     incomplete assistant message (and any partial tool responses already
 *     collected for it) are dropped.
 *
 * This prevents 400 errors from OpenAI-compatible APIs which require every
 * `tool` message to be a direct response to a preceding `tool_calls` block.
 */
function sanitizeMessageSequence(messages: LLMMessage[]): LLMMessage[] {
  const result: LLMMessage[] = [];
  // IDs of tool_calls we are still waiting for responses to
  let pendingIds: Set<string> | null = null;
  // Index in `result` of the assistant message whose tool_calls are pending
  let pendingAssistantIndex = -1;

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // If a previous assistant block was incomplete, drop it before opening a new one
      if (pendingIds && pendingIds.size > 0 && pendingAssistantIndex !== -1) {
        // Remove the incomplete assistant + any partial tool responses
        result.splice(pendingAssistantIndex);
      }
      pendingIds = new Set(msg.tool_calls.map(tc => tc.id));
      pendingAssistantIndex = result.length;
      result.push(msg);
    } else if (msg.role === 'tool') {
      if (pendingIds && msg.tool_call_id && pendingIds.has(msg.tool_call_id)) {
        result.push(msg);
        pendingIds.delete(msg.tool_call_id);
        if (pendingIds.size === 0) {
          pendingIds = null;
          pendingAssistantIndex = -1;
        }
      }
      // Orphaned tool message (no preceding assistant tool_calls) — drop silently
    } else {
      // Non-tool message: if the previous assistant block is still incomplete, drop it
      if (pendingIds && pendingIds.size > 0 && pendingAssistantIndex !== -1) {
        result.splice(pendingAssistantIndex);
        pendingIds = null;
        pendingAssistantIndex = -1;
      }
      result.push(msg);
    }
  }

  // Trailing incomplete assistant block
  if (pendingIds && pendingIds.size > 0 && pendingAssistantIndex !== -1) {
    result.splice(pendingAssistantIndex);
  }

  return result;
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
  // Always sanitize the message sequence first to prevent orphaned tool messages
  // from reaching the API (can happen when conversation history is naively trimmed).
  const sanitized = sanitizeMessageSequence(request.messages);
  if (sanitized.length !== request.messages.length) {
    Logger.warn(
      `sanitizeMessageSequence: removed ${request.messages.length - sanitized.length} orphaned message(s) from conversation history`
    );
    request = { ...request, messages: sanitized };
  }

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

    if (lastUserMessage) {
      // Key insight: the returned request always keeps request.tools regardless of this
      // path, so tool tokens are sent to the API either way. If the overflow is caused
      // by verbose MCP tool definitions (not the image), stripping the image is wrong —
      // it degrades the request unnecessarily. Only strip images if the message content
      // itself (system + last user, without tool tokens) exceeds the aggressive budget.
      const msgOnlyTokens =
        (systemMessage ? estimateFullMessageTokens(systemMessage) : 0) +
        estimateFullMessageTokens(lastUserMessage);

      if (msgOnlyTokens <= aggressiveBudget) {
        // Overflow was caused by tool definitions, not message content.
        // Preserve image — just drop conversation history.
        Logger.warn(`Overflow caused by tool definitions (${toolTokens} tool tokens); preserving image in messages`);
        return {
          ...request,
          messages: [...(systemMessage ? [systemMessage] : []), lastUserMessage],
        };
      }

      // Message content itself is too large: strip images and truncate text.
      const [strippedUserMsg] = stripBinaryContent([lastUserMessage]);
      let userContent = getContentText(strippedUserMsg.content);
      let userTokens = estimateTokens(userContent);
      
      // Truncate user message text if too long
      if (userTokens > aggressiveBudget / 2) {
        const targetLength = Math.floor((aggressiveBudget / 2) * 4); // Convert back to characters
        userContent = userContent.substring(0, targetLength) + '... [truncated]';
      }

      return {
        ...request,
        messages: [
          ...(systemMessage ? [systemMessage] : []),
          { ...strippedUserMsg, content: userContent },
        ],
      };
    }

    return { ...request, messages: systemMessage ? [systemMessage] : [] };
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
  private isAzureModelsEndpoint(): boolean {
    return this.baseUrl.includes('models.inference.ai.azure.com');
  }

  /**
   * The /models list uses full registry IDs like
   * "azureml://registries/azure-openai/models/gpt-4o/versions/2",
   * but /chat/completions only accepts the short name ("gpt-4o").
   * Extract the leaf segment when targeting the Azure Models endpoint.
   */
  private normalizeModelId(modelId: string): string {
    if (this.isAzureModelsEndpoint() && modelId.startsWith('azureml://')) {
      const parts = modelId.split('/');
      // URI: azureml://registries/<registry>/models/<name>/versions/<ver>
      //      index:  0           1           2       3      4        5      6
      const nameIdx = parts.indexOf('models');
      if (nameIdx !== -1 && nameIdx + 1 < parts.length) {
        return parts[nameIdx + 1];
      }
    }
    return modelId;
  }

  private async createHeaders(): Promise<Record<string, string>> {
    // Azure Models endpoint uses a PAT with models:read scope (preferred) or the raw
    // GitHub OAuth token. The standard Copilot endpoint uses the short-lived internal token.
    let currentToken: string;
    if (this.isAzureModelsEndpoint()) {
      const pat = config.AUTH_GITHUB_COPILOT_PAT;
      const source = pat ? 'PAT' : 'oauth-token';
      Logger.debug(`Azure Models endpoint: using ${source} (PAT configured: ${!!pat})`);
      currentToken = pat || (await AuthGithubCopilot.oauthToken()) || this.apiKey;
    } else {
      currentToken = (await AuthGithubCopilot.access()) ?? this.apiKey;
    }
    
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
      Logger.debug(`Available GitHub Copilot models: ${JSON.stringify(modelIds)}`);
      
      return modelIds;
    } catch (error) {
      Logger.error(`Error getting GitHub Copilot models: ${error}`);
      return ['gpt-4o', 'gpt-4o-mini']; // Fallback to known models
    }
  }

  // GitHub Copilot API supports the model's full context window for modern models.
  // The previous 7500-token cap was written for old gpt-4 (8K context) and is no longer
  // accurate — gpt-4.1 and other current Copilot models have 128K+ context windows.
  // We leave a small headroom below the true per-model limit so we never hit a hard 413.
  private static readonly COPILOT_REQUEST_TOKEN_LIMIT = 128000;

  // GitHub Models (Azure AI Inference) free tier enforces an 8000-token hard limit
  // per request (tools + messages combined). Leave headroom for the response.
  private static readonly AZURE_MODELS_REQUEST_TOKEN_LIMIT = 7500;

  async chat(request: LLMChatRequest, abortSignal?: AbortSignal): Promise<LLMChatResponse> {
    // Store the model for this request
    this.model = request.model;

    // Handle token limits for GitHub Copilot API.
    // Use the smaller of the model's theoretical context window and the Copilot
    // per-request limit so that ageing models (gpt-4, 8192 tokens) are still
    // correctly capped while modern models (gpt-4.1, 1M tokens) get a realistic limit.
    const endpointLimit = this.isAzureModelsEndpoint()
      ? GitHubCopilotProvider.AZURE_MODELS_REQUEST_TOKEN_LIMIT
      : GitHubCopilotProvider.COPILOT_REQUEST_TOKEN_LIMIT;

    const modelMaxTokens = Math.min(
      getModelMaxTokens(request.model),
      endpointLimit
    );
    const adjustedRequest = handleTokenLimits(request, modelMaxTokens);

    const requestBody: any = {
      model: this.normalizeModelId(adjustedRequest.model),
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
              model: this.normalizeModelId(retryRequest.model),
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

          // Surface other structured API errors with their message
          if (errorData.error?.message) {
            throw new Error(`GitHub Copilot API error: 400 - ${errorData.error.message} (code: ${errorData.error.code ?? 'unknown'})`);
          }
        } catch (parseError) {
          // Re-throw intentional errors; only swallow JSON parse failures
          if (!(parseError instanceof SyntaxError)) {
            throw parseError;
          }
        }
      }
      
      throw new Error(`GitHub Copilot API error: ${response.status} ${response.statusText} - ${errorText}`);
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
          model: this.normalizeModelId(retryRequest.model),
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

// ---------------------------------------------------------------------------
// Anthropic Provider
// ---------------------------------------------------------------------------

/**
 * Returns the maximum output tokens for an Anthropic model.
 * Anthropic requires an explicit max_tokens field (not the context window size).
 */
function getAnthropicMaxOutputTokens(model: string): number {
  if (/claude-(opus|sonnet)-4|claude-haiku-4-5/i.test(model)) return 16000;
  if (/claude-3-[57]-sonnet|claude-3-7/i.test(model)) return 8192;
  return 4096;
}

/**
 * Converts the internal LLMMessage[] into Anthropic's messages format.
 * Returns { system, messages } where system is the joined system prompt (or undefined)
 * and messages is the Anthropic-compatible messages array.
 *
 * Anthropic rules:
 * - system messages → top-level system string (not in messages array)
 * - tool role → user message with tool_result content block
 * - assistant with tool_calls → assistant message with tool_use content blocks
 * - messages must strictly alternate user/assistant (consecutive same-role are merged)
 */
function convertToAnthropicMessages(messages: LLMMessage[]): {
  system: string | undefined;
  messages: any[];
} {
  // Extract system messages
  const systemParts: string[] = [];
  const nonSystemMessages: LLMMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = typeof msg.content === 'string' ? msg.content : msg.content.map(p => p.type === 'text' ? p.text : '').join('');
      systemParts.push(text);
    } else {
      nonSystemMessages.push(msg);
    }
  }

  const system = systemParts.length > 0 ? systemParts.join('\n\n') : undefined;

  // Convert to Anthropic message format
  const anthropicMessages: any[] = [];

  for (const msg of nonSystemMessages) {
    if (msg.role === 'tool') {
      // Tool result → user message with tool_result content block
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      anthropicMessages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content
        }]
      });
    } else if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // Assistant with tool calls → content array with tool_use blocks
      const content: any[] = [];

      // Include text content if present
      if (msg.content && (typeof msg.content === 'string' ? msg.content : '').length > 0) {
        content.push({ type: 'text', text: typeof msg.content === 'string' ? msg.content : '' });
      }

      // Add tool_use blocks
      for (const tc of msg.tool_calls) {
        let input: any = {};
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          input = { raw: tc.function.arguments };
        }
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input
        });
      }

      anthropicMessages.push({ role: 'assistant', content });
    } else {
      // Regular user or assistant message
      const role = msg.role as 'user' | 'assistant';
      let content: any;

      if (Array.isArray(msg.content)) {
        // Multimodal content — convert image_url parts to Anthropic vision format
        content = msg.content.map(part => {
          if (part.type === 'text') return { type: 'text', text: part.text };
          if (part.type === 'image_url') {
            const url = part.image_url.url;
            if (url.startsWith('data:')) {
              const match = url.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                return {
                  type: 'image',
                  source: { type: 'base64', media_type: match[1], data: match[2] }
                };
              }
            }
            return { type: 'image', source: { type: 'url', url } };
          }
          return { type: 'text', text: '' };
        });
      } else {
        content = msg.content as string;
      }

      anthropicMessages.push({ role, content });
    }
  }

  // Anthropic requires messages to start with 'user' and strictly alternate.
  // Merge consecutive same-role messages by combining their content.
  const merged: any[] = [];
  for (const msg of anthropicMessages) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) {
      // Merge content
      const lastContent = Array.isArray(last.content) ? last.content : [{ type: 'text', text: last.content }];
      const newContent = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }];
      last.content = [...lastContent, ...newContent];
    } else {
      merged.push({ ...msg });
    }
  }

  // Ensure first message is 'user'
  if (merged.length > 0 && merged[0].role !== 'user') {
    merged.unshift({ role: 'user', content: 'Continue.' });
  }

  return { system, messages: merged };
}

export class AnthropicProvider implements LLMProvider {
  name = 'Anthropic';
  private baseUrl: string;
  private apiKey: string;
  private static readonly ANTHROPIC_VERSION = '2023-06-01';

  constructor(apiKey: string, baseUrl: string = 'https://api.anthropic.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private createHeaders(): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'anthropic-version': AnthropicProvider.ANTHROPIC_VERSION,
      'Content-Type': 'application/json'
    };
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.createHeaders()
      });
      // 200 = healthy, 401 = bad key (treat as unhealthy), network error caught below
      return response.ok;
    } catch (error) {
      Logger.error(`Anthropic health check failed: ${error}`);
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.createHeaders()
      });

      if (response.ok) {
        const data = await response.json();
        const models = data.data || [];
        if (models.length > 0) {
          return models.map((m: any) => m.id as string);
        }
      }
    } catch (error) {
      Logger.error(`Error fetching Anthropic models: ${error}`);
    }

    // Fallback to known models
    return [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
      'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet-20241022',
      'claude-3-haiku-20240307'
    ];
  }

  async chat(request: LLMChatRequest, abortSignal?: AbortSignal): Promise<LLMChatResponse> {
    const modelMaxTokens = getModelMaxTokens(request.model);
    const adjustedRequest = handleTokenLimits(request, modelMaxTokens);

    const { system, messages } = convertToAnthropicMessages(adjustedRequest.messages);
    const maxTokens = getAnthropicMaxOutputTokens(adjustedRequest.model);

    const requestBody: any = {
      model: adjustedRequest.model,
      max_tokens: maxTokens,
      messages,
      stream: adjustedRequest.stream ?? false
    };

    if (system) {
      requestBody.system = system;
    }

    if (adjustedRequest.tools && adjustedRequest.tools.length > 0) {
      requestBody.tools = adjustedRequest.tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters
      }));
    }

    Logger.debug(`Anthropic chat: model=${adjustedRequest.model}, messages=${messages.length}, tools=${requestBody.tools?.length ?? 0}`);

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.createHeaders(),
      body: JSON.stringify(requestBody),
      signal: abortSignal
    });

    if (!response.ok) {
      const errorText = await response.text();
      Logger.error(`Anthropic API error: ${response.status} ${response.statusText} - ${errorText}`);
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    if (adjustedRequest.stream === true) {
      if (!response.body) {
        throw new Error('No response body for streaming');
      }

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

              const chunk = decoder.decode(value, { stream: true });
              const lines = chunk.split('\n');

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6).trim();
                  if (!data) continue;

                  try {
                    const parsed = JSON.parse(data);
                    if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                      controller.enqueue(parsed.delta.text);
                    } else if (parsed.type === 'message_stop') {
                      controller.close();
                      return;
                    }
                  } catch {
                    // Skip invalid JSON
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
        message: { role: 'assistant', content: stream },
        done: false
      };
    }

    // Non-streaming
    const data = await response.json();

    if (!data.content || data.content.length === 0) {
      throw new Error('No content in Anthropic response');
    }

    // Extract text and tool_use blocks
    const textBlocks: string[] = [];
    const toolCalls: ToolCall[] = [];

    for (const block of data.content) {
      if (block.type === 'text') {
        textBlocks.push(block.text);
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input)
          }
        });
      }
    }

    return {
      message: {
        role: 'assistant',
        content: textBlocks.join(''),
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
      },
      done: true
    };
  }
}

/** Dedicated image-generation models that use the Images API directly */
const IMAGE_GENERATION_MODEL_PATTERNS = [/^dall-e-/i, /^gpt-image-/i];

/** Returns true for models like dall-e-3, dall-e-2, gpt-image-1 */
export function isImageGenerationModel(model: string): boolean {
  return IMAGE_GENERATION_MODEL_PATTERNS.some(p => p.test(model));
}

/** Chat models that support the image_generation tool via the Responses API */
const RESPONSES_API_IMAGE_MODEL_PATTERNS = [
  /^gpt-4o/i,
  /^gpt-4\.1/i,
  /^o3/i,
  /^gpt-5/i,
];

/** Returns true for models like gpt-4.1, gpt-4o, o3, gpt-5 */
export function isResponsesAPIImageModel(model: string): boolean {
  return RESPONSES_API_IMAGE_MODEL_PATTERNS.some(p => p.test(model));
}

/** Provider capability: generate images via the OpenAI Images API */
export interface ImageGenerationProvider {
  generateImage(prompt: string, model: string, signal?: AbortSignal): Promise<string>;
}

export function isImageGenerationProvider(p: unknown): p is ImageGenerationProvider {
  return typeof (p as any)?.generateImage === 'function';
}

/**
 * Provider capability: single raw HTTP call to the OpenAI Responses API.
 * The agentic loop (function-call handling, tool approval) stays in MCPServerManager.
 */
export interface ResponsesAPICapable {
  callResponsesAPI(params: {
    model: string;
    instructions?: string;
    input: any[];
    tools: any[];
    previousResponseId?: string;
    abortSignal?: AbortSignal;
  }): Promise<{ id: string; output: any[] }>;
}

export function isResponsesAPICapable(p: unknown): p is ResponsesAPICapable {
  return typeof (p as any)?.callResponsesAPI === 'function';
}

export class OpenAIProvider implements LLMProvider, ImageGenerationProvider, ResponsesAPICapable {
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
      const response = await fetch(`${this.baseUrl}/v1/models`,  {
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

    const chatPromise = fetch(`${this.baseUrl}/v1/chat/completions`, {
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

  async generateImage(prompt: string, model: string, signal?: AbortSignal): Promise<string> {
    // gpt-image-1 only supports b64_json; dall-e-3 and dall-e-2 support url
    const usesB64 = /^gpt-image-/i.test(model);
    const requestBody: any = {
      model,
      prompt,
      n: 1,
      size: '1024x1024',
      response_format: usesB64 ? 'b64_json' : 'url',
    };

    Logger.debug(`OpenAI generateImage: model=${model}, prompt=${prompt.slice(0, 80)}`);

    const response = await fetch(`${this.baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      Logger.error(`OpenAI Images API error: ${errorText}`);
      throw new Error(`OpenAI Images API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const item = data.data?.[0];
    if (!item) throw new Error('No image returned from OpenAI Images API');

    if (usesB64) {
      return `data:image/png;base64,${item.b64_json}`;
    }
    return item.url as string;
  }

  async callResponsesAPI(params: {
    model: string;
    instructions?: string;
    input: any[];
    tools: any[];
    previousResponseId?: string;
    abortSignal?: AbortSignal;
  }): Promise<{ id: string; output: any[] }> {
    const { model, instructions, input, tools, previousResponseId, abortSignal } = params;

    const requestBody: any = { model, tools };
    if (previousResponseId) {
      requestBody.previous_response_id = previousResponseId;
    } else {
      if (instructions) requestBody.instructions = instructions;
    }
    requestBody.input = input;

    Logger.debug(`OpenAI Responses API: model=${model}, input items=${input.length}, tools=${tools.length}`);

    const response = await fetch(`${this.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: abortSignal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      Logger.error(`OpenAI Responses API error: ${errorText}`);
      throw new Error(`OpenAI Responses API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return { id: data.id as string, output: data.output ?? [] };
  }
}