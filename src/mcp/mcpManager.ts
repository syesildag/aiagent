import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import Logger from '../utils/logger';
import { LLMMessage, LLMProvider, OllamaProvider, Tool } from './llmProviders';

// MCP Protocol Types
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

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPPrompt {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
}

interface MCPServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: {};
}

export interface MCPServer {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export interface MCPConfig {
  servers: MCPServer[];
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
    // Send initialize request
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

    // Send initialized notification
    await this.sendNotification('notifications/initialized', {});

    // List available tools, resources, and prompts
    await this.refreshCapabilities();
  }

  private async refreshCapabilities(): Promise<void> {
    try {
      // List tools
      if (this.capabilities.tools) {
        const toolsResponse = await this.sendRequest('tools/list', {});
        this.tools = toolsResponse.tools || [];
      }

      // List resources
      if (this.capabilities.resources) {
        const resourcesResponse = await this.sendRequest('resources/list', {});
        this.resources = resourcesResponse.resources || [];
      }

      // List prompts
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

      // Set timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout for method: ${method}`));
        }
      }, 30000);
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

  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }
}

export class MCPServerManager {
  private servers: MCPServer[] = [];
  private connections: Map<string, MCPServerConnection> = new Map();
  private configPath: string;
  private llmProvider: LLMProvider;
  private model: string;
  private cachedTools: Tool[] | null = null;

  constructor(
    configPath: string = './mcp-servers.json', 
    llmProvider?: LLMProvider,
    model: string = 'qwen3:4b'
  ) {
    this.configPath = configPath;
    this.llmProvider = llmProvider || new OllamaProvider();
    this.model = model;
  }

  async loadServersConfig(): Promise<void> {
    try {
      const configData = await fs.readFile(this.configPath, 'utf-8');
      const config: MCPConfig = JSON.parse(configData);
      this.servers = config.servers.filter(server => server.enabled);
      Logger.info(`Loaded ${this.servers.length} enabled MCP servers`);
    } catch (error) {
      Logger.error(`Error loading MCP servers config: ${error}`);
      throw error;
    }
  }

  async startAllServers(): Promise<void> {
    for (const server of this.servers) {
      try {
        const connection = new MCPServerConnection(server);
        await connection.start();
        this.connections.set(server.name, connection);
        Logger.info(`Started MCP server: ${server.name}`);
      } catch (error) {
        Logger.error(`Failed to start MCP server ${server.name}: ${error}`);
      }
    }

    // Wait a bit for all servers to fully initialize
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Invalidate tools cache since servers have changed
    this.invalidateToolsCache();
  }

  async stopAllServers(): Promise<void> {
    for (const [name, connection] of this.connections) {
      connection.stop();
      Logger.info(`Stopped MCP server: ${name}`);
    }
    this.connections.clear();
    
    // Invalidate tools cache since servers have changed
    this.invalidateToolsCache();
  }

  // Invalidate the tools cache
  private invalidateToolsCache(): void {
    this.cachedTools = null;
    Logger.debug('Tools cache invalidated');
  }

  // Get cached tools count for status reporting
  getCachedToolsCount(): number {
    return this.cachedTools ? this.cachedTools.length : 0;
  }

  // Check if tools cache is valid
  isToolsCacheValid(): boolean {
    return this.cachedTools !== null;
  }

  // Manually refresh tools cache
  refreshToolsCache(): Tool[] {
    return this.convertMCPToolsToLLMFormat(true);
  }

  async checkHealth(): Promise<boolean> {
    return await this.llmProvider.checkHealth();
  }

  async getAvailableModels(): Promise<string[]> {
    return await this.llmProvider.getAvailableModels();
  }

  // Convert MCP tools to LLM tool format with caching
  private convertMCPToolsToLLMFormat(forceRefresh: boolean = false): Tool[] {
    // Return cached tools if they exist and not forcing refresh
    if (!forceRefresh && this.cachedTools) {
      return this.cachedTools;
    }

    Logger.debug('Refreshing tools cache...');
    const tools: Tool[] = [];

    for (const [serverName, connection] of this.connections) {
      const mcpTools = connection.getTools();
      
      for (const mcpTool of mcpTools) {
        tools.push({
          type: 'function',
          function: {
            name: `${serverName}_${mcpTool.name}`,
            description: `[${serverName}] ${mcpTool.description}`,
            parameters: {
              type: mcpTool.inputSchema.type || 'object',
              properties: mcpTool.inputSchema.properties || {},
              required: mcpTool.inputSchema.required || []
            }
          }
        });
      }

      // Also add resource access as tools
      const resources = connection.getResources();
      if (resources.length > 0) {
        tools.push({
          type: 'function',
          function: {
            name: `${serverName}_get_resource`,
            description: `[${serverName}] Get a resource by URI`,
            parameters: {
              type: 'object',
              properties: {
                uri: {
                  type: 'string',
                  description: 'URI of the resource to retrieve',
                  enum: resources.map(r => r.uri)
                }
              },
              required: ['uri']
            }
          }
        });
      }

      // Add prompt access as tools
      const prompts = connection.getPrompts();
      for (const prompt of prompts) {
        tools.push({
          type: 'function',
          function: {
            name: `${serverName}_prompt_${prompt.name}`,
            description: `[${serverName}] ${prompt.description}`,
            parameters: {
              type: 'object',
              properties: prompt.arguments?.reduce((props, arg) => {
                props[arg.name] = {
                  type: 'string',
                  description: arg.description
                };
                return props;
              }, {} as Record<string, any>) || {},
              required: prompt.arguments?.filter(arg => arg.required).map(arg => arg.name) || []
            }
          }
        });
      }
    }

    // Cache the tools
    this.cachedTools = tools;
    
    Logger.info(`Cached ${tools.length} tools from ${this.connections.size} MCP servers`);
    return tools;
  }

  // Handle tool calls by routing them to appropriate MCP servers
  private async handleToolCall(toolCall: any): Promise<string> {
    const { name, arguments: args } = toolCall.function;
    let parsedArgs;
    
    try {
      parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
    } catch (error) {
      return `Error parsing tool arguments: ${error}`;
    }

    // Parse tool name to extract server and method
    const parts = name.split('_');
    if (parts.length < 2) {
      return `Invalid tool name format: ${name}`;
    }

    const serverName = parts[0];
    const methodParts = parts.slice(1);
    const connection = this.connections.get(serverName);

    if (!connection) {
      return `Server ${serverName} not found or not running`;
    }

    try {
      // Handle different types of calls
      if (methodParts[0] === 'get' && methodParts[1] === 'resource') {
        const result = await connection.getResource(parsedArgs.uri);
        return JSON.stringify(result, null, 2);
      } else if (methodParts[0] === 'prompt') {
        const promptName = methodParts.slice(1).join('_');
        const result = await connection.getPrompt(promptName, parsedArgs);
        return JSON.stringify(result, null, 2);
      } else {
        // Regular tool call
        const toolName = methodParts.join('_');
        const result = await connection.callTool(toolName, parsedArgs);
        return JSON.stringify(result, null, 2);
      }
    } catch (error) {
      return `Error calling ${name}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async chatWithLLM(message: string, abortSignal?: AbortSignal, customSystemPrompt?: string): Promise<string> {
    try {
      const tools = this.convertMCPToolsToLLMFormat();
      
      const defaultSystemPrompt = `You are an assistant with access to various MCP (Model Context Protocol) servers and their tools. 
Available MCP servers: ${Array.from(this.connections.keys()).join(', ')}

You can use tools to:
- Access file systems and repositories
- Query databases
- Search the web
- Read and manipulate various resources
- Execute server-specific operations

When using tools, always provide clear context about what you're doing and interpret the results for the user.`;

      const systemPrompt = customSystemPrompt ?? defaultSystemPrompt;
      
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: message
        }
      ];

      // Check for cancellation before starting
      if (abortSignal?.aborted) {
        throw new Error('Operation cancelled by user');
      }

      const chatPromise = this.llmProvider.chat({
        model: this.model,
        messages: messages,
        tools: tools,
        stream: false
      });

      // Create a promise that rejects when the abort signal is triggered
      const abortPromise = new Promise<never>((_, reject) => {
        if (abortSignal) {
          abortSignal.addEventListener('abort', () => {
            reject(new Error('Operation cancelled by user'));
          });
        }
      });

      const response = await Promise.race([chatPromise, abortPromise]);
      
      // Handle tool calls if present
      if (response.message.tool_calls && response.message.tool_calls.length > 0) {
        const toolResults: string[] = [];
        
        Logger.debug(`Executing ${response.message.tool_calls.length} tool calls...`);
        
        for (const toolCall of response.message.tool_calls) {
          if (abortSignal?.aborted) {
            throw new Error('Operation cancelled by user');
          }
          Logger.debug(`Calling tool: ${toolCall.function.name}`);
          const result = await this.handleToolCall(toolCall);
          toolResults.push(result);
        }

        // Make a follow-up request with tool results
        const followUpMessages: LLMMessage[] = [
          ...messages,
          {
            role: 'assistant',
            content: response.message.content || '',
            tool_calls: response.message.tool_calls
          },
          {
            role: 'tool',
            content: toolResults.join('\n\n---\n\n')
          }
        ];

        const followUpChatPromise = this.llmProvider.chat({
          model: this.model,
          messages: followUpMessages,
          stream: false
        });

        const followUpResponse = await Promise.race([followUpChatPromise, abortPromise]);
        return followUpResponse.message.content;
      }

      return response.message.content;
    } catch (error) {
      if (error instanceof Error && error.message === 'Operation cancelled by user') {
        throw error;
      }
      Logger.error(`Error chatting with LLM: ${error}`);
      throw error;
    }
  }

  // Get comprehensive status of all servers and their capabilities
  getServerStatus(): Record<string, any> {
    const status: Record<string, any> = {};
    
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
}