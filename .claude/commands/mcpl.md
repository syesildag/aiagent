---
description: List all MCP server information — tools, capabilities, resources, and descriptions
argument-hint: [server-name to filter]
allowed-tools: Read, Glob, ListMcpResourcesTool, ReadMcpResourceTool
fresh-context: true
---

## Task

Produce a detailed report of all configured MCP servers in two sections:

---

### Section 1 — Project Backend MCP Servers

Read the file `mcp-servers.json` at the project root using the `Read` tool.

For each server entry, display:

```
## <name>  [enabled ✓ | disabled ✗]
Protocol:  stdio | sse
Command:   <command> <args…>   (stdio)  OR  URL: <httpUrl>  (sse)
Env vars:  <list of env key names, if any>
```

$IF $ARGUMENTS
Only show servers whose name contains **$ARGUMENTS** (case-insensitive).
$ENDIF

---

### Section 2 — Claude Code MCP Servers (live)

Call `ListMcpResourcesTool` to retrieve all resources currently exposed by Claude Code's connected MCP servers. For each resource returned, display:

```
URI:         <uri>
Name:        <name>
Description: <description>
MIME type:   <mimeType>
```

Group resources under their server name (derived from the URI prefix before the first `://` or `/`).

$IF $ARGUMENTS
Only show servers whose name contains **$ARGUMENTS** (case-insensitive).
$ENDIF

---

### Section 3 — Available MCP Tools (from context)

List all MCP tools available in this session (visible as `mcp__<server>__<tool>` in context). Group by server name and for each tool show:

```
Tool:        <tool_name>
Full name:   mcp__<server>__<tool_name>
```

$IF $ARGUMENTS
Only show tools whose server name contains **$ARGUMENTS** (case-insensitive).
$ENDIF

---

### Summary

After all sections, print a one-line summary:
- Total project backend servers (enabled / total)
- Total Claude Code resources found
- Total MCP tool names listed

Keep formatting clean. Use markdown headers and code blocks. Do not skip any server or tool.
