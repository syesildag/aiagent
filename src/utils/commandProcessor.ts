import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { SlashCommand } from './slashCommands';
import { Skill } from './skillLoader';

/**
 * Evaluate $IF / $ELSE / $ENDIF blocks.
 *
 * Syntax (each keyword must be on its own line):
 *
 *   $IF <expr>
 *   ...true branch...
 *   $ELSE
 *   ...false branch...
 *   $ENDIF
 *
 * <expr> is truthy when it is a non-empty, non-whitespace string after
 * argument substitution has already been applied.
 */
function evaluateConditionals(body: string): string {
  // Match $IF ... $ENDIF blocks (with optional $ELSE), non-greedy
  return body.replace(
    /^\$IF ([^\n]*)\n([\s\S]*?)(?:^\$ELSE\n([\s\S]*?))?^\$ENDIF$/gm,
    (_match, condition: string, trueBranch: string, falseBranch = '') => {
      const isTruthy = condition.trim().length > 0;
      return isTruthy ? trueBranch : falseBranch;
    },
  );
}

/**
 * Process a slash-command body, returning the final prompt to send to the LLM.
 *
 * Pipeline:
 *  1. Argument substitution — $1, $2, ... and $ARGUMENTS
 *  2. Conditional blocks    — $IF / $ELSE / $ENDIF
 *  3. File inclusion        — @path/to/file replaced with file contents
 *  4. Bash execution        — !`command` replaced with stdout
 *  5. Skill injection       — "Use the <skill-name> skill" appends full skill body
 */
export function processCommand(
  command: SlashCommand,
  args: string[],
  skills: Map<string, Skill>,
): string {
  let body = command.body;

  // ── 1. Argument substitution ──────────────────────────────────────────────
  const allArgs = args.join(' ');
  body = body.replace(/\$ARGUMENTS/g, allArgs);
  body = body.replace(/\$(\d+)/g, (_match, index) => {
    const idx = parseInt(index, 10) - 1;
    return args[idx] ?? '';
  });

  // ── 2. Conditional blocks ─────────────────────────────────────────────────
  body = evaluateConditionals(body);

  // ── 3. File inclusion: @path/to/file ──────────────────────────────────────
  body = body.replace(/@([\S]+)/g, (_match, filePath: string) => {
    try {
      // Resolve relative to cwd
      const resolved = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(process.cwd(), filePath);
      if (fs.existsSync(resolved)) {
        return fs.readFileSync(resolved, 'utf-8');
      }
    } catch {
      // Leave unchanged if unreadable
    }
    return _match;
  });

  // ── 4. Bash execution: !`command` ─────────────────────────────────────────
  body = body.replace(/!`([^`]+)`/g, (_match, cmd: string) => {
    try {
      return execSync(cmd, { encoding: 'utf-8', timeout: 15_000 }).trim();
    } catch (err: any) {
      return `[bash error: ${err.message ?? String(err)}]`;
    }
  });

  // ── 5. Skill injection ────────────────────────────────────────────────────
  // Pattern: "Use the <skill-name> skill" — case-insensitive
  const skillPattern = /Use the ([\w-]+) skill/gi;
  const referencedSkills: Skill[] = [];
  let match: RegExpExecArray | null;

  while ((match = skillPattern.exec(body)) !== null) {
    const skillName = match[1].toLowerCase();
    const skill = skills.get(skillName);
    if (skill && !referencedSkills.includes(skill)) {
      referencedSkills.push(skill);
    }
  }

  if (referencedSkills.length > 0) {
    body += '\n\n---\n';
    for (const skill of referencedSkills) {
      body += `\n## Skill: ${skill.name}\n\n${skill.content}\n`;
    }
  }

  return body;
}

/**
 * Return true if a tool name matches an allowed-tools pattern.
 *
 * Patterns are server-name prefixes (e.g. "memory" matches "memory_create")
 * or full tool names, with "*" as a match-all wildcard.
 */
export function toolMatchesPattern(toolName: string, pattern: string): boolean {
  if (pattern === '*') return true;
  // Exact match
  if (toolName === pattern) return true;
  // Prefix match: "memory" matches "memory_create"
  if (toolName.startsWith(pattern + '_')) return true;
  return false;
}

/**
 * Filter a list of tool names to only those allowed by the given patterns.
 * If patterns is undefined/empty, all tools are allowed.
 */
export function filterToolsByPatterns(
  toolNames: string[],
  patterns: string[] | undefined,
): string[] {
  if (!patterns || patterns.length === 0) return toolNames;
  return toolNames.filter(name => patterns.some(p => toolMatchesPattern(name, p)));
}
