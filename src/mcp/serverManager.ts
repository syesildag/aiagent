import { promises as fs } from 'fs';
import Logger from '../utils/logger';
import { MCPSSEConnection } from './mcpSSEConnection';
import { MCPServerConnection } from './mcpServerConnection';
import type { MCPServer, MCPConfig } from './mcpManager';
import type { LLMProvider } from './llmProviders';

export interface ServerStatusEntry {
  running: boolean;
  tools: { name: string; description: string }[];
  resources: { uri: string; name: string; description?: string }[];
  prompts: { name: string; description: string }[];
}

/**
 * Manages the lifecycle of MCP server processes (start, stop, health).
 * Extracted from MCPServerManager to give it a single responsibility.
 * Does NOT own the tools cache — that belongs to ToolRegistry.
 */
export class ServerManager {
  private servers: MCPServer[] = [];
  private connections: Map<string, MCPServerConnection | MCPSSEConnection> = new Map();
  private configPath: string;
  private _initialized: boolean = false;

  constructor(configPath: string = './mcp-servers.json') {
    this.configPath = configPath;

    // Ensure cleanup on process exit
    process.on('SIGINT', () => this.cleanup());
    process.on('SIGTERM', () => this.cleanup());
    process.on('exit', () => this.cleanup());
  }

  private cleanup(): void {
    if (this.connections.size > 0) {
      Logger.info('Cleaning up MCP server processes...');
      for (const [name, connection] of this.connections) {
        connection.stop();
        Logger.debug(`Stopped MCP server: ${name}`);
      }
      this.connections.clear();
    }
  }

  async loadServersConfig(): Promise<void> {
    try {
      const configData = await fs.readFile(this.configPath, 'utf-8');
      const mcpConfig: MCPConfig = JSON.parse(configData);
      // Expand ${VAR_NAME} placeholders in server env values from process.env
      this.servers = mcpConfig.servers
        .filter(server => server.enabled)
        .map(server => ({
          ...server,
          env: server.env
            ? Object.fromEntries(
                Object.entries(server.env).map(([k, v]) => [
                  k,
                  v.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? ''),
                ]),
              )
            : server.env,
        }));
      Logger.info(`Loaded ${this.servers.length} enabled MCP servers`);
    } catch (error) {
      Logger.error(`Error loading MCP servers config: ${error}`);
      throw error;
    }
  }

  async startAllServers(): Promise<void> {
    await this.stopAllServers();

    for (const server of this.servers) {
      try {
        if (this.connections.has(server.name) && this.connections.get(server.name)?.isRunning()) {
          Logger.info(`MCP server ${server.name} is already running, skipping start`);
          continue;
        }

        const connection = server.protocol === 'sse'
          ? new MCPSSEConnection(server)
          : new MCPServerConnection(server);
        await connection.start();
        this.connections.set(server.name, connection);
        Logger.info(`Started MCP server: ${server.name}`);
      } catch (error) {
        Logger.error(`Failed to start MCP server ${server.name}: ${error}`);
      }
    }

    // Wait for all servers to fully initialize
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  async stopAllServers(): Promise<void> {
    for (const [name, connection] of this.connections) {
      connection.stop();
      Logger.info(`Stopped MCP server: ${name}`);
    }
    this.connections.clear();
  }

  /**
   * Ensure MCP servers are initialized on first use.
   * @param llmProvider Used only for health check during initialization.
   */
  async ensureInitialized(llmProvider: LLMProvider): Promise<void> {
    if (this._initialized) {
      return;
    }

    try {
      Logger.info('Initializing MCP servers...');

      await this.loadServersConfig();

      Logger.debug('Checking provider health...');
      const providerAvailable = await llmProvider.checkHealth();
      Logger.debug(`Provider health check result: ${providerAvailable}`);
      if (!providerAvailable) {
        const providerName = llmProvider.name || 'Unknown';
        Logger.error(`${providerName} provider is not available. Please check your configuration.`);
        throw new Error(`${providerName} provider is not available`);
      }

      Logger.info(`${llmProvider.name || 'LLM'} provider is available`);
      const models = await llmProvider.getAvailableModels();
      Logger.debug(`Available models: ${JSON.stringify(models)}`);

      await this.startAllServers();
      Logger.info('All MCP servers started');

      this._initialized = true;
      Logger.info('✅ MCP servers initialized successfully!');
    } catch (error) {
      Logger.error(`Failed to initialize MCP servers: ${error}`);
      throw new Error(`MCP initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getConnections(): ReadonlyMap<string, MCPServerConnection | MCPSSEConnection> {
    return this.connections;
  }

  getAvailableServerNames(): string[] {
    return Array.from(this.connections.keys());
  }

  getEnabledServerConfigs(): MCPServer[] {
    return this.servers ? [...this.servers] : [];
  }

  getServerStatus(): Record<string, ServerStatusEntry> {
    const status: Record<string, ServerStatusEntry> = {};

    for (const [serverName, connection] of this.connections) {
      status[serverName] = {
        running: connection.isRunning(),
        tools: connection.getTools().map(tool => ({
          name: tool.name,
          description: tool.description
        })),
        resources: connection.getResources().map(resource => ({
          uri: resource.uri,
          name: resource.name,
          description: resource.description
        })),
        prompts: connection.getPrompts().map(prompt => ({
          name: prompt.name,
          description: prompt.description
        }))
      };
    }

    return status;
  }

  isInitialized(): boolean {
    return this._initialized;
  }
}
