import { ToolExecutor } from './toolExecutor';
import type { ServerManager } from './serverManager';

type Call = { tool: string; args: Record<string, unknown> };

function makeExecutor() {
  const calls: Call[] = [];
  const makeConnection = (tools: string[]) => ({
    getTools: () => tools.map(name => ({ name, annotations: { readOnlyHint: true } })),
    callTool: jest.fn(async (tool: string, args: Record<string, unknown>) => {
      calls.push({ tool, args });
      return { content: [{ type: 'text', text: 'ok' }] };
    }),
    getResource: jest.fn(async () => ({ contents: [] })),
  });
  const connections = new Map<string, ReturnType<typeof makeConnection>>([
    ['memory', makeConnection(['msearch'])],
    ['weather', makeConnection(['get_forecast'])],
  ]);
  const serverManager = { getConnections: () => connections } as unknown as ServerManager;
  return { executor: new ToolExecutor(serverManager), calls, connections };
}

const toolCall = (name: string, args: Record<string, unknown>) => ({ function: { name, arguments: JSON.stringify(args) } });

describe('ToolExecutor identity handling', () => {
  it('injects the trusted identity into per-user servers, overriding spoofed values', async () => {
    const { executor, calls } = makeExecutor();
    await executor.execute(
      toolCall('memory_msearch', { query: 'x', _userLogin: 'bob', _isAdmin: true }),
      null, undefined, { userLogin: 'alice', isAdmin: false },
    );
    expect(calls[0].args).toEqual({ query: 'x', _userLogin: 'alice', _isAdmin: false });
  });

  it('injects a null identity when no user context is given (never trusts the LLM)', async () => {
    const { executor, calls } = makeExecutor();
    await executor.execute(toolCall('memory_msearch', { query: 'x', _isAdmin: true }), null);
    expect(calls[0].args).toEqual({ query: 'x', _userLogin: null, _isAdmin: false });
  });

  it('strips identity fields from calls to other servers', async () => {
    const { executor, calls } = makeExecutor();
    await executor.execute(
      toolCall('weather_get_forecast', { city: 'Paris', _isAdmin: true }),
      null, undefined, { userLogin: 'alice', isAdmin: false },
    );
    expect(calls[0].args).toEqual({ city: 'Paris' });
  });

  it('denies resource reads on per-user servers to non-admins', async () => {
    const { executor, connections } = makeExecutor();
    const result = await executor.execute(
      toolCall('memory_get_resource', { uri: 'memory:///identity' }),
      null, undefined, { userLogin: 'alice', isAdmin: false },
    );
    expect(result).toMatch(/only available to administrators/);
    expect(connections.get('memory')!.getResource).not.toHaveBeenCalled();
  });

  it('allows resource reads on per-user servers to admins', async () => {
    const { executor, connections } = makeExecutor();
    await executor.execute(
      toolCall('memory_get_resource', { uri: 'memory://types' }),
      null, undefined, { userLogin: 'root', isAdmin: true },
    );
    expect(connections.get('memory')!.getResource).toHaveBeenCalledWith('memory://types');
  });

  it('passes the approval callback and identity to sub-agents', async () => {
    const { executor } = makeExecutor();
    const runner = jest.fn(async () => 'done');
    const approval = jest.fn(async () => true);
    await executor.execute(
      toolCall('task', { subagent_type: 'researcher', prompt: 'look it up' }),
      runner, approval, { userLogin: 'alice', isAdmin: false },
    );
    expect(runner).toHaveBeenCalledWith('researcher', 'look it up', undefined, {
      approvalCallback: approval, userLogin: 'alice', isAdmin: false,
    });
  });
});
