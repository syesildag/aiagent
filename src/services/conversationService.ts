import { randomUUID } from 'crypto';
import { AiAgentConversationMessages } from '../entities/ai-agent-conversation-messages';
import aiagentconversationmessagesRepository from '../entities/ai-agent-conversation-messages';
import aiagentconversationsRepository, { AiAgentConversations } from '../entities/ai-agent-conversations';
import type { AiAgentSession } from '../entities/ai-agent-session';
import type { IConversationHistory } from '../descriptions/conversationTypes';
import { LRUCache } from 'lru-cache';
import { HistoryManager } from '../mcp/historyManager';
import { config } from '../utils/config';
import { ConversationHistoryFactory } from '../utils/conversationHistoryFactory';
import Logger from '../utils/logger';

/** Idle time after which a web conversation's in-memory history is rebuilt from the DB. */
const WEB_HISTORY_IDLE_TTL_MS = 60 * 60 * 1000;

/**
 * Handles DB conversation persistence and per-conversation LLM history for
 * the web server. Extracted from src/routes/chat.ts to keep the route handler
 * focused on HTTP concerns only.
 */
export class ConversationService {
  /**
   * Validate the incoming conversation ID (if any), create a new DB conversation
   * when none exists, and return the resolved IDs.
   */
  async resolveOrCreateConversation(
    sessionEntity: AiAgentSession,
    incomingConversationId: number | null,
    promptTitle: string,
  ): Promise<{ conversationId: number | null; conversationUuid: string | null }> {
    const userLogin = sessionEntity.getUserLogin();
    if (!userLogin) {
      return { conversationId: null, conversationUuid: null };
    }

    let activeConversationId = incomingConversationId;
    let activeConversationUuid: string | null = null;

    try {
      // Validate that an incoming conversation ID still exists; if it was deleted
      // (sliding window, server restart, migration reset) treat it as a new conversation
      // to avoid FK violations when inserting messages.
      if (activeConversationId) {
        const existingConv = await aiagentconversationsRepository.getById(activeConversationId);
        if (!existingConv) {
          Logger.warn(`Conversation ${activeConversationId} not found in DB, starting a new one`);
          activeConversationId = null;
        } else if (!await aiagentconversationsRepository.belongsToUserLogin(activeConversationId, userLogin)) {
          // Never continue (or load the history of) another user's conversation.
          Logger.warn(`User ${userLogin} tried to continue conversation ${activeConversationId} they do not own; starting a new one`);
          activeConversationId = null;
        } else {
          activeConversationUuid = existingConv.getMetadata()?.id ?? null;
        }
      }

      if (!activeConversationId) {
        const title = promptTitle.slice(0, 60);
        activeConversationUuid = randomUUID();
        const conv = await new AiAgentConversations({
          sessionId: sessionEntity.getId()!,
          userId: userLogin,
          metadata: { title, userLogin, id: activeConversationUuid },
        }).save();
        activeConversationId = conv?.getId() ?? null;
      }
    } catch (err) {
      Logger.error(`Failed to resolve/create conversation: ${err}`);
    }

    return { conversationId: activeConversationId, conversationUuid: activeConversationUuid };
  }

  /**
   * In-memory LLM histories of web conversations, one per DB conversation id.
   * Kept so tool calls/results from earlier turns stay in context; rebuilt
   * from the DB (user/assistant messages) after eviction or a restart.
   * Stores the promise so concurrent first requests share a single restore.
   */
  private readonly webHistories = new LRUCache<number, Promise<IConversationHistory>>({
    max: config.MAX_CONVERSATIONS,
    ttl: WEB_HISTORY_IDLE_TTL_MS,
    updateAgeOnGet: true,
  });

  private readonly historyManager = new HistoryManager();

  /**
   * Return the LLM history of one web conversation.
   *
   * Every conversation gets its own history object, so concurrent users never
   * see or modify each other's context (the agents and the MCP manager are
   * shared singletons; their own history is only for the single-user CLI).
   *
   * Call this BEFORE persisting the user's new message: a restore reads the
   * conversation's DB rows and must not pick up the prompt about to be sent.
   * `conversationId` must already be validated as owned by `userLogin`.
   */
  async getHistoryForConversation(
    conversationId: number | null,
    conversationUuid: string | null,
    userLogin: string,
  ): Promise<IConversationHistory> {
    // No DB conversation (e.g. the DB was unavailable): an empty history only this turn sees.
    if (conversationId === null) {
      return ConversationHistoryFactory.createInstance('memory');
    }

    // DbConversationHistory reads and writes this conversation's rows directly,
    // so a fresh instance pointed at it is complete and isolated.
    if (config.USE_DB_CONVERSATION_HISTORY && conversationUuid) {
      const history = ConversationHistoryFactory.createInstance('database');
      history.setCurrentConversationId(conversationUuid);
      return history;
    }

    const cached = this.webHistories.get(conversationId);
    if (cached) {
      return cached;
    }
    const restoring = this.restoreHistoryFromDb(conversationId, userLogin);
    this.webHistories.set(conversationId, restoring);
    try {
      return await restoring;
    } catch (err) {
      this.webHistories.delete(conversationId);
      Logger.error(`Failed to restore history for conversationId=${conversationId}: ${err}`);
      return ConversationHistoryFactory.createInstance('memory');
    }
  }

  /** Drop the cached history of a deleted conversation. */
  forgetConversation(conversationId: number): void {
    this.webHistories.delete(conversationId);
  }

  private async restoreHistoryFromDb(conversationId: number, userLogin: string): Promise<IConversationHistory> {
    const history = ConversationHistoryFactory.createInstance('memory');
    const rows = await aiagentconversationmessagesRepository.findByConversationId(conversationId);
    // Only plain user/assistant turns can be replayed; tool rows lack their call context.
    const messages = rows
      .filter(m => (m.getRole() === 'user' || m.getRole() === 'assistant') && m.getContent())
      .map(m => ({ role: m.getRole(), content: m.getContent() }));
    await this.historyManager.restoreConversation(history, messages, userLogin);
    return history;
  }

  /** Persist the user's message to the DB (skipped when DbConversationHistory is active). */
  async persistUserMessage(conversationId: number, content: string): Promise<void> {
    if (config.USE_DB_CONVERSATION_HISTORY) return;
    try {
      await new AiAgentConversationMessages({
        conversationId,
        role: 'user',
        content,
      }).save();
    } catch (err) {
      Logger.error(`Failed to persist user message: ${err}`);
    }
  }

  /** Persist the assistant's reply to the DB (skipped when DbConversationHistory is active). */
  async persistAssistantMessage(conversationId: number, content: string): Promise<void> {
    if (config.USE_DB_CONVERSATION_HISTORY) return;
    try {
      await new AiAgentConversationMessages({
        conversationId,
        role: 'assistant',
        content,
      }).save();
      await aiagentconversationsRepository.getById(conversationId).then(async conv => {
        if (conv) { conv.setUpdatedAt(new Date()); await conv.save(); }
      });
    } catch (err) {
      Logger.error(`Failed to persist assistant message: ${err}`);
    }
  }
}

export const conversationService = new ConversationService();
