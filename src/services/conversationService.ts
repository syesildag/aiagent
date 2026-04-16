import { randomUUID } from 'crypto';
import { AiAgentConversationMessages } from '../entities/ai-agent-conversation-messages';
import aiagentconversationmessagesRepository from '../entities/ai-agent-conversation-messages';
import aiagentconversationsRepository, { AiAgentConversations } from '../entities/ai-agent-conversations';
import type { AiAgentSession } from '../entities/ai-agent-session';
import type { Agent } from '../agent';
import { config } from '../utils/config';
import Logger from '../utils/logger';

/**
 * Handles DB conversation persistence and history synchronization.
 * Extracted from src/routes/chat.ts lines 262–334 to keep the route handler
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
   * Ensure the in-memory LLM context matches the DB conversation being served.
   * Clears and restores history whenever the conversation changes (new, switched,
   * or after restart). When DbConversationHistory is active, also sets the UUID
   * so it can locate the row without creating a duplicate.
   */
  async syncAgentHistory(
    agent: Agent,
    incomingConversationId: number | null,
    activeConversationId: number | null,
    userLogin: string | undefined,
    conversationUuid: string | null,
  ): Promise<void> {
    const currentDbConvId = agent.getActiveDbConversationId();
    if (incomingConversationId === currentDbConvId) {
      return;
    }

    try {
      await agent.clearConversationHistory();
      if (incomingConversationId) {
        const priorMessages = await aiagentconversationmessagesRepository.findByConversationId(incomingConversationId);
        if (priorMessages.length > 0) {
          await agent.restoreConversationHistory(
            priorMessages.map(m => ({ role: m.getRole(), content: m.getContent() })),
            userLogin ?? undefined,
          );
          Logger.info(`Restored ${priorMessages.length} messages for conversationId=${incomingConversationId}`);
        }
      }
      agent.setActiveDbConversationId(activeConversationId);
      if (config.USE_DB_CONVERSATION_HISTORY && conversationUuid) {
        agent.setCurrentConversationId(conversationUuid);
      }
    } catch (err) {
      Logger.error(`Failed to sync conversation history: ${err}`);
    }
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
