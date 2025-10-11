import { IConversationHistory } from '../descriptions/conversationTypes';
import { InMemoryConversationHistory } from './conversationHistory';
import { DbConversationHistory } from './dbConversationHistory';
import { config } from './config';
import Logger from './logger';

/**
 * Factory for creating conversation history implementations
 */
export class ConversationHistoryFactory {
  private static _instance: IConversationHistory | null = null;

  /**
   * Get singleton instance of conversation history
   */
  static getInstance(): IConversationHistory {
    if (!this._instance) {
      // Check if database conversation history is enabled
      const useDatabase = config.NODE_ENV !== 'test' && process.env.USE_DB_CONVERSATION_HISTORY === 'true';
      
      if (useDatabase) {
        this._instance = new DbConversationHistory();
        Logger.info('Created DbConversationHistory instance');
      } else {
        this._instance = new InMemoryConversationHistory();
        Logger.info('Created InMemoryConversationHistory instance');
      }
    }
    
    return this._instance;
  }

  /**
   * Create a specific implementation (useful for testing)
   */
  static createInstance(type: 'memory' | 'database'): IConversationHistory {
    if (type === 'database') {
      return new DbConversationHistory();
    }
    return new InMemoryConversationHistory();
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
  static reset(): void {
    this._instance = null;
  }
}