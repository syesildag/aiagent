import Logger from '../utils/logger';
import { LLMProvider, OllamaProvider, Tool } from './llmProviders';
import { IConversationHistory } from '../descriptions/conversationTypes';
import { ToolApprovalCallback } from './approvalManager';

// ── Re-export the MCPServerConnection class so callers that still import it
//    from mcpManager.ts continue to work without changes.
export { MCPServerConnection } from './mcpServerConnection';

// ── New focused classes (the actual implementations) ──────────────────────────
import { ServerManager } from './serverManager';
import { ToolRegistry, SUB_AGENT_RUNNER as TOOL_REGISTRY_SUB_AGENT_RUNNER } from './toolRegistry';
import { ToolExecutor } from './toolExecutor';
import { AgentLoop } from './agentLoop';
import { HistoryManager } from './historyManager';
import { ServerFilter } from './serverFilter';
import { createLLMProvider, getLLMModel } from './llmFactory';
// ─────────────────────────────────────────────────────────────────────────────

// MCP Protocol Types (kept here because mcpSSEConnection.ts imports them from this module)
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
  excludedServerNames?: string[];
  stream?: boolean;
  attachments?: {
    base64: string;
    mimeType: string;
    name?: string;
  }[];
  userLogin?: string;
  isAdmin?: boolean;
  approvalCallback?: ToolApprovalCallback;
  toolNameFilter?: string[];
  maxIterations?: number;
  freshContext?: boolean;
  modelOverride?: string;
  onContextUpdate?: (used: number, max: number) => void;
  onCompact?: (info: CompactInfo) => void;
}

/** Metadata emitted when conversation history is auto-compacted. */
export interface CompactInfo {
  summarized: number;
  kept: number;
  tokensBefore: number;
  tokensAfter: number;
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

/** Re-export so callers that import SUB_AGENT_RUNNER from mcpManager.ts continue to work. */
export const SUB_AGENT_RUNNER = TOOL_REGISTRY_SUB_AGENT_RUNNER;

/**
 * MCPServerManager — facade over five focused components.
 *
 * All existing public methods are preserved so cli.ts, agent.ts, and the route
 * handlers require zero changes. The internals are now composed from:
 *   - ServerManager   : MCP process lifecycle
 *   - ToolRegistry    : tool cache + virtual (sub-agent) tool generation
 *   - ToolExecutor    : tool dispatch + danger detection
 *   - AgentLoop       : LLM agentic iteration loop
 *   - HistoryManager  : per-session conversation history scoping
 *
 * Use the static `create()` factory — it wires the components together.
 */
export class MCPServerManager {
  // Per-manager conversation history. NOT the global getInstance() singleton —
  // this is a fresh instance created at construction time. The route handler's
  // clearConversationHistory / restoreConversationHistory calls operate on this.
  private _currentHistory: IConversationHistory;
  private _activeDbConversationId: number | null = null;

  constructor(
    private readonly serverManager: ServerManager,
    private readonly toolRegistry: ToolRegistry,
    private readonly toolExecutor: ToolExecutor,
    private readonly agentLoop: AgentLoop,
    private readonly historyManager: HistoryManager,
    private _llmProvider: LLMProvider,
    private _model: string,
  ) {
    // Create a fresh, isolated history — not the shared getInstance() singleton
    this._currentHistory = historyManager.createHistoryForSession();
  }

  /**
   * Static factory: the only way callers need to build MCPServerManager.
   * Constructs and wires the five focused components.
   */
  static async create(
    configPath: string,
    llmProvider: LLMProvider,
    model: string,
  ): Promise<MCPServerManager> {
    const serverManager = new ServerManager(configPath);
    const toolRegistry = new ToolRegistry(serverManager);
    const toolExecutor = new ToolExecutor(serverManager);
    const historyManager = new HistoryManager();
    const agentLoop = new AgentLoop({ llmProvider, model, toolRegistry, toolExecutor });
    return new MCPServerManager(serverManager, toolRegistry, toolExecutor, agentLoop, historyManager, llmProvider, model);
  }

  // ── Provider / model ────────────────────────────────────────────────────────

  getCurrentModel(): string {
    return this._model;
  }

  getProviderName(): string {
    return this._llmProvider?.name || 'Unknown';
  }

  async checkHealth(): Promise<boolean> {
    return await this._llmProvider.checkHealth();
  }

  async getAvailableModels(): Promise<string[]> {
    return await this._llmProvider.getAvailableModels();
  }

  updateLLMProvider(provider: LLMProvider): void {
    this._llmProvider = provider;
    Logger.info('LLM provider updated in MCPServerManager');
  }

  updateModel(model: string): void {
    this._model = model;
    Logger.info(`Model updated to: ${model} in MCPServerManager`);
  }

  updateConfiguration(provider: LLMProvider, model: string): void {
    this._llmProvider = provider;
    this._model = model;
    Logger.info(`LLM configuration updated: provider and model=${model}`);
  }

  // ── Server lifecycle ────────────────────────────────────────────────────────

  async loadServersConfig(): Promise<void> {
    return this.serverManager.loadServersConfig();
  }

  async startAllServers(): Promise<void> {
    await this.serverManager.startAllServers();
    this.toolRegistry.invalidateToolsCache();
  }

  async stopAllServers(): Promise<void> {
    await this.serverManager.stopAllServers();
    this.toolRegistry.invalidateToolsCache();
  }

  async ensureInitialized(): Promise<void> {
    return this.serverManager.ensureInitialized(this._llmProvider);
  }

  getServerStatus(): Record<string, any> {
    return this.serverManager.getServerStatus();
  }

  getAvailableServerNames(): string[] {
    return this.serverManager.getAvailableServerNames();
  }

  getEnabledServerConfigs(): MCPServer[] {
    return this.serverManager.getEnabledServerConfigs();
  }

  // ── Tool cache ──────────────────────────────────────────────────────────────

  getCachedToolsCount(): number {
    return this.toolRegistry.getCachedToolsCount();
  }

  isToolsCacheValid(): boolean {
    return this.toolRegistry.isToolsCacheValid();
  }

  async refreshToolsCache(): Promise<Tool[]> {
    await this.stopAllServers();
    await this.ensureInitialized();
    return this.toolRegistry.convertMCPToolsToLLMFormat(true);
  }

  getToolsByServer(): Record<string, Tool[]> {
    return this.toolRegistry.getToolsByServer();
  }

  getToolsForServers(serverNames: string[]): Tool[] {
    return this.toolRegistry.getToolsForServers(serverNames);
  }

  getVirtualServerNames(): string[] {
    return this.toolRegistry.getVirtualServerNames();
  }

  // ── Sub-agent runner ────────────────────────────────────────────────────────

  setSubAgentRunner(
    runner: SubAgentRunner,
    descriptions: Record<string, string>,
    allowedServers: Record<string, string[] | undefined>,
  ): void {
    this.toolRegistry.registerSubAgentRunner(runner, descriptions, allowedServers);
  }

  // ── Agentic loop ────────────────────────────────────────────────────────────

  async chatWithLLM(
    args: ChatWithLLMArgs,
  ): Promise<ReadableStream<string> | string | ImageGenerationResult | MixedContentResult> {
    await this.ensureInitialized();

    // Use the established history (populated by restoreConversationHistory if the
    // route handler synced a prior conversation) so restored context is preserved.
    // withModel() returns a NEW AgentLoop — fixes the model-mutation race condition.
    const loop = args.modelOverride
      ? this.agentLoop.withModel(args.modelOverride)
      : this.agentLoop;

    return loop.run(args, this._currentHistory);
  }

  // ── MCP status rendering ────────────────────────────────────────────────────

  /**
   * Build the Markdown status page for /mcp-status without calling the LLM.
   * Both chat.ts and cli.ts call this instead of duplicating the inline block.
   */
  renderStatusMarkdown(): string {
    const serverStatus = this.serverManager.getServerStatus();
    const cacheValid = this.toolRegistry.isToolsCacheValid();
    const cachedCount = this.toolRegistry.getCachedToolsCount();
    const toolsByServer = this.toolRegistry.getToolsByServer();
    const serverEntries = Object.entries(serverStatus);
    const runningCount = serverEntries.filter(([, s]) => s.running).length;

    const lines: string[] = [];
    lines.push('# 🔌 MCP Status');
    lines.push('');
    lines.push('## Cache');
    lines.push('');
    lines.push('| Property | Value |');
    lines.push('|---|---|');
    lines.push(`| Status | ${cacheValid ? '✅ Valid' : '⚠️ Stale'} |`);
    lines.push(`| Total tools | ${cachedCount} |`);
    lines.push(`| Servers | ${runningCount} running / ${serverEntries.length} total |`);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Servers');
    lines.push('');

    for (const [serverName, info] of serverEntries) {
      const serverTools = toolsByServer[serverName] ?? [];
      const statusIcon = info.running ? '🟢' : '🔴';
      const statusLabel = info.running ? 'running' : 'stopped';

      lines.push(`### ${statusIcon} \`${serverName}\` — ${statusLabel}`);
      lines.push('');
      lines.push('| | Count |');
      lines.push('|---|---|');
      lines.push(`| 🛠 Tools | ${info.tools.length} |`);
      lines.push(`| 📦 Resources | ${info.resources.length} |`);
      lines.push(`| 💬 Prompts | ${info.prompts.length} |`);

      if (serverTools.length > 0) {
        lines.push('');
        lines.push('<details><summary>📋 Cached tools</summary>');
        lines.push('');
        lines.push('| Tool | Description |');
        lines.push('|---|---|');
        for (const tool of serverTools) {
          lines.push(`| \`${tool.function.name}\` | ${tool.function.description ?? '—'} |`);
        }
        lines.push('');
        lines.push('</details>');
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /** Creates a ServerFilter wired to this manager's internal toolRegistry and serverManager. */
  createServerFilter(): ServerFilter {
    return new ServerFilter(this.toolRegistry, this.serverManager);
  }

  // ── Conversation history (backward-compat delegates) ───────────────────────

  addAssistantMessageToHistory(finalContent: string | undefined): void {
    if (!finalContent) return;
    this._currentHistory.addMessage({ role: 'assistant', content: finalContent });
  }

  async startNewConversation(sessionId?: string, userId?: string): Promise<string> {
    const conversationId = await this._currentHistory.startNewConversation(sessionId, userId);
    Logger.info(`Started new conversation: ${conversationId}`);
    return conversationId;
  }

  async getCurrentConversation(): Promise<any[]> {
    return await this._currentHistory.getCurrentConversation();
  }

  async getConversations(limit?: number): Promise<any[]> {
    return await this._currentHistory.getConversations(limit);
  }

  async clearConversationHistory(): Promise<void> {
    await this._currentHistory.clearHistory();
    Logger.info('Conversation history cleared');
  }

  getActiveDbConversationId(): number | null {
    return this._activeDbConversationId;
  }

  setActiveDbConversationId(id: number | null): void {
    this._activeDbConversationId = id;
  }

  setCurrentConversationId(uuid: string): void {
    this._currentHistory.setCurrentConversationId(uuid);
  }

  hasActiveConversation(): boolean {
    return this._currentHistory.hasActiveConversation();
  }

  async restoreConversation(
    messages: Array<{ role: string; content: string }>,
    userId?: string,
  ): Promise<void> {
    return this.historyManager.restoreConversation(this._currentHistory, messages, userId);
  }

  async getConversationCount(): Promise<number> {
    return await this._currentHistory.getConversationCount();
  }

  async getConversation(conversationId: string): Promise<any | null> {
    return await this._currentHistory.getConversation(conversationId);
  }

  async compactHistory(): Promise<{ summarized: number; kept: number }> {
    // Delegate to the agentLoop's inline compaction (which has llmProvider + model)
    return (this.agentLoop as any).compactHistory(this._currentHistory);
  }
}
