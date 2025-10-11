import { DbConversationHistory } from './dbConversationHistory';
import { ValidationError } from './errors';

describe('DbConversationHistory', () => {
  let conversationHistory: DbConversationHistory;

  beforeEach(() => {
    conversationHistory = new DbConversationHistory();
  });

  it('should initialize with correct window size', () => {
    expect(conversationHistory.maxConversations).toBeGreaterThan(0);
  });

  it('should start with no current conversation', () => {
    expect(conversationHistory.currentConversationId).toBeNull();
  });

  it('should add a valid message and create conversation if none exists', async () => {
    const messageData = {
      role: 'user' as const,
      content: 'Hello, this is a test message'
    };

    const message = await conversationHistory.addMessage(messageData);

    expect(message).toBeDefined();
    expect(message.id).toBeTruthy();
    expect(message.role).toBe('user');
    expect(message.content).toBe('Hello, this is a test message');
    expect(message.timestamp).toBeInstanceOf(Date);
    expect(conversationHistory.currentConversationId).toBeTruthy();
  }, 10000); // 10 second timeout for database operations

  it('should reject invalid message data', async () => {
    const invalidMessageData = {
      role: 'invalid_role' as any,
      content: 'Test message'
    };

    await expect(conversationHistory.addMessage(invalidMessageData))
      .rejects.toThrow(ValidationError);
  });

  it('should start a new conversation with session and user', async () => {
    const conversationId = await conversationHistory.startNewConversation('session1', 'user1');
    
    expect(conversationId).toBeTruthy();
    expect(typeof conversationId).toBe('string');
    expect(conversationHistory.currentConversationId).toBe(conversationId);
    
    const conversation = await conversationHistory.getConversation(conversationId);
    expect(conversation).toBeTruthy();
    expect(conversation!.sessionId).toBe('session1');
    expect(conversation!.userId).toBe('user1');
  }, 10000);

  it('should get current conversation messages', async () => {
    await conversationHistory.startNewConversation();
    await conversationHistory.addMessage({ role: 'user', content: 'Test message' });
    
    const messages = await conversationHistory.getCurrentConversation();
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Test message');
  }, 10000);

  it('should return empty array when no current conversation', async () => {
    const messages = await conversationHistory.getCurrentConversation();
    expect(messages).toEqual([]);
  });

  it('should get conversation count', async () => {
    const initialCount = await conversationHistory.getConversationCount();
    
    await conversationHistory.startNewConversation();
    
    const newCount = await conversationHistory.getConversationCount();
    expect(newCount).toBe(initialCount + 1);
  }, 10000);

  afterEach(async () => {
    // Clean up any test data
    try {
      await conversationHistory.clearHistory();
    } catch (error) {
      // Ignore cleanup errors in tests
    }
  });
});