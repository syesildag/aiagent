import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import { Ollama } from 'ollama';
import * as readline from 'readline';
import "dotenv/config";

// LLM Provider Types
interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
}

interface LLMChatRequest {
  model: string;
  messages: LLMMessage[];
  tools?: Tool[];
  stream?: boolean;
}

interface LLMChatResponse {
  message: {
    role: string;
    content: string;
    tool_calls?: ToolCall[];
  };
  done?: boolean;
}

interface LLMProvider {
  name: string;
  checkHealth(): Promise<boolean>;
  getAvailableModels(): Promise<string[]>;
  chat(request: LLMChatRequest, abortSignal?: AbortSignal): Promise<LLMChatResponse>;
}

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

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, any>;
      required: string[];
    };
  };
}

// LLM Provider Implementations
class OllamaProvider implements LLMProvider {
  name = 'Ollama';
  private ollama: Ollama;

  constructor(baseUrl: string = 'http://localhost:11434') {
    this.ollama = new Ollama({ host: baseUrl });
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.ollama.list();
      return true;
    } catch (error) {
      console.error('Ollama health check failed:', error);
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await this.ollama.list();
      return response.models.map(model => model.name);
    } catch (error) {
      console.error('Error getting available models:', error);
      return [];
    }
  }

  async chat(request: LLMChatRequest, abortSignal?: AbortSignal): Promise<LLMChatResponse> {
    // Convert LLMMessage to Ollama Message format
    const ollamaMessages = request.messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      tool_calls: msg.tool_calls?.map(tc => ({
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'string' 
            ? JSON.parse(tc.function.arguments) 
            : tc.function.arguments
        }
      }))
    }));

    const chatPromise = this.ollama.chat({
      model: request.model,
      messages: ollamaMessages,
      tools: request.tools,
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
    
    // Convert Ollama response back to LLMChatResponse format
    const convertedToolCalls = response.message.tool_calls?.map((tc: any, index: number) => ({
      id: `call_${index}`,
      type: 'function' as const,
      function: {
        name: tc.function.name,
        arguments: typeof tc.function.arguments === 'string' 
          ? tc.function.arguments 
          : JSON.stringify(tc.function.arguments)
      }
    }));

    return {
      message: {
        role: response.message.role,
        content: response.message.content,
        tool_calls: convertedToolCalls
      },
      done: response.done
    };
  }
}

class GitHubCopilotProvider implements LLMProvider {
  name = 'GitHub Copilot';
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey: string, baseUrl: string = 'https://api.githubcopilot.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      return response.ok;
    } catch (error) {
      console.error('GitHub Copilot health check failed:', error);
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.data?.map((model: any) => model.id) || [];
    } catch (error) {
      console.error('Error getting GitHub Copilot models:', error);
      return [];
    }
  }

  async chat(request: LLMChatRequest, abortSignal?: AbortSignal): Promise<LLMChatResponse> {
    const requestBody = {
      model: request.model,
      messages: request.messages,
      tools: request.tools,
      stream: request.stream || false
    };

    const chatPromise = fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: abortSignal
    });

    const response = await chatPromise;
    
    if (!response.ok) {
      throw new Error(`GitHub Copilot API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    
    if (!choice) {
      throw new Error('No response from GitHub Copilot');
    }

    return {
      message: {
        role: choice.message.role,
        content: choice.message.content || '',
        tool_calls: choice.message.tool_calls
      },
      done: true
    };
  }
}

class OpenAIProvider implements LLMProvider {
  name = 'OpenAI';
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey: string, baseUrl: string = 'https://api.openai.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      return response.ok;
    } catch (error) {
      console.error('OpenAI health check failed:', error);
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.data?.map((model: any) => model.id) || [];
    } catch (error) {
      console.error('Error getting OpenAI models:', error);
      return [];
    }
  }

  async chat(request: LLMChatRequest, abortSignal?: AbortSignal): Promise<LLMChatResponse> {
    const requestBody = {
      model: request.model,
      messages: request.messages,
      tools: request.tools,
      stream: request.stream || false
    };

    const chatPromise = fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: abortSignal
    });

    const response = await chatPromise;
    
    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    
    if (!choice) {
      throw new Error('No response from OpenAI');
    }

    return {
      message: {
        role: choice.message.role,
        content: choice.message.content || '',
        tool_calls: choice.message.tool_calls
      },
      done: true
    };
  }
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
    
    // Invalidate tools cache since servers have changed
    this.invalidateToolsCache();
  }

  async stopAllServers(): Promise<void> {
    for (const [name, connection] of this.connections) {
      connection.stop();
      console.log(`Stopped MCP server: ${name}`);
    }
    this.connections.clear();
    
    // Invalidate tools cache since servers have changed
    this.invalidateToolsCache();
  }

  // Invalidate the tools cache
  private invalidateToolsCache(): void {
    this.cachedTools = null;
    console.log('Tools cache invalidated');
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

    console.log('Refreshing tools cache...');
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
    
    console.log(`Cached ${tools.length} tools from ${this.connections.size} MCP servers`);
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

  async chatWithLLM(message: string, abortSignal?: AbortSignal): Promise<string> {
    try {
      const tools = this.convertMCPToolsToLLMFormat();
      
      const messages: LLMMessage[] = [
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
        
        console.log(`Executing ${response.message.tool_calls.length} tool calls...`);
        
        for (const toolCall of response.message.tool_calls) {
          if (abortSignal?.aborted) {
            throw new Error('Operation cancelled by user');
          }
          console.log(`Calling tool: ${toolCall.function.name}`);
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
  // Demo different LLM providers
  console.log('=== LLM Provider Options ===');
  console.log('1. Ollama (local) - Default');
  console.log('2. GitHub Copilot (requires API key)');
  console.log('3. OpenAI (requires API key)');
  console.log('');

  // For demo purposes, using Ollama. In production, you could:
  // - Read from environment variables
  // - Use command line arguments
  // - Prompt user for selection
  
  let llmProvider: LLMProvider;
  const providerType = process.env.LLM_PROVIDER || 'ollama';
  
  switch (providerType.toLowerCase()) {
    case 'github':
    case 'copilot':
      const githubApiKey = process.env.GITHUB_TOKEN;
      if (!githubApiKey) {
        console.error('GitHub Copilot requires GITHUB_TOKEN environment variable');
        process.exit(1);
      }
      llmProvider = new GitHubCopilotProvider(githubApiKey);
      console.log('Using GitHub Copilot provider');
      break;
    
    case 'openai':
      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        console.error('OpenAI requires OPENAI_API_KEY environment variable');
        process.exit(1);
      }
      llmProvider = new OpenAIProvider(openaiApiKey);
      console.log('Using OpenAI provider');
      break;
    
    case 'ollama':
    default:
      llmProvider = new OllamaProvider();
      console.log('Using Ollama provider (local)');
      break;
  }

  const manager = new MCPServerManager(process.env.MCP_SERVERS_PATH, llmProvider);

  try {
    // Load MCP server configuration
    await manager.loadServersConfig();

    // Check if the selected LLM provider is available
    const providerAvailable = await manager.checkHealth();
    if (!providerAvailable) {
      console.error(`${providerType} provider is not available. Please check your configuration.`);
      process.exit(1);
    }

    console.log(`${providerType} provider is available`);
    const models = await manager.getAvailableModels();
    console.log('Available models:', models);

    // Start all MCP servers
    await manager.startAllServers();
    console.log('All MCP servers started');

    // Show server status and capabilities
    const status = manager.getServerStatus();
    console.log('\nMCP Server Status and Capabilities:');
    console.log(JSON.stringify(status, null, 2));

    // Example interactions with the LLM using MCP tools
    console.log(`\n--- Interactive Chat with ${providerType.toUpperCase()} using MCP tools ---`);
    console.log('Type your questions or commands. Special commands:');
    console.log('  - "help" - Show available commands');
    console.log('  - "status" - Show MCP server status');
    console.log('  - "refresh" - Refresh tools cache');
    console.log('  - "cancel" - Cancel current operation');
    console.log('  - "clear" - Clear the screen');
    console.log('  - "exit" or "quit" - Exit the program');
    console.log('\nLLM Provider Configuration:');
    console.log('  - Default: Ollama (local)');
    console.log('  - Set LLM_PROVIDER=github and GITHUB_TOKEN=<token> for GitHub Copilot');
    console.log('  - Set LLM_PROVIDER=openai and OPENAI_API_KEY=<key> for OpenAI');
    console.log('\nDuring processing, you can:');
    console.log('  - Type "cancel" to cancel the current operation');
    console.log('  - Press Ctrl+C to cancel the current operation');
    console.log('\nSuggested queries to try:');
    console.log('  - "What tools and capabilities are available to me?"');
    console.log('  - "Can you list the current directory contents?"');
    console.log('  - "What resources can you access?"');
    console.log('');
    
    // Create readline interface for interactive input
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> '
    });

    // Interactive chat loop
    let currentAbortController: AbortController | null = null;
    
    const chatLoop = () => {
      rl.prompt();
      
      rl.on('line', async (input: string) => {
        const query = input.trim();
        
        if (query.toLowerCase() === 'exit' || query.toLowerCase() === 'quit') {
          // Cancel any ongoing operation
          if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
          }
          console.log('\nGoodbye!');
          rl.close();
          await manager.stopAllServers();
          process.exit(0);
        }
        
        if (query.toLowerCase() === 'cancel') {
          if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
            console.log('Operation cancelled.\n');
          } else {
            console.log('No operation to cancel.\n');
          }
          rl.prompt();
          return;
        }
        
        if (query.toLowerCase() === 'help') {
          console.log('\nAvailable commands:');
          console.log('  - help: Show this help message');
          console.log('  - status: Show MCP server status and capabilities');
          console.log('  - refresh: Refresh tools cache from MCP servers');
          console.log('  - clear: Clear the screen');
          console.log('  - cancel: Cancel current operation');
          console.log('  - exit/quit: Exit the program');
          console.log('\nOr ask any question to chat with the AI assistant using MCP tools.');
          console.log('While processing, you can press Ctrl+C to cancel the current operation.\n');
          rl.prompt();
          return;
        }
        
        if (query.toLowerCase() === 'status') {
          console.log('\nMCP Server Status:');
          const status = manager.getServerStatus();
          console.log(JSON.stringify(status, null, 2));
          
          // Also show tools cache status
          const toolsCount = manager.getCachedToolsCount();
          const cacheExists = manager.isToolsCacheValid();
          console.log(`\nTools Cache: ${toolsCount} tools ${cacheExists ? 'cached' : 'not cached'}`);
          console.log('');
          rl.prompt();
          return;
        }
        
        if (query.toLowerCase() === 'refresh') {
          console.log('Refreshing tools cache...');
          const tools = manager.refreshToolsCache();
          console.log(`Tools cache refreshed with ${tools.length} tools.\n`);
          rl.prompt();
          return;
        }
        
        if (query.toLowerCase() === 'clear') {
          console.clear();
          console.log('--- Interactive Chat with LLM using MCP tools ---');
          console.log('Type "help" for available commands.\n');
          rl.prompt();
          return;
        }
        
        if (query === '') {
          rl.prompt();
          return;
        }
        
        try {
          // Create new AbortController for this operation
          currentAbortController = new AbortController();
          console.log('Assistant: Thinking... (type "cancel" or press Ctrl+C to cancel)');
          
          const response = await manager.chatWithLLM(query, currentAbortController.signal);
          
          // Clear the abort controller since operation completed successfully
          currentAbortController = null;
          console.log(`Assistant: ${response}\n`);
        } catch (error) {
          // Clear the abort controller
          currentAbortController = null;
          
          if (error instanceof Error && error.message === 'Operation cancelled by user') {
            console.log('Operation was cancelled.\n');
          } else {
            console.error(`Error: ${error}\n`);
          }
        }
        
        rl.prompt();
      });
      
      rl.on('close', async () => {
        console.log('\nShutting down...');
        await manager.stopAllServers();
        process.exit(0);
      });
      
      // Handle Ctrl+C gracefully
      rl.on('SIGINT', () => {
        if (currentAbortController) {
          // If there's an ongoing operation, cancel it
          currentAbortController.abort();
          currentAbortController = null;
          console.log('\nOperation cancelled. Type "exit" to quit or continue chatting.');
          rl.prompt();
        } else {
          // If no operation is running, just show the prompt
          console.log('\nType "exit" to quit gracefully.');
          rl.prompt();
        }
      });
    };

    // Start the interactive chat
    chatLoop();

  } catch (error) {
    console.error('Error in main:', error);
    process.exit(1);
  }
}

// Export the class for use in other modules
export { 
  MCPConfig, 
  MCPServer, 
  MCPServerConnection, 
  MCPServerManager,
  LLMProvider,
  LLMMessage,
  LLMChatResponse,
  Tool,
  OllamaProvider,
  GitHubCopilotProvider,
  OpenAIProvider
};

// Run the main function if this file is executed directly
if (require.main === module) {
  main();
}