/**
 * Per-user access rules for the memory MCP server.
 *
 * The host (ToolExecutor) injects the authenticated identity into every call
 * as `_userLogin` and `_isAdmin`. The LLM-visible `user_login` argument is NOT
 * trusted for authorization: a user (or a prompt injection) could ask for
 * anyone's memories.
 */
import Logger from "../../utils/logger.js";

export interface MemoryUserContext {
  /** Authenticated user, or null when no user is attached (CLI, system jobs). */
  userLogin: string | null;
  isAdmin: boolean;
}

/** Read the host-injected identity from raw tool arguments. */
export function extractUserContext(args: unknown): MemoryUserContext {
  const { _userLogin, _isAdmin } = (args ?? {}) as Record<string, unknown>;
  return {
    userLogin: typeof _userLogin === 'string' && _userLogin.length > 0 ? _userLogin : null,
    isAdmin: _isAdmin === true,
  };
}

/**
 * Decide whose memories a call may touch.
 *  - authenticated non-admin → always their own login; `user_login` is ignored
 *  - admin                   → the requested `user_login`, defaulting to their own
 *  - no authenticated user   → the requested `user_login` (local operator / system job)
 */
export function resolveScopedUser(ctx: MemoryUserContext, requested: string | undefined): string | undefined {
  if (ctx.userLogin && !ctx.isAdmin) {
    if (requested && requested !== ctx.userLogin) {
      Logger.warn(`[Memory] Ignoring user_login="${requested}" requested by "${ctx.userLogin}"`);
    }
    return ctx.userLogin;
  }
  if (ctx.userLogin && ctx.isAdmin) return requested ?? ctx.userLogin;
  return requested;
}

/** True when an authenticated non-admin user may not modify a memory owned by `ownerLogin`. */
export function isForeignMemory(ctx: MemoryUserContext, ownerLogin: string | undefined | null): boolean {
  if (!ctx.userLogin || ctx.isAdmin) return false;
  // Global memories (no owner) are shared; only admins may delete them.
  return ownerLogin !== ctx.userLogin;
}
