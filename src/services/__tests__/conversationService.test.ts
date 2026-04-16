import { ConversationService } from '../conversationService';

describe('ConversationService', () => {
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
