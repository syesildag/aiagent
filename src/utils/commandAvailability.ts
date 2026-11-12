/**
 * A slash command names the MCP servers it needs in `allowed-tools`. It is usable only when
 * each of those servers is enabled in mcp-servers.json. A command that names no server, or
 * the '*' wildcard, needs none.
 *
 * Returns the named servers that are not enabled (empty when the command is available).
 */
export function missingServers(
  allowedTools: string[] | undefined,
  enabledServerNames: ReadonlySet<string>,
): string[] {
  if (!allowedTools || allowedTools.includes('*')) return [];
  return allowedTools.filter(name => !enabledServerNames.has(name));
}
