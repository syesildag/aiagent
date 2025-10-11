import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import Logger from '../utils/logger';
import { config } from '../utils/config';
import { LLMMessage, LLMProvider, OllamaProvider, Tool } from './llmProviders';
import { IConversationHistory } from '../descriptions/conversationTypes';
import { ConversationHistoryFactory } from '../utils/conversationHistoryFactory';

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

export interface ChatWithLLMArgs {
  message: string;
  customSystemPrompt: string;
  abortSignal?: AbortSignal;
  serverNames?: string[];
  stream?: boolean;
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
  private initialized: boolean = false;
  private conversationHistory: IConversationHistory;

  constructor(
    configPath: string = './mcp-servers.json', 
    llmProvider?: LLMProvider,
    model: string = 'qwen3:4b'
  ) {
    this.configPath = configPath;
    this.llmProvider = llmProvider || new OllamaProvider();
    this.model = model;
    this.conversationHistory = ConversationHistoryFactory.getInstance();
    
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

  /**
   * Get the current model name
   */
  getCurrentModel(): string {
    return this.model;
  }

  /**
   * Get the current LLM provider name
   */
  getProviderName(): string {
    return this.llmProvider?.name || 'Unknown';
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
    // Stop any existing servers first to prevent duplicates
    await this.stopAllServers();
    
    for (const server of this.servers) {
      try {
        // Check if server is already running by attempting to connect
        if (this.connections.has(server.name) && this.connections.get(server.name)?.isRunning()) {
          Logger.info(`MCP server ${server.name} is already running, skipping start`);
          continue;
        }
        
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
  async refreshToolsCache(): Promise<Tool[]> {
    await this.stopAllServers();
    this.initialized = false;
    this.ensureInitialized();
    return this.convertMCPToolsToLLMFormat(true);
  }

  // Get tools grouped by server name
  getToolsByServer(): Record<string, Tool[]> {
    const tools = this.convertMCPToolsToLLMFormat();
    const toolsByServer: Record<string, Tool[]> = {};
    
    for (const tool of tools) {
      const serverName = tool.serverName || 'unknown';
      if (!toolsByServer[serverName]) {
        toolsByServer[serverName] = [];
      }
      toolsByServer[serverName].push(tool);
    }
    
    return toolsByServer;
  }

  // Get tools filtered by server names
  getToolsForServers(serverNames: string[]): Tool[] {
    const tools = this.convertMCPToolsToLLMFormat();
    return tools.filter(tool => 
      tool.serverName && serverNames.includes(tool.serverName)
    );
  }

  // Get available server names
  getAvailableServerNames(): string[] {
    return Array.from(this.connections.keys());
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
          serverName: serverName,
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
          serverName: serverName,
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
          serverName: serverName,
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
    // Defensive check for tool call structure
    if (!toolCall?.function) {
      return 'Error: Tool call missing function property';
    }
    
    const { name, arguments: args } = toolCall.function;
    
    // Check if name exists
    if (!name) {
      return 'Error: Tool call missing function name';
    }
    
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

  /**
   * Ensure MCP servers are initialized on first use
   */
  public async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      Logger.info('Initializing MCP servers...');
      
      // Load MCP server configuration
      await this.loadServersConfig();

      // Check if the selected LLM provider is available
      Logger.debug('Checking provider health...');
      const providerAvailable = await this.checkHealth();
      Logger.debug(`Provider health check result: ${providerAvailable}`);
      if (!providerAvailable) {
        const providerName = this.llmProvider.name || 'Unknown';
        Logger.error(`${providerName} provider is not available. Please check your configuration.`);
        throw new Error(`${providerName} provider is not available`);
      }

      Logger.info(`${this.llmProvider.name || 'LLM'} provider is available`);
      const models = await this.getAvailableModels();
      Logger.debug(`Available models: ${JSON.stringify(models)}`);

      // Start all MCP servers
      await this.startAllServers();
      Logger.info('All MCP servers started');

      this.initialized = true;
      Logger.info('✅ MCP servers initialized successfully!');
    } catch (error) {
      Logger.error(`Failed to initialize MCP servers: ${error}`);
      throw new Error(`MCP initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  addAssistantMessageToHistory(finalContent: string | undefined) {

    if (!finalContent) {
      return;
    }

    return this.conversationHistory.addMessage({
      role: 'assistant',
      content: finalContent
    });
  }

  async chatWithLLM(args: ChatWithLLMArgs): Promise<ReadableStream<string> | string> {
    const { message, customSystemPrompt, abortSignal, serverNames, stream } = args;
    try {
      // Ensure MCP servers are initialized on first use
      await this.ensureInitialized();

      // Get all tools and filter by server names if specified
      let tools = this.convertMCPToolsToLLMFormat();
      
      if (serverNames && serverNames.length > 0) {
        tools = tools.filter(tool => 
          tool.serverName && serverNames.includes(tool.serverName)
        );
      }
      
      const availableServers = serverNames && serverNames.length > 0 
        ? serverNames.filter(name => this.connections.has(name))
        : Array.from(this.connections.keys());
      
      // Add user message to conversation history
      await this.conversationHistory.addMessage({
        role: 'user',
        content: message
      });
      
      // Get conversation history and add system prompt at the beginning
      const conversationMessages = await this.conversationHistory.getCurrentConversation();
      let messages: LLMMessage[] = [
        {
          role: 'system',
          content: customSystemPrompt
        },
        ...conversationMessages
      ];

      const maxIterations = config.MAX_LLM_ITERATIONS;
      let currentIteration = 0;

      while (currentIteration < maxIterations) {
        // Check for cancellation before each iteration
        if (abortSignal?.aborted) {
          throw new Error('Operation cancelled by user');
        }

        Logger.debug(`MCPServerManager chatWithLLM request: model=${this.model}, messages=${messages.length}, tools=${tools.length}, provider=${this.getProviderName()}`);

        // NEVER stream during tool iteration loops - we need to examine the response for tool calls
        // The LLM might decide to call tools even when we don't expect it
        const chatRequest = {
          model: this.model,
          messages: messages,
          tools: tools,
          stream: false  // Always false during iterations
        };

        let response = await this.llmProvider.chat(chatRequest, abortSignal);
        
        // If no tool calls, we're done with iterations
        if (!response?.message?.tool_calls || response.message.tool_calls.length === 0) {
          return response?.message?.content || 'No response content received';
        }
        
        // Handle tool calls
        const toolResults: string[] = [];
        
        Logger.debug(`Executing ${response.message.tool_calls.length} tool calls...`);
        
        for (const toolCall of response.message.tool_calls) {
          if (abortSignal?.aborted) {
            throw new Error('Operation cancelled by user');
          }
          
          // Defensive check for tool call structure
          if (!toolCall?.function?.name) {
            Logger.error(`Invalid tool call structure: ${JSON.stringify(toolCall)}`);
            toolResults.push('Error: Invalid tool call structure');
            continue;
          }
          
          Logger.debug(`Calling tool: ${JSON.stringify(toolCall)}`);
          const result = await this.handleToolCall(toolCall);
          Logger.debug(`Tool call result for ${toolCall.function.name}: ${result}`);

          toolResults.push(result);
        }

        // Add the assistant's response with tool calls to the conversation
        messages.push({
          role: 'assistant',
          content: response.message.content as string|| '',
          tool_calls: response.message.tool_calls
        });

        // Add individual tool result messages
        for (let i = 0; i < response.message.tool_calls.length; i++) {
          const toolCall = response.message.tool_calls[i];
          messages.push({
            role: 'tool',
            content: toolResults[i],
            tool_call_id: toolCall.id
          });
        }

        currentIteration++;
        Logger.debug(`Completed iteration ${currentIteration}/${maxIterations}`);
      }

      // If we've reached max iterations, make one final call without tools to get a response
      Logger.debug(`Reached max iterations (${maxIterations}), making final response call`);
      
      if (abortSignal?.aborted) {
        throw new Error('Operation cancelled by user');
      }

      // Final call can be streamed since we're not providing tools
      const finalResponse = await this.llmProvider.chat({
        model: this.model,
        messages: messages,
        stream
      }, abortSignal);

      return finalResponse?.message?.content;
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

  /**
   * Update the LLM provider without recreating the manager
   */
  updateLLMProvider(provider: LLMProvider): void {
    this.llmProvider = provider;
    Logger.info('LLM provider updated in MCPServerManager');
  }

  /**
   * Update the model without recreating the manager
   */
  updateModel(model: string): void {
    this.model = model;
    Logger.info(`Model updated to: ${model} in MCPServerManager`);
  }

  /**
   * Update both LLM provider and model
   */
  updateConfiguration(provider: LLMProvider, model: string): void {
    this.llmProvider = provider;
    this.model = model;
    Logger.info(`LLM configuration updated: provider and model=${model}`);
  }

  /**
   * Start a new conversation
   */
  async startNewConversation(sessionId?: string, userId?: string): Promise<string> {
    const conversationId = await this.conversationHistory.startNewConversation(sessionId, userId);
    Logger.info(`Started new conversation: ${conversationId}`);
    return conversationId;
  }

  /**
   * Get current conversation messages
   */
  async getCurrentConversation(): Promise<any[]> {
    return await this.conversationHistory.getCurrentConversation();
  }

  /**
   * Get all conversations within the sliding window
   */
  async getConversations(limit?: number): Promise<any[]> {
    return await this.conversationHistory.getConversations(limit);
  }

  /**
   * Clear conversation history
   */
  async clearConversationHistory(): Promise<void> {
    await this.conversationHistory.clearHistory();
    Logger.info('Conversation history cleared');
  }

  /**
   * Get conversation count
   */
  async getConversationCount(): Promise<number> {
    return await this.conversationHistory.getConversationCount();
  }

  /**
   * Get conversation by ID
   */
  async getConversation(conversationId: string): Promise<any | null> {
    return await this.conversationHistory.getConversation(conversationId);
  }
}

// Export singleton instance
const mcpManager = new MCPServerManager();
export default mcpManager;