import Logger from '../utils/logger';
import { ConversationHistoryFactory } from '../utils/conversationHistoryFactory';
import type { IConversationHistory } from '../descriptions/conversationTypes';
import type { LLMProvider } from './llmProviders';

/** Number of most-recent messages to preserve verbatim after compaction. */
const AUTO_COMPACT_KEEP_RECENT = 4;

/**
 * Manages per-request conversation history scoping and auto-compaction.
 * Extracted from MCPServerManager to eliminate the shared-singleton bug:
 * the old code used ConversationHistoryFactory.getInstance() which returned
 * the same object to every agent, mixing messages across concurrent users.
 *
 * createHistoryForSession() calls createFresh() — each call returns a new
 * independent IConversationHistory instance.
 */
export class HistoryManager {
  /**
   * Create a fresh, isolated conversation history for one agent/session.
   * Never returns a shared singleton — each call gets its own instance.
   */
  createHistoryForSession(_userId?: string): IConversationHistory {
    return ConversationHistoryFactory.createFresh();
  }

  /**
   * Summarize the older portion of the conversation, clear it, and re-seed
   * with the summary plus the most recent messages.
   */
  async compactHistory(
    history: IConversationHistory,
    llmProvider: LLMProvider,
    model: string,
  ): Promise<{ summarized: number; kept: number }> {
    const messages = await history.getCurrentConversation();
    if (messages.length <= AUTO_COMPACT_KEEP_RECENT) {
      return { summarized: 0, kept: messages.length };
    }

    const toSummarize = messages.slice(0, -AUTO_COMPACT_KEEP_RECENT);
    const recentMessages = messages.slice(-AUTO_COMPACT_KEEP_RECENT);

    const historyText = toSummarize
      .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
      .join('\n');

    const summaryResponse = await llmProvider.chat({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a conversation summarizer. Produce a concise summary of the conversation that preserves all key facts, decisions, and context needed to continue the conversation. Be thorough but brief.'
        },
        {
          role: 'user',
          content: `Summarize this conversation:\n\n${historyText}`
        }
      ],
      tools: [],
      stream: false
    });

    const summary = summaryResponse.message.content as string;

    await history.clearCurrentMessages();

    await history.addMessage({
      role: 'user',
      content: '[Conversation history was automatically compacted to free context space.]'
    });

    await history.addMessage({
      role: 'assistant',
      content: `Summary of previous conversation:\n\n${summary}`
    });

    for (const msg of recentMessages) {
      await history.addMessage({
        role: msg.role as 'user' | 'assistant' | 'system' | 'tool',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      });
    }

    Logger.info(`Context auto-compacted: summarized ${toSummarize.length} messages, kept ${recentMessages.length} recent`);
    return { summarized: toSummarize.length, kept: recentMessages.length };
  }

  /**
   * Restore a prior conversation from an external message list (e.g. DB records).
   * Starts a fresh conversation in the given history and bulk-inserts the messages.
   */
  async restoreConversation(
    history: IConversationHistory,
    messages: Array<{ role: string; content: string }>,
    userId?: string,
  ): Promise<void> {
    await history.startNewConversation(undefined, userId);
    for (const msg of messages) {
      await history.addMessage({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }
    Logger.info(`Restored conversation with ${messages.length} messages for user=${userId ?? 'anonymous'}`);
  }
}
