import { randomUUID } from 'crypto';
import { IConversationHistory, Message, Conversation, MessageSchema, ConversationSchema } from '../descriptions/conversationTypes';
import { config } from './config';
import Logger from './logger';
import { ValidationError, DatabaseError } from './errors';
import { AiAgentConversations } from '../entities/ai-agent-conversations';
import { AiAgentConversationMessages } from '../entities/ai-agent-conversation-messages';
import { AiAgentSession } from '../entities/ai-agent-session';
import aiagentconversationsRepository from '../entities/ai-agent-conversations';
import aiagentconversationmessagesRepository from '../entities/ai-agent-conversation-messages';
import aiagentsessionRepository from '../entities/ai-agent-session';
import { queryDatabase } from './pgClient';

export class DbConversationHistory implements IConversationHistory {
  private _currentConversationId: string | null = null;
  private readonly _maxConversations: number;

  constructor() {
    this._maxConversations = config.CONVERSATION_HISTORY_WINDOW_SIZE;
    Logger.info(`Initialized DbConversationHistory with window size: ${this._maxConversations}`);
  }

  get maxConversations(): number {
    return this._maxConversations;
  }

  get currentConversationId(): string | null {
    return this._currentConversationId;
  }

  async addMessage(messageData: Omit<Message, 'id' | 'timestamp'>): Promise<Message> {
    try {
      // Validate input
      const validatedData = MessageSchema.omit({ id: true, timestamp: true }).parse(messageData);
      
      // Ensure we have a current conversation
      if (!this._currentConversationId) {
        await this.startNewConversation();
      }

      const messageId = randomUUID();
      const timestamp = new Date();

      // Find the database conversation ID by our UUID
      const dbConversation = await this._findDbConversationByUuid(this._currentConversationId!);
      if (!dbConversation) {
        throw new DatabaseError(`Current conversation ${this._currentConversationId} not found in database`);
      }

      // Create the message entity
      const messageEntity = new AiAgentConversationMessages({
        conversationId: dbConversation.getId()!,
        role: validatedData.role,
        content: validatedData.content,
        toolCalls: validatedData.toolCalls || null,
        toolCallId: validatedData.toolCallId || null,
        timestamp,
        metadata: { id: messageId, ...validatedData.metadata }
      });

      // Save the message
      const savedMessage = await aiagentconversationmessagesRepository.save(messageEntity);

      // Update conversation updated_at timestamp
      await this._updateConversationTimestamp(dbConversation.getId()!);

      const message: Message = {
        id: messageId,
        role: validatedData.role,
        content: validatedData.content,
        toolCalls: validatedData.toolCalls,
        toolCallId: validatedData.toolCallId,
        timestamp,
        metadata: validatedData.metadata
      };

      Logger.debug(`Added message to conversation ${this._currentConversationId}: messageId=${message.id}, role=${message.role}, contentLength=${message.content.length}`);

      return message;
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        throw new ValidationError(`Invalid message data: ${error.message}`);
      }
      throw error;
    }
  }

  async getCurrentConversation(): Promise<Message[]> {
    if (!this._currentConversationId) {
      return [];
    }

    const dbConversation = await this._findDbConversationByUuid(this._currentConversationId);
    if (!dbConversation) {
      return [];
    }

    const messages = await this._getMessagesForConversation(dbConversation.getId()!);
    return messages;
  }

  async getConversations(limit?: number): Promise<Conversation[]> {
    try {
      const effectiveLimit = limit || this._maxConversations;
      
      // Get conversations ordered by updated_at descending
      const dbConversations = await queryDatabase(`
        SELECT * FROM ai_agent_conversations 
        ORDER BY updated_at DESC 
        LIMIT $1
      `, [effectiveLimit]);

      const conversations: Conversation[] = [];

      for (const dbConv of dbConversations) {
        const messages = await this._getMessagesForConversation(dbConv.id);
        const conversationUuid = this._extractUuidFromMetadata(dbConv.metadata);
        
        conversations.push({
          id: conversationUuid,
          sessionId: dbConv.session_id?.toString(),
          userId: dbConv.user_id?.toString(),
          messages,
          createdAt: dbConv.created_at,
          updatedAt: dbConv.updated_at,
          metadata: dbConv.metadata || {}
        });
      }

      return conversations;
    } catch (error) {
      throw new DatabaseError(`Failed to get conversations: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async startNewConversation(sessionId?: string, userId?: string): Promise<string> {
    try {
      const conversationId = randomUUID();
      const now = new Date();

      // Always get or create a session - use default if not provided
      const effectiveSessionId = sessionId || `session-${conversationId}`;
      const effectiveUserId = userId || config.DEFAULT_USERNAME;

      const session = await this._getOrCreateSession(effectiveSessionId, effectiveUserId);
      const dbSessionId = session.getId()!;

      // Create conversation entity
      const conversationEntity = new AiAgentConversations({
        sessionId: dbSessionId,
        userId: effectiveUserId,
        createdAt: now,
        updatedAt: now,
        metadata: { 
          id: conversationId,
          originalSessionId: sessionId,
          originalUserId: userId
        }
      });

      // Save the conversation
      const savedConversation = await aiagentconversationsRepository.save(conversationEntity);
      this._currentConversationId = conversationId;

      // Implement sliding window: remove oldest conversations if limit exceeded
      await this._maintainSlidingWindow();

      Logger.info(`Started new conversation: ${conversationId}, sessionId=${sessionId}, userId=${userId}, dbId=${savedConversation.getId()}`);

      return conversationId;
    } catch (error) {
      throw new DatabaseError(`Failed to start new conversation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getConversation(conversationId: string): Promise<Conversation | null> {
    try {
      const dbConversation = await this._findDbConversationByUuid(conversationId);
      if (!dbConversation) {
        return null;
      }

      const messages = await this._getMessagesForConversation(dbConversation.getId()!);
      
      return {
        id: conversationId,
        sessionId: this._extractOriginalSessionId(dbConversation.getMetadata()),
        userId: this._extractOriginalUserId(dbConversation.getMetadata()),
        messages,
        createdAt: dbConversation.getCreatedAt()!,
        updatedAt: dbConversation.getUpdatedAt()!,
        metadata: dbConversation.getMetadata() || {}
      };
    } catch (error) {
      throw new DatabaseError(`Failed to get conversation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async clearHistory(): Promise<void> {
    try {
      const count = await this.getConversationCount();
      
      // Delete all messages first (due to foreign key constraints)
      await queryDatabase('DELETE FROM ai_agent_conversation_messages', []);
      
      // Then delete all conversations
      await queryDatabase('DELETE FROM ai_agent_conversations', []);
      
      this._currentConversationId = null;
      
      Logger.info(`Cleared conversation history: ${count} conversations removed`);
    } catch (error) {
      throw new DatabaseError(`Failed to clear history: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getConversationCount(): Promise<number> {
    try {
      const result = await queryDatabase('SELECT COUNT(*) as count FROM ai_agent_conversations', []);
      return parseInt(result[0].count);
    } catch (error) {
      throw new DatabaseError(`Failed to get conversation count: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Switch to a specific conversation
   */
  async switchToConversation(conversationId: string): Promise<boolean> {
    const conversation = await this.getConversation(conversationId);
    if (conversation) {
      this._currentConversationId = conversationId;
      Logger.debug(`Switched to conversation: ${conversationId}`);
      return true;
    }
    return false;
  }

  /**
   * Private helper methods
   */

  private async _findDbConversationByUuid(uuid: string): Promise<AiAgentConversations | null> {
    try {
      const results = await queryDatabase(`
        SELECT * FROM ai_agent_conversations 
        WHERE metadata->>'id' = $1
      `, [uuid]);
      
      if (results.length === 0) {
        return null;
      }

      const dbConv = results[0];
      return new AiAgentConversations({
        id: dbConv.id,
        sessionId: dbConv.session_id,
        userId: dbConv.user_id,
        createdAt: dbConv.created_at,
        updatedAt: dbConv.updated_at,
        metadata: dbConv.metadata
      });
    } catch (error) {
      throw new DatabaseError(`Failed to find conversation by UUID: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _getMessagesForConversation(conversationDbId: number): Promise<Message[]> {
    try {
      const results = await queryDatabase(`
        SELECT * FROM ai_agent_conversation_messages 
        WHERE conversation_id = $1
        ORDER BY timestamp ASC
      `, [conversationDbId]);

      return results.map((msg: any) => ({
        id: this._extractUuidFromMetadata(msg.metadata) || randomUUID(),
        role: msg.role,
        content: msg.content,
        toolCalls: msg.tool_calls,
        toolCallId: msg.tool_call_id,
        timestamp: msg.timestamp,
        metadata: msg.metadata
      }));
    } catch (error) {
      throw new DatabaseError(`Failed to get messages for conversation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _getOrCreateSession(sessionId: string, userId?: string): Promise<AiAgentSession> {
    try {
      // Try to find existing session by name (using sessionId as name)
      const existingSessions = await aiagentsessionRepository.findAll({
        where: { name: sessionId }
      });

      if (existingSessions && existingSessions.length > 0) {
        return existingSessions[0];
      }

      // Get the user login to use - default to 'serkan' if not provided
      let userLogin = userId || config.DEFAULT_USERNAME;
      
      // Verify the user exists in ai_agent_user table, create if it doesn't exist
      const userExists = await queryDatabase('SELECT id FROM ai_agent_user WHERE login = $1', [userLogin]);
      if (userExists.length === 0) {
        // Create the default user if it doesn't exist (only login and password columns exist)
        await queryDatabase(
          'INSERT INTO ai_agent_user (login, password) VALUES ($1, $2)',
          [userLogin, config.DEFAULT_PASSWORD] // You might want to use a better default password or hash
        );
        Logger.info(`Created default user: ${userLogin}`);
      }

      // Create new session
      const newSession = new AiAgentSession({
        name: sessionId,
        userLogin: userLogin,
        createdAt: new Date(),
        ping: new Date()
      });

      return await aiagentsessionRepository.save(newSession);
    } catch (error) {
      throw new DatabaseError(`Failed to get or create session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _updateConversationTimestamp(conversationDbId: number): Promise<void> {
    try {
      await queryDatabase(`
        UPDATE ai_agent_conversations 
        SET updated_at = CURRENT_TIMESTAMP 
        WHERE id = $1
      `, [conversationDbId]);
    } catch (error) {
      throw new DatabaseError(`Failed to update conversation timestamp: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private _extractUuidFromMetadata(metadata: any): string {
    if (metadata && typeof metadata === 'object' && metadata.id) {
      return metadata.id;
    }
    return randomUUID(); // Fallback for legacy data
  }

  private _extractOriginalSessionId(metadata: any): string | undefined {
    if (metadata && typeof metadata === 'object' && metadata.originalSessionId) {
      return metadata.originalSessionId;
    }
    return undefined;
  }

  private _extractOriginalUserId(metadata: any): string | undefined {
    if (metadata && typeof metadata === 'object' && metadata.originalUserId) {
      return metadata.originalUserId;
    }
    return undefined;
  }

  /**
   * Maintain sliding window by removing oldest conversations
   */
  private async _maintainSlidingWindow(): Promise<void> {
    try {
      const currentCount = await this.getConversationCount();
      
      if (currentCount <= this._maxConversations) {
        return;
      }

      const conversationsToRemove = currentCount - this._maxConversations;

      // Get oldest conversations
      const oldestConversations = await queryDatabase(`
        SELECT id, metadata FROM ai_agent_conversations 
        ORDER BY updated_at ASC 
        LIMIT $1
      `, [conversationsToRemove]);

      // Delete messages first, then conversations
      for (const conv of oldestConversations) {
        await queryDatabase(
          'DELETE FROM ai_agent_conversation_messages WHERE conversation_id = $1',
          [conv.id]
        );
        
        await queryDatabase(
          'DELETE FROM ai_agent_conversations WHERE id = $1',
          [conv.id]
        );

        // If we're removing the current conversation, clear the current ID
        const convUuid = this._extractUuidFromMetadata(conv.metadata);
        if (convUuid === this._currentConversationId) {
          this._currentConversationId = null;
        }
      }

      Logger.debug(`Sliding window maintenance: removed ${conversationsToRemove} old conversations`);
    } catch (error) {
      throw new DatabaseError(`Failed to maintain sliding window: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}