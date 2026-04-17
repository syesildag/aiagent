import { ToolExecutor } from '../toolExecutor';
import type { ServerManager } from '../serverManager';

function makeServerManager(): ServerManager {
  return { getConnections: () => new Map() } as any;
}

describe('ToolExecutor', () => {
  it('identifies dangerous tool names by pattern', () => {
    const executor = new ToolExecutor(makeServerManager());
    expect(executor.isToolDangerous('memory_delete_memory')).toBe(true);
    expect(executor.isToolDangerous('weather_get_current')).toBe(false);
  });

  it('identifies create/update/run as dangerous', () => {
    const executor = new ToolExecutor(makeServerManager());
    expect(executor.isToolDangerous('jobs_create_job')).toBe(true);
    expect(executor.isToolDangerous('jobs_update_job')).toBe(true);
    expect(executor.isToolDangerous('jobs_run_job')).toBe(true);
  });

  it('returns error string for missing function property', async () => {
    const executor = new ToolExecutor(makeServerManager());
    const result = await executor.execute({ function: null as any }, null);
    expect(result).toContain('Error');
  });

  it('returns error string for missing function name', async () => {
    const executor = new ToolExecutor(makeServerManager());
    const result = await executor.execute({ function: { name: '', arguments: '{}' } }, null);
    expect(result).toContain('Error');
  });

  it('returns error when server not found', async () => {
    const executor = new ToolExecutor(makeServerManager());
    const result = await executor.execute(
      { function: { name: 'unknown_tool', arguments: '{}' } },
      null,
    );
    expect(result).toContain('not found');
  });

  it('returns error for task tool without runner', async () => {
    const executor = new ToolExecutor(makeServerManager());
    const result = await executor.execute(
      { function: { name: 'task', arguments: JSON.stringify({ subagent_type: 'foo', prompt: 'bar' }) } },
      null,
    );
    expect(result).toContain('not initialized');
  });

  it('caps total serialized result to 10,000 chars when many fields are present', () => {
    // 50 fields × 300 chars each = 15,000+ chars when serialized
    const largeResult = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [`field${i}`, 'a'.repeat(300)])
    );
    const serialized = JSON.stringify(largeResult, null, 2);
    expect(serialized.length).toBeGreaterThan(10_000);

    const MAX = 10_000;
    const capped = serialized.length > MAX
      ? serialized.slice(0, MAX) + '\n...[result truncated]'
      : serialized;

    expect(capped.length).toBeLessThanOrEqual(MAX + '\n...[result truncated]'.length);
    expect(capped).toContain('[result truncated]');
  });
});
