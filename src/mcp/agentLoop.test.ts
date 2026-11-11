import { AgentLoop } from './agentLoop';
import type { LLMProvider, UserRestrictedProvider } from './llmProviders';
import type { ToolRegistry } from './toolRegistry';
import type { ToolExecutor } from './toolExecutor';
import type { IConversationHistory } from '../descriptions/conversationTypes';
import { AppError } from '../utils/errors';

jest.mock('../utils/logger');

describe('AgentLoop user-restricted providers', () => {
  it('asks the provider to authorize the user before any history change or LLM call', async () => {
    const provider: LLMProvider & UserRestrictedProvider = {
      name: 'Restricted',
      checkHealth: jest.fn(),
      getAvailableModels: jest.fn(),
      chat: jest.fn(),
      assertUserAllowed: jest.fn(() => { throw new AppError('not for you', 403); }),
    };
    const history = { addMessage: jest.fn() } as unknown as IConversationHistory;
    const loop = new AgentLoop({
      llmProvider: provider,
      model: 'sonnet',
      toolRegistry: {} as ToolRegistry,
      toolExecutor: {} as ToolExecutor,
    });

    await expect(
      loop.run({ message: 'hi', customSystemPrompt: 'S', userLogin: 'guest', isAdmin: false }, history),
    ).rejects.toThrow('not for you');

    expect(provider.assertUserAllowed).toHaveBeenCalledWith({ userLogin: 'guest', isAdmin: false });
    expect(provider.chat).not.toHaveBeenCalled();
    expect(history.addMessage).not.toHaveBeenCalled();
  });
});
