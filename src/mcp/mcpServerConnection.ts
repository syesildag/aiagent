import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import Logger from '../utils/logger';
import type { MCPServer, MCPTool, MCPResource, MCPPrompt } from './mcpManager';

// MCP JSON-RPC 2.0 wire types (private to stdio transport)
interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

interface MCPServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: {};
}

export class MCPServerConnection extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 1;
  private pendingRequests = new Map<string | number, { resolve: Function; reject: Function }>();
  private capabilities: MCPServerCapabilities = {};
  private tools: MCPTool[] = [];
  private resources: MCPResource[] = [];
  private prompts: MCPPrompt[] = [];

  constructor(private server: MCPServer) {
    super();
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        if (!this.server.command) {
          reject(new Error(`[${this.server.name}] command is required for stdio protocol`));
          return;
        }
        this.process = spawn(this.server.command, this.server.args || [], {
          env: { ...process.env, ...this.server.env },
          stdio: ['pipe', 'pipe', 'pipe']
        });

        if (!this.process.stdin || !this.process.stdout || !this.process.stderr) {
          reject(new Error('Failed to create stdio streams'));
          return;
        }

        let buffer = '';
        this.process.stdout.on('data', (data) => {
          buffer += data.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim()) {
              try {
                const message = JSON.parse(line) as MCPResponse;
                this.handleResponse(message);
              } catch (error) {
                Logger.error(`[${this.server.name}] Failed to parse JSON: ${line}`);
              }
            }
          }
        });

        this.process.stderr.on('data', (data) => {
          Logger.error(`[${this.server.name}] stderr: ${data.toString()}`);
        });

        this.process.on('error', (error) => {
          Logger.error(`[${this.server.name}] Process error: ${error}`);
          reject(error);
        });

        this.process.on('exit', (code) => {
          Logger.info(`[${this.server.name}] Process exited with code ${code}`);
          this.emit('exit', code);
        });

        // Initialize the MCP connection
        setTimeout(async () => {
          try {
            await this.initialize();
            Logger.info(`[${this.server.name}] Initialized successfully`);
            resolve();
          } catch (error) {
            reject(error);
          }
        }, 1000);

      } catch (error) {
        reject(error);
      }
    });
  }

  private async initialize(): Promise<void> {
    const initResponse = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      },
      clientInfo: {
        name: 'mcp-ai-agent',
        version: '1.0.0'
      }
    });

    this.capabilities = initResponse.capabilities || {};

    await this.sendNotification('notifications/initialized', {});
    await this.refreshCapabilities();
  }

  private async refreshCapabilities(): Promise<void> {
    try {
      if (this.capabilities.tools) {
        const toolsResponse = await this.sendRequest('tools/list', {});
        this.tools = toolsResponse.tools || [];
      }

      if (this.capabilities.resources) {
        const resourcesResponse = await this.sendRequest('resources/list', {});
        this.resources = resourcesResponse.resources || [];
      }

      if (this.capabilities.prompts) {
        const promptsResponse = await this.sendRequest('prompts/list', {});
        this.prompts = promptsResponse.prompts || [];
      }

      Logger.info(`[${this.server.name}] Capabilities refreshed: tools=${this.tools.length}, resources=${this.resources.length}, prompts=${this.prompts.length}`);
    } catch (error) {
      Logger.error(`[${this.server.name}] Error refreshing capabilities: ${error}`);
    }
  }

  private sendRequest(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });

      if (this.process && this.process.stdin) {
        this.process.stdin.write(JSON.stringify(request) + '\n');
      } else {
        reject(new Error('Process not available'));
      }

      // Tool calls can be slow (DB + embeddings), so they get more time
      const timeoutMs = method === 'tools/call' ? 120000 : 30000;
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout for method: ${method}`));
        }
      }, timeoutMs);
    });
  }

  private sendNotification(method: string, params?: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const notification = {
        jsonrpc: '2.0' as const,
        method,
        params
      };

      if (this.process && this.process.stdin) {
        this.process.stdin.write(JSON.stringify(notification) + '\n');
        resolve();
      } else {
        reject(new Error('Process not available'));
      }
    });
  }

  private handleResponse(response: MCPResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      this.pendingRequests.delete(response.id);
      if (response.error) {
        pending.reject(new Error(`MCP Error: ${response.error.message}`));
      } else {
        pending.resolve(response.result);
      }
    }
  }

  async callTool(name: string, arguments_: any): Promise<any> {
    try {
      const response = await this.sendRequest('tools/call', {
        name,
        arguments: arguments_
      });
      return response;
    } catch (error) {
      Logger.error(`[${this.server.name}] Tool call error: ${error}`);
      throw error;
    }
  }

  async getResource(uri: string): Promise<any> {
    try {
      const response = await this.sendRequest('resources/read', { uri });
      return response;
    } catch (error) {
      Logger.error(`[${this.server.name}] Resource read error: ${error}`);
      throw error;
    }
  }

  async getPrompt(name: string, arguments_?: any): Promise<any> {
    try {
      const response = await this.sendRequest('prompts/get', {
        name,
        arguments: arguments_
      });
      return response;
    } catch (error) {
      Logger.error(`[${this.server.name}] Prompt get error: ${error}`);
      throw error;
    }
  }

  getTools(): MCPTool[] {
    return this.tools;
  }

  getResources(): MCPResource[] {
    return this.resources;
  }

  getPrompts(): MCPPrompt[] {
    return this.prompts;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.process || this.process.killed) {
        this.process = null;
        resolve();
        return;
      }
      this.process.once('exit', () => {
        this.process = null;
        resolve();
      });
      this.process.kill('SIGTERM');
      setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL');
        }
      }, 5000);
    });
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }
}
