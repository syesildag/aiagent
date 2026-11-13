import { ConversationService } from '../conversationService';
import aiagentconversationsRepository, { AiAgentConversations } from '../../entities/ai-agent-conversations';

describe('ConversationService', () => {
  afterEach(() => jest.restoreAllMocks());

  it("never continues another user's conversation", async () => {
    const service = new ConversationService();
    const mockSession = { getUserLogin: () => 'mallory', getId: () => 9 } as any;
    jest.spyOn(aiagentconversationsRepository, 'getById').mockResolvedValue(
      { getMetadata: () => ({ id: 'victim-uuid' }) } as any,
    );
    const ownership = jest.spyOn(aiagentconversationsRepository, 'belongsToUserLogin').mockResolvedValue(false);
    const save = jest.spyOn(AiAgentConversations.prototype, 'save').mockImplementation(async function (this: any) {
      return { getId: () => 101 } as any;
    });

    const result = await service.resolveOrCreateConversation(mockSession, 42, 'Hello');

    expect(ownership).toHaveBeenCalledWith(42, 'mallory');
    expect(save).toHaveBeenCalled();
    expect(result.conversationId).toBe(101);
    expect(result.conversationUuid).not.toBe('victim-uuid');
  });

  it('continues a conversation the user owns', async () => {
    const service = new ConversationService();
    const mockSession = { getUserLogin: () => 'alice', getId: () => 3 } as any;
    jest.spyOn(aiagentconversationsRepository, 'getById').mockResolvedValue(
      { getMetadata: () => ({ id: 'alice-uuid' }) } as any,
    );
    jest.spyOn(aiagentconversationsRepository, 'belongsToUserLogin').mockResolvedValue(true);

    const result = await service.resolveOrCreateConversation(mockSession, 42, 'Hello');

    expect(result).toEqual({ conversationId: 42, conversationUuid: 'alice-uuid' });
  });
  it('resolveOrCreateConversation returns null ids when no userLogin', async () => {
    const service = new ConversationService();
    const mockSession = { getUserLogin: () => undefined, getId: () => 1 } as any;
    const result = await service.resolveOrCreateConversation(mockSession, null, 'Hello');
    expect(result.conversationId).toBeNull();
    expect(result.conversationUuid).toBeNull();
  });

  it('syncAgentHistory is a no-op when conversation id matches', async () => {
    const service = new ConversationService();
    const clearSpy = jest.fn();
    const mockAgent = {
      getActiveDbConversationId: () => 5,
      clearConversationHistory: clearSpy,
    } as any;
    // incomingConversationId === currentDbConvId → should not clear
    await service.syncAgentHistory(mockAgent, 5, 5, 'alice', null);
    expect(clearSpy).not.toHaveBeenCalled();
  });
});
