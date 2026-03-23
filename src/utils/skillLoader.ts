import * as fs from 'fs';
import * as path from 'path';
import Logger from './logger';

export interface Skill {
  /** Directory name under `.claude/skills/` */
  name: string;
  /** Full content of SKILL.md */
  content: string;
  /** Absolute path to SKILL.md */
  filePath: string;
  /** Extracted H1 title + first paragraph. Used for semantic similarity matching. */
  description: string;
}

/**
 * Extracts a short description from SKILL.md content.
 * Uses the H1 title and the first paragraph before the first ## section.
 */
export function extractSkillDescription(content: string): string {
  const lines = content.split('\n');
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

  const body = descLines.join(' ');
  if (title && body) return `${title} - ${body}`;
  return title || body || content.slice(0, 200);
}

/**
 * Load all skills from `skillsDir`.
 * Each skill is a directory containing a `SKILL.md` file.
 * Returns a Map keyed by skill name (the directory name).
 */
export function loadSkills(skillsDir: string): Map<string, Skill> {
  const skills = new Map<string, Skill>();

  if (!fs.existsSync(skillsDir)) return skills;

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) continue;

    try {
      const content = fs.readFileSync(skillMdPath, 'utf-8').trim();
      skills.set(entry.name, {
        name: entry.name,
        content,
        filePath: skillMdPath,
        description: extractSkillDescription(content),
      });
    } catch (err) {
      Logger.warn(`[Skills] Failed to load ${skillMdPath}: ${err}`);
    }
  }

  return skills;
}
