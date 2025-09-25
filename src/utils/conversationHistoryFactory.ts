import { IConversationHistory } from '../descriptions/conversationTypes';
import { InMemoryConversationHistory } from './conversationHistory';
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
      // For now, always return in-memory implementation
      // In the future, this can be configured via environment variable
      this._instance = new InMemoryConversationHistory();
      Logger.info('Created InMemoryConversationHistory instance');
    }
    
    return this._instance;
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
  static reset(): void {
    this._instance = null;
  }
}