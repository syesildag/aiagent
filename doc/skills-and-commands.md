# Skills & Slash Commands

This document describes how the unified skills system works — how skills are defined, loaded, activated, and how they double as slash commands.

---

## Overview

All reusable agent behaviours live in `.claude/skills/`. Each skill is a directory containing a `SKILL.md` file. Skills serve two purposes:

| Mode | Trigger | Mechanism |
|------|---------|-----------|
| **Slash command** | User types `/skill-name [args]` | Registered in `SlashCommandRegistry` via `user-invocable: true` |
| **Semantic injection** | User writes a natural-language prompt | Injected into the system prompt when cosine similarity ≥ 0.40 and `injectable: true` |

---

## Directory Layout

```
.claude/skills/
├── code-standards/
│   └── SKILL.md          # knowledge skill — injectable, no slash command
├── git-workflow/
│   └── SKILL.md          # knowledge skill — injectable, no slash command
├── daily-briefing/
│   └── SKILL.md          # user-invocable + injectable
├── forecast/
│   └── SKILL.md          # user-invocable + injectable
├── jobs/
│   └── SKILL.md          # user-invocable, not injectable
├── mcp-status/
│   └── SKILL.md          # user-invocable, not injectable, no LLM call
└── memory/
    ├── list/
    │   └── SKILL.md      # user-invocable, not injectable
    ├── log/
    │   └── SKILL.md      # user-invocable, not injectable
    └── del/
        └── SKILL.md      # user-invocable, not injectable
```

Nested directories produce colon-separated names: `memory/list` → `memory:list`.

---

## SKILL.md Frontmatter

```yaml
---
# Official supported keys
description:               # Short description used for semantic matching and autocomplete
argument-hint:             # "[city or location]"  — shown during /command autocomplete
user-invocable:            # true → register as a slash command
disable-model-invocation:  # true → return skill body directly, no LLM call (e.g. /mcp-status)

# Project-specific keys (must go under `metadata:`)
metadata:
  allowed-tools:           # Comma-separated MCP server names (e.g. "memory, weather, time")
  max-iterations:          # Max LLM tool-call loops (default: global MAX_LLM_ITERATIONS)
  fresh-context:           # true → start with a clean conversation history
  injectable:              # true/false — override the default injection behaviour (see below)
---
```

### Why `metadata:`?

Only a fixed set of keys are officially supported at the top level (`description`, `argument-hint`, `user-invocable`, `disable-model-invocation`, `name`, `compatibility`, `license`). Project-specific operational settings (`allowed-tools`, `max-iterations`, `fresh-context`, `injectable`) live under `metadata:` to avoid schema conflicts.

---

## The `injectable` Flag

`injectable` controls whether a skill's content is included in the agent system prompt for natural-language queries.

### Default values

| Skill type | Default `injectable` |
|------------|---------------------|
| Knowledge skill (no `user-invocable`) | `true` |
| User-invocable slash command | `false` |

This default can be overridden with `injectable: true` or `injectable: false` under `metadata:`.

### Activation paths

```
User prompt
    │
    ├─ starts with "/"  ──► SlashCommandRegistry.hasCommand()
    │                              │
    │                        matched? ──► execute skill body as slash command
    │
    └─ natural language ──► getSkillsSystemPromptBlockForPrompt()
                                   │
                              filter injectable === true
                                   │
                              compute cosine similarity
                              (prompt vs. skill description)
                                   │
                              similarity ≥ 0.40? ──► inject into system prompt
```

### Examples

| Skill | `injectable` | Result |
|-------|-------------|--------|
| `code-standards` | `true` (default) | Injected when user asks about code quality, linting, TypeScript style, etc. |
| `git-workflow` | `true` (default) | Injected when user asks about branching, commits, PRs, etc. |
| `daily-briefing` | `true` (explicit) | Works as `/daily-briefing` AND when user says "give me the daily briefing" |
| `forecast` | `true` (explicit) | Works as `/forecast Paris` AND "what's the weather in Paris?" |
| `jobs` | `false` (explicit) | Only works via `/jobs` — not triggered by unrelated queries |
| `mcp-status` | `false` (explicit) | Only works via `/mcp-status` |
| `memory:list` | `false` (explicit) | Only works via `/memory:list` |

---

## Slash Commands

Any skill with `user-invocable: true` is automatically registered as a slash command. The command name is derived from the skill's directory path:

| Directory | Command |
|-----------|---------|
| `daily-briefing/` | `/daily-briefing` |
| `memory/list/` | `/memory:list` |
| `memory/log/` | `/memory:log` |
| `memory/del/` | `/memory:del` |
| `jobs/` | `/jobs` |
| `mcp-status/` | `/mcp-status` |
| `forecast/` | `/forecast` |

### Usage

```
/daily-briefing [city]
/forecast Paris
/memory:list
/memory:log user prefers dark mode
/memory:del dark mode
/jobs
/mcp-status
```

### Special case: `disable-model-invocation: true`

When set, the skill body is returned verbatim to the client without any LLM call. Used by `/mcp-status` to return live cache state from the server handler directly.

---

## How Skills Are Loaded

`src/utils/skillLoader.ts` — `loadSkills(skillsDir)`:

1. Recursively walks `.claude/skills/` for directories containing `SKILL.md`
2. Parses YAML frontmatter with `gray-matter`
3. Detects `user-invocable: true` → builds `commandMeta` from `metadata` block
4. Computes `injectable` (default: `!isUserInvocable`, overridable via `metadata.injectable`)
5. Uses `frontmatter.description` (preferred) or H1+first-paragraph as the semantic matching description
6. Returns `Map<string, Skill>`

`src/utils/slashCommandRegistry.ts` — `SlashCommandRegistry.initialize()`:

1. Calls `loadSkills()`
2. For each skill with `commandMeta`, registers a `SlashCommand` entry
3. Command body = skill content with frontmatter stripped

---

## Adding a New Skill

### Knowledge skill (semantic injection only)

Create `.claude/skills/my-topic/SKILL.md`:

```markdown
---
description: Brief description used for semantic matching
---

# My Topic

Content that will be injected into the system prompt when relevant.
```

No `user-invocable` → not a slash command. No `metadata.injectable` → defaults to `true`.

### Slash command (user-invocable)

Create `.claude/skills/my-command/SKILL.md`:

```markdown
---
description: What this command does
argument-hint: "[optional-arg]"
user-invocable: true
metadata:
  allowed-tools: my-mcp-server
  max-iterations: 10
  fresh-context: true
  injectable: false
---

Instructions for the LLM. Use $ARGUMENTS for all arguments, or $1, $2 for positional ones.
```

### Slash command that also responds to natural language

Same as above but set `injectable: true`:

```yaml
metadata:
  injectable: true
```

---

## Semantic Similarity Threshold

The default threshold is **0.40** (cosine similarity). Skills below this score for a given prompt are not injected.

- Scores are logged at `DEBUG` level: `[Skills] "skill-name" similarity=0.412 threshold=0.40`
- Matched skills are logged at `INFO` level: `[Skills] Loaded "skill-name" (similarity=0.412)`
- If the embedding service is unavailable, all injectable skills are included as a fallback

---

## Built-in Command Names (Reserved)

The following names cannot be used as skill/command names — they are reserved for CLI built-ins:

`help`, `login`, `model`, `status`, `refresh`, `new`, `newchat`, `history`, `current`, `clearchat`, `cancel`, `clear`, `exit`, `quit`
