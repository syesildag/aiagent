import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs/promises';

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

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

interface MCPPrompt {
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

// Application Types
interface MCPServer {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

interface MCPConfig {
  servers: MCPServer[];
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  tools?: Tool[];
  stream?: boolean;
}

interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

interface OllamaChatResponse {
  message: {
    role: string;
    content: string;
    tool_calls?: ToolCall[];
  };
  done: boolean;
}

class MCPServerConnection extends EventEmitter {
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
                console.error(`[${this.server.name}] Failed to parse JSON:`, line);
              }
            }
          }
        });

        this.process.stderr.on('data', (data) => {
          console.error(`[${this.server.name}] stderr:`, data.toString());
        });

        this.process.on('error', (error) => {
          console.error(`[${this.server.name}] Process error:`, error);
          reject(error);
        });

        this.process.on('exit', (code) => {
          console.log(`[${this.server.name}] Process exited with code ${code}`);
          this.emit('exit', code);
        });

        // Initialize the MCP connection
        setTimeout(async () => {
          try {
            await this.initialize();
            console.log(`[${this.server.name}] Initialized successfully`);
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
        name: 'mcp-ollama-manager',
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

      console.log(`[${this.server.name}] Capabilities refreshed:`, {
        tools: this.tools.length,
        resources: this.resources.length,
        prompts: this.prompts.length
      });
    } catch (error) {
      console.error(`[${this.server.name}] Error refreshing capabilities:`, error);
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
      console.error(`[${this.server.name}] Tool call error:`, error);
      throw error;
    }
  }

  async getResource(uri: string): Promise<any> {
    try {
      const response = await this.sendRequest('resources/read', { uri });
      return response;
    } catch (error) {
      console.error(`[${this.server.name}] Resource read error:`, error);
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
      console.error(`[${this.server.name}] Prompt get error:`, error);
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

class MCPServerManager {
  private servers: MCPServer[] = [];
  private connections: Map<string, MCPServerConnection> = new Map();
  private configPath: string;
  private ollamaBaseUrl: string;
  private model: string;

  constructor(configPath: string = './mcp-servers.json', ollamaBaseUrl: string = 'http://localhost:11434', model: string = 'llama3.1:8b') {
    this.configPath = configPath;
    this.ollamaBaseUrl = ollamaBaseUrl;
    this.model = model;
  }

  async loadServersConfig(): Promise<void> {
    try {
      const configData = await fs.readFile(this.configPath, 'utf-8');
      const config: MCPConfig = JSON.parse(configData);
      this.servers = config.servers.filter(server => server.enabled);
      console.log(`Loaded ${this.servers.length} enabled MCP servers`);
    } catch (error) {
      console.error('Error loading MCP servers config:', error);
      throw error;
    }
  }

  async startAllServers(): Promise<void> {
    for (const server of this.servers) {
      try {
        const connection = new MCPServerConnection(server);
        await connection.start();
        this.connections.set(server.name, connection);
        console.log(`Started MCP server: ${server.name}`);
      } catch (error) {
        console.error(`Failed to start MCP server ${server.name}:`, error);
      }
    }

    // Wait a bit for all servers to fully initialize
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  async stopAllServers(): Promise<void> {
    for (const [name, connection] of this.connections) {
      connection.stop();
      console.log(`Stopped MCP server: ${name}`);
    }
    this.connections.clear();
  }

  async checkOllamaHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaBaseUrl}/api/tags`);
      return response.ok;
    } catch (error) {
      console.error('Ollama health check failed:', error);
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.ollamaBaseUrl}/api/tags`);
      const data = await response.json() as { models: Array<{ name: string }> };
      return data.models.map(model => model.name);
    } catch (error) {
      console.error('Error getting available models:', error);
      return [];
    }
  }

  // Convert MCP tools to Ollama tool format
  private convertMCPToolsToOllamaFormat(): Tool[] {
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

    return tools;
  }

  // Handle tool calls by routing them to appropriate MCP servers
  private async handleToolCall(toolCall: ToolCall): Promise<string> {
    const { name, arguments: args } = toolCall.function;
    const parsedArgs = JSON.parse(args);

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

  async chatWithOllama(message: string): Promise<string> {
    try {
      const tools = this.convertMCPToolsToOllamaFormat();
      
      console.log(`Available tools from MCP servers: ${tools.length}`);
      tools.forEach(tool => {
        console.log(`- ${tool.function.name}: ${tool.function.description}`);
      });

      const messages: OllamaMessage[] = [
        {
          role: 'system',
          content: `You are an assistant with access to various MCP (Model Context Protocol) servers and their tools. 
Available MCP servers: ${Array.from(this.connections.keys()).join(', ')}

You can use tools to:
- Access file systems and repositories
- Query databases
- Search the web
- Read and manipulate various resources
- Execute server-specific operations

When using tools, always provide clear context about what you're doing and interpret the results for the user.`
        },
        {
          role: 'user',
          content: message
        }
      ];

      const requestBody: OllamaChatRequest = {
        model: this.model,
        messages: messages,
        tools: tools,
        stream: false
      };

      const response = await fetch(`${this.ollamaBaseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as OllamaChatResponse;
      
      // Handle tool calls if present
      if (data.message.tool_calls && data.message.tool_calls.length > 0) {
        const toolResults: string[] = [];
        
        console.log(`Executing ${data.message.tool_calls.length} tool calls...`);
        
        for (const toolCall of data.message.tool_calls) {
          console.log(`Calling tool: ${toolCall.function.name}`);
          const result = await this.handleToolCall(toolCall);
          toolResults.push(result);
        }

        // Make a follow-up request with tool results
        const followUpMessages: OllamaMessage[] = [
          ...messages,
          {
            role: 'assistant',
            content: data.message.content || '',
            tool_calls: data.message.tool_calls
          },
          {
            role: 'tool',
            content: toolResults.join('\n\n---\n\n')
          }
        ];

        const followUpResponse = await fetch(`${this.ollamaBaseUrl}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            messages: followUpMessages,
            stream: false
          })
        });

        const followUpData = await followUpResponse.json() as OllamaChatResponse;
        return followUpData.message.content;
      }

      return data.message.content;
    } catch (error) {
      console.error('Error chatting with Ollama:', error);
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

// Example usage and CLI interface
async function main() {
  const manager = new MCPServerManager();

  try {
    // Load MCP server configuration
    await manager.loadServersConfig();

    // Check if Ollama is available
    const ollamaAvailable = await manager.checkOllamaHealth();
    if (!ollamaAvailable) {
      console.error('Ollama is not available. Please make sure it is running.');
      process.exit(1);
    }

    console.log('Ollama is available');
    const models = await manager.getAvailableModels();
    console.log('Available models:', models);

    // Start all MCP servers
    await manager.startAllServers();
    console.log('All MCP servers started');

    // Show server status and capabilities
    const status = manager.getServerStatus();
    console.log('\nMCP Server Status and Capabilities:');
    console.log(JSON.stringify(status, null, 2));

    // Example interactions with Ollama using MCP tools
    console.log('\n--- Chatting with Ollama using MCP tools ---');
    
    const queries = [
      'What tools and capabilities are available to me?',
      'Can you list the current directory contents?',
      'What resources can you access?'
    ];

    for (const query of queries) {
      console.log(`\nUser: ${query}`);
      try {
        const response = await manager.chatWithOllama(query);
        console.log(`Assistant: ${response}`);
      } catch (error) {
        console.error(`Error: ${error}`);
      }
    }

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down...');
      await manager.stopAllServers();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\nShutting down...');
      await manager.stopAllServers();
      process.exit(0);
    });

  } catch (error) {
    console.error('Error in main:', error);
    process.exit(1);
  }
}

// Export the class for use in other modules
export { MCPConfig, MCPServer, MCPServerConnection, MCPServerManager };

// Run the main function if this file is executed directly
if (require.main === module) {
  main();
}