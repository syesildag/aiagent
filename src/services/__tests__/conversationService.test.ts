import { ConversationService } from '../conversationService';
import aiagentconversationsRepository, { AiAgentConversations } from '../../entities/ai-agent-conversations';
import aiagentconversationmessagesRepository from '../../entities/ai-agent-conversation-messages';
import { DbConversationHistory } from '../../utils/dbConversationHistory';
import { config } from '../../utils/config';

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

});

describe('ConversationService.getHistoryForConversation', () => {
  const dbRow = (role: string, content: string) => ({ getRole: () => role, getContent: () => content }) as any;
  const mutableConfig = config as { USE_DB_CONVERSATION_HISTORY: boolean };

  afterEach(() => {
    mutableConfig.USE_DB_CONVERSATION_HISTORY = false;
    jest.restoreAllMocks();
  });

  it('gives every conversation its own history (no cross-user context)', async () => {
    jest.spyOn(aiagentconversationmessagesRepository, 'findByConversationId').mockResolvedValue([]);
    const service = new ConversationService();

    const alice = await service.getHistoryForConversation(1, null, 'alice');
    const bob = await service.getHistoryForConversation(2, null, 'bob');
    await alice.addMessage({ role: 'user', content: 'alice secret' });

    expect(alice).not.toBe(bob);
    expect((await bob.getCurrentConversation()).map(m => m.content)).toEqual([]);
  });

  it('keeps a conversation\'s history across turns, including tool messages', async () => {
    const find = jest.spyOn(aiagentconversationmessagesRepository, 'findByConversationId').mockResolvedValue([]);
    const service = new ConversationService();

    const first = await service.getHistoryForConversation(7, null, 'alice');
    await first.addMessage({ role: 'tool', content: '{"ok":true}', toolCallId: 'call_1' });
    const second = await service.getHistoryForConversation(7, null, 'alice');

    expect(second).toBe(first);
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('shares one restore between concurrent first requests', async () => {
    const find = jest.spyOn(aiagentconversationmessagesRepository, 'findByConversationId').mockResolvedValue([]);
    const service = new ConversationService();

    const [a, b] = await Promise.all([
      service.getHistoryForConversation(8, null, 'alice'),
      service.getHistoryForConversation(8, null, 'alice'),
    ]);

    expect(a).toBe(b);
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('restores only user/assistant turns from the database', async () => {
    jest.spyOn(aiagentconversationmessagesRepository, 'findByConversationId').mockResolvedValue([
      dbRow('user', 'hi'), dbRow('tool', '{"raw":1}'), dbRow('assistant', 'hello'), dbRow('assistant', ''),
    ]);
    const service = new ConversationService();

    const history = await service.getHistoryForConversation(3, null, 'alice');

    expect((await history.getCurrentConversation()).map(m => [m.role, m.content])).toEqual([
      ['user', 'hi'], ['assistant', 'hello'],
    ]);
  });

  it('returns an isolated, uncached history when there is no conversation id', async () => {
    const service = new ConversationService();
    const a = await service.getHistoryForConversation(null, null, 'alice');
    const b = await service.getHistoryForConversation(null, null, 'alice');
    expect(a).not.toBe(b);
  });

  it('rebuilds a forgotten (deleted) conversation from the database', async () => {
    const find = jest.spyOn(aiagentconversationmessagesRepository, 'findByConversationId').mockResolvedValue([]);
    const service = new ConversationService();

    const before = await service.getHistoryForConversation(4, null, 'alice');
    service.forgetConversation(4);
    const after = await service.getHistoryForConversation(4, null, 'alice');

    expect(after).not.toBe(before);
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('points a DB-backed history at the conversation in USE_DB_CONVERSATION_HISTORY mode', async () => {
    mutableConfig.USE_DB_CONVERSATION_HISTORY = true;
    const service = new ConversationService();

    const history = await service.getHistoryForConversation(5, 'conv-uuid', 'alice');

    expect(history).toBeInstanceOf(DbConversationHistory);
    expect((history as DbConversationHistory).currentConversationId).toBe('conv-uuid');
  });
});
