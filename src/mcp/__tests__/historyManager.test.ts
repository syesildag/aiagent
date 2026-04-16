import { HistoryManager } from '../historyManager';

describe('HistoryManager', () => {
  it('createHistoryForSession returns a fresh instance each call', () => {
    const hm = new HistoryManager();
    const h1 = hm.createHistoryForSession('alice');
    const h2 = hm.createHistoryForSession('bob');
    expect(h1).not.toBe(h2);  // distinct instances — no shared state
  });

  it('createHistoryForSession returns a usable history object', async () => {
    const hm = new HistoryManager();
    const h = hm.createHistoryForSession('alice');
    await h.startNewConversation(undefined, 'alice');
    await h.addMessage({ role: 'user', content: 'hello' });
    const msgs = await h.getCurrentConversation();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('hello');
  });

  it('two sessions do not share history', async () => {
    const hm = new HistoryManager();
    const h1 = hm.createHistoryForSession('alice');
    const h2 = hm.createHistoryForSession('bob');

    await h1.startNewConversation(undefined, 'alice');
    await h1.addMessage({ role: 'user', content: 'alice message' });

    await h2.startNewConversation(undefined, 'bob');
    const h2msgs = await h2.getCurrentConversation();
    expect(h2msgs).toHaveLength(0);  // bob's history is independent
  });
});
