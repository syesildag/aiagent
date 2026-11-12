import { EventEmitter } from 'events';
import * as os from 'os';
import type { ChildProcess, ChildProcessWithoutNullStreams } from 'child_process';
import {
  ClaudeCodeProvider,
  buildTranscript,
  buildCliArgs,
  buildStreamJsonInput,
  buildChildEnv,
  isAllowedSubscriptionUser,
  type SpawnFn,
} from './claudeCodeProvider';
import { isUserRestrictedProvider, OllamaProvider, type LLMChatRequest, type LLMMessage, type Tool } from './llmProviders';
import { parseToolCalls, serializeToolCalls } from './claudeCodeToolProtocol';
import { AppError } from '../utils/errors';

jest.mock('../utils/logger');
// parseToolCalls is implemented separately; the provider tests only check that it is wired in.
jest.mock('./claudeCodeToolProtocol', () => ({
  ...jest.requireActual('./claudeCodeToolProtocol'),
  parseToolCalls: jest.fn(),
}));
const mockParseToolCalls = parseToolCalls as jest.MockedFunction<typeof parseToolCalls>;

// ── Fake child process ───────────────────────────────────────────────────────

class FakeStdin extends EventEmitter {
  written = '';
  write = jest.fn((chunk: string) => { this.written += chunk; return true; });
  end = jest.fn((chunk?: string) => { if (chunk) this.written += chunk; });
}

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = new FakeStdin();
  kill = jest.fn(() => true);
  out(text: string): void { this.stdout.emit('data', Buffer.from(text)); }
  err(text: string): void { this.stderr.emit('data', Buffer.from(text)); }
  exit(code: number | null): void { this.emit('close', code); }
}

/** Returns a spawn mock whose child runs `script` on the next tick (after listeners attach). */
function fakeSpawn(child: FakeChild, script: (c: FakeChild) => void): jest.MockedFunction<SpawnFn> {
  return jest.fn<ReturnType<SpawnFn>, Parameters<SpawnFn>>(() => {
    setImmediate(() => script(child));
    return child as unknown as ChildProcessWithoutNullStreams;
  });
}

const resultJson = (result: string, isError = false): string =>
  JSON.stringify({ type: 'result', subtype: 'success', is_error: isError, result, session_id: 's1' });

const deltaLine = (text: string): string =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });

async function readAll(stream: ReadableStream<string>): Promise<string> {
  const reader = stream.getReader();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out += value;
  }
}

const weatherTool: Tool = {
  type: 'function',
  function: {
    name: 'weather_get_forecast',
    description: 'Forecast',
    parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  },
};

const request = (overrides: Partial<LLMChatRequest> = {}): LLMChatRequest => ({
  model: 'sonnet',
  messages: [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hi' },
  ],
  ...overrides,
});

function makeProvider(spawnFn: SpawnFn, extra: Partial<ConstructorParameters<typeof ClaudeCodeProvider>[0]> = {}): ClaudeCodeProvider {
  return new ClaudeCodeProvider({ binaryPath: '/opt/claude', workDir: os.tmpdir(), spawnFn, ...extra });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe('buildTranscript', () => {
  it('moves system messages into the system prompt', () => {
    const { systemPrompt } = buildTranscript([
      { role: 'system', content: 'Rule one.' },
      { role: 'system', content: 'Rule two.' },
      { role: 'user', content: 'Hi' },
    ]);

    expect(systemPrompt).toBe('Rule one.\n\nRule two.');
  });

  it('sends a lone user message as plain text', () => {
    const { prompt } = buildTranscript([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'What time is it?' },
    ]);

    expect(prompt).toBe('What time is it?');
  });

  it('renders multi-turn history with past tool calls and named tool results, in order', () => {
    const toolCalls = [{ id: 'c1', type: 'function' as const, function: { name: 'weather_get_forecast', arguments: '{"city":"Paris"}' } }];
    const messages: LLMMessage[] = [
      { role: 'user', content: 'Weather in Paris?' },
      { role: 'assistant', content: 'Let me check.', tool_calls: toolCalls },
      { role: 'tool', content: 'Sunny, 21°C', tool_call_id: 'c1' },
      { role: 'user', content: 'Thanks!' },
    ];

    const { prompt } = buildTranscript(messages);

    expect(prompt).toContain('<user>\nWeather in Paris?\n</user>');
    expect(prompt).toContain(`Let me check.\n${serializeToolCalls(toolCalls)}`);
    expect(prompt).toContain('<tool_result name="weather_get_forecast" call_id="c1">\nSunny, 21°C\n</tool_result>');
    expect(prompt.indexOf('Weather in Paris?')).toBeLessThan(prompt.indexOf('<tool_result'));
    expect(prompt.indexOf('<tool_result')).toBeLessThan(prompt.indexOf('Thanks!'));
  });

  it('keeps text-only transcripts as plain text with no image blocks', () => {
    const transcript = buildTranscript([{ role: 'user', content: 'Hi' }]);

    expect(transcript.hasImages).toBe(false);
    expect(transcript.content).toEqual([{ type: 'text', text: 'Hi' }]);
  });

  it('turns image data URLs into image blocks, in place among the text', () => {
    const transcript = buildTranscript([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          { type: 'text', text: 'Be brief.' },
        ],
      },
    ]);

    expect(transcript.hasImages).toBe(true);
    expect(transcript.content).toEqual([
      { type: 'text', text: 'What is this?' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'text', text: 'Be brief.' },
    ]);
    expect(transcript.prompt).not.toContain('AAAA');
  });

  it('keeps images from earlier turns inside the conversation transcript', () => {
    const { content } = buildTranscript([
      { role: 'user', content: [{ type: 'text', text: 'Look' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBBB' } }] },
      { role: 'assistant', content: 'A cat.' },
      { role: 'user', content: 'What colour?' },
    ]);

    expect(content).toHaveLength(3);
    expect((content[0] as { text: string }).text).toMatch(/<conversation>\n<user>\nLook$/);
    expect(content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBBB' } });
    expect((content[2] as { text: string }).text).toMatch(/^<\/user>\n<assistant>\nA cat\./);
  });

  it('passes http(s) image URLs through and replaces unsupported images with a note', () => {
    const { content } = buildTranscript([
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
          { type: 'image_url', image_url: { url: 'data:image/tiff;base64,CCCC' } },
        ],
      },
    ]);

    expect(content[0]).toEqual({ type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } });
    expect(content[1]).toEqual({ type: 'text', text: '[image omitted: unsupported type image/tiff]' });
  });
});

describe('buildStreamJsonInput', () => {
  it('wraps the content blocks in one stream-json user message line', () => {
    const line = buildStreamJsonInput([{ type: 'text', text: 'Hi' }]);

    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Hi' }] } });
  });
});

describe('buildCliArgs', () => {
  it('runs headless with built-in tools, MCP, user settings and session files disabled', () => {
    const args = buildCliArgs({ model: 'sonnet', systemPrompt: 'Be brief.', streaming: false });

    expect(args).toContain('-p');
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual(['--model', 'sonnet']);
    expect(args.slice(args.indexOf('--system-prompt'), args.indexOf('--system-prompt') + 2)).toEqual(['--system-prompt', 'Be brief.']);
    expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual(['--tools', '']);
    expect(args).toContain('--strict-mcp-config');
    expect(args.slice(args.indexOf('--setting-sources'), args.indexOf('--setting-sources') + 2)).toEqual(['--setting-sources', 'local']);
    expect(args).toContain('--no-session-persistence');
    expect(args).toContain('--disable-slash-commands');
    expect(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2)).toEqual(['--output-format', 'json']);
  });

  it('switches to partial stream-json output when streaming', () => {
    const args = buildCliArgs({ model: 'sonnet', systemPrompt: 'S', streaming: true });

    expect(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2)).toEqual(['--output-format', 'stream-json']);
    expect(args).toContain('--verbose');
    expect(args).toContain('--include-partial-messages');
  });

  it('reads stream-json input (with the stream-json output it requires) for block input', () => {
    const args = buildCliArgs({ model: 'sonnet', systemPrompt: 'S', streaming: false, blockInput: true });

    expect(args.slice(args.indexOf('--input-format'), args.indexOf('--input-format') + 2)).toEqual(['--input-format', 'stream-json']);
    expect(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2)).toEqual(['--output-format', 'stream-json']);
    expect(args).toContain('--verbose');
    expect(args).not.toContain('--include-partial-messages');
  });

  it('never leaves the system prompt empty, so Claude Code\'s coding prompt is not used', () => {
    const args = buildCliArgs({ model: 'sonnet', systemPrompt: '', streaming: false });

    expect(args[args.indexOf('--system-prompt') + 1].length).toBeGreaterThan(0);
  });
});

describe('buildChildEnv', () => {
  it('removes API credentials that would override the subscription login', () => {
    const env = buildChildEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'sk-x', ANTHROPIC_AUTH_TOKEN: 't' }, {});

    expect(env.PATH).toBe('/bin');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it('sets the dedicated config dir and OAuth token when configured', () => {
    const env = buildChildEnv({}, { configDir: '/home/me/.claude-aiagent', oauthToken: 'oat-123' });

    expect(env.CLAUDE_CONFIG_DIR).toBe('/home/me/.claude-aiagent');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oat-123');
  });

  it('does not mutate the environment it was given', () => {
    const base = { ANTHROPIC_API_KEY: 'sk-x' };
    buildChildEnv(base, { oauthToken: 'oat' });

    expect(base).toEqual({ ANTHROPIC_API_KEY: 'sk-x' });
  });
});

// ── chat(): non-streaming ────────────────────────────────────────────────────

describe('ClaudeCodeProvider.chat (non-streaming)', () => {
  it('spawns the binary in the work dir, writes the prompt to stdin and returns the result text', async () => {
    const child = new FakeChild();
    const spawnFn = fakeSpawn(child, c => { c.out(resultJson('Hello!')); c.exit(0); });

    const response = await makeProvider(spawnFn).chat(request());

    expect(spawnFn).toHaveBeenCalledWith('/opt/claude', expect.arrayContaining(['-p', '--output-format', 'json']), expect.objectContaining({ cwd: os.tmpdir() }));
    expect(child.stdin.written).toBe('Hi');
    expect(child.stdin.end).toHaveBeenCalled();
    expect(response.message).toEqual({ role: 'assistant', content: 'Hello!' });
    expect(mockParseToolCalls).not.toHaveBeenCalled();
  });

  it('sends images as stream-json content blocks and reads the result line', async () => {
    const child = new FakeChild();
    const spawnFn = fakeSpawn(child, c => {
      c.out(`${JSON.stringify({ type: 'system', subtype: 'init' })}\n${resultJson('A red square.')}\n`);
      c.exit(0);
    });
    const image = { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AAAA' } };

    const response = await makeProvider(spawnFn).chat(request({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Describe' }, image] }],
    }));

    expect(spawnFn.mock.calls[0][1]).toEqual(expect.arrayContaining(['--input-format', 'stream-json']));
    expect(JSON.parse(child.stdin.written).message.content).toEqual([
      { type: 'text', text: 'Describe' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ]);
    expect(response.message).toEqual({ role: 'assistant', content: 'A red square.' });
  });

  it('adds the tool protocol to the system prompt and returns parsed tool calls', async () => {
    const child = new FakeChild();
    const spawnFn = fakeSpawn(child, c => { c.out(resultJson('raw reply')); c.exit(0); });
    const toolCalls = [{ id: 'x', type: 'function' as const, function: { name: 'weather_get_forecast', arguments: '{"city":"Paris"}' } }];
    mockParseToolCalls.mockReturnValue({ content: 'Checking.', toolCalls });

    const response = await makeProvider(spawnFn).chat(request({ tools: [weatherTool], tool_choice: 'required' }));

    const args = spawnFn.mock.calls[0][1];
    const systemPrompt = args[args.indexOf('--system-prompt') + 1];
    expect(systemPrompt).toContain('You are helpful.');
    expect(systemPrompt).toContain('weather_get_forecast');
    expect(systemPrompt).toMatch(/must call at least one tool/i);
    expect(mockParseToolCalls).toHaveBeenCalledWith('raw reply');
    expect(response.message).toEqual({ role: 'assistant', content: 'Checking.', tool_calls: toolCalls });
  });

  it('skips the tool protocol when tool_choice is none', async () => {
    const child = new FakeChild();
    const spawnFn = fakeSpawn(child, c => { c.out(resultJson('Plain answer')); c.exit(0); });

    const response = await makeProvider(spawnFn).chat(request({ tools: [weatherTool], tool_choice: 'none' }));

    const args = spawnFn.mock.calls[0][1];
    expect(args[args.indexOf('--system-prompt') + 1]).not.toContain('weather_get_forecast');
    expect(mockParseToolCalls).not.toHaveBeenCalled();
    expect(response.message.content).toBe('Plain answer');
  });

  it('throws the CLI\'s own message when the result is an error (e.g. not logged in)', async () => {
    const child = new FakeChild();
    const spawnFn = fakeSpawn(child, c => { c.out(resultJson('Not logged in · Please run /login', true)); c.exit(1); });

    await expect(makeProvider(spawnFn).chat(request())).rejects.toThrow('Not logged in · Please run /login');
  });

  it('throws with stderr when the process fails without a JSON result', async () => {
    const child = new FakeChild();
    const spawnFn = fakeSpawn(child, c => { c.err('Error: something broke\n'); c.exit(2); });

    await expect(makeProvider(spawnFn).chat(request())).rejects.toThrow(/exited with code 2.*something broke/);
  });

  it('explains how to fix a missing binary', async () => {
    const child = new FakeChild();
    const spawnFn = fakeSpawn(child, c => {
      c.emit('error', Object.assign(new Error('spawn /opt/claude ENOENT'), { code: 'ENOENT' }));
    });

    await expect(makeProvider(spawnFn).chat(request())).rejects.toThrow(/CLAUDE_CODE_PATH/);
  });

  it('kills the process and rejects when the request is aborted', async () => {
    const child = new FakeChild();
    const controller = new AbortController();
    const spawnFn = fakeSpawn(child, () => controller.abort());

    await expect(makeProvider(spawnFn).chat(request(), controller.signal)).rejects.toThrow(/cancelled/i);
    expect(child.kill).toHaveBeenCalled();
  });
});

// ── chat(): streaming ────────────────────────────────────────────────────────

describe('ClaudeCodeProvider.chat (streaming)', () => {
  it('streams text deltas from stream-json output, including lines split across chunks', async () => {
    const child = new FakeChild();
    const spawnFn = fakeSpawn(child, c => {
      const init = JSON.stringify({ type: 'system', subtype: 'init', tools: [] });
      const first = deltaLine('Hel');
      c.out(`${init}\n${first.slice(0, 10)}`);
      c.out(`${first.slice(10)}\n${deltaLine('lo')}\n`);
      c.out(`${resultJson('Hello')}\n`);
      c.exit(0);
    });

    const response = await makeProvider(spawnFn).chat(request({ stream: true }));

    expect(spawnFn.mock.calls[0][1]).toEqual(expect.arrayContaining(['stream-json', '--include-partial-messages']));
    expect(await readAll(response.message.content as ReadableStream<string>)).toBe('Hello');
  });

  it('never adds the tool protocol, since tool calls cannot be parsed from a stream', async () => {
    const child = new FakeChild();
    const spawnFn = fakeSpawn(child, c => { c.out(`${resultJson('ok')}\n`); c.exit(0); });

    const response = await makeProvider(spawnFn).chat(request({ stream: true, tools: [weatherTool] }));
    await readAll(response.message.content as ReadableStream<string>);

    const args = spawnFn.mock.calls[0][1];
    expect(args[args.indexOf('--system-prompt') + 1]).not.toContain('weather_get_forecast');
  });

  it('falls back to the final result text when no deltas arrive', async () => {
    const child = new FakeChild();
    const spawnFn = fakeSpawn(child, c => { c.out(`${resultJson('Whole answer')}\n`); c.exit(0); });

    const response = await makeProvider(spawnFn).chat(request({ stream: true }));

    expect(await readAll(response.message.content as ReadableStream<string>)).toBe('Whole answer');
  });

  it('errors the stream when the result is an error', async () => {
    const child = new FakeChild();
    const spawnFn = fakeSpawn(child, c => { c.out(`${resultJson('Usage limit reached', true)}\n`); c.exit(1); });

    const response = await makeProvider(spawnFn).chat(request({ stream: true }));

    await expect(readAll(response.message.content as ReadableStream<string>)).rejects.toThrow('Usage limit reached');
  });
});

// ── Health, models, access policy ────────────────────────────────────────────

describe('ClaudeCodeProvider.checkHealth', () => {
  it('is healthy when `claude auth status` reports a login', async () => {
    const child = new FakeChild();
    const spawnFn = fakeSpawn(child, c => { c.out(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })); c.exit(0); });

    await expect(makeProvider(spawnFn).checkHealth()).resolves.toBe(true);
    expect(spawnFn).toHaveBeenCalledWith('/opt/claude', ['auth', 'status'], expect.anything());
  });

  it('is unhealthy when not logged in', async () => {
    const child = new FakeChild();
    const spawnFn = fakeSpawn(child, c => { c.out(JSON.stringify({ loggedIn: false })); c.exit(1); });

    await expect(makeProvider(spawnFn).checkHealth()).resolves.toBe(false);
  });

  it('is unhealthy when the binary cannot be started', async () => {
    const child = new FakeChild();
    const spawnFn = fakeSpawn(child, c => { c.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })); });

    await expect(makeProvider(spawnFn).checkHealth()).resolves.toBe(false);
  });
});

describe('ClaudeCodeProvider.getAuthStatus', () => {
  it('returns the account the claude CLI is signed in with', async () => {
    const child = new FakeChild();
    const status = { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro', email: 'me@example.com' };
    const spawnFn = fakeSpawn(child, c => { c.out(JSON.stringify(status)); c.exit(0); });

    await expect(makeProvider(spawnFn).getAuthStatus()).resolves.toEqual(status);
  });

  it('returns null when the CLI cannot be run', async () => {
    const child = new FakeChild();
    const spawnFn = fakeSpawn(child, c => { c.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })); });

    await expect(makeProvider(spawnFn).getAuthStatus()).resolves.toBeNull();
  });
});

describe('ClaudeCodeProvider.login', () => {
  it('runs `claude auth login` on the user\'s terminal and resolves when it succeeds', async () => {
    const child = new FakeChild();
    const interactiveSpawnFn = jest.fn(() => {
      setImmediate(() => child.exit(0));
      return child as unknown as ChildProcess;
    });

    await makeProvider(jest.fn(), { interactiveSpawnFn }).login();

    expect(interactiveSpawnFn).toHaveBeenCalledWith('/opt/claude', ['auth', 'login'], expect.objectContaining({ cwd: os.tmpdir() }));
  });

  it('rejects when the sign-in fails or is cancelled', async () => {
    const child = new FakeChild();
    const interactiveSpawnFn = jest.fn(() => {
      setImmediate(() => child.exit(1));
      return child as unknown as ChildProcess;
    });

    await expect(makeProvider(jest.fn(), { interactiveSpawnFn }).login()).rejects.toThrow(/sign-in.*code 1/i);
  });

  it('explains how to fix a missing binary', async () => {
    const child = new FakeChild();
    const interactiveSpawnFn = jest.fn(() => {
      setImmediate(() => child.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })));
      return child as unknown as ChildProcess;
    });

    await expect(makeProvider(jest.fn(), { interactiveSpawnFn }).login()).rejects.toThrow(/CLAUDE_CODE_PATH/);
  });
});

describe('ClaudeCodeProvider.getAvailableModels', () => {
  it('offers the Claude Code model aliases', async () => {
    await expect(makeProvider(jest.fn()).getAvailableModels()).resolves.toEqual(['sonnet', 'opus', 'haiku']);
  });
});

describe('ClaudeCodeProvider.assertUserAllowed', () => {
  it('is recognised as a user-restricted provider (other providers are not)', () => {
    expect(isUserRestrictedProvider(makeProvider(jest.fn()))).toBe(true);
    expect(isUserRestrictedProvider(new OllamaProvider('http://localhost:11434'))).toBe(false);
  });

  it('throws a 403 AppError when the access policy denies the user', () => {
    const isUserAllowed = jest.fn(() => false);
    const provider = makeProvider(jest.fn(), { isUserAllowed });

    let thrown: unknown;
    try { provider.assertUserAllowed({ userLogin: 'guest', isAdmin: false }); } catch (e) { thrown = e; }

    expect(isUserAllowed).toHaveBeenCalledWith({ userLogin: 'guest', isAdmin: false });
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).statusCode).toBe(403);
  });

  it('does nothing when the access policy allows the user', () => {
    const provider = makeProvider(jest.fn(), { isUserAllowed: () => true });

    expect(() => provider.assertUserAllowed({})).not.toThrow();
  });
});

describe('isAllowedSubscriptionUser', () => {
  it('allows any signed-in web user, admin or not', () => {
    expect(isAllowedSubscriptionUser({ userLogin: 'serkan', isAdmin: true })).toBe(true);
    expect(isAllowedSubscriptionUser({ userLogin: 'guest', isAdmin: false })).toBe(true);
  });

  it('allows the CLI operator', () => {
    expect(isAllowedSubscriptionUser({ interactive: true })).toBe(true);
  });

  it('refuses scheduled-job calls, which carry neither a userLogin nor interactive', () => {
    expect(isAllowedSubscriptionUser({})).toBe(false);
    expect(isAllowedSubscriptionUser({ isAdmin: true })).toBe(false);
  });

  it('is the default policy of the provider', () => {
    const provider = makeProvider(jest.fn());

    expect(() => provider.assertUserAllowed({ userLogin: 'guest' })).not.toThrow();
    expect(() => provider.assertUserAllowed({})).toThrow(AppError);
  });
});
