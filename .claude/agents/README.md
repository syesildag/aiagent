# Project Agents

Place `.md` files here to define custom agents without writing TypeScript.

Agents in this directory are loaded at startup and take priority over built-in
class-based agents with the same name. User-level agents (`~/.claude/agents/`)
are also loaded but are overridden by project-level agents here.

## File Format

```markdown
---
name: my-agent
description: One-sentence description shown to the orchestrator LLM in the Task tool.
tools: weather, time       # MCP server names (comma or space separated); omit for all servers
model: sonnet              # optional — overrides the global LLM model for this agent
---

Your system prompt goes here. This becomes the agent's system prompt verbatim.
```

## Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | ✅ | Agent identifier used in URLs (`/chat/<name>`) and the Task tool |
| `description` | — | Shown to the orchestrator so it knows when to delegate to this agent |
| `tools` | — | Comma/space-separated list of MCP server names this agent may use; omit to allow all |
| `model` | — | Override the global LLM model (e.g. `sonnet`, `haiku`, `opus`) for this agent only |

## Example

```markdown
---
name: docs-writer
description: Technical documentation specialist that writes clear, structured docs.
tools: memory, fetch
---

You are a technical documentation specialist. Write clear, concise, and well-structured
documentation. Use Markdown formatting. Focus on accuracy and completeness.
```

Once this file is saved, restart the server and the `docs-writer` agent will be
available at `/chat/docs-writer` and as a sub-agent in the Task tool.
