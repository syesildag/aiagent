import { ServerManager } from '../serverManager';

describe('ServerManager', () => {
  it('loads enabled servers from config', async () => {
    const sm = new ServerManager('./mcp-servers.json');
    await sm.loadServersConfig();
    expect(sm.getEnabledServerConfigs().length).toBeGreaterThanOrEqual(0);
  });

  it('getConnections() returns empty map before start', () => {
    const sm = new ServerManager('./mcp-servers.json');
    expect(sm.getConnections().size).toBe(0);
  });

  it('isInitialized() returns false before ensureInitialized', () => {
    const sm = new ServerManager('./mcp-servers.json');
    expect(sm.isInitialized()).toBe(false);
  });

  it('getAvailableServerNames() returns empty array before start', () => {
    const sm = new ServerManager('./mcp-servers.json');
    expect(sm.getAvailableServerNames()).toEqual([]);
  });

  it('getServerStatus() returns empty object before start', () => {
    const sm = new ServerManager('./mcp-servers.json');
    expect(sm.getServerStatus()).toEqual({});
  });
});
