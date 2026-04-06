import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import Logger from './logger';

/** Command-execution metadata parsed from SKILL.md frontmatter. */
export interface SkillCommandMeta {
  description?: string;
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
  disableModelInvocation?: boolean;
  maxIterations?: number;
  freshContext?: boolean;
}

export interface Skill {
  /** Skill name derived from directory path, e.g. "memory:list" */
  name: string;
  /** Full content of SKILL.md (including frontmatter) */
  content: string;
  /** Absolute path to SKILL.md */
  filePath: string;
  /** Extracted H1 title + first paragraph. Used for semantic similarity matching. */
  description: string;
  /**
   * Present when the SKILL.md declares slash-command frontmatter keys.
   * When set, the skill is also registered as a slash command.
   */
  commandMeta?: SkillCommandMeta;
  /**
   * Whether this skill should be injected into agent system prompts.
   * Defaults to true for knowledge skills, false for command-only skills.
   * Can be overridden with `injectable: true/false` frontmatter.
   */
  injectable: boolean;
  /**
   * Optional keyword tags used by the tag-based routing strategy.
   * When `SKILL_ROUTING_STRATEGY=tags`, a skill is injected only when at
   * least one tag appears as a substring in the user's prompt.
   * Parsed from `tags:` frontmatter (array or comma-separated string).
   */
  tags?: string[];
}

/**
 * Extracts a short description from SKILL.md content.
 * Uses the H1 title and the first paragraph before the first ## section.
 */
export function extractSkillDescription(content: string): string {
  // Strip YAML frontmatter before scanning for markdown structure
  const body = matter(content).content;
  const lines = body.split('\n');
  let title = '';
  const descLines: string[] = [];
  let inDesc = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!title && trimmed.startsWith('# ')) {
      title = trimmed.slice(2).trim();
      inDesc = true;
      continue;
    }
    if (trimmed.startsWith('## ')) break;
    if (inDesc) {
      if (trimmed.length > 0) {
        descLines.push(trimmed);
      } else if (descLines.length > 0) {
        break; // end of first paragraph
      }
    }
  }

  const desc = descLines.join(' ');
  if (title && desc) return `${title} - ${desc}`;
  return title || desc || content.slice(0, 200);
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
 * A skill is also a slash command when `user-invocable: true` is declared.
 * Command-specific config that is not in the supported schema lives under `metadata`.
 */

/**
 * Recursively walk `dir`, collecting [absolutePath, relativeDir] for every
 * directory that contains a SKILL.md file.
 */
function collectSkillDirs(
  dir: string,
  base: string = dir,
): Array<[string, string]> {
  if (!fs.existsSync(dir)) return [];
  const results: Array<[string, string]> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const fullDir = path.join(dir, entry.name);
    const skillMd = path.join(fullDir, 'SKILL.md');
    if (fs.existsSync(skillMd)) {
      results.push([skillMd, path.relative(base, fullDir)]);
    }
    // Recurse regardless — nested skills like memory/list are valid
    results.push(...collectSkillDirs(fullDir, base));
  }

  return results;
}

/**
 * Derive a skill/command name from a relative directory path.
 *   "daily-briefing"   → "daily-briefing"
 *   "memory/list"      → "memory:list"
 */
function deriveSkillName(relativeDir: string): string {
  const parts = relativeDir.split(/[/\\]/);
  return parts.join(':');
}

/**
 * Load all skills from `skillsDir`.
 * Each skill is a directory (at any depth) containing a `SKILL.md` file.
 * Returns a Map keyed by skill name (e.g. "memory:list").
 */
export function loadSkills(skillsDir: string): Map<string, Skill> {
  const skills = new Map<string, Skill>();

  if (!fs.existsSync(skillsDir)) return skills;

  for (const [skillMdPath, relativeDir] of collectSkillDirs(skillsDir)) {
    try {
      const raw = fs.readFileSync(skillMdPath, 'utf-8').trim();
      const { data } = matter(raw);
      const name = deriveSkillName(relativeDir);

      // A skill becomes a slash command when `user-invocable: true` is declared.
      // Command-specific config that falls outside the supported schema lives under `metadata`.
      const isUserInvocable = data['user-invocable'] === true;
      let commandMeta: SkillCommandMeta | undefined;

      if (isUserInvocable) {
        const meta = (data.metadata ?? {}) as Record<string, unknown>;
        const rawMaxIter = meta['max-iterations'];
        commandMeta = {
          description: data.description ? String(data.description) : undefined,
          argumentHint: data['argument-hint'] ? String(data['argument-hint']) : undefined,
          allowedTools: parseAllowedTools(meta['allowed-tools']),
          model: data.model ? String(data.model) : undefined,
          disableModelInvocation: data['disable-model-invocation'] === true,
          maxIterations:
            rawMaxIter !== undefined && rawMaxIter !== null
              ? parseInt(String(rawMaxIter), 10) || undefined
              : undefined,
          freshContext: meta['fresh-context'] === true,
        };
      }

      // injectable defaults: true for knowledge skills, false for command skills.
      // Can be overridden with `injectable: true/false` under metadata.
      const meta = (data.metadata ?? {}) as Record<string, unknown>;
      let injectable: boolean;
      if ('injectable' in meta) {
        injectable = meta.injectable === true;
      } else {
        injectable = !isUserInvocable;
      }

      // Use frontmatter description for semantic matching if available
      const description =
        (data.description ? String(data.description) : '') ||
        extractSkillDescription(raw);

      const rawTags = (data.metadata ?? {} as Record<string, unknown>)['tags'];
      const tags: string[] | undefined = Array.isArray(rawTags)
        ? rawTags.map(String).map(s => s.trim()).filter(Boolean)
        : typeof rawTags === 'string'
        ? rawTags.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;

      skills.set(name, {
        name,
        content: raw,
        filePath: skillMdPath,
        description,
        commandMeta,
        injectable,
        tags,
      });
    } catch (err) {
      Logger.warn(`[Skills] Failed to load ${skillMdPath}: ${err}`);
    }
  }

  return skills;
}
