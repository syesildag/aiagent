import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
  type SpawnOptionsWithoutStdio,
} from 'child_process';
import { StringDecoder } from 'string_decoder';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Logger from '../utils/logger';
import { AppError } from '../utils/errors';
import {
  getModelMaxTokens,
  handleTokenLimits,
  type LLMChatRequest,
  type LLMChatResponse,
  type LLMMessage,
  type LLMProvider,
  type ProviderUserContext,
  type UserRestrictedProvider,
} from './llmProviders';
import { buildToolProtocolPrompt, parseToolCalls, serializeToolCalls } from './claudeCodeToolProtocol';

/**
 * LLM provider backed by the official Claude Code CLI (`claude -p`), so a Claude
 * Pro/Max subscription can be used without an Anthropic API key.
 *
 * Each chat() call is one stateless `claude -p` process: AgentLoop's full history is
 * rendered into a transcript (stdin), Claude Code's own tools / MCP / user settings are
 * disabled, and MCP tool calls travel through the prompt protocol in
 * claudeCodeToolProtocol.ts. AgentLoop keeps owning tools, approvals and history.
 *
 * Terms: OAuth subscription credentials are meant for your own use of Claude Code. Any
 * signed-in web user and the CLI operator may use this provider (see
 * isAllowedSubscriptionUser()), so the accounts on this server share the subscription.
 */

export type SpawnFn = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

/** Spawns a process attached to the user's terminal (stdio inherited). */
export type InteractiveSpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

/** Output of `claude auth status` (JSON). */
export interface ClaudeCodeAuthStatus {
  loggedIn: boolean;
  /** 'claude.ai' for a Claude subscription login. */
  authMethod?: string;
  /** e.g. 'pro' or 'max'. */
  subscriptionType?: string;
  email?: string;
}

export interface ClaudeCodeProviderOptions {
  /** Path to the `claude` executable (config: CLAUDE_CODE_PATH). */
  binaryPath: string;
  /** Dedicated Claude Code config dir for this app, passed as CLAUDE_CONFIG_DIR. */
  configDir?: string;
  /** Long-lived token from `claude setup-token`, passed as CLAUDE_CODE_OAUTH_TOKEN. */
  oauthToken?: string;
  /** Empty working directory, so no project CLAUDE.md or settings are picked up. */
  workDir?: string;
  spawnFn?: SpawnFn;
  interactiveSpawnFn?: InteractiveSpawnFn;
  isUserAllowed?: (ctx: ProviderUserContext) => boolean;
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface ResultMessage {
  type: 'result';
  subtype?: string;
  is_error?: boolean;
  result?: string;
}

const DEFAULT_WORK_DIR = path.join(os.tmpdir(), 'aiagent-claude-code');
const FALLBACK_SYSTEM_PROMPT = 'You are a helpful assistant.';
const MODEL_ALIASES = ['sonnet', 'opus', 'haiku'];
const CANCELLED_MESSAGE = 'Operation cancelled by user';

/**
 * Access policy: who may chat through the Claude subscription.
 *
 * Any signed-in web user and the CLI operator are allowed. Anthropic's terms are stricter
 * about routing other people's requests through a personal subscription, and this server
 * has multiple accounts that will share it.
 *
 * ctx.userLogin comes from the web session (routes/chat.ts). ctx.interactive is set by the
 * CLI. Scheduled AgentJobs set neither and are refused: they would spend the subscription's
 * 5-hour / weekly usage limits with no person behind them.
 */
export function isAllowedSubscriptionUser(ctx: ProviderUserContext): boolean {
  return Boolean(ctx.userLogin) || ctx.interactive === true;
}

// ── Pure helpers (exported for tests) ────────────────────────────────────────

/** An Anthropic content block, as `--input-format stream-json` accepts it. */
export type PromptBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string } };

type ImageBlock = Extract<PromptBlock, { type: 'image' }>;
/** Transcript pieces: text lines (joined with newlines) and images in their place. */
type Segment = string | ImageBlock;

const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const IMAGE_MARKER = '[image]';

export interface Transcript {
  systemPrompt: string;
  /** The prompt as plain text, with images shown as a marker. Sent when there are no images. */
  prompt: string;
  /** The prompt as content blocks with the images in place. Sent when hasImages is true. */
  content: PromptBlock[];
  hasImages: boolean;
}

export function buildTranscript(messages: LLMMessage[]): Transcript {
  const systemParts: string[] = [];
  const turns: LLMMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(contentToText(message.content));
    } else {
      turns.push(message);
    }
  }
  const systemPrompt = systemParts.join('\n\n');

  if (turns.length === 1 && turns[0].role === 'user') {
    return finishTranscript(systemPrompt, contentToSegments(turns[0].content));
  }

  const toolNamesById = new Map<string, string>();
  const segments: Segment[] = ['<conversation>'];
  for (const turn of turns) {
    if (turn.role === 'user') {
      segments.push('<user>', ...contentToSegments(turn.content), '</user>');
    } else if (turn.role === 'assistant') {
      const text = contentToText(turn.content);
      const calls = turn.tool_calls ?? [];
      calls.forEach(call => toolNamesById.set(call.id, call.function.name));
      const body = calls.length > 0 ? [text, serializeToolCalls(calls)].filter(Boolean).join('\n') : text;
      segments.push('<assistant>', body, '</assistant>');
    } else if (turn.role === 'tool') {
      const callId = turn.tool_call_id ?? '';
      const name = toolNamesById.get(callId) ?? 'unknown';
      segments.push(`<tool_result name="${name}" call_id="${callId}">`, ...contentToSegments(turn.content), '</tool_result>');
    }
  }
  segments.push('</conversation>', '', 'Write the assistant\'s next reply to the conversation above.');
  return finishTranscript(systemPrompt, segments);
}

function finishTranscript(systemPrompt: string, segments: Segment[]): Transcript {
  const content: PromptBlock[] = [];
  let lines: string[] = [];
  const flush = (): void => {
    if (lines.length > 0) content.push({ type: 'text', text: lines.join('\n') });
    lines = [];
  };
  for (const segment of segments) {
    if (typeof segment === 'string') {
      lines.push(segment);
    } else {
      flush();
      content.push(segment);
    }
  }
  flush();
  const prompt = segments.map(segment => (typeof segment === 'string' ? segment : IMAGE_MARKER)).join('\n');
  return { systemPrompt, prompt, content, hasImages: segments.some(segment => typeof segment !== 'string') };
}

function contentToSegments(content: LLMMessage['content']): Segment[] {
  if (typeof content === 'string') return [content];
  return content.map(part => (part.type === 'text' ? part.text : toImageBlock(part.image_url.url)));
}

function contentToText(content: LLMMessage['content']): string {
  return contentToSegments(content)
    .map(segment => (typeof segment === 'string' ? segment : IMAGE_MARKER))
    .join('\n');
}

/** Converts an image_url (data URL or http(s) URL) to an image block, or a text note if unusable. */
function toImageBlock(url: string): Segment {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (match) {
    const mediaType = match[1].toLowerCase();
    if (!SUPPORTED_IMAGE_TYPES.has(mediaType)) {
      Logger.warn(`Claude Code provider: unsupported image type ${mediaType} omitted`);
      return `[image omitted: unsupported type ${mediaType}]`;
    }
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: match[2] } };
  }
  if (/^https?:\/\//i.test(url)) return { type: 'image', source: { type: 'url', url } };
  Logger.warn('Claude Code provider: image with an unrecognised URL omitted');
  return '[image omitted: unrecognised image URL]';
}

/** The single stdin line for `--input-format stream-json`. */
export function buildStreamJsonInput(content: PromptBlock[]): string {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`;
}

export function buildCliArgs(opts: {
  model: string;
  systemPrompt: string;
  streaming: boolean;
  /** Read the prompt as stream-json content blocks (needed to send images). */
  blockInput?: boolean;
}): string[] {
  // stream-json input requires stream-json output (which requires --verbose).
  const streamJsonOutput = opts.streaming || opts.blockInput === true;
  return [
    '-p',
    '--model', opts.model,
    // Replaces Claude Code's coding-agent prompt entirely; never pass it empty.
    '--system-prompt', opts.systemPrompt || FALLBACK_SYSTEM_PROMPT,
    // No built-in tools, no MCP servers, no user/project settings (hooks, plugins), no skills.
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', 'local',
    '--disable-slash-commands',
    '--no-session-persistence',
    ...(opts.blockInput ? ['--input-format', 'stream-json'] : []),
    '--output-format', streamJsonOutput ? 'stream-json' : 'json',
    ...(streamJsonOutput ? ['--verbose'] : []),
    ...(opts.streaming ? ['--include-partial-messages'] : []),
  ];
}

export function buildChildEnv(
  base: NodeJS.ProcessEnv,
  opts: Pick<ClaudeCodeProviderOptions, 'configDir' | 'oauthToken'>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  // In -p mode an API key always wins over the subscription login.
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  if (opts.configDir) env.CLAUDE_CONFIG_DIR = opts.configDir;
  if (opts.oauthToken) env.CLAUDE_CODE_OAUTH_TOKEN = opts.oauthToken;
  return env;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isResultMessage(value: unknown): value is ResultMessage {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'result';
}

function textDelta(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const msg = value as { type?: unknown; event?: { type?: unknown; delta?: { type?: unknown; text?: unknown } } };
  const delta = msg.event?.delta;
  if (msg.type === 'stream_event' && msg.event?.type === 'content_block_delta'
      && delta?.type === 'text_delta' && typeof delta.text === 'string') {
    return delta.text;
  }
  return undefined;
}

function resultError(result: ResultMessage): Error {
  return new Error(`Claude Code error: ${result.result ?? result.subtype ?? 'unknown error'}`);
}

// ── Provider ─────────────────────────────────────────────────────────────────

export class ClaudeCodeProvider implements LLMProvider, UserRestrictedProvider {
  readonly name = 'Claude Code';
  private readonly binaryPath: string;
  private readonly workDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly spawnFn: SpawnFn;
  private readonly interactiveSpawnFn: InteractiveSpawnFn;
  private readonly isUserAllowed: (ctx: ProviderUserContext) => boolean;

  constructor(options: ClaudeCodeProviderOptions) {
    this.binaryPath = options.binaryPath;
    this.workDir = options.workDir ?? DEFAULT_WORK_DIR;
    // The child needs PATH, HOME, etc.; secrets that would bypass the subscription are stripped.
    this.env = buildChildEnv(process.env, options);
    this.spawnFn = options.spawnFn ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions));
    this.interactiveSpawnFn = options.interactiveSpawnFn
      ?? ((command, args, spawnOptions) => spawn(command, args, { ...spawnOptions, stdio: 'inherit' }));
    this.isUserAllowed = options.isUserAllowed ?? isAllowedSubscriptionUser;
  }

  assertUserAllowed(ctx: ProviderUserContext): void {
    if (!this.isUserAllowed(ctx)) {
      throw new AppError(
        'The Claude Code provider runs on a personal Claude subscription and is not available for this account.',
        403,
      );
    }
  }

  async checkHealth(): Promise<boolean> {
    return (await this.getAuthStatus())?.loggedIn === true;
  }

  /**
   * Which account the claude CLI is signed in with, or null if the CLI can't be run.
   * `auth status` makes no model request, so it costs no usage. Its output holds the
   * account email — show it to the user, never write it to the log.
   */
  async getAuthStatus(): Promise<ClaudeCodeAuthStatus | null> {
    try {
      const { stdout } = await this.run(['auth', 'status']);
      const status = parseJson(stdout.trim());
      if (typeof status !== 'object' || status === null) return null;
      return status as ClaudeCodeAuthStatus;
    } catch (error) {
      Logger.error(`Claude Code auth status failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Runs `claude auth login` on the user's terminal: Anthropic's own browser sign-in.
   * Credentials stay in Claude Code's store (macOS Keychain); this app never sees them.
   * The caller must hand over the terminal (pause its own readline) while this runs.
   */
  login(): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.mkdirSync(this.workDir, { recursive: true });
      const child = this.interactiveSpawnFn(this.binaryPath, ['auth', 'login'], { cwd: this.workDir, env: this.env });
      let settled = false;
      child.on('error', (error: Error) => {
        if (settled) return;
        settled = true;
        reject(this.describeSpawnError(error));
      });
      child.on('close', (code: number | null) => {
        if (settled) return;
        settled = true;
        if (code === 0) resolve();
        else reject(new Error(`Claude Code sign-in did not complete (exit code ${code})`));
      });
    });
  }

  async getAvailableModels(): Promise<string[]> {
    return [...MODEL_ALIASES];
  }

  async chat(request: LLMChatRequest, abortSignal?: AbortSignal): Promise<LLMChatResponse> {
    const adjusted = handleTokenLimits(request, getModelMaxTokens(request.model));
    const streaming = adjusted.stream === true;
    const transcript = buildTranscript(adjusted.messages);
    const { systemPrompt } = transcript;
    const blockInput = transcript.hasImages;
    const input = blockInput ? buildStreamJsonInput(transcript.content) : transcript.prompt;

    // Tool calls can only be parsed from a complete reply, so streamed calls get no tools.
    const tools = streaming || adjusted.tool_choice === 'none' ? [] : (adjusted.tools ?? []);
    const fullSystemPrompt = tools.length > 0
      ? `${systemPrompt}\n\n${buildToolProtocolPrompt(tools, adjusted.tool_choice === 'required' ? 'required' : 'auto')}`
      : systemPrompt;
    const args = buildCliArgs({ model: adjusted.model, systemPrompt: fullSystemPrompt, streaming, blockInput });

    Logger.debug(`Claude Code chat: model=${adjusted.model}, messages=${adjusted.messages.length}, tools=${tools.length}, stream=${streaming}, images=${blockInput}`);

    if (streaming) {
      return { message: { role: 'assistant', content: this.stream(args, input, abortSignal) }, done: false };
    }

    const text = this.extractResult(await this.run(args, input, abortSignal));
    if (tools.length === 0) {
      return { message: { role: 'assistant', content: text }, done: true };
    }
    const parsed = parseToolCalls(text);
    return {
      message: {
        role: 'assistant',
        content: parsed.content,
        ...(parsed.toolCalls.length > 0 ? { tool_calls: parsed.toolCalls } : {}),
      },
      done: true,
    };
  }

  private start(args: string[]): ChildProcessWithoutNullStreams {
    fs.mkdirSync(this.workDir, { recursive: true });
    const child = this.spawnFn(this.binaryPath, args, { cwd: this.workDir, env: this.env });
    // Without a handler, an early exit (EPIPE on stdin) would crash the server.
    child.stdin.on('error', (error: Error) => Logger.debug(`Claude Code stdin closed early: ${error.message}`));
    return child;
  }

  private writeInput(child: ChildProcessWithoutNullStreams, input: string | undefined): void {
    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  }

  private describeSpawnError(error: Error & { code?: string }): Error {
    if (error.code === 'ENOENT') {
      return new Error(
        `Claude Code CLI not found at "${this.binaryPath}". Install it (https://code.claude.com/docs/en/setup) ` +
        'or set CLAUDE_CODE_PATH to the absolute path of the claude binary.',
      );
    }
    return new Error(`Failed to start Claude Code: ${error.message}`);
  }

  /** Runs the CLI to completion. Rejects only on spawn failure or abort; callers judge the exit code. */
  private run(args: string[], input?: string, abortSignal?: AbortSignal): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      if (abortSignal?.aborted) {
        reject(new Error(CANCELLED_MESSAGE));
        return;
      }
      const child = this.start(args);
      const stdoutDecoder = new StringDecoder('utf8');
      const stderrDecoder = new StringDecoder('utf8');
      let stdout = '';
      let stderr = '';
      let settled = false;

      const settle = (complete: () => void): void => {
        if (settled) return;
        settled = true;
        abortSignal?.removeEventListener('abort', onAbort);
        complete();
      };
      const onAbort = (): void => {
        child.kill('SIGTERM');
        settle(() => reject(new Error(CANCELLED_MESSAGE)));
      };
      abortSignal?.addEventListener('abort', onAbort, { once: true });

      child.stdout.on('data', (chunk: Buffer) => { stdout += stdoutDecoder.write(chunk); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += stderrDecoder.write(chunk); });
      child.on('error', (error: Error) => settle(() => reject(this.describeSpawnError(error))));
      child.on('close', (code: number | null) => settle(() => resolve({
        code,
        stdout: stdout + stdoutDecoder.end(),
        stderr: stderr + stderrDecoder.end(),
      })));

      this.writeInput(child, input);
    });
  }

  /** Reads the result from `json` output, or from the last result line of `stream-json` output. */
  private extractResult({ code, stdout, stderr }: ProcessResult): string {
    const lines = stdout.trim().split('\n');
    const parsed = parseJson(stdout.trim())
      ?? lines.reverse().map(line => parseJson(line)).find(isResultMessage);
    if (isResultMessage(parsed)) {
      if (parsed.is_error) throw resultError(parsed);
      return parsed.result ?? '';
    }
    const detail = (stderr || stdout).trim() || 'no output';
    throw new Error(code === 0
      ? `Claude Code returned no result: ${detail}`
      : `Claude Code exited with code ${code}: ${detail}`);
  }

  /** Streams text deltas from `--output-format stream-json --include-partial-messages`. */
  private stream(args: string[], input: string, abortSignal?: AbortSignal): ReadableStream<string> {
    let child: ChildProcessWithoutNullStreams | undefined;
    let finished = false;

    return new ReadableStream<string>({
      start: (controller) => {
        const decoder = new StringDecoder('utf8');
        let buffer = '';
        let stderr = '';
        let sawDelta = false;
        let result: ResultMessage | undefined;

        const finish = (error?: Error): void => {
          if (finished) return;
          finished = true;
          abortSignal?.removeEventListener('abort', onAbort);
          if (error) controller.error(error);
          else controller.close();
        };
        const onAbort = (): void => {
          child?.kill('SIGTERM');
          finish(new Error(CANCELLED_MESSAGE));
        };
        const handleLine = (line: string): void => {
          if (finished || !line.trim()) return;
          const message = parseJson(line);
          const delta = textDelta(message);
          if (delta !== undefined) {
            sawDelta = true;
            controller.enqueue(delta);
          } else if (isResultMessage(message)) {
            result = message;
          }
        };

        if (abortSignal?.aborted) {
          finish(new Error(CANCELLED_MESSAGE));
          return;
        }
        abortSignal?.addEventListener('abort', onAbort, { once: true });

        child = this.start(args);
        child.stdout.on('data', (chunk: Buffer) => {
          buffer += decoder.write(chunk);
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          lines.forEach(handleLine);
        });
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
        child.on('error', (error: Error) => finish(this.describeSpawnError(error)));
        child.on('close', (code: number | null) => {
          handleLine(buffer + decoder.end());
          if (result?.is_error) {
            finish(resultError(result));
          } else if (!result && code !== 0) {
            finish(new Error(`Claude Code exited with code ${code}: ${stderr.trim() || 'no output'}`));
          } else {
            if (!sawDelta && result?.result && !finished) controller.enqueue(result.result);
            finish();
          }
        });

        this.writeInput(child, input);
      },
      cancel: () => {
        finished = true;
        child?.kill('SIGTERM');
      },
    });
  }
}
