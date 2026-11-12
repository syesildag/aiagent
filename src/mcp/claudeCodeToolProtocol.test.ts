import {
  buildToolProtocolPrompt,
  serializeToolCalls,
  parseToolCalls,
  TOOL_CALLS_OPEN_TAG,
  TOOL_CALLS_CLOSE_TAG,
} from './claudeCodeToolProtocol';
import type { Tool, ToolCall } from './llmProviders';

const weatherTool: Tool = {
  type: 'function',
  serverName: 'weather',
  function: {
    name: 'weather_get_forecast',
    description: 'Get the weather forecast for a city',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
};

const timeTool: Tool = {
  type: 'function',
  serverName: 'time',
  function: {
    name: 'time_now',
    description: 'Current time',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

describe('buildToolProtocolPrompt', () => {
  it('lists every tool with its name, description and JSON schema', () => {
    const prompt = buildToolProtocolPrompt([weatherTool, timeTool], 'auto');

    expect(prompt).toContain('weather_get_forecast');
    expect(prompt).toContain('Get the weather forecast for a city');
    expect(prompt).toContain(JSON.stringify(weatherTool.function.parameters));
    expect(prompt).toContain('time_now');
  });

  it('documents the tool_calls block format the parser expects', () => {
    const prompt = buildToolProtocolPrompt([weatherTool], 'auto');

    expect(prompt).toContain(TOOL_CALLS_OPEN_TAG);
    expect(prompt).toContain(TOOL_CALLS_CLOSE_TAG);
  });

  it('makes a tool call mandatory when toolChoice is required', () => {
    const required = buildToolProtocolPrompt([weatherTool], 'required');
    const auto = buildToolProtocolPrompt([weatherTool], 'auto');

    expect(required).toMatch(/must call at least one tool/i);
    expect(auto).not.toMatch(/must call at least one tool/i);
  });
});

describe('serializeToolCalls', () => {
  it('renders past calls as a tool_calls block with parsed arguments', () => {
    const calls: ToolCall[] = [
      { id: 'c1', type: 'function', function: { name: 'weather_get_forecast', arguments: '{"city":"Paris"}' } },
    ];

    const block = serializeToolCalls(calls);

    expect(block.startsWith(TOOL_CALLS_OPEN_TAG)).toBe(true);
    expect(block.trimEnd().endsWith(TOOL_CALLS_CLOSE_TAG)).toBe(true);
    const json = block.slice(TOOL_CALLS_OPEN_TAG.length, block.lastIndexOf(TOOL_CALLS_CLOSE_TAG));
    expect(JSON.parse(json)).toEqual([{ name: 'weather_get_forecast', arguments: { city: 'Paris' } }]);
  });

  it('keeps arguments as a raw string when they are not valid JSON', () => {
    const calls: ToolCall[] = [
      { id: 'c1', type: 'function', function: { name: 'time_now', arguments: 'not json' } },
    ];

    const block = serializeToolCalls(calls);
    const json = block.slice(TOOL_CALLS_OPEN_TAG.length, block.lastIndexOf(TOOL_CALLS_CLOSE_TAG));

    expect(JSON.parse(json)).toEqual([{ name: 'time_now', arguments: 'not json' }]);
  });
});

// ── Spec for parseToolCalls (implemented by you) ─────────────────────────────
// These tests define the contract the provider relies on. How lenient the parser
// is beyond them (code fences, malformed JSON, unknown tool names) is your call.
describe('parseToolCalls', () => {
  it('returns the text unchanged and no tool calls when there is no block', () => {
    const result = parseToolCalls('The weather in Paris is sunny.');

    expect(result.toolCalls).toEqual([]);
    expect(result.content).toBe('The weather in Paris is sunny.');
  });

  it('extracts a call, serializes its arguments as JSON, and strips the block from content', () => {
    const text = `Let me check.\n${TOOL_CALLS_OPEN_TAG}\n[{"name":"weather_get_forecast","arguments":{"city":"Paris"}}]\n${TOOL_CALLS_CLOSE_TAG}`;

    const result = parseToolCalls(text);

    expect(result.content).toBe('Let me check.');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].type).toBe('function');
    expect(result.toolCalls[0].function.name).toBe('weather_get_forecast');
    expect(JSON.parse(result.toolCalls[0].function.arguments)).toEqual({ city: 'Paris' });
  });

  it('gives every call in a batch a unique, non-empty id', () => {
    const text = `${TOOL_CALLS_OPEN_TAG}[{"name":"time_now","arguments":{}},{"name":"weather_get_forecast","arguments":{"city":"Oslo"}}]${TOOL_CALLS_CLOSE_TAG}`;

    const result = parseToolCalls(text);

    expect(result.toolCalls).toHaveLength(2);
    const ids = result.toolCalls.map(c => c.id);
    expect(ids.every(id => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(2);
  });

  it('accepts a block whose JSON is wrapped in a code fence', () => {
    const text = `${TOOL_CALLS_OPEN_TAG}\n\`\`\`json\n[{"name":"time_now","arguments":{}}]\n\`\`\`\n${TOOL_CALLS_CLOSE_TAG}`;

    const result = parseToolCalls(text);

    expect(result.toolCalls.map(c => c.function.name)).toEqual(['time_now']);
  });

  it('leaves a malformed block as written and runs nothing', () => {
    const text = `Checking.\n${TOOL_CALLS_OPEN_TAG}[{"name":"time_now",${TOOL_CALLS_CLOSE_TAG}`;

    const result = parseToolCalls(text);

    expect(result.toolCalls).toEqual([]);
    expect(result.content).toBe(text);
  });

  it('leaves a block cut off before its close tag as written and runs nothing', () => {
    const text = `${TOOL_CALLS_OPEN_TAG}[{"name":"time_now","arguments":{}}]`;

    const result = parseToolCalls(text);

    expect(result.toolCalls).toEqual([]);
    expect(result.content).toBe(text);
  });

  it('passes raw-string arguments through unchanged, matching serializeToolCalls', () => {
    const calls: ToolCall[] = [
      { id: 'c1', type: 'function', function: { name: 'time_now', arguments: 'not json' } },
    ];

    const result = parseToolCalls(serializeToolCalls(calls));

    expect(result.toolCalls[0].function.arguments).toBe('not json');
  });
});
