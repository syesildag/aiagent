import { processCommand } from './commandProcessor';
import { slashCommandRegistry } from './slashCommandRegistry';
import type { MCPServerManager } from '../mcp/mcpManager';

/**
 * Discriminated union returned by processSlashCommand().
 * Callers branch on `kind` — no boolean flags needed.
 *
 * - 'direct'  → return the response to the caller immediately without calling the LLM
 * - 'chat'    → run agent.chat() with the computed effectivePrompt and options
 */
export type SlashCommandOutcome =
  | { kind: 'direct'; response: string }
  | {
      kind: 'chat';
      effectivePrompt: string;
      toolNameFilter?: string[];
      maxIterations?: number;
      freshContext?: boolean;
    };

/**
 * Pure function — processes slash commands and returns the appropriate outcome.
 * Returns null when `prompt` is not a slash command (plain chat input).
 *
 * NOTE: slashCommandRegistry.initialize() must have been called before this
 * function is used. That call belongs in initializeAgents() at startup — once.
 * This function deliberately does NOT call initialize() itself so it remains
 * stateless and safe to call from tests without hidden filesystem side-effects.
 *
 * Both chat.ts and cli.ts replace their entire slash-command dispatch blocks
 * with a single call to this function.
 */
export function processSlashCommand(
  prompt: string,
  mcpManager: MCPServerManager | null,
): SlashCommandOutcome | null {
  if (!slashCommandRegistry.hasCommand(prompt)) {
    return null;
  }

  const parsed = slashCommandRegistry.parseInput(prompt);
  if (!parsed) {
    return null;
  }

  const cmd = slashCommandRegistry.getCommand(parsed.name)!;

  if (cmd.disableModelInvocation) {
    // Special case: mcp-status builds its response directly from the in-process
    // MCPServerManager to avoid a deadlock (execSync bash capture + self-HTTP call
    // would block the event loop before the server could respond to itself).
    if (parsed.name === 'mcp-status') {
      const response = mcpManager
        ? mcpManager.renderStatusMarkdown()
        : 'MCP manager not initialised yet.';
      return { kind: 'direct', response };
    }

    // Other commands with disableModelInvocation: return processed body directly
    const response = processCommand(cmd, parsed.args, slashCommandRegistry.getSkills());
    return { kind: 'direct', response };
  }

  const effectivePrompt = processCommand(cmd, parsed.args, slashCommandRegistry.getSkills());
  return {
    kind: 'chat',
    effectivePrompt,
    toolNameFilter: cmd.allowedTools,
    maxIterations: cmd.maxIterations,
    freshContext: cmd.freshContext,
  };
}
