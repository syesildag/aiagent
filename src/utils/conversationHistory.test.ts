import { config } from './config';
import { InMemoryConversationHistory } from './conversationHistory';

describe('InMemoryConversationHistory', () => {
  let conversationHistory: InMemoryConversationHistory;

  beforeEach(() => {
    conversationHistory = new InMemoryConversationHistory();
  });

  describe('addMessage', () => {
    it('should add a message to a new conversation', async () => {
      const messageData = {
        role: 'user' as const,
        content: 'Hello, world!'
      };

      const message = await conversationHistory.addMessage(messageData);

      expect(message.id).toBeDefined();
      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello, world!');
      expect(message.timestamp).toBeInstanceOf(Date);
    });

    it('should validate message data', async () => {
      const invalidMessageData = {
        role: 'invalid' as any,
        content: 'Hello'
      };

      await expect(conversationHistory.addMessage(invalidMessageData))
        .rejects
        .toThrow('Invalid message data');
    });
  });

  describe('conversation management', () => {
    it('should start a new conversation', async () => {
      const conversationId = await conversationHistory.startNewConversation('session1', 'user1');
      
      expect(conversationId).toBeDefined();
      expect(typeof conversationId).toBe('string');

      const conversation = await conversationHistory.getConversation(conversationId);
      expect(conversation).toBeDefined();
      expect(conversation!.sessionId).toBe('session1');
      expect(conversation!.userId).toBe('user1');
    });

    it('should get current conversation messages', async () => {
      await conversationHistory.startNewConversation();
      await conversationHistory.addMessage({ role: 'user', content: 'Test message' });

      const messages = await conversationHistory.getCurrentConversation();
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Test message');
    });

    it('should return empty array when no current conversation', async () => {
      const messages = await conversationHistory.getCurrentConversation();
      expect(messages).toEqual([]);
    });
  });

  describe('sliding window', () => {
    it('should maintain sliding window size', async () => {
      const maxConversations = config.CONVERSATION_HISTORY_WINDOW_SIZE;
      
      // Create more conversations than the window size
      for (let i = 0; i < maxConversations + 3; i++) {
        await conversationHistory.startNewConversation(`session${i}`, `user${i}`);
        await conversationHistory.addMessage({ role: 'user', content: `Message ${i}` });
      }

      const count = await conversationHistory.getConversationCount();
      expect(count).toBe(maxConversations);

      const conversations = await conversationHistory.getConversations();
      expect(conversations).toHaveLength(maxConversations);
    });

    it('should keep most recent conversations', async () => {
      // Create 3 conversations
      const id1 = await conversationHistory.startNewConversation('session1');
      await conversationHistory.addMessage({ role: 'user', content: 'First' });

      const id2 = await conversationHistory.startNewConversation('session2');
      await conversationHistory.addMessage({ role: 'user', content: 'Second' });

      const id3 = await conversationHistory.startNewConversation('session3');
      await conversationHistory.addMessage({ role: 'user', content: 'Third' });

      const conversations = await conversationHistory.getConversations();
      
      // All 3 conversations should be present
      expect(conversations).toHaveLength(3);
      const ids = conversations.map(c => c.id);
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
      expect(ids).toContain(id3);
    });
  });

  describe('clearHistory', () => {
    it('should clear all conversations', async () => {
      await conversationHistory.startNewConversation();
      await conversationHistory.addMessage({ role: 'user', content: 'Test' });

      expect(await conversationHistory.getConversationCount()).toBe(1);

      await conversationHistory.clearHistory();

      expect(await conversationHistory.getConversationCount()).toBe(0);
      expect(await conversationHistory.getCurrentConversation()).toEqual([]);
    });
  });

  describe('switchToConversation', () => {
    it('should switch to existing conversation', async () => {
      const id1 = await conversationHistory.startNewConversation('session1');
      const id2 = await conversationHistory.startNewConversation('session2');
      
      expect(conversationHistory.currentConversationId).toBe(id2);
      
      const switched = await conversationHistory.switchToConversation(id1);
      expect(switched).toBe(true);
      expect(conversationHistory.currentConversationId).toBe(id1);
    });

    it('should return false for non-existent conversation', async () => {
      const switched = await conversationHistory.switchToConversation('non-existent-id');
      expect(switched).toBe(false);
    });
  });
});