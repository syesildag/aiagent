import type * as readline from 'readline';
import { ProviderService } from './providerService';
import { updateEnvVariables } from '../utils/envManager';
import { createClaudeCodeProvider } from '../mcp/llmFactory';
import type { ClaudeCodeAuthStatus, ClaudeCodeProvider } from '../mcp/claudeCodeProvider';

jest.mock('../utils/envManager');
jest.mock('../utils/githubAuth');
jest.mock('../utils/logger');
jest.mock('../mcp/llmFactory', () => ({ createClaudeCodeProvider: jest.fn() }));

const mockUpdateEnv = updateEnvVariables as jest.MockedFunction<typeof updateEnvVariables>;
const mockCreateClaudeCode = createClaudeCodeProvider as jest.MockedFunction<typeof createClaudeCodeProvider>;

const PRO_LOGIN: ClaudeCodeAuthStatus = { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro', email: 'me@example.com' };
const LOGGED_OUT: ClaudeCodeAuthStatus = { loggedIn: false };

/** Records the order of terminal hand-over and sign-in calls. */
let events: string[];

/** readline stub that answers each question with the next scripted answer. */
function scriptedReadline(...answers: string[]): readline.Interface {
  return {
    question: (_query: string, callback: (answer: string) => void) => callback(answers.shift() ?? ''),
    pause: jest.fn(() => { events.push('pause'); }),
    resume: jest.fn(() => { events.push('resume'); }),
  } as unknown as readline.Interface;
}

/** Fake Claude Code provider: getAuthStatus() returns `statuses` in order. */
function fakeClaudeCode(statuses: Array<ClaudeCodeAuthStatus | null>, loginError?: Error) {
  const getAuthStatus = jest.fn<Promise<ClaudeCodeAuthStatus | null>, []>();
  statuses.forEach(status => getAuthStatus.mockResolvedValueOnce(status));
  const login = jest.fn(async () => {
    events.push('login');
    if (loginError) throw loginError;
  });
  mockCreateClaudeCode.mockReturnValue({ getAuthStatus, login } as unknown as ClaudeCodeProvider);
  return { getAuthStatus, login };
}

describe('ProviderService.configureProvider — Claude Code (option 5)', () => {
  const originalModel = process.env.LLM_MODEL;
  let logSpy: jest.SpyInstance;
  const output = (): string => logSpy.mock.calls.map(args => args.join(' ')).join('\n');

  beforeEach(() => {
    jest.clearAllMocks();
    events = [];
    process.env.LLM_MODEL = 'qwen3:4b';
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (originalModel === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = originalModel;
    jest.restoreAllMocks();
  });

  it('keeps the account the claude CLI is already signed in with', async () => {
    const claude = fakeClaudeCode([PRO_LOGIN]);
    const updateManager = jest.fn().mockResolvedValue(undefined);

    await new ProviderService().configureProvider(scriptedReadline('5', ''), updateManager);

    expect(claude.login).not.toHaveBeenCalled();
    expect(output()).toContain('me@example.com');
    expect(output()).toMatch(/Claude Pro/);
    expect(mockUpdateEnv).toHaveBeenCalledWith({ LLM_PROVIDER: 'claude-code', LLM_MODEL: 'sonnet' });
    expect(updateManager).toHaveBeenCalled();
  });

  it('signs in through `claude auth login` when not signed in, handing over the terminal', async () => {
    const claude = fakeClaudeCode([LOGGED_OUT, PRO_LOGIN]);

    await new ProviderService().configureProvider(scriptedReadline('5'), jest.fn().mockResolvedValue(undefined));

    expect(events).toEqual(['pause', 'login', 'resume']);
    expect(claude.getAuthStatus).toHaveBeenCalledTimes(2);
    expect(mockUpdateEnv).toHaveBeenCalledWith({ LLM_PROVIDER: 'claude-code', LLM_MODEL: 'sonnet' });
  });

  it('signs in again when the user wants a different account', async () => {
    const claude = fakeClaudeCode([PRO_LOGIN, { ...PRO_LOGIN, email: 'other@example.com' }]);

    await new ProviderService().configureProvider(scriptedReadline('5', 'n'), jest.fn().mockResolvedValue(undefined));

    expect(claude.login).toHaveBeenCalledTimes(1);
    expect(output()).toContain('other@example.com');
    expect(mockUpdateEnv).toHaveBeenCalled();
  });

  it('leaves the provider unchanged and gives the terminal back when sign-in fails', async () => {
    fakeClaudeCode([LOGGED_OUT], new Error('Claude Code sign-in did not complete (exit code 1)'));
    const updateManager = jest.fn();

    await new ProviderService().configureProvider(scriptedReadline('5'), updateManager);

    expect(events).toEqual(['pause', 'login', 'resume']);
    expect(mockUpdateEnv).not.toHaveBeenCalled();
    expect(updateManager).not.toHaveBeenCalled();
  });

  it('leaves the provider unchanged when still not signed in after the sign-in', async () => {
    fakeClaudeCode([LOGGED_OUT, LOGGED_OUT]);

    await new ProviderService().configureProvider(scriptedReadline('5'), jest.fn());

    expect(mockUpdateEnv).not.toHaveBeenCalled();
  });

  it('stops with an install hint when the claude CLI cannot be run', async () => {
    const claude = fakeClaudeCode([null]);

    await new ProviderService().configureProvider(scriptedReadline('5'), jest.fn());

    expect(claude.login).not.toHaveBeenCalled();
    expect(output()).toMatch(/CLAUDE_CODE_PATH/);
    expect(mockUpdateEnv).not.toHaveBeenCalled();
  });

  it('warns when the login is not a Claude subscription (API billing)', async () => {
    fakeClaudeCode([{ loggedIn: true, authMethod: 'console', email: 'me@example.com' }]);

    await new ProviderService().configureProvider(scriptedReadline('5', ''), jest.fn().mockResolvedValue(undefined));

    expect(output()).toMatch(/not a Claude subscription/i);
  });

  it('keeps an existing Claude model', async () => {
    process.env.LLM_MODEL = 'opus';
    fakeClaudeCode([PRO_LOGIN]);

    await new ProviderService().configureProvider(scriptedReadline('5', ''), jest.fn().mockResolvedValue(undefined));

    expect(mockUpdateEnv).toHaveBeenCalledWith({ LLM_PROVIDER: 'claude-code', LLM_MODEL: 'opus' });
  });
});
