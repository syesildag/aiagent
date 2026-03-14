---
description: List all MCP server information — tools, capabilities, resources, and descriptions
argument-hint: [server-name to filter]
allowed-tools: Read, Glob, Grep, ListMcpResourcesTool, ReadMcpResourceTool
fresh-context: true
---

## Task

Produce a detailed report of all configured MCP servers in two sections.

**Filter:** `$ARGUMENTS`
If a server name is provided above, restrict the report to only that server. If empty, show all servers.

---

### Step 0 — Handle the filter argument

If `$ARGUMENTS` is non-empty, store the value as the server name filter (case-insensitive). All subsequent steps apply only to servers whose `name` field matches this filter. If no server matches, print:
> Error: No server named "$ARGUMENTS" found in mcp-servers.json.

Then stop.

---

### Step 1 — Read and classify servers from `mcp-servers.json`

Read the file `mcp-servers.json` at the project root.

For each entry in the `servers` array, classify it as one of three categories:

- **Local** — `command` is `"node"` and `args[0]` contains `dist/src/mcp/server/`
- **External npm** — `command` starts with `./node_modules/`
- **SSE remote** — entry has a `protocol: "sse"` field and an `httpUrl`

Apply the name filter from Step 0 if set.

---

### Step 2 — Inspect local server source files

For each **Local** server (after filtering):

1. Derive the TypeScript source path by replacing `dist/src/mcp/server/<name>.js` with `src/mcp/server/<name>.ts`
2. Use `Grep` with pattern `registerTool|registerResource` on that file to locate all capability registrations, then read the surrounding context
3. For each `server.registerTool(` call, extract:
   - Tool name (first string argument, e.g. `"memory_create"`)
   - `title` field from the second argument object
   - `description` field from the second argument object
4. For each `server.registerResource(` call, extract:
   - Resource name (first string argument)
   - URI pattern (second argument — string literal or `new ResourceTemplate("...", ...)`)
   - `title` and `description` from the metadata object

---

### Section 1 — Project Backend MCP Servers

Output one subsection per server (filtered or all) using this format:

---

#### `<server-name>` — <Category> <Enabled/Disabled>

| Field | Value |
|-------|-------|
| Status | ✓ Enabled / ✗ Disabled |
| Transport | stdio / SSE |
| Command | `<command and args>` or `<httpUrl>` |
| Env vars | `VAR_NAME` — one per row, or none |

**Tools** (Local servers only):

| Tool Name | Title | Description |
|-----------|-------|-------------|
| `tool_name` | Tool Title | Description (truncated to 100 chars if needed) |

**Resources** (Local servers only, if any):

| Resource Name | URI Pattern | Description |
|---------------|-------------|-------------|
| `resource-name` | `resource://uri/{param}` | Description |

For **External npm** servers, omit the tables and add:
> Source is an external npm package — tools are not introspectable from this codebase.

For **SSE remote** servers, omit the tables and add:
> Remote SSE service at `<httpUrl>` — tools depend on the running remote process.

---

### Step 3 — Enumerate Claude Code's connected MCP runtime

Call `ListMcpResourcesTool` to list all resources available from Claude Code's own connected MCP servers.

Also, describe the MCP tools currently available in your context: look at your available tools list and identify all tools whose names follow the `mcp__<serverName>__<toolName>` pattern. Group them by server name.

---

### Section 2 — Claude Code Connected MCP Servers

Output one subsection per connected MCP server:

#### `<serverName>`

**Tools available in runtime:**

| Tool Name | Description |
|-----------|-------------|
| `mcp__server__tool` | Brief description |

**Resources** (from ListMcpResourcesTool, if any):

| URI | Description |
|-----|-------------|
| `resource://uri` | Description |

If no MCP tools or resources are available in the current Claude Code context, print:
> No MCP tools or resources available in the current Claude Code session.

---

### Final summary line

End with a one-line summary, e.g.:
> **Project servers:** 10 total (9 enabled) — 6 local, 3 external npm, 1 SSE remote. **Claude Code MCP servers:** N connected.
