import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import Logger from '../utils/logger';
import { MCPSSEConnection } from './mcpSSEConnection.js';
import { config } from '../utils/config';
import { ContentPart, LLMMessage, LLMProvider, OllamaProvider, Tool, getModelMaxTokens, estimateTokens, estimateFullMessageTokens, trimConversationToTokenBudget, isImageGenerationModel, isResponsesAPIImageModel, isImageGenerationProvider, isResponsesAPICapable } from './llmProviders';
import { IConversationHistory } from '../descriptions/conversationTypes';
import { ConversationHistoryFactory } from '../utils/conversationHistoryFactory';
import { ToolApprovalCallback, CONTINUE_ITERATIONS_TOOL } from './approvalManager';
import { capitalize } from '../utils/stringCase';

/**
 * Tool name patterns that require human approval before execution.
 * Based on MCP 2025-11-25 spec: hosts SHOULD prompt users before invoking
 * tools with destructiveHint=true, and SHOULD respect openWorldHint.
 * We also match common destructive verb suffixes as a safety net.
 */
const DANGEROUS_TOOL_PATTERNS: RegExp[] = [
  /(^|_)delete($|_)/i,
  /(^|_)drop($|_)/i,
  /(^|_)create($|_)/i,
  /(^|_)update($|_)/i,
  /(^|_)truncate($|_)/i,
  /(^|_)execute($|_)/i,
  /(^|_)evaluate($|_)/i,
  /(^|_)run($|_)/i,
  /(^|_)send($|_)/i,
  /(^|_)write($|_)/i,
  /(^|_)remove($|_)/i,
  /(^|_)kill($|_)/i,
  /(^|_)deploy($|_)/i,
  /(^|_)publish($|_)/i,
  /(^|_)destroy($|_)/i,
  /(^|_)reset($|_)/i,
  /(^|_)wipe($|_)/i,
  /(^|_)format($|_)/i,
  /(^|_)nuke($|_)/i,
  /(^|_)purge($|_)/i,
  /(^|_)mark($|_)/i,
];

const VIRTUAL_TASK_TOOL_NAME = 'task';

/** Maximum characters allowed per text field in a tool result before truncation. */
const MAX_TOOL_RESULT_TEXT_CHARS = 20_000;

/**
 * Recursively truncates string values in a tool result object so that no
 * single text field exceeds MAX_TOOL_RESULT_TEXT_CHARS characters.
 * Preserves the original JSON structure so the LLM receives a valid object.
 */
function truncateToolResultText(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_TOOL_RESULT_TEXT_CHARS
      ? value.slice(0, MAX_TOOL_RESULT_TEXT_CHARS) + '...[truncated]'
      : value;
  }
  if (Array.isArray(value)) {
    return value.map(truncateToolResultText);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, truncateToolResultText(v)])
    );
  }
  return value;
}

/** Fraction of the model's context window that triggers automatic history compaction. */
const AUTO_COMPACT_THRESHOLD = 0.90;
/** Number of most-recent messages to preserve verbatim after compaction. */
const AUTO_COMPACT_KEEP_RECENT = 4;

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
  /** MCP 2025-11-25 tool annotations for human-in-the-loop hints */
  annotations?: {
    destructiveHint?: boolean;
    readOnlyHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    title?: string;
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
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
  /** Transport protocol — defaults to 'stdio'. */
  protocol?: 'stdio' | 'sse';
  /** Base URL for SSE-based MCP servers, e.g. 'http://localhost:7007/mcp'. */
  httpUrl?: string;
  /** Always include this server regardless of BM25/embedding similarity filtering. */
  alwaysInclude?: boolean;
}

export interface MCPConfig {
  servers: MCPServer[];
}

export type ImageGenerationResult = { kind: 'image'; urls: string[] };
export type MixedContentResult = { kind: 'mixed'; text: string; imageUrls: string[] };

export interface ChatWithLLMArgs {
  message: string;
  customSystemPrompt: string;
  abortSignal?: AbortSignal;
  serverNames?: string[];
  stream?: boolean;
  attachments?: {
    base64: string;
    mimeType: string;
    name?: string;
  }[];
  userLogin?: string;
  isAdmin?: boolean;
  /**
   * Optional callback invoked before executing a dangerous MCP tool.
   * Return true to allow execution, false to deny it.
   * Follows the MCP 2025-11-25 human-in-the-loop recommendation.
   */
  approvalCallback?: ToolApprovalCallback;
  /**
   * Optional list of allowed tool name patterns from a slash command's
   * `allowed-tools:` frontmatter.  Values are server-name prefixes (e.g.
   * "memory", "weather") or exact tool names.  "*" allows everything.
   * When undefined the full tool list is used.
   */
  toolNameFilter?: string[];
  /**
   * Override the global MAX_LLM_ITERATIONS limit for this request.
   * Sourced from the `max-iterations:` frontmatter of a slash command.
   * Falls back to config.MAX_LLM_ITERATIONS when not provided.
   */
  maxIterations?: number;
  /**
   * When true, prior conversation history is NOT injected into this LLM call.
   * Only the current message (plus the system prompt) is sent.
   * Use for stateless slash commands (e.g. daily briefings) that don't need
   * earlier chat context and would otherwise overflow the token budget with
   * accumulated history before the tool-call results are even added.
   */
  freshContext?: boolean;
  /**
   * Override the LLM model for this request only.
   * Sourced from the `model:` frontmatter of a file-based agent definition.
   * Falls back to the globally configured model when not provided.
   */
  modelOverride?: string;
  /**
   * Optional callback invoked once per chat call, immediately after the full
   * messages array (system + history) is assembled. Reports a rough token
   * estimate so the caller can surface context-usage metrics.
   */
  onContextUpdate?: (used: number, max: number) => void;
  /**
   * Optional callback invoked immediately after auto-compaction completes.
   * The caller uses this to emit a {t:'compact'} NDJSON event to the frontend.
   */
  onCompact?: (info: CompactInfo) => void;
}

/** Metadata emitted when conversation history is auto-compacted. */
export interface CompactInfo {
  summarized: number;
  kept: number;
  tokensBefore: number;
  tokensAfter: number;
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

      // Set timeout — tool calls can be slow (DB + embeddings), so they get more time
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
      // Force-kill after 5 s if SIGTERM is ignored
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

/**
 * Callback that runs a named sub-agent with a given prompt and returns its text result.
 * Injected from agent.ts after the agent registry is built to avoid circular imports.
 */
export type SubAgentRunner = (
  agentName: string,
  prompt: string,
  abortSignal?: AbortSignal,
) => Promise<string>;

export class MCPServerManager {
  private servers: MCPServer[] = [];
  private connections: Map<string, MCPServerConnection | MCPSSEConnection> = new Map();
  private configPath: string;
  private llmProvider: LLMProvider;
  private model: string;
  private cachedTools: Tool[] | null = null;
  private initialized: boolean = false;
  private conversationHistory: IConversationHistory;
  private _activeDbConversationId: number | null = null;
  /** Injected after agent registry is built. Enables the Task sub-agent tool. */
  private subAgentRunner: SubAgentRunner | null = null;
  private subAgentDescriptions: Record<string, string> = {};

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
      // Expand ${VAR_NAME} placeholders in server env values from process.env
      this.servers = config.servers
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
    // Stop any existing servers first to prevent duplicates
    await this.stopAllServers();
    
    for (const server of this.servers) {
      try {
        // Check if server is already running by attempting to connect
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
    await this.ensureInitialized();
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

  getEnabledServerConfigs(): MCPServer[] {
    return this.servers;
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

    // Append virtual tools (e.g. the Task sub-agent tool) after MCP tools
    const virtualTools = this.getVirtualTools();
    const allTools = [...tools, ...virtualTools];

    // Cache the tools
    this.cachedTools = allTools;

    Logger.info(`Cached ${allTools.length} tools (${tools.length} MCP + ${virtualTools.length} virtual) from ${this.connections.size} MCP servers`);
    return allTools;
  }

  // Handle tool calls by routing them to appropriate MCP servers
  /**
   * Returns true when the given full tool name ("server_method") is considered
   * destructive and requires human approval before execution.
   * Checks both MCP annotations (destructiveHint) and name patterns.
   */
  private isToolDangerous(fullToolName: string): boolean {
    const parts = fullToolName.split('_');
    if (parts.length < 2) return false;
    const serverName = parts[0];
    const methodName = parts.slice(1).join('_');
    const connection = this.connections.get(serverName);
    if (connection) {
      const tool = connection.getTools().find(t => t.name === methodName);
      if (tool?.annotations?.destructiveHint === true) return true;
      // A readOnly tool is always safe
      if (tool?.annotations?.readOnlyHint === true) return false;
    }
    return DANGEROUS_TOOL_PATTERNS.some(p => p.test(methodName));
  }

  /** Returns the description for a full tool name ("server_method"). */
  private getToolDescription(fullToolName: string): string {
    const parts = fullToolName.split('_');
    if (parts.length < 2) return fullToolName;
    const serverName = parts[0];
    const methodName = parts.slice(1).join('_');
    const connection = this.connections.get(serverName);
    const tool = connection?.getTools().find(t => t.name === methodName);
    return tool?.description ?? fullToolName;
  }

  /** Returns the inputSchema for a full tool name ("server_method"), for display in approval cards. */
  private getToolSchema(fullToolName: string): MCPTool['inputSchema'] | undefined {
    const parts = fullToolName.split('_');
    if (parts.length < 2) return undefined;
    const serverName = parts[0];
    const methodName = parts.slice(1).join('_');
    const connection = this.connections.get(serverName);
    const tool = connection?.getTools().find(t => t.name === methodName);
    return tool?.inputSchema;
  }

  private async handleToolCall(
    toolCall: any,
    approvalCallback?: ToolApprovalCallback,
    userContext?: { userLogin?: string; isAdmin?: boolean },
  ): Promise<string> {
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

    // ── Virtual Task tool: delegate to a sub-agent ────────────────────────────
    if (name === VIRTUAL_TASK_TOOL_NAME) {
      if (!this.subAgentRunner) {
        return 'Error: Sub-agent system not initialized';
      }
      const { subagent_type, prompt, description } = parsedArgs ?? {};
      if (!subagent_type || !prompt) {
        return 'Error: task tool requires subagent_type and prompt';
      }
      Logger.info(`Task tool: delegating "${description ?? prompt.slice(0, 60)}" to sub-agent "${subagent_type}"`);
      try {
        const result = await this.subAgentRunner(subagent_type, prompt);
        Logger.info(`Task tool: sub-agent "${subagent_type}" completed`);
        return JSON.stringify({ result });
      } catch (error) {
        return `Error: sub-agent "${subagent_type}" failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

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

    // ── Human-in-the-loop check (MCP 2025-11-25) ──────────────────────────────
    if (approvalCallback && this.isToolDangerous(name)) {
      Logger.info(`Tool '${name}' requires user approval before execution.`);
      const description = this.getToolDescription(name);
      const schema = this.getToolSchema(name);
      const approved = await approvalCallback(name, parsedArgs ?? {}, description, schema);
      if (!approved) {
        Logger.info(`Tool '${name}' execution denied by user.`);
        return JSON.stringify({ denied: true, message: `User denied execution of tool: ${name}` });
      }
      Logger.info(`Tool '${name}' approved by user.`);
    }
    // ──────────────────────────────────────────────────────────────────────────

    Logger.info(`[Tool] ${name} args=${JSON.stringify(parsedArgs ?? {})}`);
    const toolStart = Date.now();

    try {
      // Handle different types of calls
      if (methodParts[0] === 'get' && methodParts[1] === 'resource') {
        const result = await connection.getResource(parsedArgs.uri);
        Logger.info(`[Tool] ${name} completed in ${Date.now() - toolStart}ms`);
        return JSON.stringify(result, null, 2);
      } else if (methodParts[0] === 'prompt') {
        const promptName = methodParts.slice(1).join('_');
        const result = await connection.getPrompt(promptName, parsedArgs);
        Logger.info(`[Tool] ${name} completed in ${Date.now() - toolStart}ms`);
        return JSON.stringify(result, null, 2);
      } else {
        // Regular tool call
        const toolName = methodParts.join('_');
        let argsToSend = parsedArgs ?? {};
        if (serverName === 'jobs' && userContext) {
          argsToSend = {
            ...argsToSend,
            _userLogin: userContext.userLogin ?? null,
            _isAdmin:   userContext.isAdmin  ?? false,
          };
        }
        const result = await connection.callTool(toolName, argsToSend);
        Logger.info(`[Tool] ${name} completed in ${Date.now() - toolStart}ms`);
        return JSON.stringify(truncateToolResultText(result), null, 2);
      }
    } catch (error) {
      Logger.error(`[Tool] ${name} failed after ${Date.now() - toolStart}ms: ${error instanceof Error ? error.message : String(error)}`);
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

  /**
   * Agentic loop using the OpenAI Responses API.
   * Handles text responses, image_generation_call outputs, and function_call
   * items (MCP tools) via the same handleToolCall mechanism as Chat Completions.
   */
  private async chatWithResponsesAPILoop(params: {
    model: string;
    systemPrompt: string;
    history: LLMMessage[];
    tools: Tool[];
    approvalCallback?: ToolApprovalCallback;
    abortSignal?: AbortSignal;
    userLogin?: string;
    isAdmin?: boolean;
  }): Promise<{ text: string; imageUrls: string[] }> {
    const { model, systemPrompt, history, tools, approvalCallback, abortSignal, userLogin, isAdmin } = params;
    const provider = this.llmProvider as unknown as import('./llmProviders').ResponsesAPICapable;

    // Convert MCP tools to Responses API function format
    const functionTools = tools.map(t => ({
      type: 'function',
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));

    const responsesTools: any[] = [
      { type: 'image_generation', size: '1024x1024', quality: 'medium' },
      ...functionTools,
    ];

    // Convert LLM history messages to Responses API input format
    // System messages become `instructions`; tool-result messages are skipped
    // on the initial call (they're included only when continuing with function_call_output)
    const inputMessages = history
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role,
        content: typeof m.content === 'string'
          ? m.content
          : (m.content as import('./llmProviders').ContentPart[])
              .filter((p: any) => p.type === 'text')
              .map((p: any) => p.text)
              .join(' '),
      }));

    let collectedText = '';
    const collectedImageUrls: string[] = [];
    let previousResponseId: string | undefined;
    let inputForThisCall: any[] = inputMessages;
    const ORIGINAL_MAX_ITERATIONS = 10;
    let maxIterations = ORIGINAL_MAX_ITERATIONS;
    let totalIterations = 0;

    continuationLoop: while (true) {
      let hitMaxIterations = true;
      for (let iteration = 0; iteration < maxIterations; iteration++, totalIterations++) {
        if (abortSignal?.aborted) throw new Error('Operation cancelled by user');

        const { id, output } = await provider.callResponsesAPI({
          model,
          instructions: previousResponseId ? undefined : systemPrompt,
          input: inputForThisCall,
          tools: responsesTools,
          previousResponseId,
          abortSignal,
        });

        previousResponseId = id;

        const functionCallOutputs: any[] = [];
        let hasFunctionCalls = false;

        for (const item of output) {
          if (item.type === 'message') {
            for (const contentItem of (item.content ?? [])) {
              if (contentItem.type === 'output_text') {
                collectedText += contentItem.text;
              }
            }
          } else if (item.type === 'image_generation_call' && item.status === 'completed' && item.result) {
            collectedImageUrls.push(`data:image/png;base64,${item.result}`);
          } else if (item.type === 'function_call') {
            hasFunctionCalls = true;
            const toolCallAdapter = {
              id: item.id,
              type: 'function' as const,
              function: { name: item.name, arguments: item.arguments },
            };
            const result = await this.handleToolCall(toolCallAdapter, approvalCallback, { userLogin, isAdmin });
            functionCallOutputs.push({
              type: 'function_call_output',
              call_id: item.call_id,
              output: result,
            });
          }
        }

        if (!hasFunctionCalls) {
          hitMaxIterations = false;
          break;
        }

        // Next iteration: send function_call_outputs using previous_response_id chaining
        inputForThisCall = functionCallOutputs;
      }

      if (hitMaxIterations && approvalCallback && !abortSignal?.aborted) {
        const approved = await approvalCallback(
          CONTINUE_ITERATIONS_TOOL,
          { iterations_completed: totalIterations },
          `The agent has completed ${totalIterations} iteration${totalIterations === 1 ? '' : 's'}. Allow it to continue with ${ORIGINAL_MAX_ITERATIONS} more?`,
        );
        if (approved) {
          maxIterations = ORIGINAL_MAX_ITERATIONS;
          continue continuationLoop;
        }
      }
      break;
    } // end continuationLoop

    return { text: collectedText, imageUrls: collectedImageUrls };
  }

  async chatWithLLM(args: ChatWithLLMArgs): Promise<ReadableStream<string> | string | ImageGenerationResult | MixedContentResult> {
    const { message, customSystemPrompt, abortSignal, serverNames, stream, attachments, userLogin, isAdmin, approvalCallback, toolNameFilter, freshContext, modelOverride, onContextUpdate, onCompact } = args;
    const previousModel = this.model;
    if (modelOverride) this.model = modelOverride;
    try {
      // Ensure MCP servers are initialized on first use
      await this.ensureInitialized();

      // ── Track 1: Dedicated image-generation models (Images API) ───────────
      if (isImageGenerationModel(this.model)) {
        if (!isImageGenerationProvider(this.llmProvider)) {
          throw new Error(`Provider '${this.llmProvider.name}' does not support image generation`);
        }
        // Add user message to history before generating
        await this.conversationHistory.addMessage({ role: 'user', content: message });
        const url = await this.llmProvider.generateImage(message, this.model, abortSignal);
        return { kind: 'image', urls: [url] };
      }

      // ── Track 2: Chat models with image generation via Responses API ──────
      // Only enters this path when the provider actually supports the Responses API (i.e. OpenAI).
      // Other providers (GitHub Copilot, Ollama) fall through to the standard Chat Completions loop.
      if (isResponsesAPIImageModel(this.model) && isResponsesAPICapable(this.llmProvider)) {
        // Add user message to history
        if (!this.conversationHistory.hasActiveConversation() && userLogin) {
          await this.conversationHistory.startNewConversation(undefined, userLogin);
        }
        await this.conversationHistory.addMessage({ role: 'user', content: message });
        const history = await this.conversationHistory.getCurrentConversation();
        const result = await this.chatWithResponsesAPILoop({
          model: this.model,
          systemPrompt: customSystemPrompt,
          history,
          tools: this.convertMCPToolsToLLMFormat(),
          approvalCallback,
          abortSignal,
          userLogin,
          isAdmin,
        });
        return result.imageUrls.length > 0
          ? { kind: 'mixed', text: result.text, imageUrls: result.imageUrls }
          : result.text;
      }

      // Get all tools and filter by server names if specified
      let tools = this.convertMCPToolsToLLMFormat();
      Logger.debug(`Total tools available before filtering: ${tools.length}`);
      
      if (serverNames != null) {
        // Virtual tools (no serverName) always pass through — they are not MCP-server-specific
        tools = tools.filter(tool =>
          !tool.serverName || serverNames.includes(tool.serverName)
        );
      }

      // Further filter by toolNameFilter from slash-command allowed-tools
      if (toolNameFilter && toolNameFilter.length > 0 && !toolNameFilter.includes('*')) {
        tools = tools.filter(tool => {
          const name = tool.function.name;
          return toolNameFilter.some(pattern =>
            name === pattern || name.startsWith(pattern + '_')
          );
        });
      }
      Logger.debug(`Total tools available after filtering: ${tools.length}`);
      // Ensure the conversation is initialised with the authenticated user's login
      // before adding the first message. Without this, DbConversationHistory would
      // call startNewConversation() internally with no userId, causing an anonymous
      // session to be created even when a real user is logged in.
      // We check hasActiveConversation() rather than convCount because old DB rows
      // do not constitute an "active" conversation on a fresh server start.
      if (!this.conversationHistory.hasActiveConversation() && userLogin) {
        await this.conversationHistory.startNewConversation(undefined, userLogin);
      }

      // Add user message to conversation history (text only — images are not persisted)
      await this.conversationHistory.addMessage({
        role: 'user',
        content: message
      });
      Logger.debug(`Added user message to conversation history: "${message}"`);
      // Get conversation history and add system prompt at the beginning.
      // When a user is authenticated, inject an instruction so the LLM always
      // passes user_login to memory tools, ensuring per-user memory isolation.
      const conversationMessages = await this.conversationHistory.getCurrentConversation();
      const displayName = userLogin ? capitalize(userLogin) : '';
      const userInstruction = userLogin
        ? `\n\nCurrent authenticated user: ${userLogin}\nAlways address and greet the user as "${displayName}" — do not use a name found in memory instead.\nWhen calling any memory tool (memory_mcreate, memory_msearch, memory_mlist, memory_mdelete), always include user_login="${userLogin}" in the tool arguments.`
        : '';
      const parallelToolInstruction = '\n\nWhen multiple independent tool calls are needed to answer a request, issue ALL of them in a single response as a batch rather than one at a time. This significantly reduces latency.';
      const currentTimeInstruction = `\n\nCurrent date and time (UTC): ${new Date().toISOString()}`;
      const effectiveSystemPrompt = customSystemPrompt + userInstruction + parallelToolInstruction + currentTimeInstruction;

      // Trim history to the configured token budget, keeping the most recent messages.
      // When freshContext is true (stateless slash commands), skip prior history entirely
      // so accumulated chat messages don't eat the token budget before tool results arrive.
      let trimmedConversation: typeof conversationMessages;
      if (freshContext) {
        // Only include the message we just added — no prior conversation history
        trimmedConversation = conversationMessages.slice(-1);
        Logger.debug('chatWithLLM: fresh-context mode — prior conversation history excluded');
      } else {
        trimmedConversation = trimConversationToTokenBudget(
          conversationMessages,
          config.CONVERSATION_HISTORY_TOKEN_BUDGET,
          msg => estimateTokens(msg.content + (msg.toolCalls ? JSON.stringify(msg.toolCalls) : ''))
        );
      }

      // Build messages; if an image was provided, replace the last user message with
      // a multimodal content array so vision models can process it.
      // Map stored Message fields (toolCalls, toolCallId) back to LLM wire format
      // (tool_calls, tool_call_id). A plain spread would silently drop them.
      let historyMessages: LLMMessage[] = trimmedConversation.map(msg => ({
        role: msg.role,
        content: msg.content,
        ...(msg.toolCalls  ? { tool_calls: msg.toolCalls as LLMMessage['tool_calls'] }    : {}),
        ...(msg.toolCallId ? { tool_call_id: msg.toolCallId } : {}),
      }));
      if (attachments && attachments.length > 0) {
        const lastUserIdx = historyMessages.map(m => m.role).lastIndexOf('user');
        if (lastUserIdx !== -1) {
          const extraTextParts: string[] = [];
          const imageContentBlocks: ContentPart[] = [];

          for (const file of attachments) {
            if (file.mimeType.startsWith('image/')) {
              // Vision-capable image — attach as image_url block
              imageContentBlocks.push({
                type: 'image_url' as const,
                image_url: {
                  url: `data:${file.mimeType};base64,${file.base64}`,
                  detail: 'auto' as const,
                },
              });
            } else if (
              file.mimeType.startsWith('text/') ||
              file.mimeType === 'application/json' ||
              file.mimeType === 'application/xml' ||
              file.mimeType === 'application/javascript' ||
              file.mimeType === 'application/typescript'
            ) {
              // Text-based file — decode and embed inline
              const text = Buffer.from(file.base64, 'base64').toString('utf-8');
              const label = file.name ? `[Attached file: ${file.name}]` : `[Attached ${file.mimeType} file]`;
              extraTextParts.push(`${label}\n\`\`\`\n${text}\n\`\`\``);
            } else {
              // Other binary types (PDF, etc.) — pass as data URL; some providers (e.g. Anthropic) support this
              imageContentBlocks.push({
                type: 'image_url' as const,
                image_url: {
                  url: `data:${file.mimeType};base64,${file.base64}`,
                  detail: 'auto' as const,
                },
              });
            }
          }

          const textContent = [
            ...extraTextParts,
            message,
          ].join('\n\n');

          historyMessages[lastUserIdx] = {
            ...historyMessages[lastUserIdx],
            content: [
              ...imageContentBlocks,
              {
                type: 'text' as const,
                text: textContent,
              },
            ],
          };
        }
      }

      let messages: LLMMessage[] = [
        {
          role: 'system',
          content: effectiveSystemPrompt
        },
        ...historyMessages
      ];

      // Estimate token usage, auto-compact if over threshold, then notify caller.
      const modelMaxTokens = getModelMaxTokens(this.model);
      const estimatedTokens = messages.reduce((sum, m) => sum + estimateFullMessageTokens(m), 0);
      const usageRatio = estimatedTokens / modelMaxTokens;

      if (usageRatio >= AUTO_COMPACT_THRESHOLD) {
        Logger.warn(`Context usage ${Math.round(usageRatio * 100)}% exceeds threshold — auto-compacting history`);
        const compactResult = await this.compactHistory();
        const compacted = await this.conversationHistory.getCurrentConversation();
        messages = [{ role: 'system', content: effectiveSystemPrompt }, ...compacted];
        const compactedTokens = messages.reduce((sum, m) => sum + estimateFullMessageTokens(m), 0);
        onCompact?.({ ...compactResult, tokensBefore: estimatedTokens, tokensAfter: compactedTokens });
        onContextUpdate?.(compactedTokens, modelMaxTokens);
      } else {
        onContextUpdate?.(estimatedTokens, modelMaxTokens);
      }

      const originalMaxIterations = args.maxIterations ?? config.MAX_LLM_ITERATIONS;
      let maxIterations = originalMaxIterations;
      let currentIteration = 0;
      // Nudge flags: recover from models that narrate their plan instead of calling tools
      let hasCalledTools = false;
      let nudgeInjected = false;

      continuationLoop: while (true) {
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

          // If no tool calls, check whether the model narrated instead of acting (e.g. Claude Sonnet)
          if (!response?.message?.tool_calls || response.message.tool_calls.length === 0) {
            // One-time nudge: if no tools have been called yet and the model returned narrative text,
            // append the narration as an assistant turn and ask the model to act.
            const modelNarrated = !hasCalledTools && !nudgeInjected && tools.length > 0 && !!response?.message?.content;
            if (modelNarrated) {
              Logger.debug('Model returned narrative text without tool calls — injecting nudge to force tool execution');
              messages.push({ role: 'assistant', content: response.message.content as string });
              messages.push({
                role: 'user',
                content: 'You have not called any tools yet. Execute the tool calls now as instructed. Do not explain or describe — call the tools immediately.'
              });
              nudgeInjected = true;
              currentIteration++;
              continue;
            }
            return response?.message?.content || 'No response content received';
          }

          // Handle tool calls — run them in parallel to reduce latency
          Logger.debug(`Executing ${response.message.tool_calls.length} tool calls...`);

          if (abortSignal?.aborted) {
            throw new Error('Operation cancelled by user');
          }

          hasCalledTools = true;
          const toolResults: string[] = await Promise.all(
            response.message.tool_calls.map(async (toolCall) => {
              // Defensive check for tool call structure
              if (!toolCall?.function?.name) {
                Logger.error(`Invalid tool call structure: ${JSON.stringify(toolCall)}`);
                return 'Error: Invalid tool call structure';
              }

              Logger.debug(`Calling tool: ${JSON.stringify(toolCall)}`);
              const result = await this.handleToolCall(toolCall, approvalCallback, { userLogin, isAdmin });
              Logger.debug(`Tool call result for ${toolCall.function.name}: ${result}`);
              return result;
            })
          );

          if (abortSignal?.aborted) {
            throw new Error('Operation cancelled by user');
          }

          // Add the assistant's response with tool calls to the conversation
          messages.push({
            role: 'assistant',
            content: response.message.content as string|| '',
            tool_calls: response.message.tool_calls
          });
          await this.conversationHistory.addMessage({
            role: 'assistant',
            content: response.message.content as string || '',
            toolCalls: response.message.tool_calls
          });

          // Add individual tool result messages
          for (let i = 0; i < response.message.tool_calls.length; i++) {
            const toolCall = response.message.tool_calls[i];
            messages.push({
              role: 'tool',
              content: toolResults[i],
              tool_call_id: toolCall.id
            });
            await this.conversationHistory.addMessage({
              role: 'tool',
              content: toolResults[i],
              toolCallId: toolCall.id
            });
          }

          currentIteration++;
          Logger.debug(`Completed iteration ${currentIteration}/${maxIterations}`);
        }

        // Max iterations reached — ask whether the user wants to continue
        if (approvalCallback && !abortSignal?.aborted) {
          const approved = await approvalCallback(
            CONTINUE_ITERATIONS_TOOL,
            { iterations_completed: currentIteration },
            `The agent has completed ${currentIteration} iteration${currentIteration === 1 ? '' : 's'}. Allow it to continue with ${originalMaxIterations} more?`,
          );
          if (approved) {
            maxIterations += originalMaxIterations;
            continue continuationLoop;
          }
        }
        break;
      } // end continuationLoop

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
    } finally {
      if (modelOverride) this.model = previousModel;
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
   * Register a sub-agent runner so the LLM can delegate tasks via the Task tool.
   * Called from agent.ts after the full agent registry is built.
   */
  setSubAgentRunner(runner: SubAgentRunner, descriptions: Record<string, string>): void {
    this.subAgentRunner = runner;
    this.subAgentDescriptions = descriptions;
    this.invalidateToolsCache();
    Logger.info(`Sub-agent runner registered with agents: ${Object.keys(descriptions).join(', ')}`);
  }

  /**
   * Generate the virtual "task" tool that lets the LLM spawn sub-agents.
   * Only produced when a SubAgentRunner has been registered.
   */
  private getVirtualTools(): Tool[] {
    if (!this.subAgentRunner) return [];
    const agentNames = Object.keys(this.subAgentDescriptions);
    if (agentNames.length === 0) return [];

    const agentList = agentNames
      .map(name => `- ${name}: ${this.subAgentDescriptions[name]}`)
      .join('\n');

    return [{
      type: 'function' as const,
      function: {
        name: VIRTUAL_TASK_TOOL_NAME,
        description: `Delegate work to a specialized sub-agent and receive its full response.\nAvailable sub-agents:\n${agentList}`,
        parameters: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              description: 'A short (3-5 word) description of the task',
            },
            prompt: {
              type: 'string',
              description: 'The full task prompt for the sub-agent to execute',
            },
            subagent_type: {
              type: 'string',
              description: 'Which specialized agent to invoke',
              enum: agentNames,
            },
          },
          required: ['description', 'prompt', 'subagent_type'],
        },
      },
    }];
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
    this._activeDbConversationId = null;
    Logger.info('Conversation history cleared');
  }

  getActiveDbConversationId(): number | null {
    return this._activeDbConversationId;
  }

  setActiveDbConversationId(id: number | null): void {
    this._activeDbConversationId = id;
  }

  setCurrentConversationId(uuid: string): void {
    this.conversationHistory.setCurrentConversationId(uuid);
  }

  /**
   * Returns true when an in-memory conversation is already active.
   */
  hasActiveConversation(): boolean {
    return this.conversationHistory.hasActiveConversation();
  }

  /**
   * Restore a prior conversation from an external message list (e.g. DB records).
   * Starts a fresh in-memory conversation and bulk-inserts the supplied messages
   * so the LLM receives the full prior context on the next chatWithLLM call.
   */
  async restoreConversation(
    messages: Array<{ role: string; content: string }>,
    userId?: string,
  ): Promise<void> {
    await this.conversationHistory.startNewConversation(undefined, userId);
    for (const msg of messages) {
      await this.conversationHistory.addMessage({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }
    Logger.info(`Restored conversation with ${messages.length} messages for user=${userId ?? 'anonymous'}`);
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

  /**
   * Summarize the older portion of conversation history, clear it, and re-seed
   * with the summary plus the most recent messages. Used by the auto-compact
   * trigger and can also be called manually.
   */
  async compactHistory(): Promise<{ summarized: number; kept: number }> {
    const messages = await this.conversationHistory.getCurrentConversation();
    if (messages.length <= AUTO_COMPACT_KEEP_RECENT) {
      return { summarized: 0, kept: messages.length };
    }

    const toSummarize = messages.slice(0, -AUTO_COMPACT_KEEP_RECENT);
    const recentMessages = messages.slice(-AUTO_COMPACT_KEEP_RECENT);

    const historyText = toSummarize
      .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
      .join('\n');

    const summaryResponse = await this.llmProvider.chat({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: 'You are a conversation summarizer. Produce a concise summary of the conversation that preserves all key facts, decisions, and context needed to continue the conversation. Be thorough but brief.'
        },
        {
          role: 'user',
          content: `Summarize this conversation:\n\n${historyText}`
        }
      ],
      tools: [],
      stream: false
    });

    const summary = summaryResponse.message.content as string;

    await this.conversationHistory.clearCurrentMessages();

    await this.conversationHistory.addMessage({
      role: 'user',
      content: '[Conversation history was automatically compacted to free context space.]'
    });

    await this.conversationHistory.addMessage({
      role: 'assistant',
      content: `Summary of previous conversation:\n\n${summary}`
    });

    for (const msg of recentMessages) {
      await this.conversationHistory.addMessage({
        role: msg.role as 'user' | 'assistant' | 'system' | 'tool',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      });
    }

    Logger.info(`Context auto-compacted: summarized ${toSummarize.length} messages, kept ${recentMessages.length} recent`);
    return { summarized: toSummarize.length, kept: recentMessages.length };
  }
}
