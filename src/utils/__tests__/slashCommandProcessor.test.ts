import { processSlashCommand } from '../slashCommandProcessor';
import { slashCommandRegistry } from '../slashCommandRegistry';

describe('processSlashCommand', () => {
  it('returns null for plain text', () => {
    expect(processSlashCommand('hello world', null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(processSlashCommand('', null)).toBeNull();
  });

  it('returns kind:direct for mcp-status when manager is null', () => {
    // registry must have mcp-status registered — initialize first
    slashCommandRegistry.initialize();
    const result = processSlashCommand('/mcp-status', null);
    expect(result?.kind).toBe('direct');
    expect((result as any).response).toContain('not initialised');
  });

  it('returns kind:direct for mcp-status when manager is provided', () => {
    slashCommandRegistry.initialize();
    const mockManager = {
      renderStatusMarkdown: () => '# MCP Status\n\nAll good.',
    } as any;
    const result = processSlashCommand('/mcp-status', mockManager);
    expect(result?.kind).toBe('direct');
    expect((result as any).response).toContain('MCP Status');
  });
});
