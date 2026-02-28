import { randomUUID } from 'crypto';

/**
 * Represents a request for the user to approve a dangerous MCP tool call.
 * Follows the MCP 2025-11-25 human-in-the-loop specification.
 */
export interface ToolApprovalRequest {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  description: string;
}

/**
 * Callback type passed down the agent → mcpManager stack.
 * The callback is invoked when a dangerous tool is about to be executed.
 * Resolves to `true` (approve) or `false` (deny).
 */
export type ToolApprovalCallback = (
  toolName: string,
  args: Record<string, unknown>,
  description: string,
) => Promise<boolean>;

/**
 * Singleton store for pending tool-approval decisions.
 * The Express handler writes the approval event to the streaming response
 * and registers a promise here. The POST /chat/approve/:id endpoint later
 * resolves or rejects that promise with the user's decision.
 */
class ApprovalManager {
  private pending = new Map<string, (approved: boolean) => void>();

  /** Create a new pending approval entry; returns its unique id. */
  register(id: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.pending.set(id, resolve);
    });
  }

  /**
   * Resolve a pending approval with the user's decision.
   * Returns false if the id was not found (already resolved / timed out).
   */
  resolve(id: string, approved: boolean): boolean {
    const resolver = this.pending.get(id);
    if (!resolver) return false;
    this.pending.delete(id);
    resolver(approved);
    return true;
  }

  hasPending(id: string): boolean {
    return this.pending.has(id);
  }

  /** Create a ToolApprovalRequest with a fresh UUID. */
  buildRequest(
    toolName: string,
    args: Record<string, unknown>,
    description: string,
  ): ToolApprovalRequest {
    return { id: randomUUID(), toolName, args, description };
  }
}

export const approvalManager = new ApprovalManager();
