import { randomUUID } from 'crypto';
import { config } from '../utils/config';

/**
 * Sentinel tool name used when asking the user whether to continue past max iterations.
 * Reuses the same approval mechanism as dangerous-tool approvals.
 */
export const CONTINUE_ITERATIONS_TOOL = '__continue_iterations__';

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
  schema?: { properties?: Record<string, { type?: string; description?: string; [key: string]: unknown }>; required?: string[] },
) => Promise<boolean>;

interface PendingEntry {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Login of the user whose chat raised the request; only they may decide it. */
  ownerLogin: string;
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

  /**
   * Create a new pending approval entry owned by `ownerLogin`.
   * Resolves with the owner's decision, or false on timeout.
   */
  register(id: string, ownerLogin: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve(false);
        }
      }, config.APPROVAL_TIMEOUT_MS);

      this.pending.set(id, { resolve, timer, ownerLogin });
    });
  }

  /**
   * Resolve a pending approval with the user's decision.
   * Returns false if the id was not found (already resolved / timed out) or if
   * `requesterLogin` is not the user who owns the request — another user must
   * never be able to approve a dangerous tool call on someone else's behalf.
   */
  resolve(id: string, approved: boolean, requesterLogin: string): boolean {
    const entry = this.pending.get(id);
    if (!entry || entry.ownerLogin !== requesterLogin) return false;
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
