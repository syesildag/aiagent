import { MCPServerManager, ChatWithLLMArgs } from './mcpManager';
import { HistoryManager } from './historyManager';
import { InMemoryConversationHistory } from '../utils/conversationHistory';
import type { IConversationHistory } from '../descriptions/conversationTypes';

function makeManager() {
  const seen: IConversationHistory[] = [];
  const agentLoop = {
    run: jest.fn(async (_args: ChatWithLLMArgs, history: IConversationHistory) => {
      seen.push(history);
      return 'ok';
    }),
    withModel: jest.fn(),
  };
  const serverManager = { ensureInitialized: jest.fn(async () => undefined) };
  const manager = new MCPServerManager(
    serverManager as any, {} as any, {} as any, agentLoop as any, new HistoryManager(), {} as any, 'model',
  );
  return { manager, seen };
}

describe('MCPServerManager history selection', () => {
  it('runs a turn on the caller-supplied history (web: one per conversation)', async () => {
    const { manager, seen } = makeManager();
    const alice = new InMemoryConversationHistory();
    const bob = new InMemoryConversationHistory();

    await Promise.all([
      manager.chatWithLLM({ message: 'a', customSystemPrompt: '', history: alice }),
      manager.chatWithLLM({ message: 'b', customSystemPrompt: '', history: bob }),
    ]);

    expect(seen).toEqual([alice, bob]);
  });

  it('falls back to the shared history when none is supplied (CLI)', async () => {
    const { manager, seen } = makeManager();

    await manager.chatWithLLM({ message: 'a', customSystemPrompt: '' });
    await manager.chatWithLLM({ message: 'b', customSystemPrompt: '' });

    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).toBeInstanceOf(InMemoryConversationHistory);
  });
});
