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
      });
    } catch (err) {
      Logger.warn(`[Skills] Failed to load ${skillMdPath}: ${err}`);
    }
  }

  return skills;
}
