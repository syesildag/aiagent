import { randomUUID } from 'crypto';
import { IConversationHistory, Message, Conversation, MessageSchema, ConversationSchema } from '../descriptions/conversationTypes';
import { config } from './config';
import Logger from './logger';
import { ValidationError } from './errors';

export class InMemoryConversationHistory implements IConversationHistory {
  private _conversations: Map<string, Conversation> = new Map();
  private _currentConversationId: string | null = null;
  private readonly _maxConversations: number;

  constructor() {
    this._maxConversations = config.CONVERSATION_HISTORY_WINDOW_SIZE;
    Logger.info(`Initialized InMemoryConversationHistory with window size: ${this._maxConversations}`);
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

      const message: Message = {
        ...validatedData,
        id: randomUUID(),
        timestamp: new Date()
      };

      const conversation = this._conversations.get(this._currentConversationId!);
      if (!conversation) {
        throw new Error(`Current conversation ${this._currentConversationId} not found`);
      }

      conversation.messages.push(message);
      conversation.updatedAt = new Date();

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

    const conversation = this._conversations.get(this._currentConversationId);
    return conversation ? conversation.messages : [];
  }

  async getConversations(limit?: number): Promise<Conversation[]> {
    const conversationArray = Array.from(this._conversations.values());
    
    // Sort by updatedAt descending (most recent first)
    conversationArray.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    
    const effectiveLimit = limit || this._maxConversations;
    return conversationArray.slice(0, effectiveLimit);
  }

  async startNewConversation(sessionId?: string, userId?: string): Promise<string> {
    const conversationId = randomUUID();
    const now = new Date();

    const conversation: Conversation = {
      id: conversationId,
      sessionId,
      userId,
      messages: [],
      createdAt: now,
      updatedAt: now,
      metadata: {}
    };

    // Validate the conversation
    ConversationSchema.parse(conversation);

    this._conversations.set(conversationId, conversation);
    this._currentConversationId = conversationId;

    // Implement sliding window: remove oldest conversations if limit exceeded
    await this._maintainSlidingWindow();

    Logger.info(`Started new conversation: ${conversationId}, sessionId=${sessionId}, userId=${userId}, totalConversations=${this._conversations.size}`);

    return conversationId;
  }

  async getConversation(conversationId: string): Promise<Conversation | null> {
    const conversation = this._conversations.get(conversationId);
    return conversation || null;
  }

  async clearHistory(): Promise<void> {
    const conversationCount = this._conversations.size;
    this._conversations.clear();
    this._currentConversationId = null;
    
    Logger.info(`Cleared conversation history: ${conversationCount} conversations removed`);
  }

  async getConversationCount(): Promise<number> {
    return this._conversations.size;
  }

  /**
   * Switch to a specific conversation
   */
  async switchToConversation(conversationId: string): Promise<boolean> {
    if (this._conversations.has(conversationId)) {
      this._currentConversationId = conversationId;
      Logger.debug(`Switched to conversation: ${conversationId}`);
      return true;
    }
    return false;
  }

  /**
   * Maintain sliding window by removing oldest conversations
   */
  private async _maintainSlidingWindow(): Promise<void> {
    if (this._conversations.size <= this._maxConversations) {
      return;
    }

    const conversationArray = Array.from(this._conversations.entries());
    
    // Sort by updatedAt ascending (oldest first)
    conversationArray.sort((a, b) => a[1].updatedAt.getTime() - b[1].updatedAt.getTime());
    
    // Remove oldest conversations until we're within the limit
    const conversationsToRemove = conversationArray.slice(0, this._conversations.size - this._maxConversations);
    
    for (const [conversationId, _conversation] of conversationsToRemove) {
      this._conversations.delete(conversationId);
      
      // If we're removing the current conversation, switch to the most recent one
      if (conversationId === this._currentConversationId) {
        const remainingConversations = Array.from(this._conversations.values());
        if (remainingConversations.length > 0) {
          remainingConversations.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
          this._currentConversationId = remainingConversations[0].id;
        } else {
          this._currentConversationId = null;
        }
      }
    }

    Logger.debug(`Sliding window maintenance: removed ${conversationsToRemove.length} old conversations`);
  }
}