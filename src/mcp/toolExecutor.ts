import Logger from '../utils/logger';
import type { ToolApprovalCallback } from './approvalManager';
import type { MCPTool } from './mcpManager';
import type { SubAgentRunner } from './mcpManager';
import type { ServerManager } from './serverManager';

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

/** Maximum total characters for the entire serialized tool result (all fields combined). */
const MAX_TOOL_RESULT_TOTAL_CHARS = 10_000;

/**
 * Recursively truncates string values in a tool result object so that no
 * single text field exceeds MAX_TOOL_RESULT_TEXT_CHARS characters.
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

/**
 * Dispatches MCP tool calls and enforces human-in-the-loop approval for
 * dangerous tools. Extracted from MCPServerManager to be stateless about
 * which sub-agent runner is active — the runner is passed per-call.
 */
export class ToolExecutor {
  constructor(private readonly serverManager: ServerManager) {}

  /**
   * Execute a tool call, routing to the appropriate MCP server.
   * The subAgentRunner is passed as a parameter (not stored) so this class
   * has no mutable sub-agent state and is safe to share across requests.
   */
  async execute(
    toolCall: { function: { name: string; arguments: string | Record<string, unknown> } },
    subAgentRunner: SubAgentRunner | null,
    approvalCallback?: ToolApprovalCallback,
    userContext?: { userLogin?: string; isAdmin?: boolean },
  ): Promise<string> {
    if (!toolCall?.function) {
      return 'Error: Tool call missing function property';
    }

    const { name, arguments: args } = toolCall.function;

    if (!name) {
      return 'Error: Tool call missing function name';
    }

    let parsedArgs: Record<string, unknown>;
    try {
      parsedArgs = typeof args === 'string' ? JSON.parse(args) : (args as Record<string, unknown>);
    } catch (error) {
      return `Error parsing tool arguments: ${error}`;
    }

    // ── Virtual Task tool: delegate to a sub-agent ──────────────────────────
    if (name === VIRTUAL_TASK_TOOL_NAME) {
      if (!subAgentRunner) {
        return 'Error: Sub-agent system not initialized';
      }
      const { subagent_type, prompt, description } = parsedArgs ?? {};
      if (!subagent_type || !prompt) {
        return 'Error: task tool requires subagent_type and prompt';
      }
      Logger.info(`Task tool: delegating "${description ?? (prompt as string).slice(0, 60)}" to sub-agent "${subagent_type}"`);
      try {
        const result = await subAgentRunner(subagent_type as string, prompt as string);
        Logger.info(`Task tool: sub-agent "${subagent_type}" completed`);
        return JSON.stringify({ result });
      } catch (error) {
        return `Error: sub-agent "${subagent_type}" failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    const parts = name.split('_');
    if (parts.length < 2) {
      return `Invalid tool name format: ${name}`;
    }

    const serverName = parts[0];
    const methodParts = parts.slice(1);
    const connection = this.serverManager.getConnections().get(serverName);

    if (!connection) {
      return `Server ${serverName} not found or not running`;
    }

    // ── Human-in-the-loop check (MCP 2025-11-25) ────────────────────────────
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
    // ────────────────────────────────────────────────────────────────────────

    Logger.info(`[Tool] ${name} args=${JSON.stringify(parsedArgs ?? {})}`);
    const toolStart = Date.now();

    try {
      if (methodParts[0] === 'get' && methodParts[1] === 'resource') {
        const result = await connection.getResource((parsedArgs as any).uri);
        Logger.info(`[Tool] ${name} completed in ${Date.now() - toolStart}ms`);
        return JSON.stringify(result, null, 2);
      } else if (methodParts[0] === 'prompt') {
        const promptName = methodParts.slice(1).join('_');
        const result = await connection.getPrompt(promptName, parsedArgs);
        Logger.info(`[Tool] ${name} completed in ${Date.now() - toolStart}ms`);
        return JSON.stringify(result, null, 2);
      } else {
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
        const serialized = JSON.stringify(truncateToolResultText(result), null, 2);
        return serialized.length > MAX_TOOL_RESULT_TOTAL_CHARS
          ? serialized.slice(0, MAX_TOOL_RESULT_TOTAL_CHARS) + '\n...[result truncated]'
          : serialized;
      }
    } catch (error) {
      Logger.error(`[Tool] ${name} failed after ${Date.now() - toolStart}ms: ${error instanceof Error ? error.message : String(error)}`);
      return `Error calling ${name}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Returns true when the given full tool name ("server_method") is considered
   * destructive and requires human approval before execution.
   */
  isToolDangerous(fullToolName: string): boolean {
    const parts = fullToolName.split('_');
    if (parts.length < 2) return false;
    const serverName = parts[0];
    const methodName = parts.slice(1).join('_');
    const connection = this.serverManager.getConnections().get(serverName);
    if (connection) {
      const tool = connection.getTools().find(t => t.name === methodName);
      if (tool?.annotations?.destructiveHint === true) return true;
      if (tool?.annotations?.readOnlyHint === true) return false;
    }
    return DANGEROUS_TOOL_PATTERNS.some(p => p.test(methodName));
  }

  /** Returns the description for a full tool name ("server_method"). */
  getToolDescription(fullToolName: string): string {
    const parts = fullToolName.split('_');
    if (parts.length < 2) return fullToolName;
    const serverName = parts[0];
    const methodName = parts.slice(1).join('_');
    const connection = this.serverManager.getConnections().get(serverName);
    const tool = connection?.getTools().find(t => t.name === methodName);
    return tool?.description ?? fullToolName;
  }

  /** Returns the inputSchema for a full tool name, for display in approval cards. */
  getToolSchema(fullToolName: string): MCPTool['inputSchema'] | undefined {
    const parts = fullToolName.split('_');
    if (parts.length < 2) return undefined;
    const serverName = parts[0];
    const methodName = parts.slice(1).join('_');
    const connection = this.serverManager.getConnections().get(serverName);
    const tool = connection?.getTools().find(t => t.name === methodName);
    return tool?.inputSchema;
  }
}
