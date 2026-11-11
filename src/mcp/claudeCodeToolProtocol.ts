import type { Tool, ToolCall } from './llmProviders';

/**
 * Prompt-level tool-calling protocol for the Claude Code provider.
 *
 * `claude -p` runs with its built-in tools disabled, so it cannot return native
 * tool_use blocks to us. Instead the system prompt describes our MCP tools and asks
 * Claude to end its reply with a <tool_calls> block, which parseToolCalls() turns back
 * into ToolCall[] for AgentLoop. Past calls are replayed into the transcript with
 * serializeToolCalls(), so the model always sees the same format it is asked to write.
 */

export const TOOL_CALLS_OPEN_TAG = '<tool_calls>';
export const TOOL_CALLS_CLOSE_TAG = '</tool_calls>';

export interface ParsedAssistantTurn {
  /** The assistant's prose with the <tool_calls> block removed. */
  content: string;
  /** Calls requested by the model; empty when it answered directly. */
  toolCalls: ToolCall[];
}

export function buildToolProtocolPrompt(tools: Tool[], toolChoice: 'auto' | 'required' = 'auto'): string {
  const choiceRule = toolChoice === 'required'
    ? '- You must call at least one tool in this reply.'
    : '- If no tool is needed, answer normally and do not include a block.';

  const toolList = tools
    .map(tool => [
      `<tool name="${tool.function.name}">`,
      `<description>${tool.function.description}</description>`,
      `<parameters>${JSON.stringify(tool.function.parameters)}</parameters>`,
      '</tool>',
    ].join('\n'))
    .join('\n');

  return [
    '# Tools',
    '',
    'You can call the tools listed below. To call tools, end your reply with exactly one block in this format, a JSON array with one object per call:',
    '',
    TOOL_CALLS_OPEN_TAG,
    '[{"name": "tool_name", "arguments": {"param": "value"}}]',
    TOOL_CALLS_CLOSE_TAG,
    '',
    'Rules:',
    '- Use only tool names from the list below, with arguments that match the tool\'s JSON schema.',
    '- Put independent calls in the same block; they run in parallel.',
    '- Stop writing after the block. Results arrive in the next message as <tool_result> elements.',
    choiceRule,
    '',
    toolList,
  ].join('\n');
}

export function serializeToolCalls(toolCalls: ToolCall[]): string {
  const calls = toolCalls.map(call => ({
    name: call.function.name,
    arguments: parseArgumentsOrRaw(call.function.arguments),
  }));
  return `${TOOL_CALLS_OPEN_TAG}${JSON.stringify(calls)}${TOOL_CALLS_CLOSE_TAG}`;
}

function parseArgumentsOrRaw(args: string): unknown {
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

/**
 * Turn Claude's reply into prose + ToolCall[].
 *
 * Contract (see claudeCodeToolProtocol.test.ts):
 * - No block → content is the text unchanged, toolCalls is [].
 * - Block present → content is the text with the block removed (trimmed);
 *   each call becomes { id, type: 'function', function: { name, arguments } }
 *   where `arguments` is a JSON *string* (AgentLoop / ToolExecutor JSON.parse it).
 * - Every call gets a unique, non-empty id — tool results are matched back by id.
 */
export function parseToolCalls(text: string): ParsedAssistantTurn {
  // TODO(you): implement — see the contract above and the parseToolCalls tests.
  void text;
  throw new Error('TODO: implement parseToolCalls in src/mcp/claudeCodeToolProtocol.ts');
}
