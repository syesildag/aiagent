# Slash Commands & Skills

## Overview

The slash command system lets you define reusable AI workflows as plain Markdown files. Place them in `.claude/commands/` and invoke them anywhere — the CLI or the web chat — with `/command-name args`.

Skills are companion knowledge documents stored in `.claude/skills/`. Their content is automatically injected into every agent's system prompt so the LLM is always aware of project conventions, and they can also be explicitly referenced inside command bodies for deeper context.

The design is intentionally compatible with the [Claude Code plugin format](https://github.com/anthropics/claude-code): commands use the same Markdown-with-YAML-frontmatter convention, so commands written for Claude Code can be dropped in here with little or no modification.

---

## Directory Structure

```
.claude/
├── commands/          # Slash command definitions
│   ├── commit.md      # → /commit
│   ├── code-review.md # → /code-review
│   ├── git-status.md  # → /git-status
│   └── git/           # Subdirectory = namespace prefix
│       └── push-pr.md # → /git:push-pr
└── skills/            # Reusable knowledge documents
    ├── code-standards/
    │   └── SKILL.md   # Auto-injected + referenceable as "code-standards"
    └── git-workflow/
        └── SKILL.md   # "git-workflow" skill
```

The `.claude/` directory lives at the project root (next to `package.json`).

---

## Command Files

### Basic Format

A command file is a Markdown file with an optional YAML frontmatter block followed by the prompt body.

```markdown
---
description: Brief description shown in /help
argument-hint: [arg1] [arg2]
allowed-tools: memory, weather
model: sonnet
disable-model-invocation: false
---

Command prompt content. This is sent to the LLM as the user message.
```

All frontmatter fields are optional. A command file with no frontmatter at all is valid.

### Frontmatter Reference

| Field | Type | Default | Description |
|---|---|---|---|
| `description` | string | — | Short description shown in `/help` and `GET /commands` |
| `argument-hint` | string | — | Documents expected arguments, e.g. `[file-path] [priority]` |
| `allowed-tools` | string or array | all tools | Restricts which MCP tools the LLM may call (see [Tool Filtering](#tool-filtering)) |
| `model` | `haiku` \| `sonnet` \| `opus` | inherited | Override the LLM model for this command |
| `disable-model-invocation` | boolean | `false` | When `true`, the command body is returned directly without calling the LLM |

### Command Naming

The command name is derived from the file path relative to `.claude/commands/`:

| File | Command name |
|---|---|
| `commit.md` | `/commit` |
| `code-review.md` | `/code-review` |
| `git/push-pr.md` | `/git:push-pr` |
| `git/tag/release.md` | `/git:tag:release` |

---

## Prompt Syntax

### Arguments

Pass arguments after the command name: `/deploy app staging`.

Inside the body, use positional placeholders or capture all arguments at once:

```markdown
---
argument-hint: [app-name] [environment]
---

Deploy $1 to the $2 environment.
All arguments: $ARGUMENTS
```

| Placeholder | Meaning |
|---|---|
| `$1`, `$2`, … | Positional argument by index (1-based) |
| `$ARGUMENTS` | All arguments joined into a single string |

### File Inclusion — `@path`

Prefix a file path with `@` to inline its contents into the prompt at command-processing time:

```markdown
Review @src/utils/commandProcessor.ts for bugs.
```

Paths are resolved relative to the current working directory. If the file does not exist the `@path` token is left unchanged.

```markdown
---
argument-hint: [file-path]
---

Review @$1 for code quality issues.
```

### Bash Execution — `` !`command` ``

Wrap a shell command in backticks preceded by `!` to capture its stdout and embed it in the prompt:

```markdown
## Current Status

Branch: !`git branch --show-current`
Staged: !`git diff --cached --stat`
```

Execution happens at command-processing time, before the prompt reaches the LLM. Commands time out after 15 seconds. Failures produce a `[bash error: ...]` placeholder and do not abort processing.

### Conditional Logic — `$IF`

```markdown
$IF($1,
  Review file @$1,
  No file provided. Describe current project structure instead.
)
```

### Skill Reference

Mention a skill by name inside the body to have its full content appended to the prompt:

```markdown
Use the code-standards skill to validate the implementation.
```

Any text matching `Use the <skill-name> skill` (case-insensitive) triggers injection. Each skill is appended at most once per invocation.

---

## Tool Filtering

The `allowed-tools` frontmatter restricts which MCP tools the LLM may invoke during this command's session.

```yaml
# Server-name prefix — allows all tools from that server
allowed-tools: memory

# Multiple servers (comma-separated string)
allowed-tools: "memory, weather"

# Multiple servers (YAML array)
allowed-tools:
  - memory
  - weather

# Exact tool name
allowed-tools: memory_create

# Wildcard — all tools (same as omitting the field)
allowed-tools: "*"

# Read-only — no tools at all
allowed-tools: []
```

Patterns follow these matching rules (in order):

1. `*` matches any tool.
2. Exact match: `memory_create` matches only `memory_create`.
3. Server-prefix match: `memory` matches `memory_create`, `memory_search`, `memory_delete`, etc.

---

## `disable-model-invocation`

When this flag is `true` the LLM is never called. The processed command body (after argument substitution, file inclusion, and bash execution) is returned directly to the caller.

Use cases:
- Commands that print static reference material
- Commands that require human approval before anything runs
- Dry-run inspection of what would be sent to the LLM

```markdown
---
description: Show deployment runbook
disable-model-invocation: true
---

# Production Deployment Runbook

1. Run `npm run build`
2. Tag the release: `git tag -a vX.Y.Z -m "release"`
3. Push the Docker image to the registry
4. Update the Helm values file
5. Run `kubectl apply -f k8s/`
```

---

## Skills

### What is a Skill?

A skill is a Markdown document stored at `.claude/skills/<name>/SKILL.md`. Its purpose is to capture project-specific knowledge — coding standards, architecture decisions, workflow conventions — that the LLM should always apply.

### Auto-injection

All skills are loaded at runtime and their contents are appended to every agent's system prompt in a `<skills>…</skills>` block:

```
<skills>

## code-standards

[full SKILL.md content]

## git-workflow

[full SKILL.md content]

</skills>
```

This means the LLM will apply the documented standards in every conversation without you having to mention them.

### Explicit Reference in Commands

When a command body contains `Use the <skill-name> skill`, the full skill content is also appended directly to that command's prompt. This is useful for commands where a specific skill is especially relevant and you want to ensure the LLM focuses on it:

```markdown
---
description: Perform a thorough code review
argument-hint: [file-path]
---

Review @$1 for correctness and maintainability.

Use the code-standards skill to check TypeScript conventions and naming.
Use the git-workflow skill to verify commit readiness.
```

### Creating a Skill

```bash
mkdir -p .claude/skills/my-skill
touch .claude/skills/my-skill/SKILL.md
```

Write standard Markdown. There is no frontmatter required for skills.

```markdown
# My Skill

## Why this matters
...

## Rules
- Rule one
- Rule two
```

---

## Usage

### CLI

Type a slash command at the interactive prompt:

```
> /git-status
> /commit
> /code-review src/utils/commandProcessor.ts
> /git:push-pr "Add slash command system"
```

Type `/help` to list all loaded commands alongside the built-in commands:

```
> /help

Available commands:
  - help: Show this help message
  ...

Slash commands (from .claude/commands/):
  /git-status — Show a summary of the current git repository status
  /commit — Create a git commit with a meaningful message based on staged changes
  /code-review [file-path] — Review a file or the current git diff for code quality issues
  /git:push-pr [pr-title] — Commit all staged changes, push the branch, and open a pull request
```

### Web Chat

Send a slash command as the message body. The system intercepts it before it reaches the LLM:

```
POST /chat/general
{ "prompt": "/code-review src/index.ts" }
```

The server processes the command, substitutes arguments, runs any bash snippets, injects referenced skills, and passes the resulting prompt to the agent.

When `disable-model-invocation: true`, the processed body is streamed back immediately as a `{ t: "text", v: "..." }` NDJSON event — no LLM call is made.

### Listing Commands via API

```
GET /commands
```

Response:

```json
{
  "commands": [
    {
      "name": "git-status",
      "description": "Show a summary of the current git repository status",
      "argumentHint": null,
      "model": null,
      "disableModelInvocation": false,
      "allowedTools": ["*"]
    },
    {
      "name": "git:push-pr",
      "description": "Commit all staged changes, push the branch, and open a pull request",
      "argumentHint": "[pr-title]",
      "model": null,
      "disableModelInvocation": false,
      "allowedTools": ["*"]
    }
  ],
  "skills": ["code-standards", "git-workflow"]
}
```

This endpoint is unauthenticated and is intended for frontend autocomplete or tooling.

---

## Programmatic API

### `SlashCommandRegistry`

```typescript
import { slashCommandRegistry } from './utils/slashCommandRegistry';

// Load (no-op after first call)
slashCommandRegistry.initialize();

// Check if input is a slash command
slashCommandRegistry.hasCommand('/git-status');       // true
slashCommandRegistry.hasCommand('help');              // false (built-in)
slashCommandRegistry.hasCommand('/nonexistent');      // false

// Parse input
slashCommandRegistry.parseInput('/git:push-pr My title');
// → { name: 'git:push-pr', args: ['My', 'title'] }

// Retrieve a command
const cmd = slashCommandRegistry.getCommand('commit');

// List all commands
slashCommandRegistry.listCommands();

// Get skills map
slashCommandRegistry.getSkills(); // Map<string, Skill>

// Get the <skills> block for system prompt injection
slashCommandRegistry.getSkillsSystemPromptBlock();

// Force reload from disk
slashCommandRegistry.reload();
```

### `processCommand`

```typescript
import { processCommand } from './utils/commandProcessor';

const processed = processCommand(cmd, ['src/index.ts'], skills);
// Returns the final string to send to the LLM
```

### `loadSlashCommands` / `loadSkills`

```typescript
import { loadSlashCommands } from './utils/slashCommands';
import { loadSkills } from './utils/skillLoader';

const commands = loadSlashCommands('/path/to/commands');  // Map<string, SlashCommand>
const skills   = loadSkills('/path/to/skills');           // Map<string, Skill>
```

---

## Bundled Examples

The following commands ship with the project in `.claude/commands/`:

### `/git-status`

Runs `git status`, `git log --oneline -5`, and a dry-run fetch, then asks the LLM to summarise the state and suggest next steps. No arguments.

### `/commit`

Reads the staged diff and recent commit log, then writes and applies a conventional commit message. No arguments.

### `/code-review [file-path]`

Reviews a specific file (`@$1`) or falls back to `git diff HEAD` when no file is provided. Uses the `code-standards` skill. Rates issues as High / Medium / Low.

### `/git:push-pr [pr-title]`

Commits staged changes, pushes the branch, and opens a pull request via `gh pr create`. Demonstrates subdirectory namespacing.

---

## Implementation Reference

| Module | Location |
|---|---|
| YAML frontmatter parser | [src/utils/slashCommands.ts](../src/utils/slashCommands.ts) |
| Skill loader | [src/utils/skillLoader.ts](../src/utils/skillLoader.ts) |
| Prompt processing pipeline | [src/utils/commandProcessor.ts](../src/utils/commandProcessor.ts) |
| Registry singleton | [src/utils/slashCommandRegistry.ts](../src/utils/slashCommandRegistry.ts) |
| CLI integration | [src/cli.ts](../src/cli.ts) |
| Web route integration | [src/index.ts](../src/index.ts) |
| Agent system prompt injection | [src/agents/abstractAgent.ts](../src/agents/abstractAgent.ts) |
| `toolNameFilter` in LLM loop | [src/mcp/mcpManager.ts](../src/mcp/mcpManager.ts) |

### Processing Pipeline

```
User input: "/code-review src/auth.ts"
         │
         ▼
SlashCommandRegistry.hasCommand()  ← checks .claude/commands/
         │
         ▼
SlashCommandRegistry.parseInput()  → { name: "code-review", args: ["src/auth.ts"] }
         │
         ▼
processCommand()
  1. $1 → "src/auth.ts"
  2. @src/auth.ts → [file contents]
  3. !`bash command` → stdout
  4. "Use the code-standards skill" → append SKILL.md
         │
         ▼
agent.chat(processedPrompt, ..., toolNameFilter)
         │
         ▼
mcpManager.chatWithLLM({ toolNameFilter: ["memory", "weather"] })
  ↳ tools filtered to allowed set before LLM call
```

### System Prompt Injection

Every call to `agent.chat()` appends the skills block to the agent's base system prompt:

```
[Agent's base system prompt]

<skills>

## code-standards
[SKILL.md content]

## git-workflow
[SKILL.md content]

</skills>
```

This happens regardless of whether a slash command was used.
