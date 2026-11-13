import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { SlashCommand } from './slashCommands';
import { Skill } from './skillLoader';

/** Matches `$ARGUMENTS` and positional `$1`, `$2`, … placeholders. */
const ARG_PLACEHOLDER = /\$ARGUMENTS|\$(\d+)/g;

/**
 * One pass over the command template. Each match is one of:
 *   1. a bash capture    !`command`
 *   2. a file inclusion  @path
 *   3. an argument       $ARGUMENTS | $N
 *
 * Text produced by a replacement is never scanned again. Argument values come
 * from the (untrusted) user, so they must never be read as a bash capture or a
 * file inclusion.
 */
const TEMPLATE_DIRECTIVE = /!`([^`]+)`|@(\S+)|\$ARGUMENTS|\$(\d+)/g;

/** Environment variable that carries `$ARGUMENTS` into a bash capture. */
const ARGUMENTS_ENV = 'AIAGENT_ARGUMENTS';
/** Prefix of the environment variables that carry `$N` into a bash capture. */
const ARG_ENV_PREFIX = 'AIAGENT_ARG_';

/** Replace argument placeholders with the raw argument values (plain text only). */
function substituteArgs(text: string, args: string[]): string {
  return text.replace(ARG_PLACEHOLDER, (_match, index?: string) =>
    index === undefined ? args.join(' ') : args[parseInt(index, 10) - 1] ?? '',
  );
}

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
 * argument substitution. Branches are returned unexpanded so that argument
 * values are never parsed as template syntax.
 */
function evaluateConditionals(body: string, args: string[]): string {
  // Match $IF ... $ENDIF blocks (with optional $ELSE), non-greedy
  return body.replace(
    /^\$IF ([^\n]*)\n([\s\S]*?)(?:^\$ELSE\n([\s\S]*?))?^\$ENDIF$/gm,
    (_match, condition: string, trueBranch: string, falseBranch = '') => {
      const isTruthy = substituteArgs(condition, args).trim().length > 0;
      return isTruthy ? trueBranch : falseBranch;
    },
  );
}

/**
 * Run a bash capture from the command template.
 *
 * Argument placeholders inside the command are NOT pasted into the shell
 * source: they become references to environment variables holding the values.
 * The shell never parses an expanded variable as code, so an argument such as
 * `$(rm -rf ~)` or `;id` stays plain data.
 */
function runBashCapture(commandTemplate: string, args: string[]): string {
  const env: NodeJS.ProcessEnv = { ...process.env, [ARGUMENTS_ENV]: args.join(' ') };
  args.forEach((value, i) => { env[`${ARG_ENV_PREFIX}${i + 1}`] = value; });

  const command = commandTemplate.replace(ARG_PLACEHOLDER, (_match, index?: string) =>
    index === undefined ? `\${${ARGUMENTS_ENV}}` : `\${${ARG_ENV_PREFIX}${parseInt(index, 10)}}`,
  );

  try {
    return execSync(command, { encoding: 'utf-8', timeout: 15_000, env }).trim();
  } catch (err: unknown) {
    return `[bash error: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

/**
 * Replace `@path` with the file's contents. The path comes from the command
 * template only; a path built from an argument (e.g. `@$1`) is never read,
 * otherwise any user could read arbitrary files on the server.
 */
function includeFile(match: string, filePath: string, args: string[]): string {
  if (new RegExp(ARG_PLACEHOLDER.source).test(filePath)) {
    return `@${substituteArgs(filePath, args)}`;
  }
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
  return match;
}

/**
 * Process a slash-command body, returning the final prompt to send to the LLM.
 *
 * Pipeline:
 *  1. Conditional blocks — $IF / $ELSE / $ENDIF (conditions see argument values)
 *  2. One pass over the template:
 *       !`command`         replaced with stdout (arguments passed as env vars)
 *       @path/to/file      replaced with file contents (template paths only)
 *       $1, $ARGUMENTS     replaced with the argument values, as plain text
 *  3. Skill injection — "Use the <skill-name> skill" appends full skill body
 *
 * SECURITY: arguments are user input (any web user can call a slash command).
 * They are substituted in the same pass as the directives, so an argument
 * containing !`…` or @/etc/passwd is never executed or read.
 */
export function processCommand(
  command: SlashCommand,
  args: string[],
  skills: Map<string, Skill>,
): string {
  // ── 1. Conditional blocks ─────────────────────────────────────────────────
  let body = evaluateConditionals(command.body, args);

  // ── 2. Bash captures, file inclusion and arguments, in a single pass ──────
  body = body.replace(
    TEMPLATE_DIRECTIVE,
    (match, bashCommand?: string, filePath?: string, argIndex?: string) => {
      if (bashCommand !== undefined) return runBashCapture(bashCommand, args);
      if (filePath !== undefined) return includeFile(match, filePath, args);
      if (argIndex !== undefined) return args[parseInt(argIndex, 10) - 1] ?? '';
      return args.join(' '); // $ARGUMENTS
    },
  );

  // ── 3. Skill injection ────────────────────────────────────────────────────
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
