import Logger from '../utils/logger';
import { config } from '../utils/config';
import { capitalize } from '../utils/stringCase';
import {
  LLMProvider,
  LLMMessage,
  Tool,
  ContentPart,
  getModelMaxTokens,
  estimateTokens,
  estimateFullMessageTokens,
  trimConversationToTokenBudget,
  isImageGenerationModel,
  isResponsesAPIImageModel,
  isImageGenerationProvider,
  isResponsesAPICapable,
  type ResponsesAPICapable,
} from './llmProviders';
import { CONTINUE_ITERATIONS_TOOL, ToolApprovalCallback } from './approvalManager';
import type { IConversationHistory } from '../descriptions/conversationTypes';
import type { ChatWithLLMArgs, CompactInfo, ImageGenerationResult, MixedContentResult } from './mcpManager';
import type { ToolRegistry } from './toolRegistry';
import type { ToolExecutor } from './toolExecutor';
import type { HistoryManager } from './historyManager';

/** Fraction of the model's context window that triggers automatic history compaction. */
const AUTO_COMPACT_THRESHOLD = 0.90;

export interface AgentLoopDeps {
  llmProvider: LLMProvider;
  model: string;
  toolRegistry: ToolRegistry;
  toolExecutor: ToolExecutor;
  historyManager: HistoryManager;
}

/**
 * Implements the LLM agentic loop (tool calling, iteration limits).
 * Extracted from MCPServerManager to isolate loop logic.
 *
 * Key design decisions:
 * - `withModel()` returns a NEW AgentLoop (no mutation) — fixes the model race condition
 *   where concurrent requests with different model overrides would corrupt each other
 *   via the old `this.model = modelOverride` pattern.
 * - `run()` accepts `conversationHistory` as a parameter — each request owns its
 *   own history instance (provided by HistoryManager.createHistoryForSession()).
 */
export class AgentLoop {
  constructor(private readonly deps: AgentLoopDeps) {}

  /**
   * Returns a NEW AgentLoop with the model overridden — no mutation.
   * Fixes the model-mutation race condition in the original code.
   */
  withModel(model: string): AgentLoop {
    return new AgentLoop({ ...this.deps, model });
  }

  async run(
    args: ChatWithLLMArgs,
    conversationHistory: IConversationHistory,
  ): Promise<ReadableStream<string> | string | ImageGenerationResult | MixedContentResult> {
    const {
      message, customSystemPrompt, abortSignal, serverNames, stream,
      attachments, userLogin, isAdmin, approvalCallback, toolNameFilter,
      freshContext, onContextUpdate, onCompact,
    } = args;
    const { llmProvider, model, toolRegistry, toolExecutor, historyManager } = this.deps;

    // ── Track 1: Dedicated image-generation models (Images API) ─────────────
    if (isImageGenerationModel(model)) {
      if (!isImageGenerationProvider(llmProvider)) {
        throw new Error(`Provider '${llmProvider.name}' does not support image generation`);
      }
      await conversationHistory.addMessage({ role: 'user', content: message });
      const url = await llmProvider.generateImage(message, model, abortSignal);
      return { kind: 'image', urls: [url] };
    }

    // ── Track 2: Chat models with image generation via Responses API ─────────
    if (isResponsesAPIImageModel(model) && isResponsesAPICapable(llmProvider)) {
      if (!conversationHistory.hasActiveConversation() && userLogin) {
        await conversationHistory.startNewConversation(undefined, userLogin);
      }
      await conversationHistory.addMessage({ role: 'user', content: message });
      const history = await conversationHistory.getCurrentConversation();
      const result = await this.chatWithResponsesAPILoop({
        model,
        systemPrompt: customSystemPrompt,
        history,
        tools: toolRegistry.convertMCPToolsToLLMFormat(),
        approvalCallback,
        abortSignal,
        userLogin,
        isAdmin,
        subAgentRunner: null,
        toolExecutor,
      });
      return result.imageUrls.length > 0
        ? { kind: 'mixed', text: result.text, imageUrls: result.imageUrls }
        : result.text;
    }

    // ── Track 3: Standard Chat Completions agentic loop ──────────────────────
    let tools = toolRegistry.convertMCPToolsToLLMFormat();
    Logger.debug(`Total tools available before filtering: ${tools.length}`);

    if (serverNames != null) {
      tools = tools.filter(tool =>
        !tool.serverName || serverNames.includes(tool.serverName)
      );
    }

    tools = [...tools, ...toolRegistry.getVirtualTools(serverNames ?? null)];

    if (toolNameFilter && toolNameFilter.length > 0 && !toolNameFilter.includes('*')) {
      tools = tools.filter(tool => {
        const name = tool.function.name;
        return toolNameFilter.some(pattern =>
          name === pattern || name.startsWith(pattern + '_')
        );
      });
    }
    Logger.debug(`Total tools available after filtering: ${tools.length}`);

    if (!conversationHistory.hasActiveConversation() && userLogin) {
      await conversationHistory.startNewConversation(undefined, userLogin);
    }

    await conversationHistory.addMessage({ role: 'user', content: message });
    Logger.debug(`Added user message to conversation history: "${message}"`);

    const conversationMessages = await conversationHistory.getCurrentConversation();
    const displayName = userLogin ? capitalize(userLogin) : '';
    const userInstruction = userLogin
      ? `\n\nCurrent authenticated user: ${userLogin}\nAlways address and greet the user as "${displayName}" — do not use a name found in memory instead.\nWhen calling any memory tool (memory_mcreate, memory_msearch, memory_mlist, memory_mdelete), always include user_login="${userLogin}" in the tool arguments.`
      : '';
    const parallelToolInstruction = '\n\nWhen multiple independent tool calls are needed to answer a request, issue ALL of them in a single response as a batch rather than one at a time. This significantly reduces latency.';
    const currentTimeInstruction = `\n\nCurrent date and time (UTC): ${new Date().toISOString()}`;
    const effectiveSystemPrompt = customSystemPrompt + userInstruction + parallelToolInstruction + currentTimeInstruction;

    let trimmedConversation: typeof conversationMessages;
    if (freshContext) {
      trimmedConversation = conversationMessages.slice(-1);
      Logger.debug('chatWithLLM: fresh-context mode — prior conversation history excluded');
    } else {
      trimmedConversation = trimConversationToTokenBudget(
        conversationMessages,
        config.CONVERSATION_HISTORY_TOKEN_BUDGET,
        msg => estimateTokens(msg.content + (msg.toolCalls ? JSON.stringify(msg.toolCalls) : ''))
      );
    }

    let historyMessages: LLMMessage[] = trimmedConversation.map(msg => ({
      role: msg.role,
      content: msg.content,
      ...(msg.toolCalls  ? { tool_calls: msg.toolCalls as LLMMessage['tool_calls'] }    : {}),
      ...(msg.toolCallId ? { tool_call_id: msg.toolCallId } : {}),
    }));

    if (attachments && attachments.length > 0) {
      const lastUserIdx = historyMessages.map(m => m.role).lastIndexOf('user');
      if (lastUserIdx !== -1) {
        const extraTextParts: string[] = [];
        const imageContentBlocks: ContentPart[] = [];

        for (const file of attachments) {
          if (file.mimeType.startsWith('image/')) {
            imageContentBlocks.push({
              type: 'image_url' as const,
              image_url: {
                url: `data:${file.mimeType};base64,${file.base64}`,
                detail: 'auto' as const,
              },
            });
          } else if (
            file.mimeType.startsWith('text/') ||
            file.mimeType === 'application/json' ||
            file.mimeType === 'application/xml' ||
            file.mimeType === 'application/javascript' ||
            file.mimeType === 'application/typescript'
          ) {
            const text = Buffer.from(file.base64, 'base64').toString('utf-8');
            const label = file.name ? `[Attached file: ${file.name}]` : `[Attached ${file.mimeType} file]`;
            extraTextParts.push(`${label}\n\`\`\`\n${text}\n\`\`\``);
          } else {
            imageContentBlocks.push({
              type: 'image_url' as const,
              image_url: {
                url: `data:${file.mimeType};base64,${file.base64}`,
                detail: 'auto' as const,
              },
            });
          }
        }

        const textContent = [...extraTextParts, message].join('\n\n');
        historyMessages[lastUserIdx] = {
          ...historyMessages[lastUserIdx],
          content: [
            ...imageContentBlocks,
            { type: 'text' as const, text: textContent },
          ],
        };
      }
    }

    let messages: LLMMessage[] = [
      { role: 'system', content: effectiveSystemPrompt },
      ...historyMessages
    ];

    const modelMaxTokens = getModelMaxTokens(model);
    const estimatedTokens = messages.reduce((sum, m) => sum + estimateFullMessageTokens(m), 0);
    const usageRatio = estimatedTokens / modelMaxTokens;

    if (usageRatio >= AUTO_COMPACT_THRESHOLD) {
      Logger.warn(`Context usage ${Math.round(usageRatio * 100)}% exceeds threshold — auto-compacting history`);
      const compactResult = await historyManager.compactHistory(conversationHistory, llmProvider, model);
      const compacted = await conversationHistory.getCurrentConversation();
      messages = [{ role: 'system', content: effectiveSystemPrompt }, ...compacted];
      const compactedTokens = messages.reduce((sum, m) => sum + estimateFullMessageTokens(m), 0);
      onCompact?.({ ...compactResult, tokensBefore: estimatedTokens, tokensAfter: compactedTokens });
      onContextUpdate?.(compactedTokens, modelMaxTokens);
    } else {
      onContextUpdate?.(estimatedTokens, modelMaxTokens);
    }

    const originalMaxIterations = args.maxIterations ?? config.MAX_LLM_ITERATIONS;
    let maxIterations = originalMaxIterations;
    let currentIteration = 0;
    let hasCalledTools = false;
    let nudgeInjected = false;

    continuationLoop: while (true) {
      while (currentIteration < maxIterations) {
        if (abortSignal?.aborted) {
          throw new Error('Operation cancelled by user');
        }

        Logger.debug(`AgentLoop request: model=${model}, messages=${messages.length}, tools=${tools.length}, provider=${llmProvider.name}`);

        const chatRequest = {
          model,
          messages,
          tools,
          stream: false  // Always false during tool iterations
        };

        let response = await llmProvider.chat(chatRequest, abortSignal);

        if (!response?.message?.tool_calls || response.message.tool_calls.length === 0) {
          const modelNarrated = !hasCalledTools && !nudgeInjected && tools.length > 0 && !!response?.message?.content;
          if (modelNarrated) {
            Logger.debug('Model returned narrative text without tool calls — injecting nudge to force tool execution');
            messages.push({ role: 'assistant', content: response.message.content as string });
            messages.push({ role: 'user', content: 'Please use the available tools to respond to the request.' });
            nudgeInjected = true;
            currentIteration++;
            continue;
          }
          return response?.message?.content || 'No response content received';
        }

        Logger.debug(`Executing ${response.message.tool_calls.length} tool calls...`);

        if (abortSignal?.aborted) {
          throw new Error('Operation cancelled by user');
        }

        hasCalledTools = true;
        // Capture subAgentRunner from the registry for this iteration
        const subAgentRunner = (toolRegistry as any).subAgentRunner ?? null;

        const toolResults: string[] = await Promise.all(
          response.message.tool_calls.map(async (toolCall) => {
            if (!toolCall?.function?.name) {
              Logger.error(`Invalid tool call structure: ${JSON.stringify(toolCall)}`);
              return 'Error: Invalid tool call structure';
            }
            Logger.debug(`Calling tool: ${JSON.stringify(toolCall)}`);
            const result = await toolExecutor.execute(toolCall, subAgentRunner, approvalCallback, { userLogin, isAdmin });
            Logger.debug(`Tool call result for ${toolCall.function.name}: ${result}`);
            return result;
          })
        );

        if (abortSignal?.aborted) {
          throw new Error('Operation cancelled by user');
        }

        messages.push({
          role: 'assistant',
          content: response.message.content as string || '',
          tool_calls: response.message.tool_calls
        });
        await conversationHistory.addMessage({
          role: 'assistant',
          content: response.message.content as string || '',
          toolCalls: response.message.tool_calls
        });

        for (let i = 0; i < response.message.tool_calls.length; i++) {
          const toolCall = response.message.tool_calls[i];
          messages.push({ role: 'tool', content: toolResults[i], tool_call_id: toolCall.id });
          await conversationHistory.addMessage({ role: 'tool', content: toolResults[i], toolCallId: toolCall.id });
        }

        currentIteration++;
        Logger.debug(`Completed iteration ${currentIteration}/${maxIterations}`);
      }

      if (approvalCallback && !abortSignal?.aborted) {
        const approved = await approvalCallback(
          CONTINUE_ITERATIONS_TOOL,
          { iterations_completed: currentIteration },
          `The agent has completed ${currentIteration} iteration${currentIteration === 1 ? '' : 's'}. Allow it to continue with ${originalMaxIterations} more?`,
        );
        if (approved) {
          maxIterations += originalMaxIterations;
          continue continuationLoop;
        }
      }
      break;
    }

    Logger.debug(`Reached max iterations (${maxIterations}), making final response call`);

    if (abortSignal?.aborted) {
      throw new Error('Operation cancelled by user');
    }

    const finalResponse = await llmProvider.chat({
      model,
      messages,
      stream,
      skipTruncation: true
    }, abortSignal);

    return finalResponse?.message?.content;
  }

  /**
   * Agentic loop using the OpenAI Responses API.
   */
  private async chatWithResponsesAPILoop(params: {
    model: string;
    systemPrompt: string;
    history: LLMMessage[];
    tools: Tool[];
    approvalCallback?: ToolApprovalCallback;
    abortSignal?: AbortSignal;
    userLogin?: string;
    isAdmin?: boolean;
    subAgentRunner: null;
    toolExecutor: ToolExecutor;
  }): Promise<{ text: string; imageUrls: string[] }> {
    const { model, systemPrompt, history, tools, approvalCallback, abortSignal, userLogin, isAdmin, toolExecutor } = params;
    const provider = this.deps.llmProvider as unknown as ResponsesAPICapable;

    const functionTools = tools.map(t => ({
      type: 'function',
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));

    const responsesTools: any[] = [
      { type: 'image_generation', size: '1024x1024', quality: 'medium' },
      ...functionTools,
    ];

    const inputMessages = history
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role,
        content: typeof m.content === 'string'
          ? m.content
          : (m.content as ContentPart[])
              .filter((p: any) => p.type === 'text')
              .map((p: any) => p.text)
              .join(' '),
      }));

    let collectedText = '';
    const collectedImageUrls: string[] = [];
    let previousResponseId: string | undefined;
    let inputForThisCall: any[] = inputMessages;
    const ORIGINAL_MAX_ITERATIONS = 10;
    let maxIterations = ORIGINAL_MAX_ITERATIONS;
    let totalIterations = 0;

    continuationLoop: while (true) {
      let hitMaxIterations = true;
      for (let iteration = 0; iteration < maxIterations; iteration++, totalIterations++) {
        if (abortSignal?.aborted) throw new Error('Operation cancelled by user');

        const { id, output } = await provider.callResponsesAPI({
          model,
          instructions: previousResponseId ? undefined : systemPrompt,
          input: inputForThisCall,
          tools: responsesTools,
          previousResponseId,
          abortSignal,
        });

        previousResponseId = id;

        const functionCallOutputs: any[] = [];
        let hasFunctionCalls = false;

        for (const item of output) {
          if (item.type === 'message') {
            for (const contentItem of (item.content ?? [])) {
              if (contentItem.type === 'output_text') {
                collectedText += contentItem.text;
              }
            }
          } else if (item.type === 'image_generation_call' && item.status === 'completed' && item.result) {
            collectedImageUrls.push(`data:image/png;base64,${item.result}`);
          } else if (item.type === 'function_call') {
            hasFunctionCalls = true;
            const toolCallAdapter = {
              id: item.id,
              type: 'function' as const,
              function: { name: item.name, arguments: item.arguments },
            };
            const result = await toolExecutor.execute(toolCallAdapter, null, approvalCallback, { userLogin, isAdmin });
            functionCallOutputs.push({
              type: 'function_call_output',
              call_id: item.call_id,
              output: result,
            });
          }
        }

        if (!hasFunctionCalls) {
          hitMaxIterations = false;
          break;
        }

        inputForThisCall = functionCallOutputs;
      }

      if (hitMaxIterations && approvalCallback && !abortSignal?.aborted) {
        const approved = await approvalCallback(
          CONTINUE_ITERATIONS_TOOL,
          { iterations_completed: totalIterations },
          `The agent has completed ${totalIterations} iteration${totalIterations === 1 ? '' : 's'}. Allow it to continue with ${ORIGINAL_MAX_ITERATIONS} more?`,
        );
        if (approved) {
          maxIterations = ORIGINAL_MAX_ITERATIONS;
          continue continuationLoop;
        }
      }
      break;
    }

    return { text: collectedText, imageUrls: collectedImageUrls };
  }
}
