import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import Logger from './logger';

export interface SlashCommand {
  /** Derived name, e.g. "commit" or "git:commit" */
  name: string;
  /** Absolute path to the .md file */
  filePath: string;
  /** From `description:` frontmatter */
  description?: string;
  /** From `argument-hint:` frontmatter */
  argumentHint?: string;
  /**
   * From `allowed-tools:` frontmatter.
   * Values are server-name prefixes (e.g. "memory", "weather") or "*" for all.
   */
  allowedTools?: string[];
  /** From `model:` frontmatter */
  model?: string;
  /** From `disable-model-invocation:` frontmatter */
  disableModelInvocation?: boolean;
  /**
   * From `max-iterations:` frontmatter.
   * Overrides the global MAX_LLM_ITERATIONS setting for this command.
   * Useful for commands that require many sequential tool calls (e.g. daily briefings).
   */
  maxIterations?: number;
  /**
   * From `fresh-context:` frontmatter.
   * When true, the LLM call uses only the current message — prior conversation
   * history is not injected. Useful for stateless commands (e.g. daily briefings)
   * that don't need earlier chat context and would otherwise overflow the token budget.
   */
  freshContext?: boolean;
  /** Raw Markdown body after the YAML frontmatter */
  body: string;
}

/**
 * Recursively collect all .md files under a directory.
 * Returns [absolutePath, relativePathFromBase] tuples.
 */
function collectMdFiles(dir: string, base: string = dir): Array<[string, string]> {
  if (!fs.existsSync(dir)) return [];
  const results: Array<[string, string]> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMdFiles(fullPath, base));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push([fullPath, path.relative(base, fullPath)]);
    }
  }

  return results;
}

/**
 * Derive a slash-command name from a relative path.
 *   commit.md           → "commit"
 *   git/commit.md       → "git:commit"
 *   git/push/pr.md      → "git:push:pr"
 */
export function deriveCommandName(relativePath: string): string {
  const normalized = relativePath.replace(/\.md$/, '');
  // Normalise platform path separator to ":"
  const parts = normalized.split(/[/\\]/);
  return parts.join(':');
}

/**
 * Parse the `allowed-tools` frontmatter value.
 * Supports a comma-separated string or a YAML array.
 */
function parseAllowedTools(value: unknown): string[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean);
  return undefined;
}

/**
 * Load all slash commands from `commandsDir`.
 * Returns a Map keyed by command name (e.g. "git:commit").
 */
export function loadSlashCommands(commandsDir: string): Map<string, SlashCommand> {
  const commands = new Map<string, SlashCommand>();

  for (const [filePath, relativePath] of collectMdFiles(commandsDir)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const { data, content } = matter(raw);
      const name = deriveCommandName(relativePath);

      const rawMaxIter = data['max-iterations'];
      const maxIterations =
        rawMaxIter !== undefined && rawMaxIter !== null
          ? parseInt(String(rawMaxIter), 10) || undefined
          : undefined;

      commands.set(name, {
        name,
        filePath,
        description: data.description ? String(data.description) : undefined,
        argumentHint: data['argument-hint'] ? String(data['argument-hint']) : undefined,
        allowedTools: parseAllowedTools(data['allowed-tools']),
        model: data.model ? String(data.model) : undefined,
        disableModelInvocation: data['disable-model-invocation'] === true,
        maxIterations,
        freshContext: data['fresh-context'] === true,
        body: content.trim(),
      });
    } catch (err) {
      Logger.warn(`[SlashCommands] Failed to load ${filePath}: ${err}`);
    }
  }

  return commands;
}
