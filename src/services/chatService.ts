import type { Agent } from '../agent';
import type { ToolApprovalCallback } from '../mcp/approvalManager';
import type { ImageGenerationResult, MixedContentResult, CompactInfo } from '../mcp/mcpManager';

export interface ChatResult {
  answer: ReadableStream<string> | string | ImageGenerationResult | MixedContentResult;
  /**
   * The final text content to persist.
   * - Defined for string/image/mixed answers.
   * - undefined for streaming answers (finalContent is determined after the
   *   stream is fully consumed by the caller via handleStreamingResponse).
   */
  finalContent: string | undefined;
}

/**
 * Handles the agent.chat() call and determines finalContent for non-streaming
 * answers. Extracted from src/routes/chat.ts lines 336–384.
 *
 * Does NOT contain slash command logic (that is handled by processSlashCommand).
 * Does NOT reference HTTP objects (req/res) — all HTTP concerns stay in the route.
 */
export class ChatService {
  async chat(params: {
    agent: Agent;
    prompt: string;
    attachments?: { base64: string; mimeType: string; name?: string }[];
    approvalCallback?: ToolApprovalCallback;
    onContextUpdate?: (used: number, max: number) => void;
    onCompact?: (info: CompactInfo) => void;
    isAdmin?: boolean;
    toolNameFilter?: string[];
    maxIterations?: number;
    freshContext?: boolean;
    abortSignal?: AbortSignal;
  }): Promise<ChatResult> {
    const {
      agent, prompt, attachments, approvalCallback, onContextUpdate,
      onCompact, isAdmin, toolNameFilter, maxIterations, freshContext, abortSignal,
    } = params;

    const answer = await agent.chat(
      prompt,
      abortSignal,
      true,            // stream=true so the LLM can stream the final response
      attachments,
      approvalCallback,
      toolNameFilter,
      maxIterations,
      freshContext,
      onContextUpdate,
      onCompact,
      isAdmin,
    );

    // Determine finalContent for non-streaming answers so the caller can
    // persist it without needing to know about answer types.
    let finalContent: string | undefined;

    if (answer instanceof ReadableStream) {
      // Streaming: finalContent is determined after the caller consumes the stream
      finalContent = undefined;
    } else if (answer && typeof answer === 'object' && (answer as ImageGenerationResult).kind === 'image') {
      finalContent = `[Generated image: ${prompt.slice(0, 60)}]`;
    } else if (answer && typeof answer === 'object' && (answer as MixedContentResult).kind === 'mixed') {
      const mixedResult = answer as MixedContentResult;
      finalContent = mixedResult.text || `[Generated image: ${prompt.slice(0, 60)}]`;
    } else {
      finalContent = answer as string;
    }

    return { answer, finalContent };
  }
}

export const chatService = new ChatService();
