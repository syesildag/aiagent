import Logger from '../utils/logger';
import type { Tool } from './llmProviders';
import type { ServerManager } from './serverManager';
import type { SubAgentRunner } from './mcpManager';

export const SUB_AGENT_RUNNER = 'sub-agent-runner';
const VIRTUAL_TASK_TOOL_NAME = 'task';

/**
 * Owns the MCP tools cache and generates virtual tools (e.g. the Task sub-agent tool).
 * Extracted from MCPServerManager to give tools caching a single responsibility.
 */
export class ToolRegistry {
  private cachedTools: Tool[] | null = null;
  private subAgentRunner: SubAgentRunner | null = null;
  private subAgentDescriptions: Record<string, string> = {};
  private subAgentAllowedServers: Record<string, string[] | undefined> = {};

  constructor(
    private readonly serverManager: ServerManager,
    subAgentRunner?: SubAgentRunner,
    subAgentDescriptions?: Record<string, string>,
    subAgentAllowedServers?: Record<string, string[] | undefined>,
  ) {
    if (subAgentRunner) {
      this.subAgentRunner = subAgentRunner;
      this.subAgentDescriptions = subAgentDescriptions ?? {};
      this.subAgentAllowedServers = subAgentAllowedServers ?? {};
    }
  }

  /**
   * Register a sub-agent runner post-construction (needed because agent.ts builds
   * the runner after ToolRegistry is already wired into MCPServerManager).
   */
  registerSubAgentRunner(
    runner: SubAgentRunner,
    descriptions: Record<string, string>,
    allowedServers: Record<string, string[] | undefined>,
  ): void {
    this.subAgentRunner = runner;
    this.subAgentDescriptions = descriptions;
    this.subAgentAllowedServers = allowedServers;
    this.invalidateToolsCache();
    Logger.info(`Sub-agent runner registered with agents: ${Object.keys(descriptions).join(', ')}`);
  }

  /** Convert all MCP server tools to LLM format, with result cached. */
  convertMCPToolsToLLMFormat(forceRefresh: boolean = false): Tool[] {
    if (!forceRefresh && this.cachedTools) {
      return this.cachedTools;
    }

    Logger.debug('Refreshing tools cache...');
    const tools: Tool[] = [];

    for (const [serverName, connection] of this.serverManager.getConnections()) {
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

      // Resource access as tools
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

      // Prompt access as tools
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

    // Cache only MCP tools — virtual tools are generated per-call so they can
    // be filtered to the calling agent's allowed server scope.
    this.cachedTools = tools;
    Logger.info(`Cached ${tools.length} MCP tools from ${this.serverManager.getConnections().size} MCP servers`);
    return tools;
  }

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

  getToolsForServers(serverNames: string[]): Tool[] {
    const tools = this.convertMCPToolsToLLMFormat();
    return tools.filter(tool =>
      tool.serverName && serverNames.includes(tool.serverName)
    );
  }

  /**
   * Generate the virtual "task" tool that lets the LLM spawn sub-agents.
   * @param parentServerNames When non-null, only include sub-agents whose entire
   *   allowed-server set is covered by the parent agent's server scope.
   */
  getVirtualTools(parentServerNames: string[] | null = null): Tool[] {
    if (!this.subAgentRunner) return [];
    let subAgentNames = Object.keys(this.subAgentDescriptions);
    if (subAgentNames.length === 0) return [];

    if (parentServerNames !== null) {
      subAgentNames = subAgentNames.filter(name => {
        const subAllowed = this.subAgentAllowedServers[name];
        return subAllowed !== undefined && subAllowed.every(s => parentServerNames.includes(s));
      });
    }

    if (subAgentNames.length === 0) return [];

    const subAgentList = subAgentNames
      .map(name => `- ${name}: ${this.subAgentDescriptions[name]}`)
      .join('\n');

    return [{
      type: 'function' as const,
      serverName: SUB_AGENT_RUNNER,
      function: {
        name: VIRTUAL_TASK_TOOL_NAME,
        description: `Delegate work to a specialized sub-agent and receive its full response.\nAvailable sub-agents:\n${subAgentList}`,
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
              enum: subAgentNames,
            },
          },
          required: ['description', 'prompt', 'subagent_type'],
        },
      },
    }];
  }

  invalidateToolsCache(): void {
    this.cachedTools = null;
    Logger.debug('Tools cache invalidated');
  }

  getCachedToolsCount(): number {
    return this.cachedTools ? this.cachedTools.length : 0;
  }

  isToolsCacheValid(): boolean {
    return this.cachedTools !== null;
  }

  /** Returns the serverName of every registered virtual tool (e.g. 'sub-agent-runner'). */
  getVirtualServerNames(): string[] {
    return this.getVirtualTools()
      .map(t => t.serverName)
      .filter((n): n is string => Boolean(n));
  }
}
