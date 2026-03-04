import { randomUUID } from 'crypto';
import { config } from '../utils/config';

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

interface PendingEntry {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Singleton store for pending tool-approval decisions.
 * The Express handler writes the approval event to the streaming response
 * and registers a promise here. The POST /chat/approve/:id endpoint later
 * resolves or rejects that promise with the user's decision.
 *
 * Pending approvals auto-deny after APPROVAL_TIMEOUT_MS to prevent indefinitely
 * blocked agent loops.
 */
class ApprovalManager {
  private pending = new Map<string, PendingEntry>();

  /** Create a new pending approval entry; returns its unique id. */
  register(id: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve(false);
        }
      }, config.APPROVAL_TIMEOUT_MS);

      this.pending.set(id, { resolve, timer });
    });
  }

  /**
   * Resolve a pending approval with the user's decision.
   * Returns false if the id was not found (already resolved / timed out).
   */
  resolve(id: string, approved: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(approved);
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
